import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, route, roads, incidentRoad, between, traversable, roadById } from '../lib/simulation';
test('directional block keeps reverse direction open', () => {
  const r = roadById[incidentRoad], closures = {[r.id]: 'forward' as const};
  assert.equal(traversable(r, r.a, closures), false); assert.equal(traversable(r, r.b, closures), true);
  assert.equal(route(r.b, r.a, closures).length, 2);
  assert.ok(route(r.a, r.b, closures).length > 2);
});
test('closure excludes both directions and complete isolation returns no route', () => {
  const r = roadById[incidentRoad], closures = {[r.id]: 'closed' as const};
  for (const [a, b] of [[r.a, r.b],[r.b,r.a]]) {
    const path = route(a, b, closures); assert.ok(path.length > 2);
    for (let i = 0; i < path.length - 1; i++) assert.notEqual(between(path[i], path[i+1]).id, r.id);
  }
  assert.deepEqual(route('0-0','5-6',Object.fromEntries(roads.map(r => [r.id,'closed' as const]))), []);
});
test('congested direct link causes an alternative in coordinated mode', () => {
  const r = roadById[incidentRoad], loads = {[r.id]: 100};
  assert.ok(route(r.a,r.b,{},loads,true).length > 2);
  assert.equal(route(r.a,r.b,{},loads,false).length, 2);
});
test('simulation is deterministic, completes trips, and never enters closed links', () => {
  const a = new Simulation(), b = new Simulation();
  for (let i = 0; i < 400; i++) { a.tick(.05); b.tick(.05); }
  assert.deepEqual(a.cars,b.cars);
  a.setClosure(incidentRoad,'closed'); const occupants = new Set(a.cars.filter(c => c.road === incidentRoad).map(c => c.id));
  for (let i = 0; i < 2400; i++) {
    a.tick(.05);
    for (const c of a.cars) { assert.ok(c.progress >= 0 && c.progress <= 1); if(c.road === incidentRoad) assert.ok(occupants.has(c.id)); }
  }
  assert.ok(a.completed > 0); assert.ok(a.reroutes > 0); assert.ok(a.cars.length <= 450);
});
test('reopening restores direct routing', () => {
  const r=roadById[incidentRoad], s=new Simulation(); s.setClosure(r.id,'closed'); s.setClosure(r.id,'open');
  assert.equal(route(r.a,r.b,s.closures,{},false).length,2);
});
test('telemetry uses trailing ten-second changes and absolute occupancy', () => {
  const s = new Simulation(); s.cars = []; s.demand = 0;
  assert.equal(s.history[0].time, 0);
  s.time = 5; s.completed = 3; s.reroutes = 2; s.sample();
  assert.equal(s.history.at(-1)!.completedChange, 3);
  assert.equal(s.history.at(-1)!.reroutesChange, 2);
  s.time = 15; s.completed = 8; s.reroutes = 9; s.sample();
  assert.equal(s.history.at(-1)!.completedChange, 5);
  assert.equal(s.history.at(-1)!.reroutesChange, 7);
  assert.equal(s.history.at(-1)!.vehicles, 0);
  assert.equal(s.history.at(-1)!.congested, 0);
  s.setDemand(2); s.setAdaptive(false); s.setClosure(incidentRoad, 'closed');
  assert.deepEqual(s.events.map(e=>e.time), [15,15,15]);
  assert.equal(s.history.filter(p=>p.time===15).length,1);
  const count=s.history.length; s.tick(.05); assert.equal(s.history.length,count);
});
test('original free-flow path and every changed route are immutable snapshots', () => {
  const s = new Simulation(), c = s.cars[0];
  const dumb = route(c.origin,c.destination,{}, {}, false);
  assert.deepEqual(c.originalRoute,dumb);
  const initial=[...c.routeHistory[0].nodes], original=[...c.originalRoute];
  const first = route(c.to,c.destination,{}, {},false);
  // A valid second recommendation must differ from the first remaining plan.
  const r=between(first[0],first[1]);
  const second = route(c.to,c.destination,{[r.id]:'closed'}, {},false);
  s.updateRoute(c,second,'First detour');
  s.time=2;s.updateRoute(c,first,'Return to main road');
  assert.equal(c.routeHistory.length,3);
  assert.deepEqual(c.routeHistory[0].nodes,initial);
  assert.deepEqual(c.originalRoute,original);
  assert.equal(c.routeHistory[1].reason,'First detour');
  const snapshot=[...c.routeHistory[2].nodes];c.route.shift();
  assert.deepEqual(c.routeHistory[2].nodes,snapshot);
});
test('average active vehicle age includes waiting cars and excludes completed trips', () => {
  const s = new Simulation();
  assert.equal(s.history[0].averageVehicleAge, 0);
  const a = {...s.cars[0], born: 10, wait: 12};
  const b = {...s.cars[1], born: 20};
  s.cars = [a,b]; s.time = 30; s.completed = 100; s.tripSeconds = 10000;
  s.finishedCars = [{...s.cars[0], born: -100, finished:true}];
  s.sample(); assert.equal(s.history.at(-1)!.averageVehicleAge,15);
  s.time = 32; s.sample(); assert.equal(s.history.at(-1)!.averageVehicleAge,17);
  s.cars = [b]; s.sample(); assert.equal(s.history.at(-1)!.averageVehicleAge,12);
  assert.equal(s.history.find(p=>p.time===30)!.averageVehicleAge,15);
  s.cars = []; s.sample(); assert.equal(s.history.at(-1)!.averageVehicleAge,null);
});
test('reverse-direction closure leaves forward travel open and rejects reverse entrants', () => {
  const r=roadById[incidentRoad], closures={[r.id]:'reverse' as const};
  assert.equal(traversable(r,r.a,closures),true);assert.equal(traversable(r,r.b,closures),false);
  assert.equal(route(r.a,r.b,closures).length,2);assert.ok(route(r.b,r.a,closures).length>2);
  const s=new Simulation();s.setClosure(r.id,'reverse');
  const occupants=new Set(s.cars.filter(c=>c.road===r.id&&c.from===r.b).map(c=>c.id));
  for(let i=0;i<1200;i++){s.tick(.05);for(const c of s.cars) if(c.road===r.id&&c.from===r.b) assert.ok(occupants.has(c.id));}
});
