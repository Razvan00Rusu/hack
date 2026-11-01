import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderRequest, normalizeProviderAnswers, requestChoices } from '../lib/decision-adapter';
import { decideRoutes, parseRouteInput, buildRouteDecisionRequest } from '../lib/route-decisions';
import { decideSignalTimings } from '../lib/signal-decisions';
import { SignalController, type SignalObservation } from '../lib/signals';
import { Simulation, route, between, traversable } from '../lib/simulation';
import { type DecisionProvider, type ChoiceRequest } from '../lib/decision-providers';
import { routeQuestionName, type RouteBatch } from '../lib/route-requests';
const request:ChoiceRequest={input:'same evidence',questions:[{type:'choice',name:'test',instructions:'choose',choices:[{value:'a',description:'first'},{value:'b',description:'second'}]}]};
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
function fixture(provider:DecisionProvider='openrouter',batch=true) {
  const s=new Simulation({provider,cadence:'every-vehicle',batch});const template=s.cars[0];s.demand=0;
  s.cars=[['1-0','1-1'],['1-3','1-4']].map(([from,to],i)=>({...template,id:i+1,from,to,destination:'5-6',road:between(from,to).id,progress:.5,route:route(to,'5-6',{}, {},false),travelled:[from],routeHistory:[]}));
  s.requestDecisions();return s;
}
function resultFor(batch:RouteBatch) {return {answers:batch.junctions.flatMap(j=>j.vehicles.map(v=>({node:j.node,car:v.car,choice:v.candidates[0].value,source:'api' as const,confidence:.9,reason:'chosen'})))};}

test('provider adapters preserve evidence and choices using the correct native protocols',()=>{
  const a=buildProviderRequest('openai',request),b=buildProviderRequest('openrouter',request);
  assert.equal(a.model,'gpt-6-luna');assert.equal(b.model,'typesafe/jev-1.13');
  assert.ok('state' in b && b.state===request.input);assert.ok('input' in a && a.input===request.input);
  assert.ok('questions' in b && !Array.isArray(b.questions));
  assert.deepEqual((b.questions as Record<string,unknown>).test,{type:'choice',instructions:'choose',criteria:{a:'first',b:'second'}});
  assert.deepEqual(normalizeProviderAnswers('openrouter',{answers:{test:{type:'choice',choice:'a',confidence:.9,name:'spoof'}}}),[{type:'choice',choice:'a',confidence:.9,name:'test'}]);
});

test('Jev transport uses its exact pinned model and separate server credential',async()=>{
  const r=await requestChoices('openrouter',request,{apiKey:'router-test',fetcher:async(url,options)=>{
    assert.equal(url,'https://openrouter.ai/api/alpha/decisions');assert.equal((options!.headers as Record<string,string>).Authorization,'Bearer router-test');
    const body=JSON.parse(options!.body as string);assert.equal(body.model,'typesafe/jev-1.13');assert.equal(body.questions.test.criteria.a,'first');
    assert.ok(options?.signal);return json({answers:{test:{type:'choice',choice:'a',confidence:.85}}});
  }});
  assert.equal(r.provider,'openrouter');assert.ok(r.latencyMs>=0);assert.equal(r.answers.length,1);
  const missing=await requestChoices('openrouter',request,{apiKey:''});assert.equal(missing.unavailable,true);assert.match(missing.reason!,/OPENROUTER_API_KEY/);
  assert.deepEqual(normalizeProviderAnswers('openrouter',{answers:[]}),[]);
});

test('signal provider switch discards previous responses without interrupting green and tags new reviews',()=>{
  const s=new SignalController([{id:'1-1',col:0}]);const stats={incoming:2,queued:1,queueWait:2,longestWait:2,arrivals:2,departures:0};
  const j:SignalObservation={node:'1-1',phase:'ew',phaseElapsed:0,ew:stats,ns:stats};
  s.setMode('decisions',0);const old=s.takeRequest(0,[j])!;s.setProvider('openrouter',1);
  s.receive(old,{answers:[{node:'1-1',plan:'east_west',source:'api',confidence:.9,reason:'old'}]},1);
  assert.equal(s.accepted,0);assert.equal(s.states['1-1'].since,0);
  const next=s.takeRequest(1,[j])!;assert.equal(next.provider,'openrouter');
  s.receive(next,{answers:[{node:'1-1',plan:'north_south',source:'api',confidence:.9,reason:'new'}],latencyMs:20},1);
  assert.equal(s.reviews[0].provider,'openrouter');assert.equal(s.reviews[0].latencyMs,20);
});

test('both native providers feed the same signal validator',async()=>{
  const stats={incoming:2,queued:1,queueWait:2,longestWait:2,arrivals:2,departures:0};const j:SignalObservation={node:'1-1',phase:'ew',phaseElapsed:0,ew:stats,ns:stats};
  for(const provider of ['openai','openrouter'] as const){
    const r=await decideSignalTimings([j],{provider,apiKey:'test',fetcher:async()=>json(provider==='openai'?{answers:[{name:'signal_1-1',type:'choice',choice:'east_west',confidence:.9}]}:{answers:{'signal_1-1':{type:'choice',choice:'east_west',confidence:.9}}})});
    assert.equal(r.answers[0].plan,'east_west');assert.equal(r.answers[0].source,'api');assert.equal(r.provider,provider);
  }
});

