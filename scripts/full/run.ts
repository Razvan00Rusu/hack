import {gzipSync} from 'node:zlib';
import {cityMaps} from '../../lib/maps';
import {fullProtocol as P,fullDemand,fullEngine,hashDemand,incidents,stability,type FullScenario,type Arm,type DemandTrip} from './core';
import {makeFullDecisions} from './decisions';
export async function runFull(scenario:FullScenario,arm:Arm,fetcher:typeof fetch){
 const s=fullEngine(scenario,arm),network=s.network,demand=fullDemand(network,scenario.traffic,scenario.seed),events=incidents(scenario),provider=arm.startsWith('openai')?'openai':'openrouter';
 const queues=new Map<string,{trips:DemandTrip[];head:number}>();for(const n of network.boundary)queues.set(n.id,{trips:[],head:0});
 let cursor=0,external=0,externalWait=0,lastCompletion=0,maxQueue=0,finishedCount=0,eventIndex=0,localSeconds=0;
 const finished=new Map<number,number>(),series:any[]=[],frames:any[]=[],decisions:any[]=[];
 const capture=(frame=false)=>{const queued=s.cars.filter(c=>c.stopped).length,row={time:Number(s.time.toFixed(2)),active:s.cars.length,completed:s.completed,queued,external,waiting:s.stoppedSeconds+externalWait,reroutes:s.reroutes};series.push(row);
  if(frame)frames.push({...row,cars:s.cars.map(c=>[c.id,network.roads.indexOf(network.roadById[c.road]),Math.round((c.from===network.roadById[c.road].a?c.progress:1-c.progress)*1000)/1000,c.rerouted?1:0]),signals:Object.values(s.signals.states).map(st=>st.phase),closures:{...s.closures}});
 };
 capture(true);let status='time_limit';
 for(let step=0;step<P.maxEnd/P.dt;step++){
  const now=step*P.dt;
  while(eventIndex<events.length&&events[eventIndex].time<=now+1e-7){const e=events[eventIndex++];s.setClosure(e.road,e.state);}
  while(cursor<demand.length&&demand[cursor].time<=now+1e-7){const t=demand[cursor++];queues.get(t.origin)!.trips.push(t);external++;}
  for(const queue of queues.values()){
   const t=queue.trips[queue.head];if(t&&s.admit(t.origin,t.destination,t.time,t.id)){queue.head++;external--;}
  }
  externalWait+=external*P.dt;localSeconds+=s.cars.reduce((n,c)=>n+(network.roadById[c.road].major?0:1),0)*P.dt;
  s.tick(P.dt);
  if(s.completed!==finishedCount){lastCompletion=s.time;finishedCount=s.completed;for(const c of s.finishedCars)if(!finished.has(c.id))finished.set(c.id,s.time);}
  maxQueue=Math.max(maxQueue,external+s.cars.filter(c=>c.stopped).length);
  if((step+1)%Math.round(P.decisionEvery/P.dt)===0&&arm!=='shortest-fixed')decisions.push(await makeFullDecisions(s,provider,fetcher));
  if((step+1)%Math.round(P.sampleEvery/P.dt)===0)capture((step+1)%Math.round(P.frameEvery/P.dt)===0);
  if(cursor===demand.length&&finished.size===demand.length&&now>=P.demandUntil){status='completed';break;}
  if(now>=P.demandUntil+P.noCompletionTimeout&&s.time-lastCompletion>=P.noCompletionTimeout){status='gridlock_timeout';break;}
 }
 capture(true);
 const durations=[...finished].map(([id,t])=>t-demand[id-1].time).sort((a,b)=>a-b),mean=durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null;
 const requested=demand.length,unfinished=requested-finished.size,elapsed=s.time;
 const exposure=demand.reduce((sum,t)=>sum+(finished.get(t.id)??elapsed)-t.time,0);
 const p95=durations.length?durations[Math.min(durations.length-1,Math.ceil(.95*durations.length)-1)]:null;
 return {...scenario,id:`${scenario.id}--${arm}`,arm,provider:arm==='shortest-fixed'?'none':provider,signalMode:arm.endsWith('demand')?'demand':'fixed',status,endTime:Number(elapsed.toFixed(2)),demandHash:hashDemand(demand),events,
 metrics:{requested,admitted:s.spawned,completed:finished.size,unfinished,notAdmitted:requested-s.spawned,completionRate:finished.size/requested,meanJourneyTime:unfinished?null:mean,meanCompleted:mean,p95JourneyTime:unfinished?null:p95,p95Completed:p95,exposure,meanTruncatedTime:exposure/requested,externalWait,stoppedSeconds:s.stoppedSeconds,totalWaiting:externalWait+s.stoppedSeconds,maxQueue,reroutes:s.reroutes,localSeconds},
 stability:[300,480,660,840,1140].map(t=>stability(series,t)),routeAccepted:s.routeAccepted,routeFallbacks:s.routeFallbacks,signalAccepted:s.signals.accepted,signalFallbacks:s.signals.fallbacks,
 series,framesGzip:gzipSync(JSON.stringify(frames)).toString('base64'),decisions};
}
