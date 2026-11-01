import test from 'node:test';
import assert from 'node:assert/strict';
import { SignalController, timingPlans, type SignalObservation, type SignalAnswer, type SignalResult } from '../lib/signals';
import { Simulation, between, route } from '../lib/simulation';
import { buildSignalDecisionRequest, decideSignalTimings, parseSignalAnswers, parseSignalInput } from '../lib/signal-decisions';
import { POST } from '../app/api/signal-decisions/route';
const stats=()=>({incoming:4,queued:3,queueWait:15,longestWait:8,arrivals:6,departures:2});
const observation=(node='1-1'):SignalObservation=>({node,phase:'ew',phaseElapsed:2,ew:stats(),ns:{...stats(),incoming:1,queued:1,queueWait:2,longestWait:2}});
const answer=(node='1-1',plan:SignalAnswer['plan']='east_west'):SignalAnswer=>({node,plan,source:'api',confidence:.9,reason:'test'});
const response=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});

test('fixed baseline alternates with one second of all-red and enforces mutually exclusive greens',()=>{
  const signals=new SignalController([{id:'1-1',col:0}]);
  for(let i=0;i<960;i++){
    const t=i*.05; signals.tick(t);
    const phase=(i%320)*.05;
    assert.equal(signals.states['1-1'].phase,phase<7-1e-8?'ew':phase<8-1e-8?'all-red':phase<15-1e-8?'ns':'all-red');
    assert.ok(!(signals.green('1-1','ew')&&signals.green('1-1','ns')));
  }
});

test('API timing applies at future green boundaries, retains clearance, and expires',()=>{
  const signals=new SignalController([{id:'1-1',col:0}]);
  signals.setMode('decisions',0);
  const batch=signals.takeRequest(0,[observation()])!;
  signals.receive(batch,{answers:[answer()]},.1);
  assert.equal(signals.states['1-1'].duration,7);
  signals.tick(7); assert.equal(signals.states['1-1'].phase,'all-red');
  signals.tick(8); assert.equal(signals.states['1-1'].phase,'ns'); assert.equal(signals.states['1-1'].duration,5);
  signals.tick(13); assert.equal(signals.states['1-1'].phase,'all-red');
  signals.tick(14); assert.equal(signals.states['1-1'].phase,'ew'); assert.equal(signals.states['1-1'].duration,12);
  signals.tick(21); assert.equal(signals.states['1-1'].plan,'balanced');
  signals.tick(27); assert.equal(signals.states['1-1'].phase,'ns'); assert.equal(signals.states['1-1'].duration,7);
});

test('mode changes invalidate pending answers and never interrupt a green',()=>{
  const s=new SignalController([{id:'1-1',col:0}]);s.setMode('decisions',0);
  const b=s.takeRequest(0,[observation()])!;
  s.tick(2);s.setMode('fixed',2);s.receive(b,{answers:[answer()]},2);
  assert.equal(s.states['1-1'].phase,'ew');assert.equal(s.states['1-1'].since,0);
  assert.equal(s.states['1-1'].plan,'balanced');assert.equal(s.accepted,0);
  assert.equal(s.takeRequest(10,[observation()]),null);
});

test('stale, missing, duplicate and invalid answers fall back; missing credentials stop retries',()=>{
  for(const [result,time] of [
    [{answers:[answer()]},6], [{answers:[]},1], [{answers:[answer(),answer()]},1],
    [{answers:[{...answer(),plan:'invented'}]},1], [{answers:[{...answer(),confidence:.2}]},1],
    [{answers:[{...answer(),confidence:NaN}]},1], [{answers:null},1], [null,1],
  ] as [unknown,number][]){
    const s=new SignalController([{id:'1-1',col:0}]);s.setMode('decisions',0);
    const b=s.takeRequest(0,[observation()])!;s.receive(b,result as SignalResult,time);
    assert.equal(s.accepted,0);assert.equal(s.fallbacks,1);assert.equal(s.states['1-1'].plan,'balanced');
  }
  const s=new SignalController([{id:'1-1',col:0}]);s.setMode('decisions',0);
  const b=s.takeRequest(0,[observation()])!;
  s.receive(b,{answers:[],unavailable:true},1);
  assert.equal(s.takeRequest(20,[observation()]),null);
});

