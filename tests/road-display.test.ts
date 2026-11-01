import test from 'node:test';
import assert from 'node:assert/strict';
import {directions,toggleDirection,roadLabels,trafficColor} from '../lib/road-display';
import {roadById,incidentRoad,roads} from '../lib/simulation';
test('direction toggles preserve the other side, including when both sides are closed',()=>{
  assert.equal(toggleDirection('open','reverse'),'reverse');
  assert.equal(toggleDirection('reverse','forward'),'closed');
  assert.equal(toggleDirection('closed','reverse'),'forward');
  assert.equal(toggleDirection('forward','forward'),'open');
  assert.equal(toggleDirection('closed','forward'),'reverse');
});
test('cardinal labels and road names match map geometry',()=>{
  assert.equal(directions(roadById[incidentRoad]).forward,'eastbound');
  assert.equal(directions(roadById['1-4_2-4']).reverse,'northbound');
  assert.equal(roadLabels.length,new Set(roads.map(r=>r.name)).size);
  assert.equal(new Set(roadLabels.map(r=>r.name)).size,roadLabels.length);
  assert.equal(trafficColor(-1),trafficColor(0));assert.equal(trafficColor(2),trafficColor(1));
  assert.notEqual(trafficColor(.49),trafficColor(.51));
});
