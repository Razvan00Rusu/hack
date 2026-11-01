import {runFull} from './run';import {performance} from 'node:perf_hooks';
async function main(){const started=performance.now();const r=await runFull({id:'central-high-none-s42',mapId:'central',traffic:'high',closure:'none',seed:42},'shortest-fixed',async()=>{throw new Error('No calls');});console.log({seconds:(performance.now()-started)/1000,status:r.status,end:r.endTime,metrics:r.metrics,stability:r.stability,framesBytes:r.framesGzip.length});}
main();