test('request scheduling is independent of route policy, batches lights, and permits one request in flight',()=>{
  const s=new Simulation();s.setAdaptive(false);s.setSignalMode('decisions');
  const b=s.signals.takeRequest(0,s.signalObservations())!;
  assert.ok(b.junctions.length>1);assert.equal(s.signals.requestCount,1);
  assert.equal(s.signals.takeRequest(5,s.signalObservations()),null);
  s.signals.receive(b,{answers:b.junctions.map(j=>answer(j.node))},1);
  assert.equal(s.signals.takeRequest(3,s.signalObservations()),null);
  assert.ok(s.signals.takeRequest(4,s.signalObservations()));
});

test('vehicles cannot cross red even when a vehicle ahead has passed the stop line',()=>{
  const s=new Simulation();s.cars=[{...s.cars[0],id:1,from:'1-0',to:'1-1',destination:'5-6',road:between('1-0','1-1').id,progress:.999,route:route('1-1','5-6',{}, {},false)}];s.demand=0;
  s.cars.push({...s.cars[0],id:2,progress:.9999});
  s.signals.states['1-1']={phase:'ns',previous:'ew',since:0,duration:7,plan:'balanced',expires:0};
  s.tick(.05);
  assert.ok(s.cars.every(c=>c.to==='1-1'));
  for(let i=0;i<20;i++)s.tick(.05);
  const j=s.signalObservations().find(j=>j.node==='1-1')!;
  assert.equal(j.ew.queued,2);assert.ok(j.ew.queueWait>=2);assert.ok(j.ew.longestWait>=1);
  assert.equal(j.ew.arrivals,2);assert.equal(j.ew.departures,0);assert.ok(s.stoppedSeconds>=2);
  s.signals.states['1-1'].phase='ew';s.tick(.05);
  assert.ok(s.signalObservations().find(j=>j.node==='1-1')!.ew.departures>0);
});

test('server validates signal observations and builds only allowed choice questions',()=>{
  const j=[observation(),observation('1-4')];
  assert.deepEqual(parseSignalInput({junctions:j}),j);
  for(const value of [{},{junctions:[]},{junctions:[observation('0-0')]},{junctions:[observation(),observation()]},{junctions:[{...observation(),ew:{...stats(),queueWait:-1}}]}]) assert.throws(()=>parseSignalInput(value));
  const request=buildSignalDecisionRequest(j);
  assert.equal(request.model,'gpt-6-luna');assert.equal(request.questions.length,2);
  assert.deepEqual(request.questions[0].choices.map(c=>c.value),Object.keys(timingPlans));
  assert.match(request.input,/longestWait/);assert.match(request.input,/arrivals/);
});

test('adapter parses partial responses by name and falls back per junction',()=>{
  const result=parseSignalAnswers({answers:[{type:'refusal',name:'signal_1-4'},{type:'choice',name:'signal_1-1',choice:'north_south',confidence:.85}]},[observation(),observation('1-4')]);
  assert.equal(result.answers[0].plan,'north_south');assert.equal(result.answers[0].source,'api');
  assert.equal(result.answers[1].source,'fallback');
  assert.equal(parseSignalAnswers({answers:[{type:'choice',name:'signal_1-1',choice:'bad',confidence:.9}]},[observation()]).answers[0].source,'fallback');
});

test('adapter sends a real Decisions request shape and handles network, HTTP and credential failures',async()=>{
  let calls=0;
  const fetcher:typeof fetch=async(url,options)=>{
    calls++; assert.equal(url,'https://api.openai.com/v1/decisions');
    assert.equal(options?.method,'POST'); assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer test-key');
    assert.equal(JSON.parse(options!.body as string).questions[0].name,'signal_1-1');
    return response({answers:[{name:'signal_1-1',type:'choice',choice:'east_west',confidence:.9}]});
  };
  assert.equal((await decideSignalTimings([observation()],{apiKey:'test-key',fetcher})).answers[0].source,'api');assert.equal(calls,1);
  const missing=await decideSignalTimings([observation()],{apiKey:'',fetcher});
  assert.equal(missing.unavailable,true);assert.equal(calls,1);
  for (const failure of [async()=>new Response('private provider error',{status:429}),async()=>{throw new Error('private details');},async()=>response({answers:[]})]) {
    const result=await decideSignalTimings([observation()],{apiKey:'test-key',fetcher:failure});
    assert.equal(result.answers[0].source,'fallback');assert.doesNotMatch(result.answers[0].reason,/private/);
  }
});

test('route rejects malformed and cross-origin requests before making API calls',async()=>{
  assert.equal((await POST(new Request('http://localhost/api/signal-decisions',{method:'POST',body:'bad'}))).status,400);
  assert.equal((await POST(new Request('http://localhost/api/signal-decisions',{method:'POST',headers:{origin:'https://other.test'},body:'{}'}))).status,403);
});
