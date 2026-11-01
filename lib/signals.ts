import type { DecisionProvider } from './decision-providers';
export type SignalAxis = 'ew' | 'ns';
export type SignalPhase = SignalAxis | 'all-red';
export type SignalMode = 'fixed' | 'decisions';
export const timingPlans = {
  balanced: { ew: 7, ns: 7, label: 'Balanced' },
  east_west: { ew: 12, ns: 5, label: 'East / west priority' },
  north_south: { ew: 5, ns: 12, label: 'North / south priority' },
} as const;
export type TimingPlan = keyof typeof timingPlans;
export function isTimingPlan(value: unknown): value is TimingPlan { return typeof value === 'string' && Object.hasOwn(timingPlans, value); }
export type ApproachStats = { incoming: number; queued: number; queueWait: number; longestWait: number; arrivals: number; departures: number };
export type SignalObservation = { node: string; phase: SignalPhase; phaseElapsed: number; ew: ApproachStats; ns: ApproachStats };
export type SignalBatch = { provider:DecisionProvider; id: number; version: number; time: number; junctions: SignalObservation[] };
export type SignalAnswer = { node: string; plan: TimingPlan; source: 'api' | 'fallback'; reason: string; confidence?: number };
export type SignalResult = { provider?:DecisionProvider; latencyMs?:number; answers: SignalAnswer[]; unavailable?: boolean };
export type SignalState = { phase: SignalPhase; previous: SignalAxis; since: number; duration: number; plan: TimingPlan; expires: number };
export type SignalReview = SignalAnswer & { provider:DecisionProvider; latencyMs?:number; time: number; snapshotTime: number; request: number };
const clearanceSeconds = 1;
export const signalSnapshotMaxAge = 5;
export const signalPlanLifetime = 20;
export const signalReviewInterval = 4;

export class SignalController {
  planLifetimeSeconds=signalPlanLifetime;
  provider:DecisionProvider='openai';
  setProvider(provider:DecisionProvider,time:number) {
    if(provider===this.provider) return;
    this.provider=provider; this.version++; this.pending=null; this.unavailable=false; this.nextReview=time;
    for(const s of Object.values(this.states)){s.plan='balanced';s.expires=0;}
  }
  mode: SignalMode = 'fixed'; version = 0; requestCount = 0; accepted = 0; fallbacks = 0; stale = 0;
  unavailable = false; pending: SignalBatch | null = null; nextReview = 0;
  states: Record<string, SignalState> = {};
  reviews: SignalReview[] = [];
  constructor(junctions: {id:string; col:number}[]) {
    for (const n of junctions) {
      const offset = n.col * 1.4 % 16;
      const phase = offset < 7 ? 'ew' : offset < 8 ? 'all-red' : offset < 15 ? 'ns' : 'all-red';
      const start = offset < 7 ? 0 : offset < 8 ? 7 : offset < 15 ? 8 : 15;
      this.states[n.id] = { phase, previous: offset < 8 ? 'ew' : 'ns', since: start - offset, duration: phase === 'all-red' ? 1 : 7, plan: 'balanced', expires: 0 };
    }
  }
  setMode(mode: SignalMode, time: number) {
    if (mode === this.mode) return;
    this.mode = mode; this.version++; this.pending = null; this.unavailable = false; this.nextReview = time;
    for (const s of Object.values(this.states)) { s.plan = 'balanced'; s.expires = 0; }
  }
  tick(time: number) {
    for (const s of Object.values(this.states)) {
      if (this.mode === 'fixed' || time >= s.expires) s.plan = 'balanced';
      // The duration of an active green never changes mid-phase.
      while (time + 1e-8 >= s.since + s.duration) {
        s.since += s.duration;
        if (s.phase === 'all-red') {
          s.phase = s.previous === 'ew' ? 'ns' : 'ew';
          s.duration = timingPlans[s.plan][s.phase];
        } else { s.previous = s.phase; s.phase = 'all-red'; s.duration = clearanceSeconds; }
      }
    }
  }
  green(node: string, axis: SignalAxis) { return this.states[node]?.phase === axis; }
  takeRequest(time: number, junctions: SignalObservation[]): SignalBatch | null {
    if (this.mode !== 'decisions' || this.pending || this.unavailable || time + 1e-8 < this.nextReview) return null;
    this.nextReview = time + signalReviewInterval;
    if (!junctions.some(j=>j.ew.incoming || j.ns.incoming)) return null;
    this.pending = { provider:this.provider, id: ++this.requestCount, version: this.version, time, junctions };
    return this.pending;
  }
  receive(batch: SignalBatch, result: SignalResult, time: number) {
    if (this.pending !== batch || batch.version !== this.version || this.mode !== 'decisions') return;
    this.pending = null;
    if (result?.unavailable === true) this.unavailable = true;
    const expired = time - batch.time > signalSnapshotMaxAge;
    for (const j of batch.junctions) {
      const answers = (Array.isArray(result?.answers) ? result.answers : []).filter(a=>a && a.node===j.node);
      const candidate = answers.length === 1 ? answers[0] : undefined;
      const valid = candidate?.source === 'api' && isTimingPlan(candidate.plan) && Number.isFinite(candidate.confidence) && candidate.confidence! >= 0.6 && candidate.confidence! <= 1;
      const answer: SignalAnswer = !expired && valid ? candidate! : {
        node:j.node, plan:'balanced', source:'fallback', reason:expired ? 'Stale snapshot. Fixed timing fallback.' : candidate?.source === 'fallback' && typeof candidate.reason==='string' ? candidate.reason : 'Missing or invalid answer. Fixed timing fallback.',
      };
      if (expired) this.stale++;
      if (answer.source==='api') this.accepted++; else this.fallbacks++;
      const s=this.states[j.node]; s.plan=answer.plan; s.expires=time+this.planLifetimeSeconds;
      this.reviews.unshift({...answer,provider:batch.provider,latencyMs:result?.latencyMs,time,snapshotTime:batch.time,request:batch.id});
    }
    this.reviews=this.reviews.slice(0,100);
  }
}
