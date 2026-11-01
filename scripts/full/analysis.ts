export function commonCompleted(results:any[],mode:'fixed'|'demand',filter:(r:any)=>boolean=()=>true){
 const baseline=results.filter(r=>r.arm==='shortest-fixed'&&filter(r));
 const triples=baseline.map(b=>[b,...['openai','openrouter'].map(p=>results.find(r=>r.id===`${b.mapId}-${b.traffic}-${b.closure}-s${b.seed}--${p}-${mode}`))]);
 return {all:triples,complete:triples.filter(t=>t.every(r=>r&&r.status==='completed'&&r.metrics.meanJourneyTime!==null))};
}
export function pooledMeans(triples:any[][]){
 if(!triples.length)return [null,null,null];
 const n=triples.reduce((sum,t)=>sum+t[0].metrics.requested,0);
 return [0,1,2].map(i=>triples.reduce((sum,t)=>sum+t[i].metrics.meanJourneyTime*t[i].metrics.requested,0)/n);
}
