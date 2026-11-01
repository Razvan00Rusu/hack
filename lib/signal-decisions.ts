import { requestChoices } from './decision-adapter';
import type { DecisionProvider } from './decision-providers';
// Server-side adapter. Import from the route handler, never a client component.
import { isTimingPlan, timingPlans, type SignalObservation, type SignalResult, type SignalAnswer, type ApproachStats } from './signals';
import { defaultMap, type CityMap } from './maps';
const object = (v: unknown): v is Record<string, unknown> => typeof v==='object' && v!==null && !Array.isArray(v);
const finite = (v: unknown, max: number): v is number => typeof v==='number' && Number.isFinite(v) && v>=0 && v<=max;
export function parseSignalInput(body: unknown,network:CityMap=defaultMap): SignalObservation[] {
  const signalIds=new Set(network.nodes.filter(n=>n.signal).map(n=>n.id));
  if (!object(body) || !Array.isArray(body.junctions) || !body.junctions.length || body.junctions.length>signalIds.size) throw new Error('Invalid junctions');
  const seen=new Set<string>();
  function stats(value: unknown): ApproachStats {
    if (!object(value)) throw new Error('Invalid statistics');
    const result={} as ApproachStats;
    for (const key of ['incoming','queued','queueWait','longestWait','arrivals','departures'] as const) {
      const max=key==='queueWait'||key==='longestWait'?1e9:10000;
      if (!finite(value[key],max)) throw new Error('Invalid statistics');
      result[key]=value[key];
    }
    if (result.queued>result.incoming || result.longestWait>result.queueWait) throw new Error('Invalid queue');
    return result;
  }
  return body.junctions.map(value=>{
    if (!object(value) || typeof value.node!=='string' || !signalIds.has(value.node) || seen.has(value.node) || !['ew','ns','all-red'].includes(String(value.phase)) || !finite(value.phaseElapsed,1e9)) throw new Error('Invalid junction');
    seen.add(value.node);
    return {node:value.node,phase:value.phase as SignalObservation['phase'],phaseElapsed:value.phaseElapsed,ew:stats(value.ew),ns:stats(value.ns)};
  });
}
export function buildSignalDecisionRequest(junctions: SignalObservation[]) {
  return {
    model:'gpt-6-luna',
    input: 'Synthetic traffic simulation. Choose a timing plan independently for each signal using incoming vehicles, stopped queues, accumulated stopped seconds on the current approach, longest wait, and arrivals/departures over the last 10 simulated seconds. Reduce queue waiting and serve sustained demand. Protect the opposing direction from starvation. Empty or similar demand should use balanced. Plans apply at future green boundaries; the simulator enforces clearance and bounded green times. Evidence: '+JSON.stringify(junctions),
    questions: junctions.map(j=>({
      type:'choice' as const, name:`signal_${j.node}`,
      instructions:`Choose the next timing plan for junction ${j.node} only. Give weight to both queue length and wait duration, then incoming flow. Prefer balanced if demand is low or similar.`,
      choices:Object.entries(timingPlans).map(([value,p])=>({value,description:`${p.label}: east/west green ${p.ew}s, north/south green ${p.ns}s, with 1s all-red between phases.`})),
    })),
  };
}
export function fixedFallback(junctions: SignalObservation[], reason: string): SignalResult {
  return {answers:junctions.map(j=>({node:j.node,plan:'balanced',source:'fallback',reason}))};
}
export function parseSignalAnswers(data: unknown, junctions: SignalObservation[]): SignalResult {
  const answers=object(data)&&Array.isArray(data.answers)?data.answers:[];
  return {answers:junctions.map((j):SignalAnswer=>{
    const matches=answers.filter(a=>object(a)&&a.name===`signal_${j.node}`);
    const a=matches.length===1?matches[0]:undefined;
    if (object(a) && a.type==='choice' && isTimingPlan(a.choice) && finite(a.confidence,1) && a.confidence>=0.6) {
      return {node:j.node,plan:a.choice,source:'api',confidence:a.confidence,reason:`${timingPlans[a.choice].label}. E/W queue ${j.ew.queued}, ${j.ew.queueWait.toFixed(1)}s stopped; N/S queue ${j.ns.queued}, ${j.ns.queueWait.toFixed(1)}s stopped.`};
    }
    return {node:j.node,plan:'balanced',source:'fallback',reason:object(a)&&a.type==='refusal'?'API refusal. Fixed timing fallback.':'Missing, invalid or low-confidence answer. Fixed timing fallback.'};
  })};
}
export async function decideSignalTimings(junctions: SignalObservation[], options: {provider?:DecisionProvider; apiKey?:string; fetcher?:typeof fetch} = {}): Promise<SignalResult> {
  const result=await requestChoices(options.provider||'openai',buildSignalDecisionRequest(junctions),options);
  if(result.reason) return {...fixedFallback(junctions,`${result.reason} Fixed timing fallback.`),unavailable:result.unavailable,provider:result.provider,latencyMs:result.latencyMs};
  return {...parseSignalAnswers(result,junctions),provider:result.provider,latencyMs:result.latencyMs};
}
