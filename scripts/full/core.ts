import {createHash} from 'node:crypto';
import {cityMaps,type CityMap} from '../../lib/maps';
import {Simulation,type Closure} from '../../lib/simulation';
import {arms,type Arm,type DemandTrip} from '../benchmark-core';
export {arms};export type {Arm,DemandTrip};
export const fullProtocol={version:'full-length-v2',seeds:[42,137],dt:.05,demandUntil:1140,warmup:300,changes:[300,480,660,840],drainStarts:1140,maxEnd:7200,noCompletionTimeout:300,decisionEvery:30,signalPlanLifetime:40,sampleEvery:5,frameEvery:10,trafficRates:{mid:1.5,high:3,extra:6},initialDemand:36,workers:8,maxRequests:34564,maxRequestBytes:1500000000};
export const closureKinds=['none','partial','full','multi_full','mixed','cascade'] as const;
export type FullScenario={id:string;mapId:string;traffic:keyof typeof fullProtocol.trafficRates;closure:typeof closureKinds[number];seed:number};
export type Incident={time:number;road:string;state:Closure;label:string};
export function fullScenarios():FullScenario[]{return Object.keys(cityMaps).flatMap(mapId=>(Object.keys(fullProtocol.trafficRates) as FullScenario['traffic'][]).flatMap(traffic=>closureKinds.flatMap(closure=>fullProtocol.seeds.map(seed=>({id:`${mapId}-${traffic}-${closure}-s${seed}`,mapId,traffic,closure,seed})))));}
export function incidents(s:FullScenario):Incident[]{
 const m=cityMaps[s.mapId],a=m.incidentRoad,b=m.id==='central'?'3-3_3-4':'1-2_1-3';
 const event=(time:number,road:string,state:Closure):Incident=>({time,road,state,label:`${m.roadById[road].name}: ${state==='closed'?'both directions closed':state==='open'?'reopened':state+' direction closed'}`});
 switch(s.closure){
  case 'none':return [];
  case 'partial':return [event(300,a,'forward'),event(840,a,'open')];
  case 'full':return [event(300,a,'closed'),event(840,a,'open')];
  case 'multi_full':return [event(300,a,'closed'),event(480,b,'closed'),event(660,a,'open'),event(840,b,'open')];
  case 'mixed':return [event(300,a,'closed'),event(480,b,'forward'),event(660,a,'forward'),event(660,b,'reverse'),event(840,a,'open'),event(840,b,'open')];
  case 'cascade':return [event(300,a,'forward'),event(480,b,'closed'),event(660,a,'reverse'),event(660,b,'forward'),event(840,a,'open'),event(840,b,'open')];
 }
}
export function fullDemand(network:CityMap,traffic:FullScenario['traffic'],seed:number):DemandTrip[]{
 let state=seed;const random=()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;},result:DemandTrip[]=[];
 const add=(time:number)=>{let origin:string,destination:string;
  if(random()<.45){const pair=network.id==='central'?['4-0','4-6']:['0-0','0-4'];if(random()<.5)pair.reverse();[origin,destination]=pair;}
  else{const n=network.boundary[Math.floor(random()*network.boundary.length)],ends=network.boundary.filter(e=>Math.abs(e.row-n.row)+Math.abs(e.col-n.col)>(network.id==='central'?4:2));origin=n.id;destination=ends[Math.floor(random()*ends.length)].id;}
  result.push({id:result.length+1,time:Number(time.toFixed(6)),origin,destination});};
 for(let i=0;i<fullProtocol.initialDemand;i++)add(0);
 for(let t=.25;t<fullProtocol.demandUntil;t+=1/fullProtocol.trafficRates[traffic])add(t);
 return result;
}
export function fullEngine(s:FullScenario,arm:Arm){const provider=arm.startsWith('openai')?'openai':'openrouter';
 const engine=new Simulation({provider:arm==='shortest-fixed'?'local':provider,cadence:'interval',intervalSeconds:1,batch:true,information:'network'},{network:cityMaps[s.mapId],initialCars:0,seed:s.seed});
 engine.automaticDemand=false;engine.autoRouting=false;engine.adaptive=arm!=='shortest-fixed';engine.routeQuestionLimit=180;engine.signals.planLifetimeSeconds=fullProtocol.signalPlanLifetime;
 engine.setSignalProvider(provider);if(arm.endsWith('demand'))engine.setSignalMode('decisions');return engine;
}
export function hashDemand(d:DemandTrip[]){return createHash('sha256').update(JSON.stringify(d)).digest('hex');}
export function stability(series:any[],end:number){
 const rows=series.filter(s=>s.time>end-120&&s.time<=end),a=rows.filter(s=>s.time<=end-60),b=rows.filter(s=>s.time>end-60),avg=(r:any[],key:string)=>r.length?r.reduce((sum,s)=>sum+s[key],0)/r.length:0;
 const drift=(avg(b,'active')-avg(a,'active'))/Math.max(10,avg(a,'active')),queueSlope=(avg(b,'external')-avg(a,'external'))/60;
 const outputA=a.length?(a.at(-1).completed-a[0].completed)/(a.at(-1).time-a[0].time):0,outputB=b.length?(b.at(-1).completed-b[0].completed)/(b.at(-1).time-b[0].time):0;
 const status=queueSlope>.05?'overloaded':Math.abs(queueSlope)<=.05&&Math.abs(drift)<=.1&&Math.abs(outputA-outputB)<=Math.max(.05,outputA*.2)?'steady':'transient';
 return {end,status,occupancyDrift:drift,externalQueueGrowthPerSecond:queueSlope,departuresPerSecond:outputB};
}
export function percentageChange(mean:number|null,baseline:number|null){return mean===null||baseline===null||baseline<=0?null:(mean/baseline-1)*100;}
