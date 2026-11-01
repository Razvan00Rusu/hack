import { readFileSync, writeFileSync } from 'node:fs';
const out='reports/initial-pass';
const data=JSON.parse(readFileSync(`${out}/results.json`,'utf8'));
if(data.results.length!==90)throw new Error('Expected all 90 completed runs');
for(const key of [...new Set(data.results.map((r:any)=>`${r.mapId}-${r.traffic}-${r.closure}`))]){
  const group=data.results.filter((r:any)=>`${r.mapId}-${r.traffic}-${r.closure}`===key);
  if(group.length!==5||new Set(group.map((r:any)=>r.demandHash)).size!==1)throw new Error('Unmatched demand or missing arm');
}
const html=readFileSync('scripts/report/template.html','utf8').replace('__CSS__',()=>readFileSync('scripts/report/style.css','utf8')).replace('__JS__',()=>readFileSync('scripts/report/ui.js','utf8')).replace('__DATA__',()=>JSON.stringify(data).replace(/</g,'\\u003c'));
writeFileSync(`${out}/report.html`,html);
const fields=['id','mapId','traffic','closure','arm','score','requested','completed','unfinished','notAdmitted','completionRate','meanCompleted','p95Completed','meanTruncatedTime','totalWaiting','stoppedSeconds','externalWait','maxQueue','reroutes','routeAccepted','routeFallbacks','signalAccepted','signalFallbacks','demandHash'];
writeFileSync(`${out}/metrics.csv`,[fields.join(','),...data.results.map((r:any)=>fields.map(k=>JSON.stringify(r[k]??r.metrics[k]??'')).join(','))].join('\n'));
console.log(`Saved ${out}/report.html (${(Buffer.byteLength(html)/1e6).toFixed(2)} MB), metrics.csv. No API calls made.`);
