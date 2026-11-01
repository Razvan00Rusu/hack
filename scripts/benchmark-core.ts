import { createHash } from 'node:crypto';
import { cityMaps, type CityMap } from '../lib/maps';
import { Simulation, route, type Closure } from '../lib/simulation';
export const arms=['shortest-fixed','openai-fixed','openrouter-fixed','openai-demand','openrouter-demand'] as const;
export type Arm=typeof arms[number];
export type DemandTrip={id:number;time:number;origin:string;destination:string};
export type Scenario={id:string;mapId:string;traffic:'low'|'mid'|'high';closure:'none'|'partial'|'full';seed:number};
export const protocol={seed:42,horizon:75,demandUntil:45,dt:.05,checkpoints:[20,40],incidentStart:15,incidentEnd:50,frameSeconds:2,plannedApiRequests:216,maxApiRequests:219,maxRequestBytes:8000000,trafficRates:{low:.5,mid:1.5,high:3},initialDemand:12};
export function scenarios():Scenario[]{return Object.keys(cityMaps).flatMap(mapId=>(['low','mid','high'] as const).flatMap(traffic=>(['none','partial','full'] as const).map(closure=>({id:`${mapId}-${traffic}-${closure}`,mapId,traffic,closure,seed:protocol.seed}))));}
export function makeDemand(network:CityMap,traffic:Scenario['traffic'],seed=42):DemandTrip[]{
  let state=seed;const random=()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;};
  const result:DemandTrip[]=[];const rate=protocol.trafficRates[traffic];
  const add=(time:number)=>{
    let origin:string,destination:string;
    if(random()<.45){const pair=network.id==='central'?['4-0','4-6']:['0-0','0-4'];if(random()<.5)pair.reverse();[origin,destination]=pair;}
    else {const start=network.boundary[Math.floor(random()*network.boundary.length)];const ends=network.boundary.filter(n=>Math.abs(n.row-start.row)+Math.abs(n.col-start.col)>(network.id==='central'?4:2));origin=start.id;destination=ends[Math.floor(random()*ends.length)].id;}
    result.push({id:result.length+1,time:Number(time.toFixed(3)),origin,destination});
  };
  for(let i=0;i<protocol.initialDemand;i++)add(0);
  for(let time=.25;time<protocol.demandUntil;time+=1/rate)add(time);
  return result;
}
export function demandHash(demand:DemandTrip[]){return createHash('sha256').update(JSON.stringify(demand)).digest('hex');}
export function createEngine(network:CityMap,arm:Arm){
  const provider=arm.startsWith('openai')?'openai':'openrouter';
  const s=new Simulation({provider:arm==='shortest-fixed'?'local':provider,cadence:'interval',intervalSeconds:1,batch:true,information:'network'},{network,initialCars:0,seed:protocol.seed});
  s.automaticDemand=false;s.autoRouting=false;s.adaptive=arm!=='shortest-fixed';
  s.setSignalProvider(provider);if(arm.endsWith('demand'))s.setSignalMode('decisions');
  return s;
}
export function applyIncident(s:Simulation,scenario:Scenario,step:number){
  if(scenario.closure==='none')return;
  if(step===protocol.incidentStart/protocol.dt)s.setClosure(s.network.incidentRoad,scenario.closure==='full'?'closed':'forward');
  if(step===protocol.incidentEnd/protocol.dt)s.setClosure(s.network.incidentRoad,'open');
}
export function admitWaiting(s:Simulation,waiting:DemandTrip[]){
  const blockedOrigins=new Set<string>();const next:DemandTrip[]=[];
  for(const trip of waiting){if(blockedOrigins.has(trip.origin)||!s.admit(trip.origin,trip.destination,trip.time,trip.id)){blockedOrigins.add(trip.origin);next.push(trip);}}
  return next;
}
export function auditClosedEntries(s:Simulation,previous:Map<number,string>){
  for(const c of s.cars)if(previous.get(c.id)!==c.road){
    const r=s.network.roadById[c.road];const closure=s.closures[c.road];
    if(closure==='closed'||closure===(r.a===c.from?'forward':'reverse'))throw new Error('Closed road entry detected');
  }
}
export function summarize(s:Simulation,demand:DemandTrip[],finished:Map<number,number>,externalWait:number,localSeconds:number,maxQueue:number){
  const durations=[...finished.entries()].map(([id,time])=>time-demand[id-1].time).sort((a,b)=>a-b);
  const exposure=demand.reduce((sum,t)=>sum+(finished.get(t.id)??protocol.horizon)-t.time,0);
  const n=demand.length;return {requested:n,admitted:s.spawned,completed:finished.size,unfinished:n-finished.size,notAdmitted:n-s.spawned,completionRate:finished.size/n,meanCompleted:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,p95Completed:durations.length?durations[Math.min(durations.length-1,Math.ceil(durations.length*.95)-1)]:null,exposure,meanTruncatedTime:exposure/n,stoppedSeconds:s.stoppedSeconds,externalWait,totalWaiting:s.stoppedSeconds+externalWait,localSeconds,maxQueue,reroutes:s.reroutes};
}
export type Metrics=ReturnType<typeof summarize>;
export function score(metrics:Metrics,baseline:Metrics){
  const cap=(v:number)=>Math.min(2,Math.max(0,v));
  return 100*(.4*cap(metrics.completionRate/Math.max(.001,baseline.completionRate))+.4*cap(baseline.exposure/Math.max(.001,metrics.exposure))+.2*cap((baseline.totalWaiting+baseline.requested)/(metrics.totalWaiting+metrics.requested)));
}
