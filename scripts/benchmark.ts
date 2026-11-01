import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cityMaps } from '../lib/maps';
import { requestChoices } from '../lib/decision-adapter';
import { decideRoutes, parseRouteInput } from '../lib/route-decisions';
import { decideSignalTimings, parseSignalInput } from '../lib/signal-decisions';
import { isObject, type DecisionProvider } from '../lib/decision-providers';
import { protocol, arms, scenarios, makeDemand, demandHash, createEngine, applyIncident, admitWaiting, auditClosedEntries, summarize, score, type DemandTrip, type Scenario, type Arm } from './benchmark-core';
process.loadEnvFile('.env.local');
const out='reports/initial-pass';mkdirSync(out,{recursive:true});
let apiRequests=0,requestBytes=0,budgetExhausted=false;
const audit:any[]=existsSync(`${out}/api-audit.jsonl`)?readFileSync(`${out}/api-audit.jsonl`,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
apiRequests=audit.length;requestBytes=audit.reduce((s,a)=>s+a.requestBytes,0);
function fetcherFor(provider:DecisionProvider,runId:string):typeof fetch{return async(url,options)=>{
  const expected=provider==='openai'?'https://api.openai.com/v1/decisions':'https://openrouter.ai/api/alpha/decisions';if(url!==expected)throw new Error('Mixed provider request rejected');
  const bytes=Buffer.byteLength(String(options?.body||''));
  if(apiRequests>=protocol.maxApiRequests||requestBytes+bytes>protocol.maxRequestBytes){budgetExhausted=true;throw new Error('Experiment request budget exhausted');}
  apiRequests++;requestBytes+=bytes;const started=performance.now();const body=JSON.parse(String(options?.body));
  const meta:any={runId,provider,request:apiRequests,requestBytes:bytes,questionCount:Array.isArray(body.questions)?body.questions.length:Object.keys(body.questions).length,inputHash:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
  try {const response=await fetch(url,options);meta.status=response.status;
    if(response.ok){const data=await response.clone().json();meta.usage=data.usage;meta.answerCount=Array.isArray(data.answers)?data.answers.length:isObject(data.answers)?Object.keys(data.answers).length:0;}
    return response;
  }catch(e){meta.error=e instanceof Error?e.name:'NetworkError';throw e;}
  finally{meta.latencyMs=performance.now()-started;audit.push(meta);appendFileSync(`${out}/api-audit.jsonl`,JSON.stringify(meta)+'\n');}
};}
async function run(scenario:Scenario,arm:Arm){
  const network=cityMaps[scenario.mapId],demand=makeDemand(network,scenario.traffic,scenario.seed),s=createEngine(network,arm);
  const id=`${scenario.id}--${arm}`,provider=arm.startsWith('openai')?'openai':'openrouter';
  let waiting:DemandTrip[]=[],cursor=0,externalWait=0,localSeconds=0,maxQueue=0;
  const finished=new Map<number,number>(),frames:any[]=[],series:any[]=[],decisions:any[]=[];const startAudit=audit.length;
  const capture=()=>{const queued=s.cars.filter(c=>c.stopped).length;const row={time:Number(s.time.toFixed(2)),active:s.cars.length,completed:s.completed,queued,external:waiting.length,waiting:s.stoppedSeconds+externalWait,reroutes:s.reroutes};series.push(row);
    if(Math.round(s.time)%2===0||s.time>74.9)frames.push({...row,cars:s.cars.map(c=>[c.id,network.roads.findIndex(r=>r.id===c.road),Number((c.from===network.roadById[c.road].a?c.progress:1-c.progress).toFixed(3)),c.rerouted?1:0]),signals:Object.values(s.signals.states).map(st=>st.phase),closures:{...s.closures}});
  };
  capture();
  for(let step=1;step<=protocol.horizon/protocol.dt;step++){
    const nextTime=(step-1)*protocol.dt;
    while(cursor<demand.length&&demand[cursor].time<=nextTime+1e-8)waiting.push(demand[cursor++]);
    waiting=admitWaiting(s,waiting);
    const previous=new Map(s.cars.map(c=>[c.id,c.road]));
    applyIncident(s,scenario,step-1);
    externalWait+=waiting.length*protocol.dt;localSeconds+=s.cars.filter(c=>!network.roadById[c.road].major).length*protocol.dt;
    s.tick(protocol.dt);auditClosedEntries(s,previous);
    for(const c of s.finishedCars)if(!finished.has(c.id))finished.set(c.id,s.time);
    maxQueue=Math.max(maxQueue,s.cars.filter(c=>c.stopped).length+waiting.length);
    if(protocol.checkpoints.some(t=>step===t/protocol.dt)&&arm!=='shortest-fixed'){
      // Barrier mode: simulated time pauses while the two independent decisions run.
      s.requestDecisions();const batches=s.takeRouteBatches();
      const signalBatch=arm.endsWith('demand')?s.signals.takeRequest(s.time,s.signalObservations()):null;
      const jobs=batches.map(async batch=>{const result=await decideRoutes(parseRouteInput({junctions:batch.junctions},network),{provider,fetcher:fetcherFor(provider,id)});s.receiveRouteBatch(batch,result);decisions.push({kind:'routing',time:s.time,provider,result});});
      if(signalBatch)jobs.push((async()=>{const result=await decideSignalTimings(parseSignalInput({junctions:signalBatch.junctions},network),{provider,fetcher:fetcherFor(provider,id)});s.signals.receive(signalBatch,result,s.time);decisions.push({kind:'signals',time:s.time,provider,result});})());
      await Promise.all(jobs);
    }
    if(step%Math.round(1/protocol.dt)===0)capture();
  }
  return {...scenario,id,arm,provider:arm==='shortest-fixed'?'none':provider,signalMode:arm.endsWith('demand')?'demand':'fixed',demandHash:demandHash(demand),metrics:summarize(s,demand,finished,externalWait,localSeconds,maxQueue),series,frames,events:s.events,decisions,routeAccepted:s.routeAccepted,routeFallbacks:s.routeFallbacks,signalAccepted:s.signals.accepted,signalFallbacks:s.signals.fallbacks,api:audit.slice(startAudit).filter(a=>a.runId===id),score:100};
}
async function main(){
  const results:any[]=existsSync(`${out}/checkpoint.json`)?JSON.parse(readFileSync(`${out}/checkpoint.json`,'utf8')).results:[];const list=scenarios();
  if(!process.env.OPENAI_API_KEY||!process.env.OPENROUTER_API_KEY)throw new Error('Both server credentials are required; no benchmark launched.');
  const filename=`${out}/results.json`;
  if(existsSync(filename))throw new Error('Results already exist. Move the initial-pass folder before a new paid run.');
  if(!existsSync(`${out}/preflight.json`)){
    const preflight=[];
    for(const provider of ['openai','openrouter'] as const){
      const r=await requestChoices(provider,{input:'East/west queue 9 vehicles, north/south queue 1 vehicle.',questions:[{type:'choice',name:'preflight',instructions:'Choose the larger queue to serve.',choices:[{value:'east_west',description:'Serve east/west.'},{value:'north_south',description:'Serve north/south.'}]}]});
      preflight.push(r);
      if(!r.answers.length||r.reason)throw new Error(`${provider} preflight failed; no experiment suite launched.`);
    }
    writeFileSync(`${out}/preflight.json`,JSON.stringify(preflight,null,2));
  }
  writeFileSync(`${out}/protocol.json`,JSON.stringify({...protocol,arms,scenarios:list,method:'barrier-synchronised decision-quality screening',models:{openai:'gpt-6-luna',openrouter:'typesafe/jev-1.13'}},null,2));
  // Cells run sequentially; only routing and signal requests within a single-provider arm overlap.
  for(const scenario of list){
    for(const arm of arms){
      if(results.some(r=>r.id===`${scenario.id}--${arm}`))continue;
      const result=await run(scenario,arm);if(budgetExhausted)throw new Error('Budget exhausted; incomplete arm was not added. Completed checkpoints were preserved.');results.push(result);
      console.log(`${results.length}/90 ${result.id}: ${result.metrics.completed}/${result.metrics.requested} completed, ${result.api.length} requests, ${result.routeAccepted} route / ${result.signalAccepted} signal API answers`);
      writeFileSync(`${out}/checkpoint.json`,JSON.stringify({protocol,results,apiRequests,requestBytes}));
    }
  }
  for(const r of results){const baseline=results.find(b=>b.id===`${r.mapId}-${r.traffic}-${r.closure}--shortest-fixed`)!;r.score=score(r.metrics,baseline.metrics);}
  const artifact={generatedAt:new Date().toISOString(),protocol,maps:cityMaps,results,apiRequests,requestBytes,audit,preflight:JSON.parse(readFileSync(`${out}/preflight.json`,'utf8'))};
  writeFileSync(filename,JSON.stringify(artifact));
  console.log(`Saved ${filename}; ${apiRequests} requests, ${requestBytes} request bytes.`);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Benchmark failed');process.exitCode=1;});