test('route choices are legal, parsed server-side, and selected through both providers',async()=>{
  for(const provider of ['openai','openrouter'] as const){
    const s=fixture(provider);const [batch]=s.takeRouteBatches();assert.equal(batch.junctions.length,2);
    const junctions=parseRouteInput({junctions:batch.junctions});
    const names=buildRouteDecisionRequest(junctions).questions.map(q=>q.name);assert.equal(names.length,2);
    const r=await decideRoutes(junctions,{provider,apiKey:'test',fetcher:async()=>{
      const answers=junctions.flatMap(j=>j.vehicles.map(v=>({name:routeQuestionName(j.node,v.car),type:'choice',choice:v.candidates[0].value,confidence:.9})));
      return json(provider==='openai'?{answers}:{answers:Object.fromEntries(answers.map(({name,...a})=>[name,a]))});
    }});
    s.receiveRouteBatch(batch,r);assert.equal(s.routeAccepted,2);assert.equal(s.routeReviews[0].provider,provider);
    for(const c of s.cars)for(let i=0;i<c.route.length-1;i++)assert.ok(traversable(between(c.route[i],c.route[i+1]),c.route[i],s.closures));
  }
});

test('route batching changes transport count, not observations or candidates',()=>{
  const a=fixture('openrouter',true).takeRouteBatches(),b=fixture('openrouter',false).takeRouteBatches();
  assert.equal(a.length,1);assert.equal(b.length,2);assert.deepEqual(a.flatMap(b=>b.junctions),b.flatMap(b=>b.junctions));
});

test('route switching, cadence changes and shortest-path mode invalidate old results',()=>{
  for(const change of [(s:Simulation)=>s.setDecisionSettings({provider:'openai'}),(s:Simulation)=>s.setDecisionSettings({information:'local'}),(s:Simulation)=>s.setAdaptive(false)]){
    const s=fixture();const [old]=s.takeRouteBatches();change(s);s.receiveRouteBatch(old,resultFor(old));assert.equal(s.routeAccepted,0);assert.equal(s.routeFallbacks,0);
  }
});

test('stale routes, changed closures, missing, duplicate and invented choices fall back',()=>{
  for(const kind of ['stale','closure','missing','duplicate','invented'] as const){
    const s=fixture();const [batch]=s.takeRouteBatches();let r=resultFor(batch);
    if(kind==='stale')s.time=6;
    if(kind==='closure')s.setClosure(between('4-3','4-4').id,'closed');
    if(kind==='missing')r={answers:[]};
    if(kind==='duplicate')r.answers.push(r.answers[0]);
    if(kind==='invented')r.answers[0].choice='invented';
    s.receiveRouteBatch(batch,r);assert.ok(s.routeFallbacks>=1);assert.ok(s.routeReviews.some(r=>r.source==='fallback'));
  }
});

test('route validator rejects invented streets, duplicate vehicles and candidate values',()=>{
  const s=fixture();const [batch]=s.takeRouteBatches();
  const invalid=structuredClone(batch);invalid.junctions[0].vehicles[0].candidates[0].path[1]='invented';assert.throws(()=>parseRouteInput(invalid));
  const duplicate=structuredClone(batch);duplicate.junctions[0].vehicles.push(duplicate.junctions[0].vehicles[0]);assert.throws(()=>parseRouteInput(duplicate));
  const choice=structuredClone(batch);choice.junctions[0].vehicles[0].candidates[0].value='__proto__';assert.throws(()=>parseRouteInput(choice));
});

test('provider route selection can keep a detour or apply a qualifying alternative',()=>{
  for(const keep of [true,false]){
    const s=new Simulation({provider:'openrouter',cadence:'every-vehicle'}),c=s.cars[0];
    c.from='3-3';c.to='4-3';c.destination='4-6';c.road=between(c.from,c.to).id;c.travelled=[c.from];
    c.route=['4-3','3-3','3-4','3-5','3-6','4-6'];s.cars=[c];const old=[...c.route];
    s.requestDecisions();const [batch]=s.takeRouteBatches();const vehicle=batch.junctions[0].vehicles[0];
    const choice=keep?vehicle.candidates[0]:vehicle.candidates.reduce((a,b)=>a.cost<b.cost?a:b);
    s.receiveRouteBatch(batch,{answers:[{node:c.to,car:c.id,choice:choice.value,source:'api',confidence:.9,reason:'chosen'}]});
    assert.equal(s.routeAccepted,1);
    if(keep)assert.deepEqual(c.route,old);else {assert.notDeepEqual(c.route,old);assert.equal(s.reroutes,1);}
  }
});

test('a vehicle with no alternative stays local without invalidating other provider questions',async()=>{
  const s=fixture();const [batch]=s.takeRouteBatches();
  batch.junctions[0].vehicles[0].candidates=batch.junctions[0].vehicles[0].candidates.slice(0,1);
  const junctions=parseRouteInput(batch);assert.equal(buildRouteDecisionRequest(junctions).questions.length,1);
  let questions=0;
  const r=await decideRoutes(junctions,{provider:'openai',apiKey:'test',fetcher:async(_url,options)=>{
    const body=JSON.parse(options!.body as string);questions=body.questions.length;
    return json({answers:body.questions.map((q:{name:string;choices:{value:string}[]})=>({name:q.name,type:'choice',choice:q.choices[0].value,confidence:.9}))});
  }});
  assert.equal(questions,1);assert.equal(r.answers[0].source,'fallback');assert.equal(r.answers[1].source,'api');
  const only=await decideRoutes([junctions[0]],{provider:'openai',apiKey:'test',fetcher:async()=>{throw new Error('Must not call provider');}});
  assert.match(only.answers[0].reason,/Fewer than two/);
});
