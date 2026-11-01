import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cityMaps} from '../../lib/maps';
import {fullScenarios,arms,fullProtocol,stability,percentageChange} from './core';
const out='reports/full-length',preview=process.argv.includes('--preview');
const order=fullScenarios().flatMap(s=>arms.map(a=>`${s.id}--${a}`));
let data:any;
if(preview){const r=readdirSync(out+'/runs').filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(out+'/runs/'+f,'utf8')));const groups=fullScenarios().filter(s=>arms.every(a=>r.some(r=>r.id===`${s.id}--${a}`)));const results=r.filter(r=>groups.some(s=>r.id.startsWith(s.id+'--')));data={generatedAt:new Date().toISOString(),protocol:fullProtocol,maps:cityMaps,results,audit:readFileSync(out+'/api-audit.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l)),cachedResponses:0,requestBytes:0,preflight:JSON.parse(readFileSync(out+'/preflight.json','utf8')),sourceHash:'development-preview'};data.apiRequests=data.audit.length;}
else{data=JSON.parse(readFileSync(out+'/results.json','utf8'));if(data.results.length!==360)throw new Error('Expected all 360 full-length runs');}
data.results.sort((a:any,b:any)=>order.indexOf(a.id)-order.indexOf(b.id));
for(const r of data.results){const baseline=data.results.find((b:any)=>b.id===`${r.mapId}-${r.traffic}-${r.closure}-s${r.seed}--shortest-fixed`);if(!baseline||baseline.demandHash!==r.demandHash)throw new Error('Demand mismatch');r.journeyChangePct=percentageChange(r.metrics.meanJourneyTime,baseline.metrics.meanJourneyTime);r.stability=[300,480,660,840,1140].map(end=>stability(r.series,end));}
for(const line of readFileSync(out+'/initial-artifacts.sha256','utf8').trim().split('\n')){const [hash,...path]=line.trim().split(/\s+/),file=path.join(' ');if(createHash('sha256').update(readFileSync(file)).digest('hex')!==hash)throw new Error('Initial artifact was modified: '+file);}
data.routingAudit=JSON.parse(readFileSync(out+'/routing-audit.json','utf8'));data.quotaProbe=JSON.parse(readFileSync(out+'/quota-probe.json','utf8'));data.cacheCountIsLowerBound=true;data.stabilityDiagnosticVersion='absolute-queue-drift-v2';
data.drainExtension=JSON.parse(readFileSync(out+'/drain-extension.json','utf8'));
const fixedPairs=data.results.filter((r:any)=>r.arm==='openai-fixed').map((a:any)=>[a,data.results.find((b:any)=>b.id===a.id.replace('openai-fixed','openrouter-fixed'))]).filter((pair:any[])=>pair[1]);
data.fullRoutingAudit={pairs:fixedPairs.length,identicalRawMetrics:fixedPairs.filter(([a,b]:any[])=>JSON.stringify(a.metrics)===JSON.stringify(b.metrics)).length};
const css=readFileSync('scripts/report/style.css','utf8')+'\n'+readFileSync('scripts/full/style.css','utf8');
const html=readFileSync('scripts/full/template.html','utf8').replace('__CSS__',()=>css).replace('__JS__',()=>readFileSync('scripts/full/ui.js','utf8')).replace('__DATA__',()=>JSON.stringify(data).replace(/</g,'\\u003c'));
const file=out+(preview?'/preview.html':'/report.html');writeFileSync(file,preview?html.replace('HEAVIER TRAFFIC · RUN TO COMPLETION','DEVELOPMENT PREVIEW · INCOMPLETE MATRIX'):html);
if(!preview){writeFileSync(out+'/report-data.json',JSON.stringify(data));const fields=['id','mapId','traffic','closure','seed','arm','status','endTime','journeyChangePct','requested','completed','unfinished','notAdmitted','meanJourneyTime','p95JourneyTime','meanCompleted','totalWaiting','externalWait','maxQueue','reroutes','routeAccepted','routeFallbacks','signalAccepted','signalFallbacks','demandHash'];writeFileSync(out+'/metrics.csv',[fields.join(','),...data.results.map((r:any)=>fields.map(k=>JSON.stringify(r[k]??r.metrics[k]??'')).join(','))].join('\n'));}
console.log(`Saved ${file} (${(Buffer.byteLength(html)/1e6).toFixed(1)} MB), ${data.results.length} runs. Initial artifacts unchanged. No API calls.`);
