import { defaultMap, type CityMap } from './maps';
// Server-side route selection. Candidates are built and checked locally.
import { requestChoices } from './decision-adapter';
import { isObject, type DecisionProvider, type ChoiceRequest } from './decision-providers';
import { between, pathCost } from './simulation';
import { routeQuestionName, type RouteJunction, type RouteResult, type RouteAnswer } from './route-requests';
export function parseRouteInput(body:unknown,network:CityMap=defaultMap):RouteJunction[] {
  const {nodeById,roads}=network;
  if(!isObject(body)||!Array.isArray(body.junctions)||!body.junctions.length||body.junctions.length>20) throw new Error('Invalid junctions');
  let count=0;const names=new Set<string>();const junctionIds=new Set<string>();
  return body.junctions.map(j=>{
    if(!isObject(j)||typeof j.node!=='string'||!nodeById[j.node]?.signal||junctionIds.has(j.node)||!isObject(j.observedLoads)||!Array.isArray(j.vehicles)||!j.vehicles.length) throw new Error('Invalid junction');
    junctionIds.add(j.node);
    const node=j.node, observedLoads:Record<string,number>={};
    for(const [id,load] of Object.entries(j.observedLoads)){
      if(!roads.some(r=>r.id===id)||typeof load!=='number'||!Number.isFinite(load)||load<0||load>10000) throw new Error('Invalid load');
      observedLoads[id]=load;
    }
    const path=(v:unknown,destination:string):string[]=>{
      if(!Array.isArray(v)||v.length<1||v.length>42||v[0]!==node||v.at(-1)!==destination||new Set(v).size!==v.length||v.some(n=>typeof n!=='string'||!nodeById[n])) throw new Error('Invalid path');
      for(let i=1;i<v.length;i++) if(!between(v[i-1],v[i],network)) throw new Error('Invalid link');
      return [...v];
    };
    const vehicles=j.vehicles.map(v=>{
      if(!isObject(v)||!Number.isSafeInteger(v.car)||Number(v.car)<1||typeof v.from!=='string'||!between(v.from,node,network)||v.node!==node||typeof v.destination!=='string'||!nodeById[v.destination]||!Array.isArray(v.candidates)||v.candidates.length>4) throw new Error('Invalid vehicle');
      if(++count>200) throw new Error('Too many vehicles');
      const car=Number(v.car),name=routeQuestionName(node,car);if(names.has(name)) throw new Error('Duplicate vehicle');names.add(name);
      const destination=v.destination,current=path(v.current,destination),values=new Set<string>();
      const candidates=v.candidates.map(c=>{
        if(!isObject(c)||typeof c.value!=='string'||!/^route_[0-3]$/.test(c.value)||values.has(c.value)) throw new Error('Invalid candidate');
        values.add(c.value);const nodes=path(c.path,destination);
        return {value:c.value,path:nodes,cost:pathCost(nodes,observedLoads,true,network)};
      });
      return {car,from:v.from,node,destination,current,candidates};
    });
    return {node,observedLoads,vehicles};
  });
}
export function buildRouteDecisionRequest(junctions:RouteJunction[]):ChoiceRequest {
  return {input:'Synthetic traffic route selection. Each question concerns one vehicle approaching its named signal junction. All offered routes are generated locally. Use only the supplied observed traffic and costs; unknown road traffic uses free-flow costs. Prefer keeping the current route unless an offered alternative reduces its estimated remaining cost by at least 15%. Avoid unnecessary reroutes. Select only an offered value. Evidence: '+JSON.stringify(junctions),
    questions:junctions.flatMap(j=>j.vehicles.filter(v=>v.candidates.length>=2).map(v=>({type:'choice' as const,name:routeQuestionName(j.node,v.car),instructions:`Choose a route for vehicle ${v.car} at junction ${j.node}, destination ${v.destination}. Respect the 15% improvement requirement.`,choices:v.candidates.map(c=>({value:c.value,description:`${c.path.join(' → ')}; estimated remaining cost ${c.cost.toFixed(2)} seconds${c.path.join()===v.current.join()?'; keep current route':''}.`}))}))) };
}
export async function decideRoutes(junctions:RouteJunction[], options:{provider:DecisionProvider;apiKey?:string;fetcher?:typeof fetch}):Promise<RouteResult> {
  const request=buildRouteDecisionRequest(junctions);
  const result=request.questions.length?await requestChoices(options.provider,request,options):{answers:[] as unknown[],unavailable:false,latencyMs:0,reason:'No alternative legal routes. Local routing fallback.'};
  return parseRouteAnswers(result,junctions);
}
export function parseRouteAnswers(result:{answers:unknown[];unavailable?:boolean;latencyMs:number;reason?:string},junctions:RouteJunction[]):RouteResult {
  return {unavailable:result.unavailable,latencyMs:result.latencyMs,answers:junctions.flatMap(j=>j.vehicles.map((v):RouteAnswer=>{
    if(v.candidates.length<2)return {node:j.node,car:v.car,source:'fallback',reason:'Fewer than two legal routes. Local routing fallback.'};
    const matches=result.answers.filter(a=>isObject(a)&&a.name===routeQuestionName(j.node,v.car));const a=matches.length===1?matches[0]:undefined;
    if(isObject(a)&&a.type==='choice'&&typeof a.choice==='string'&&v.candidates.some(c=>c.value===a.choice)&&typeof a.confidence==='number'&&Number.isFinite(a.confidence)&&a.confidence>=.6&&a.confidence<=1) return {node:j.node,car:v.car,choice:a.choice,confidence:a.confidence,source:'api',reason:'Validated provider choice.'};
    return {node:j.node,car:v.car,source:'fallback',reason:result.reason||'Missing, refused, invalid or low-confidence answer. Local routing fallback.'};
  }))};
}
