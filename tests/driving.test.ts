import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, cityMaps, between, nodeById, position, route } from '../lib/simulation';

function driving(progress=.3) {
  const s=new Simulation(),c=s.cars[0];
  Object.assign(c,{from:'2-2',to:'2-3',road:between('2-2','2-3').id,progress,destination:'5-6',route:route('2-3','5-6',{}, {},false)});
  s.cars=[c];s.demand=0;s.takeControl(c.id);
  return {s,c,d:c.drive!};
}
const advance=(s:Simulation,steps:number)=>{for(let i=0;i<steps;i++)s.tick(.05);};

test('continuous steering moves world position and heading without road snapping',()=>{
  const {s,c,d}=driving();const initial=position(c);c.throttle=1;c.steering=-1;
  let previous=position(c);
  for(let i=0;i<100;i++){
    s.tick(.05);const p=position(c);
    assert.ok(Math.hypot(p.x-previous.x,p.y-previous.y)<=1.501,'no teleport between frames');
    previous=p;
  }
  assert.ok(Math.abs(d.heading-initial.angle*Math.PI/180)>1);
  assert.ok(Math.hypot(d.x-initial.x,d.y-initial.y)>10);
  assert.equal(d.warning,'');
  c.throttle=0;c.steering=0;c.brake=true;advance(s,30);assert.equal(d.velocity,0);
});

test('a car drives through a junction without an exit selection or heading jump',()=>{
  const {s,c,d}=driving(.8);const heading=d.heading;c.throttle=1;
  advance(s,160);
  assert.equal(d.heading,heading);assert.notEqual(c.from,'2-2');assert.ok(d.x>nodeById['2-3'].x+10);
  assert.equal(c.route.at(-1),c.destination);
});

test('free driving can leave the road without being clamped to the graph',()=>{
  const {s,c,d}=driving();const initialY=d.y;
  d.heading=Math.PI/2;c.throttle=1;advance(s,60);
  assert.ok(d.y>initialY+40);assert.equal(d.warning,'');
  assert.equal(position(c).x,d.x);assert.equal(position(c).y,d.y);
});

test('full closures have physical barriers and can be reversed away from',()=>{
  const {s,c,d}=driving();const road=between('2-3','2-4'),start=nodeById[road.a],end=nodeById[road.b];
  d.x=start.x;d.y=start.y-4;d.heading=Math.atan2(end.y-start.y,end.x-start.x);s.setClosure(road.id,'closed');c.throttle=1;
  advance(s,80);assert.equal(d.warning,'ROAD CLOSED');
  assert.ok(Math.hypot(d.x-start.x,d.y-start.y)<16);assert.equal(d.velocity,0);
  const x=d.x;c.throttle=-1;advance(s,20);assert.ok(d.x<x,'can back away from a barrier');
});

test('directional closures leave the opposite lane open',()=>{
  const {s,c,d}=driving();const road=between('2-3','2-4'),a=nodeById[road.a],b=nodeById[road.b];
  s.setClosure(road.id,'forward');
  d.x=b.x;d.y=b.y+4;d.heading=Math.atan2(a.y-b.y,a.x-b.x);c.throttle=1;
  advance(s,100);assert.equal(d.warning,'');assert.ok(d.x<b.x-40);
});

test('map matching recalculates the route without changing the physical heading',()=>{
  const {s,c,d}=driving();
  const n=nodeById['1-3'];d.x=n.x+4;d.y=n.y+30;d.heading=-Math.PI/2;c.throttle=1;
  advance(s,10);
  assert.equal(c.to,'1-3');assert.match(c.reason,/Route recalculated/);assert.equal(d.heading,-Math.PI/2);
  assert.equal(c.route.at(-1),c.destination);
  s.releaseControl();assert.equal(c.manual,false);assert.equal(c.drive,undefined);
});

test('taking control again preserves the current world position',()=>{
  const {s,c,d}=driving();c.throttle=1;c.steering=.7;advance(s,40);
  const p=position(c);s.takeControl(c.id);
  assert.equal(c.drive,d);assert.deepEqual(position(c),p);
});

test('replanning on a closure changes navigation without moving the driver',()=>{
  const {s,c,d}=driving();c.throttle=1;c.steering=.4;advance(s,20);
  const p=position(c);s.setClosure(between(c.route[0],c.route[1]).id,'closed');
  assert.deepEqual(position(c),p);assert.equal(c.drive,d);assert.match(c.reason,/closure/);
});

test('driving uses the selected suburban network for matching and rerouting',()=>{
  const s=new Simulation({}, {network:cityMaps.suburban}),c=s.cars[0];
  s.cars=[c];s.demand=0;s.takeControl(c.id);
  const d=c.drive!,n=s.network.nodeById['1-2'];
  d.x=n.x-30;d.y=n.y-4;d.heading=0;c.throttle=1;advance(s,15);
  assert.equal(c.road,'1-1_1-2');assert.equal(c.to,'1-2');
  assert.equal(c.route.at(-1),c.destination);
  assert.ok(c.route.every(id=>s.network.nodeById[id]));
  assert.equal(position(c,s.network).x,d.x);
});
