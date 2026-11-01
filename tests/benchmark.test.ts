import test from 'node:test';
import assert from 'node:assert/strict';
import { cityMaps } from '../lib/maps';
import { route, between, Simulation } from '../lib/simulation';
import { parseRouteInput } from '../lib/route-decisions';
import { makeDemand, demandHash, scenarios, arms, createEngine, summarize, score, protocol } from '../scripts/benchmark-core';
test('suburban map is connected, has fewer signals and genuine crossroads',()=>{
  const a=cityMaps.central,b=cityMaps.suburban;
  const crossings=(m:typeof a)=>m.nodes.filter(n=>m.roads.filter(r=>r.a===n.id||r.b===n.id).length>=4).length;
  assert.ok(b.nodes.length<a.nodes.length);assert.ok(crossings(b)<crossings(a));
  assert.equal(b.nodes.filter(n=>n.signal).length,3);
  for(const start of b.boundary)for(const end of b.boundary){const path=route(start.id,end.id,{}, {},false,b);assert.ok(path.length);for(let i=1;i<path.length;i++)assert.ok(between(path[i-1],path[i],b));}
});
test('matrix covers both maps, all traffic and closure levels without mixed provider arms',()=>{
  assert.equal(scenarios().length,18);assert.equal(arms.length,5);
  for(const scenario of scenarios()){
    const demand=makeDemand(cityMaps[scenario.mapId],scenario.traffic);
    const hash=demandHash(demand);assert.equal(hash,demandHash(makeDemand(cityMaps[scenario.mapId],scenario.traffic)));
    for(const arm of arms){const s=createEngine(cityMaps[scenario.mapId],arm);assert.equal(s.automaticDemand,false);assert.equal(s.autoRouting,false);if(arm.endsWith('demand'))assert.equal(s.decisionSettings.provider,s.signals.provider);}
  }
});
test('all-demand metrics include a never-admitted vehicle and unfinished journeys',()=>{
  const s=new Simulation({}, {initialCars:0});
  const demand=[{id:1,time:0,origin:'0-0',destination:'5-6'},{id:2,time:10,origin:'0-0',destination:'5-6'}];
  const m=summarize(s,demand,new Map([[1,30]]),5,0,1);
  assert.equal(m.completed,1);assert.equal(m.unfinished,1);assert.equal(m.exposure,30+protocol.horizon-10);
  assert.equal(m.meanTruncatedTime,m.exposure/2);assert.equal(score(m,m),100);
});
test('custom map admissions and candidate validation use that graph, not the central grid',()=>{
  const m=cityMaps.suburban,s=new Simulation({provider:'openrouter',cadence:'every-vehicle'},{network:m,initialCars:0});
  assert.ok(s.admit('0-0','0-4',0,7));const c=s.cars[0];c.from='0-1';c.to='0-2';c.road=between(c.from,c.to,m).id;c.route=route(c.to,c.destination,{}, {},false,m);
  s.requestDecisions();const [batch]=s.takeRouteBatches();assert.ok(parseRouteInput(batch,m).length);
  const other=new Simulation({}, {network:cityMaps.central,initialCars:0});assert.equal(other.network.nodes.length,42);assert.equal(s.network.nodes.length,17);
});
test('signal observations clamp floating-point phase-boundary age to zero',()=>{
  const s=new Simulation({}, {initialCars:0});
  s.time=40-.000000000001;s.signals.states['1-1'].since=40;
  assert.equal(s.signalObservations().find(j=>j.node==='1-1')!.phaseElapsed,0);
});
