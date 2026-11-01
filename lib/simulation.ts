import { decisionProviders, type DecisionProvider, type RoutingProvider } from './decision-providers';
import { type RouteBatch, type RouteVehicle, type RouteResult, type RouteApiReview } from './route-requests';
import { SignalController, type SignalAxis, type SignalObservation, type ApproachStats } from './signals';
import { defaultMap, type Node, type Road, type CityMap } from './maps';
export type {Node,Road} from './maps';
export type Closure = 'open' | 'forward' | 'reverse' | 'closed';
export type RouteVersion = { nodes: string[]; time: number; reason: string };
export type Sample = { queued: number; stoppedSeconds: number; averageVehicleAge: number | null; time: number; vehicles: number; completed: number; reroutes: number; congested: number; completedChange: number; reroutesChange: number };
export type NetworkEvent = { id: number; time: number; label: string };
export type Car = { approachWait?: number; stopped?: boolean; originalRoute: string[]; travelled: string[]; routeHistory: RouteVersion[]; finished?: boolean; id: number; from: string; to: string; road: string; progress: number; destination: string; route: string[]; origin: string; rerouted: boolean; reason: string; born: number; wait: number };
export type Decision = { id: number; time: number; node: string; car: number; reason: string; road: string; kind: 'closure' | 'congestion' | 'system' };
export type DecisionSettings = {
  provider: RoutingProvider;
  information: 'local' | 'neighbours' | 'network';
  cadence: 'every-vehicle' | 'interval';
  intervalSeconds: 1 | 4 | 10;
  batch: boolean;
};
export const defaultDecisionSettings: DecisionSettings = { provider:'local', information: 'network', cadence: 'interval', intervalSeconds: 4, batch: true };
export type JunctionRequest = {
  id: number; batchId: number; time: number; node: string; cars: number[];
  settings: DecisionSettings; observedLoads: Record<string, number>; changed: number;
};
export { cityMaps, defaultMap, type CityMap } from './maps';
export const {nodes,roads,nodeById,roadById,boundary,incidentRoad}=defaultMap;
export function traversable(road: Road, from: string, closures: Record<string, Closure>) { return closures[road.id] !== 'closed' && !(closures[road.id] === 'forward' && from === road.a) && !(closures[road.id] === 'reverse' && from === road.b); }
export function pathCost(path: string[], loads: Record<string, number>, adaptive: boolean, network:CityMap=defaultMap) {
  const {nodeById}=network;
  let cost = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const r = between(path[i], path[i + 1],network), load = (loads[r.id] || 0) / r.capacity;
    cost += r.length / (r.major ? 30 : 21) * (adaptive ? 1 + 5 * load * load : 1) + (nodeById[path[i+1]].signal ? 0.7 : 0.15);
  }
  return cost;
}
export function route(start: string, end: string, closures: Record<string, Closure>, loads: Record<string, number> = {}, adaptive = true, network:CityMap=defaultMap): string[] {
  const {nodes,roads,nodeById}=network;
  const dist: Record<string, number> = { [start]: 0 }, prev: Record<string, string> = {}; const todo = new Set(nodes.map(n => n.id));
  while (todo.size) {
    const current = [...todo].reduce((a, b) => (dist[a] ?? Infinity) < (dist[b] ?? Infinity) ? a : b);
    if (!Number.isFinite(dist[current])) break;
    todo.delete(current); if (current === end) break;
    for (const road of roads.filter(r => r.a === current || r.b === current)) {
      if (!traversable(road, current, closures)) continue;
      const next = road.a === current ? road.b : road.a;
      const load = (loads[road.id] || 0) / road.capacity;
      const cost = road.length / (road.major ? 30 : 21) * (adaptive ? 1 + 5 * load * load : 1) + (nodeById[next].signal ? 0.7 : 0.15);
      if ((dist[next] ?? Infinity) > dist[current] + cost) { dist[next] = dist[current] + cost; prev[next] = current; }
    }
  }
  if (start !== end && !prev[end]) return [];
  const path = [end]; while (path[0] !== start) path.unshift(prev[path[0]]); return path;
}
const graphLinks=new WeakMap<CityMap,Map<string,Road>>();
export function between(a: string, b: string, network:CityMap=defaultMap) {
  let links=graphLinks.get(network);if(!links){links=new Map();for(const r of network.roads){links.set(`${r.a}|${r.b}`,r);links.set(`${r.b}|${r.a}`,r);}graphLinks.set(network,links);}
  return links.get(`${a}|${b}`)!;
}
export function position(car: Car,network:CityMap=defaultMap) { const {nodeById}=network; const a = nodeById[car.from], b = nodeById[car.to]; const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); return { x: a.x + dx * car.progress + dy / len * 4, y: a.y + dy * car.progress - dx / len * 4, angle: Math.atan2(dy, dx) * 180 / Math.PI }; }
export class Simulation {
  cars: Car[] = []; finishedCars: Car[] = []; history: Sample[] = []; events: NetworkEvent[] = []; eventId = 0; time = 0; completed = 0; reroutes = 0; tripSeconds = 0; spawned = 0; closures: Record<string, Closure> = {}; adaptive = true; demand = 1; decisions: Decision[] = []; seed = 42; spawnCredit = 0; decisionId = 0;
  network:CityMap;
  signals:SignalController;
  autoRouting=true;
  automaticDemand=true;
  routeQuestionLimit=200;
  private freeFlowCache=new Map<string,string[]>();
  private findRoute(start:string,end:string,closures:Record<string,Closure>,loads:Record<string,number>={},adaptive=true){
    if(adaptive)return route(start,end,closures,loads,true,this.network);
    const key=start+'|'+end+'|'+JSON.stringify(closures);let path=this.freeFlowCache.get(key);
    if(!path){path=route(start,end,closures,{},false,this.network);this.freeFlowCache.set(key,path);}return [...path];
  }
  private between(a:string,b:string){return between(a,b,this.network);}
  private pathCost(path:string[],loads:Record<string,number>,adaptive:boolean){return pathCost(path,loads,adaptive,this.network);}
  stoppedSeconds = 0;
  private signalFlows: {time:number; node:string; axis:SignalAxis; kind:'arrivals'|'departures'}[] = [];
  private incomingApproaches = new Set<string>();
  setSignalMode(mode: 'fixed' | 'decisions') {
    if (mode===this.signals.mode) return;
    this.signals.setMode(mode,this.time);
    this.event(mode==='fixed' ? 'Fixed signal timing' : 'Decisions signal timing');
  }
  signalObservations(): SignalObservation[] {
    this.signalFlows = this.signalFlows.filter(f=>f.time>this.time-10);
    return this.network.nodes.filter(n=>n.signal).map(n=>{
      const stats = (axis:SignalAxis): ApproachStats => {
        const cars=this.cars.filter(c=>c.to===n.id && (this.network.nodeById[c.from].row===n.row ? 'ew':'ns')===axis);
        const queued=cars.filter(c=>c.stopped);
        const flows=this.signalFlows.filter(f=>f.node===n.id&&f.axis===axis);
        return {incoming:cars.length,queued:queued.length,queueWait:queued.reduce((sum,c)=>sum+(c.approachWait||0),0),longestWait:Math.max(0,...queued.map(c=>c.approachWait||0)),arrivals:flows.filter(f=>f.kind==='arrivals').length,departures:flows.filter(f=>f.kind==='departures').length};
      };
      const state=this.signals.states[n.id];
      return {node:n.id,phase:state.phase,phaseElapsed:Math.max(0,this.time-state.since),ew:stats('ew'),ns:stats('ns')};
    });
  }
  private observeSignalFlow() {
    this.signalFlows=this.signalFlows.filter(f=>f.time>this.time-10);
    const active=new Set<string>();
    for (const c of this.cars) if (this.network.nodeById[c.to].signal) {
      const key=this.approachKey(c); active.add(key);
      if (!this.incomingApproaches.has(key)) this.signalFlows.push({time:this.time,node:c.to,axis:this.network.nodeById[c.from].row===this.network.nodeById[c.to].row?'ew':'ns',kind:'arrivals'});
    }
    this.incomingApproaches=active;
  }
  setSignalProvider(provider:DecisionProvider) {
    if(provider===this.signals.provider) return;
    this.signals.setProvider(provider,this.time);this.event(`Signal provider: ${decisionProviders[provider].label}`);
  }
  routeApiRequests=0; routeAccepted=0; routeFallbacks=0; routeUnavailable=false; routeReviews:RouteApiReview[]=[];
  private routeVersion=0; private closureVersion=0;
  private routePending=new Map<number,RouteBatch>(); private routeOutbox:RouteBatch[]=[];
  private invalidateRouteRequests() {this.routeVersion++;this.routePending.clear();this.routeOutbox=[];this.routeUnavailable=false;}
  takeRouteBatches() {return this.routeOutbox.splice(0);}
  private routeVehicle(c:Car,loads:Record<string,number>):RouteVehicle {
    const paths:string[][]=[];
    const add=(path:string[])=>{if(path.length && !paths.some(p=>p.join()===path.join()) && path.every((n,i)=>i===path.length-1||traversable(this.between(n,path[i+1]),n,this.closures)))paths.push([...path]);};
    add(c.route);add(this.findRoute(c.to,c.destination,this.closures,loads,true));
    if(c.route.length>1){const first=this.between(c.route[0],c.route[1]);add(this.findRoute(c.to,c.destination,{...this.closures,[first.id]:first.a===c.to?'forward':'reverse'},loads,true));}
    return {car:c.id,from:c.from,node:c.to,destination:c.destination,current:[...c.route],candidates:paths.map((path,i)=>({value:`route_${i}`,path,cost:this.pathCost(path,loads,true)}))};
  }
  receiveRouteBatch(batch:RouteBatch,result:RouteResult) {
    if(this.routePending.get(batch.id)!==batch||batch.version!==this.routeVersion||!this.adaptive) return;
    this.routePending.delete(batch.id);
    if(result?.unavailable===true)this.routeUnavailable=true;
    for(const j of batch.junctions)for(const vehicle of j.vehicles){
      const c=this.cars.find(c=>c.id===vehicle.car);if(!c||c.to!==j.node||c.from!==vehicle.from)continue;
      const answers=(Array.isArray(result?.answers)?result.answers:[]).filter(a=>a&&a.node===j.node&&a.car===c.id);
      const a=answers.length===1?answers[0]:undefined;
      const offered=vehicle.candidates.find(p=>p.value===a?.choice);
      const fresh=this.time-batch.time<=5 && batch.closureVersion===this.closureVersion && c.route.join()===vehicle.current.join();
      const valid=fresh&&a?.source==='api'&&offered&&Number.isFinite(a.confidence)&&a.confidence!>=.6&&a.confidence!<=1&&offered.path.every((n,i)=>i===offered.path.length-1||traversable(this.between(n,offered.path[i+1]),n,this.closures));
      const loads=this.junctionLoads(this.network.nodeById[j.node]);
      const path=valid?offered.path:this.findRoute(c.to,c.destination,this.closures,loads,true);
      const prefix=valid?`${decisionProviders[batch.provider].label}`:`${decisionProviders[batch.provider].label} fallback`;
      const changed=path.length&&path.join()!==c.route.join()&&this.pathCost(path,loads,true)<this.pathCost(c.route,loads,true)*.85;
      const reason=changed?`${prefix}: traffic light ${j.node} recommends ${this.between(path[0],path[1]).name}.`:`${prefix}: keep the current route.`;
      if(changed)this.updateRoute(c,path,reason);
      if(valid)this.routeAccepted++;else this.routeFallbacks++;
      this.log('congestion',this.network.nodeById[j.node],c.id,c.road,reason);
      this.routeReviews.unshift({node:j.node,car:c.id,source:valid?'api':'fallback',choice:valid?a!.choice:undefined,confidence:valid?a!.confidence:undefined,reason:valid?reason:!fresh?'Stale snapshot or changed route. Local routing fallback.':a?.reason||'Invalid answer. Local routing fallback.',provider:batch.provider,time:this.time,latencyMs:result?.latencyMs});
      const record=this.requests.find(r=>r.batchId===batch.id&&r.node===j.node);if(record&&changed)record.changed++;
    }
    this.routeReviews=this.routeReviews.slice(0,100);
  }
  decisionSettings: DecisionSettings;
  requests: JunctionRequest[] = []; requestCount = 0; batchCount = 0; vehicleDecisionCount = 0;
  private lastRouteReview=new Map<number,number>();
  private requestedApproaches = new Set<string>();
  private nextRequestTime = 4;
  setDecisionSettings(settings: Partial<DecisionSettings>) {
    const next = { ...this.decisionSettings, ...settings };
    if (JSON.stringify(next) === JSON.stringify(this.decisionSettings)) return;
    this.invalidateRouteRequests();
    this.decisionSettings = next;
    this.requestedApproaches.clear(); this.nextRequestTime = this.time + next.intervalSeconds;
    this.event(`Decision settings: ${next.provider==='local'?'Local heuristic':decisionProviders[next.provider].label}, ${next.information}, ${next.cadence === 'interval' ? `every ${next.intervalSeconds}s` : 'every vehicle'}, ${next.batch ? 'batched' : 'separate'}`);
  }
  random() { this.seed = (1664525 * this.seed + 1013904223) >>> 0; return this.seed / 4294967296; }
  constructor(settings: Partial<DecisionSettings> = {}, options:{network?:CityMap;initialCars?:number;seed?:number}={}) { this.network=options.network||defaultMap;this.signals=new SignalController(this.network.nodes.filter(n=>n.signal));this.seed=options.seed??42; this.decisionSettings = { ...defaultDecisionSettings, ...settings }; this.nextRequestTime = this.decisionSettings.intervalSeconds; for (let i = 0; i < (options.initialCars??75); i++) { this.spawn(); const c = this.cars.at(-1); if (c) c.progress = this.random() * 0.85; } this.sample(); }
  loads() { const result: Record<string, number> = {}; for (const c of this.cars) result[c.road] = (result[c.road] || 0) + 1; return result; }
  averageVehicleAge() {
    return this.cars.length ? this.cars.reduce((sum, car) => sum + this.time - car.born, 0) / this.cars.length : null;
  }
  sample() {
    const loads = this.loads();
    const beforeWindow = this.history.findLast(s => s.time <= this.time - 10 + 1e-8);
    const value: Sample = { queued: this.cars.filter(c=>c.stopped).length, stoppedSeconds: this.stoppedSeconds, averageVehicleAge: this.averageVehicleAge(), time: this.time, vehicles: this.cars.length, completedChange: this.completed - (beforeWindow?.completed || 0), reroutesChange: this.reroutes - (beforeWindow?.reroutes || 0), completed: this.completed, reroutes: this.reroutes, congested: this.network.roads.filter(r => (loads[r.id] || 0) / r.capacity > 0.8).length };
    if (this.history.at(-1)?.time === this.time) this.history[this.history.length - 1] = value;
    else this.history.push(value);
    this.history = this.history.slice(-901);
  }
  event(label: string) { this.events.push({ id: ++this.eventId, time: this.time, label }); this.events = this.events.slice(-300); this.sample(); }
  setDemand(value: number) { if (this.demand === value) return; this.demand = value; this.event(`Demand ${value.toFixed(1)}×`); }
  setAdaptive(value: boolean) { if (this.adaptive === value) return; this.adaptive = value; this.invalidateRouteRequests(); this.requestedApproaches.clear(); this.nextRequestTime = this.time + this.decisionSettings.intervalSeconds; this.replan(); this.event(value ? 'Coordinated routing' : 'Shortest-path routing'); }
  updateRoute(c: Car, path: string[], reason: string) {
    if (path.join() === c.route.join() || !path.length) return;
    c.route = [...path]; c.rerouted = true; this.reroutes++; c.reason = reason;
    c.routeHistory.push({ nodes: [...c.travelled, ...path], time: this.time, reason });
  }
  spawn() {
    if (this.cars.length >= 450) return;
    // Entry probabilities follow the capacity of this.network.roads touching each this.network.boundary node.
    const weights = this.network.boundary.map(n => this.network.roads.filter(r => r.a === n.id || r.b === n.id).reduce((s, r) => s + r.capacity, 0));
    let pick = this.random() * weights.reduce((a, b) => a + b, 0), index = 0;
    while (pick > weights[index] && index < this.network.boundary.length - 1) pick -= weights[index++];
    const start = this.network.boundary[index], ends = this.network.boundary.filter(n => Math.abs(n.row - start.row) + Math.abs(n.col - start.col) > (this.network.id==='central'?4:2));
    const end = ends[Math.floor(this.random() * ends.length)]; if(end)this.admit(start.id,end.id);
  }
  admit(startId:string,endId:string,born=this.time,id?:number) {
    if(this.cars.length>=450)return false;
    const path = this.findRoute(startId, endId, this.closures, {}, false); if (path.length < 2) return false;
    const road = this.between(path[0], path[1]);
    if (this.cars.some(c => c.road === road.id && c.from === startId && c.progress < 0.08)) return false;
    this.cars.push({ originalRoute: this.findRoute(startId, endId, {}, {}, false), travelled: [startId], routeHistory: [{nodes: [...path], time: this.time, reason: 'Initial recommendation'}], id: id??this.spawned+1, from: path[0], to: path[1], origin: path[0], destination: endId, road: road.id, progress: 0, route: path.slice(1), rerouted: false, reason: 'Following the fastest available route.', born: born, wait: 0 });
    this.spawned++; return true;
  }
  setClosure(id: string, state: Closure) {
    if ((this.closures[id] || 'open') === state) return;
    this.closures[id] = state; this.closureVersion++;
    const road = this.network.roadById[id], horizontal = this.network.nodeById[road.a].row === this.network.nodeById[road.b].row;
    const direction = state === 'forward' ? (horizontal ? 'Eastbound' : 'Southbound') : (horizontal ? 'Westbound' : 'Northbound');
    this.replan();
    this.event(`${this.network.roadById[id].name}: ${state === 'open' ? 'reopened' : state === 'closed' ? 'closed' : state === 'forward' ? `${direction} (A → B) blocked` : `${direction} (B → A) blocked`}`);
    this.log('system', this.network.nodeById[this.network.roadById[id].a], 0, id, state === 'open' ? `${this.network.roadById[id].name} reopened. Routes can use this link again.` : `${this.network.roadById[id].name}: ${state === 'closed' ? 'both directions closed' : state === 'forward' ? `${direction} (A → B) blocked` : `${direction} (B → A) blocked`}. Vehicles already on the link clear it; upstream traffic replans.`);
  }
  log(kind: Decision['kind'], node: Node, car: number, road: string, reason: string) { this.decisions.unshift({ id: ++this.decisionId, time: this.time, node: node.id, car, road, reason, kind }); this.decisions = this.decisions.slice(0, 40); }
  // Closure repair is a local safety operation, independent of decision requests.
  replan() {
    for (const c of this.cars) {
      const invalid = c.route.some((n, i) => i < c.route.length - 1 && !traversable(this.between(n, c.route[i + 1]), n, this.closures));
      if (invalid) this.updateRoute(c, this.findRoute(c.to, c.destination, this.closures, {}, false), 'Road closure ahead. Following a locally validated diversion.');
    }
  }
  private approachKey(c: Car) { return `${c.id}:${c.from}:${c.to}`; }
  private junctionLoads(node: Node) {
    const scope = this.decisionSettings.information;
    const visible = new Set([node.id]);
    if (scope === 'neighbours') for (const r of this.network.roads) {
      if (r.a === node.id) visible.add(r.b);
      if (r.b === node.id) visible.add(r.a);
    }
    const occupancy = this.loads(), loads: Record<string, number> = {};
    for (const r of this.network.roads) if (scope === 'network' || visible.has(r.a) || visible.has(r.b)) loads[r.id] = occupancy[r.id] || 0;
    // Only network visibility includes other junctions' planned-flow reservations.
    if (scope === 'network') for (const c of this.cars) for (let i = 0; i < c.route.length - 1; i++) {
      const id = this.between(c.route[i], c.route[i + 1]).id; loads[id] += 0.25;
    }
    return loads;
  }
  requestDecisions() {
    if (!this.adaptive || this.routePending.size) return;
    const active = new Set(this.cars.map(c => this.approachKey(c)));
    for (const key of this.requestedApproaches) if (!active.has(key)) this.requestedApproaches.delete(key);
    const everyVehicle = this.decisionSettings.cadence === 'every-vehicle';
    if (!everyVehicle && this.time + 1e-8 < this.nextRequestTime) return;
    if (!everyVehicle) this.nextRequestTime = this.time + this.decisionSettings.intervalSeconds;
    const groups = this.network.nodes.filter(n => n.signal).map(node => ({ node, cars: this.cars.filter(c => c.to === node.id && c.destination !== node.id && (!everyVehicle || !this.requestedApproaches.has(this.approachKey(c)))) })).filter(g => g.cars.length).map(g => ({ ...g, loads: this.junctionLoads(g.node) }));
    if (!groups.length) return;
    // Bound each review round to the common provider question limit.
    for(const id of this.lastRouteReview.keys())if(!this.cars.some(c=>c.id===id))this.lastRouteReview.delete(id);
    const limit=this.decisionSettings.provider==='local'||this.routeUnavailable?Infinity:this.routeQuestionLimit;
    const selected=new Set(groups.flatMap(g=>g.cars).sort((a,b)=>(this.lastRouteReview.get(a.id)??-Infinity)-(this.lastRouteReview.get(b.id)??-Infinity)||a.id-b.id).slice(0,limit).map(c=>c.id));
    for(const g of groups)g.cars=g.cars.filter(c=>selected.has(c.id));
    const sharedBatch = this.decisionSettings.batch ? ++this.batchCount : 0;
    // Each light owns its vehicle reviews. Batching changes transport accounting only.
    for (const { node, cars, loads } of groups) {
      if(!cars.length)continue;
      const request: JunctionRequest = { id: ++this.requestCount, batchId: sharedBatch || ++this.batchCount, time: this.time, node: node.id, cars: cars.map(c => c.id), settings: { ...this.decisionSettings }, observedLoads: { ...loads }, changed: 0 };
      if(this.decisionSettings.provider!=='local' && !this.routeUnavailable) {
        const junction={node:node.id,observedLoads:{...loads},vehicles:cars.map(c=>this.routeVehicle(c,loads))};
        let batch=this.routePending.get(request.batchId);
        if(!batch){batch={id:request.batchId,version:this.routeVersion,closureVersion:this.closureVersion,time:this.time,provider:this.decisionSettings.provider,junctions:[]};this.routePending.set(batch.id,batch);this.routeOutbox.push(batch);this.routeApiRequests++;}
        batch.junctions.push(junction);
        for(const c of cars){this.requestedApproaches.add(this.approachKey(c));this.lastRouteReview.set(c.id,this.time);this.vehicleDecisionCount++;}
        this.requests.unshift(request);continue;
      }
      for (const c of cars) {
        this.requestedApproaches.add(this.approachKey(c)); this.lastRouteReview.set(c.id,this.time); this.vehicleDecisionCount++;
        const old = c.route, path = this.findRoute(node.id, c.destination, this.closures, loads, true);
        const changed = path.length && path.join() !== old.join() && this.pathCost(path, loads, true) < this.pathCost(old, loads, true) * 0.85;
        if (changed) {
          this.updateRoute(c, path, `Traffic light ${node.id} recommends ${this.between(path[0], path[1]).name} based on ${this.decisionSettings.information} traffic.`);
          request.changed++;
        }
        this.log('congestion', node, c.id, c.road, `${this.routeUnavailable?'Provider unavailable; local fallback. ':''}${changed ? c.reason : `Traffic light ${node.id} reviewed the route. Keep the current recommendation.`}`);
        if(this.routeUnavailable)this.routeFallbacks++;
      }
      this.requests.unshift(request);
    }
    this.requests = this.requests.slice(0, 100);
  }
  tick(dt: number) {
    this.time += dt; if(this.automaticDemand)this.spawnCredit += dt * 3.6 * this.demand;
    while (this.spawnCredit >= 1) { this.spawnCredit--; this.spawn(); }
    this.signals.tick(this.time);
    this.observeSignalFlow();
    if(this.autoRouting)this.requestDecisions();
    const loads = this.loads(), exited = new Set<number>();
    const lanes=new Map<string,Car[]>();
    const laneKey=(road:string,from:string)=>road+'|'+from;
    for(const car of this.cars){const key=laneKey(car.road,car.from);const lane=lanes.get(key)||[];lane.push(car);lanes.set(key,lane);}
    const ordered = [...this.cars].sort((a, b) => b.progress - a.progress);
    for (const c of ordered) {
      const road = this.network.roadById[c.road];
      const lane=lanes.get(laneKey(c.road,c.from))!;
      let ahead:Car|undefined;for(const o of lane)if(o.id!==c.id&&o.progress>c.progress&&(!ahead||o.progress<ahead.progress))ahead=o;
      const signal = this.network.nodeById[c.to]; const horizontal = this.network.nodeById[c.from].row === signal.row;
      const green = !signal.signal || this.signals.green(signal.id, horizontal ? 'ew' : 'ns');
      const limit = Math.min(ahead ? Math.max(c.progress, ahead.progress - 0.065) : 1, !green ? Math.max(c.progress, 0.89) : 1);
      const speed = (road.major ? 29 : 21) / (1 + Math.max(0, (loads[road.id] || 0) / road.capacity - 0.7) * 1.5);
      const oldProgress = c.progress; c.progress = Math.min(limit, c.progress + dt * speed / road.length);
      const measureWait = () => {
        c.stopped = c.progress <= oldProgress;
        if (c.stopped) { c.wait += dt; c.approachWait = (c.approachWait || 0) + dt; this.stoppedSeconds += dt; }
      };
      if (c.progress >= 0.999) {
        if (!green) { measureWait(); continue; }
        if (c.to === c.destination) { if (signal.signal) this.signalFlows.push({time:this.time,node:c.to,axis:horizontal?'ew':'ns',kind:'departures'}); exited.add(c.id); c.travelled.push(c.to); c.finished = true; this.finishedCars.push(c); this.finishedCars = this.finishedCars.slice(-100); this.completed++; this.tripSeconds += this.time - c.born; continue; }
        if (c.route[0] !== c.to || c.route.length < 2 || !traversable(this.between(c.to, c.route[1]), c.to, this.closures)) this.updateRoute(c, this.findRoute(c.to, c.destination, this.closures, {}, false), 'Replanned at the junction because the previous route is unavailable.');
        if (c.route.length < 2 || !traversable(this.between(c.to, c.route[1]), c.to, this.closures)) { c.progress = 0.99; measureWait(); continue; }
        const next = c.route[1], link = this.between(c.to, next);
        if ((lanes.get(laneKey(link.id,c.to))||[]).some(o=>o.id!==c.id&&o.progress<0.075)) { c.progress = 0.99; measureWait(); continue; }
        if (signal.signal) this.signalFlows.push({time:this.time,node:c.to,axis:horizontal?'ew':'ns',kind:'departures'});
        c.approachWait=0; c.stopped=false;
        c.travelled.push(c.to);
        lane.splice(lane.indexOf(c),1);const nextKey=laneKey(link.id,c.to),nextLane=lanes.get(nextKey)||[];nextLane.push(c);lanes.set(nextKey,nextLane);
        c.from = c.to; c.to = next; c.road = link.id; c.progress = 0; c.route = c.route.slice(1);
      } else measureWait();
    }
    this.cars = this.cars.filter(c => !exited.has(c.id));
    if (Math.floor(this.time) !== Math.floor(this.time - dt)) this.sample();
  }
}
