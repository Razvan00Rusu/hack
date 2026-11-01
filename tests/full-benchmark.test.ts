import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {fullScenarios,incidents,fullProtocol,fullDemand,percentageChange,stability,fullEngine} from '../scripts/full/core';import {cityMaps} from '../lib/maps';import {Simulation} from '../lib/simulation';
test('full matrix has both seeds and the promoted demand levels',()=>{assert.equal(fullScenarios().length,72);assert.deepEqual(fullProtocol.trafficRates,{mid:1.5,high:3,extra:6});assert.ok(fullProtocol.warmup>=300);for(const s of fullScenarios()){const d=fullDemand(cityMaps[s.mapId],s.traffic,s.seed);assert.ok(d.length>1700);assert.equal(fullEngine(s,'openai-demand').signals.provider,'openai');}});
test('complex incidents overlap full and directional blocks, then reopen',()=>{for(const s of fullScenarios()){const e=incidents(s);assert.ok(e.every(e=>cityMaps[s.mapId].roadById[e.road]));if(['mixed','cascade','multi_full'].includes(s.closure))assert.equal(new Set(e.map(e=>e.road)).size,2);const state=new Map();for(const x of e)state.set(x.road,x.state);assert.ok([...state.values()].every(x=>x==='open'));}});
test('journey changes cannot rank unfinished or missing-baseline runs',()=>{assert.ok(Math.abs(percentageChange(80,100)!+20)<1e-9);assert.ok(Math.abs(percentageChange(120,100)!-20)<1e-9);assert.equal(percentageChange(null,100),null);assert.equal(percentageChange(100,null),null);});
test('growing external queue is marked overloaded despite flat road occupancy',()=>{const rows=Array.from({length:25},(_,i)=>({time:i*5,active:100,external:i*5,completed:i}));assert.equal(stability(rows,120).status,'overloaded');});
test('lane index and route caches preserve pre-optimisation simulation trajectories',()=>{const expected={central:'ada2398d62aaa5369ae878d2eca8595b715055b001e2b53a2b758b799981fd53',suburban:'099a01857bb4cceb96c163d169946ac954b1fdb6169b8e66dc8af277ae2b957d'};for(const network of Object.values(cityMaps)){const s=new Simulation({}, {network});for(let i=0;i<1600;i++){if(i===400)s.setClosure(network.incidentRoad,'forward');if(i===900)s.setClosure(network.incidentRoad,'closed');if(i===1200)s.setClosure(network.incidentRoad,'open');s.tick(.05);}const hash=createHash('sha256').update(JSON.stringify({cars:s.cars,completed:s.completed,reroutes:s.reroutes,stopped:s.stoppedSeconds})).digest('hex');assert.equal(hash,expected[network.id as keyof typeof expected]);}});
test('run-to-completion drains the full cohort and never reports a capped run as complete',async()=>{
 const {runFull}=await import('../scripts/full/run');const saved={...fullProtocol};
 const scenario={id:'central-mid-none-s42',mapId:'central',traffic:'mid' as const,closure:'none' as const,seed:42};
 try{
  fullProtocol.initialDemand=1;fullProtocol.demandUntil=1;fullProtocol.maxEnd=100;
  const complete=await runFull(scenario,'shortest-fixed',async()=>{throw new Error('No provider call expected');});
  assert.equal(complete.status,'completed');assert.equal(complete.metrics.completed,complete.metrics.requested);assert.equal(complete.metrics.unfinished,0);assert.ok(complete.metrics.meanJourneyTime!>0);
  fullProtocol.maxEnd=2;const capped=await runFull(scenario,'shortest-fixed',async()=>{throw new Error('No provider call expected');});
  assert.equal(capped.status,'time_limit');assert.ok(capped.metrics.unfinished>0);assert.equal(capped.metrics.meanJourneyTime,null);
 }finally{Object.assign(fullProtocol,saved);}
});
