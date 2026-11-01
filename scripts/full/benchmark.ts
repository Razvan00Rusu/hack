import {fork,type ChildProcess} from 'node:child_process';
import {mkdirSync,existsSync,readFileSync,writeFileSync,appendFileSync,readdirSync} from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {requestChoices} from '../../lib/decision-adapter';
import {cityMaps} from '../../lib/maps';
import {fullProtocol as P,fullScenarios,arms,percentageChange} from './core';
process.loadEnvFile('.env.local');
const out='reports/full-length';for(const dir of [out,out+'/runs',out+'/responses'])mkdirSync(dir,{recursive:true});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const tasks=fullScenarios().flatMap(scenario=>arms.map(arm=>({scenario,arm,id:`${scenario.id}--${arm}`})));
const audit:any[]=existsSync(out+'/api-audit.jsonl')?readFileSync(out+'/api-audit.jsonl','utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
let calls=audit.length,bytes=audit.reduce((sum,r)=>sum+r.requestBytes,0),done=0,cached=0;
let httpActive=0;const httpWaiters:(()=>void)[]=[];
async function acquireHttp(){if(httpActive>=4)await new Promise<void>(r=>httpWaiters.push(r));httpActive++;}
function releaseHttp(){httpActive--;httpWaiters.shift()?.();}
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
let nextOpenAI=Date.now()+60000,openAICooldown=nextOpenAI;
async function pace(provider:string,requestBytes:number){
 if(provider!=='openai')return;
 const at=Math.max(Date.now(),nextOpenAI,openAICooldown);
 nextOpenAI=at+Math.ceil((requestBytes*.53+200)/32000*1000);
 if(at>Date.now())await delay(at-Date.now());
 while(Date.now()<openAICooldown)await delay(Math.min(60000,openAICooldown-Date.now()));
}
const workers=new Set<ChildProcess>(),inFlight=new Map<string,Promise<any>>();let failed=false;
async function fetchMessage(child:ChildProcess,message:any,task:any){
 const body=JSON.parse(message.body),provider=body.model==='gpt-6-luna'?'openai':body.model==='typesafe/jev-1.13'?'openrouter':null;
 if(!provider||!task.arm.startsWith(provider))throw new Error('Mixed-provider request rejected');
 const expected=provider==='openai'?'https://api.openai.com/v1/decisions':'https://openrouter.ai/api/alpha/decisions';if(message.url!==expected)throw new Error('Unexpected endpoint');
 const key=hash(message.body),cache=out+'/responses/'+key+'.json.gz';let payload:any;
 if(existsSync(cache)){payload=JSON.parse(gunzipSync(readFileSync(cache)).toString());cached++;}
 else if(inFlight.has(key)){payload=await inFlight.get(key);cached++;}
 else{
  const work=(async()=>{
   const requestBytes=Buffer.byteLength(message.body);
   for(let attempt=1;attempt<=3;attempt++){
    if(calls>=P.maxRequests||bytes+requestBytes>P.maxRequestBytes)throw new Error('Hard API budget reached');
    const queuedAt=performance.now();await pace(provider,requestBytes);await acquireHttp();
    const request=++calls;bytes+=requestBytes;const started=performance.now(),meta:any={runId:task.id,provider,request,attempt,requestBytes,inputHash:key,queueWaitMs:started-queuedAt,questionCount:Array.isArray(body.questions)?body.questions.length:Object.keys(body.questions).length};
    let retry=false;
    try{
     const r=await fetch(expected,{method:'POST',headers:{Authorization:`Bearer ${process.env[provider==='openai'?'OPENAI_API_KEY':'OPENROUTER_API_KEY']}`,'Content-Type':'application/json'},body:message.body,signal:AbortSignal.timeout(3000)});
     const text=await r.text();meta.status=r.status;
     meta.rateLimit={remainingTokens:r.headers.get('x-ratelimit-remaining-tokens'),resetTokens:r.headers.get('x-ratelimit-reset-tokens'),retryAfter:r.headers.get('retry-after')};
     if(r.ok){const d=JSON.parse(text);meta.usage=d.usage;const result={body:text,status:r.status};writeFileSync(cache,gzipSync(JSON.stringify(result)));return result;}
     if(r.status===429&&attempt<3){
      let seconds=Number(r.headers.get('retry-after'));if(!Number.isFinite(seconds)||seconds<=0)seconds=60;
      if(provider==='openai')openAICooldown=Math.max(openAICooldown,Date.now()+seconds*1000+500);
      else await delay(Math.min(seconds*1000,60000));retry=true;
     }
     if(!retry)return {body:JSON.stringify({error:'Provider request failed'}),status:r.status};
    }catch(e){meta.error=e instanceof Error?e.name:'NetworkError';return {error:meta.error};}
    finally{releaseHttp();meta.latencyMs=performance.now()-started;audit.push(meta);appendFileSync(out+'/api-audit.jsonl',JSON.stringify(meta)+'\n');}
   }
   return {error:'Rate limit retries exhausted'};
  })();inFlight.set(key,work);try{payload=await work;}finally{inFlight.delete(key);}
 }
 if(child.connected)child.send({kind:'response',id:message.id,...payload});
}
function dispatch(child:ChildProcess){
 (child as any).task=null;(child as any).idle=true;
 for(let i=tasks.length-1;i>=0;i--)if(existsSync(`${out}/runs/${tasks[i].id}.json`)){tasks.splice(i,1);done++;}
 const activeOpenAI=[...workers].filter(w=>(w as any).task?.arm.startsWith('openai')).length;
 const index=tasks.findIndex(t=>activeOpenAI<4||!t.arm.startsWith('openai'));
 if(index<0){if(!tasks.length)for(const w of workers)if((w as any).idle&&w.connected)w.disconnect();return;}
 const [task]=tasks.splice(index,1);(child as any).idle=false;(child as any).task=task;child.send({kind:'run',...task});
}
async function main(){
 if(existsSync(out+'/results.json'))throw new Error('Full-length results already exist; refusing to overwrite.');
 if(!process.env.OPENAI_API_KEY||!process.env.OPENROUTER_API_KEY)throw new Error('Both API keys are required.');
 const protocolHash=hash(JSON.stringify(P));const manifest=out+'/protocol.json';
 if(existsSync(manifest)&&JSON.parse(readFileSync(manifest,'utf8')).protocolHash!==protocolHash)throw new Error('Protocol changed; choose a new output folder.');
 if(!existsSync(out+'/preflight.json')){
  const checks=[];for(const provider of ['openai','openrouter'] as const){const r=await requestChoices(provider,{input:'East/west queue 9; north/south queue 1.',questions:[{type:'choice',name:'probe',instructions:'Which queue is larger?',choices:[{value:'ew',description:'East/west.'},{value:'ns',description:'North/south.'}]}]});checks.push(r);if(r.reason||!r.answers.length)throw new Error(provider+' preflight failed.');}
  writeFileSync(out+'/preflight.json',JSON.stringify(checks,null,2));
 }
 writeFileSync(manifest,JSON.stringify({...P,protocolHash,arms,scenarios:fullScenarios(),method:'barrier-synchronised; run to completion with bounded gridlock fallback'},null,2));
 await Promise.all(Array.from({length:P.workers},()=>new Promise<void>((resolveDone,reject)=>{
  const child=fork(resolve('scripts/full/worker.ts'),[],{execArgv:process.execArgv,stdio:['ignore','pipe','pipe','ipc']});workers.add(child);
  child.stdout?.on('data',d=>process.stdout.write(d));child.stderr?.on('data',d=>process.stderr.write(d));
  child.on('message',(m:any)=>{
   if(m.kind==='ready')dispatch(child);
   if(m.kind==='fetch')fetchMessage(child,m,(child as any).task).catch(e=>{failed=true;child.send({kind:'response',id:m.id,error:'Budget or broker error'});for(const w of workers)w.kill();reject(e);});
   if(m.kind==='error'){failed=true;for(const w of workers)w.kill();reject(new Error(m.error));}
   if(m.kind==='result'){
    const r=m.result;writeFileSync(`${out}/runs/${r.id}.json`,JSON.stringify(r));done++;
    console.log(`${done}/360 ${r.id}: ${r.status}, ${r.metrics.completed}/${r.metrics.requested}, end ${r.endTime}s, mean ${r.metrics.meanJourneyTime?.toFixed(1)??'incomplete'}, API ${calls}, cache ${cached}`);
    dispatch(child);for(const w of workers)if((w as any).idle&&w.connected)dispatch(w);
   }
  });
  child.on('exit',code=>{workers.delete(child);code===0?resolveDone():reject(new Error(`Worker exited ${code}`));});
 })));
 if(failed)throw new Error('Worker failure; saved complete runs retained.');
 const results=readdirSync(out+'/runs').filter(f=>f.endsWith('.json')).sort().map(f=>JSON.parse(readFileSync(out+'/runs/'+f,'utf8')));
 if(results.length!==360)throw new Error('Incomplete matrix');
 for(const r of results){const baseline=results.find(b=>b.id===`${r.mapId}-${r.traffic}-${r.closure}-s${r.seed}--shortest-fixed`);if(!baseline||r.demandHash!==baseline.demandHash)throw new Error('Demand mismatch');r.journeyChangePct=percentageChange(r.metrics.meanJourneyTime,baseline.metrics.meanJourneyTime);}
 const artifact={generatedAt:new Date().toISOString(),protocol:P,maps:cityMaps,results,apiRequests:calls,cachedResponses:cached,requestBytes:bytes,audit,preflight:JSON.parse(readFileSync(out+'/preflight.json','utf8')),sourceHash:hash(['lib/simulation.ts','lib/signals.ts','scripts/full/core.ts','scripts/full/run.ts','scripts/full/decisions.ts'].map(f=>readFileSync(f,'utf8')).join('\n'))};
 writeFileSync(out+'/results.json',JSON.stringify(artifact));console.log(`Saved ${out}/results.json (${calls} live calls; ${cached} exact-response reuses).`);
}
main().catch(e=>{console.error(e);for(const w of workers)w.kill();process.exitCode=1;});
