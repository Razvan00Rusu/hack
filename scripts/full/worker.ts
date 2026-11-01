import {runFull} from './run';
let sequence=0;const callbacks=new Map<number,{resolve:(r:Response)=>void;reject:(e:Error)=>void}>();
const rpcFetch:typeof fetch=(url,options)=>new Promise((resolve,reject)=>{const id=++sequence;callbacks.set(id,{resolve,reject});process.send!({kind:'fetch',id,url,body:options?.body});});
process.on('message',async(message:any)=>{
 if(message.kind==='response'){const cb=callbacks.get(message.id);if(!cb)return;callbacks.delete(message.id);message.error?cb.reject(new Error(message.error)):cb.resolve(new Response(message.body,{status:message.status,headers:{'Content-Type':'application/json'}}));return;}
 if(message.kind==='run')try{const result=await runFull(message.scenario,message.arm,rpcFetch);process.send!({kind:'result',result});}catch(e){process.send!({kind:'error',error:e instanceof Error?e.stack:String(e)});}
});
process.send!({kind:'ready'});
