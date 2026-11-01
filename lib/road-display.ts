import { defaultMap, type CityMap } from './maps';
import { nodeById, roads, type Closure, type Road } from './simulation';
export function directions(road: Road,network:CityMap=defaultMap) {
  const {nodeById}=network;
  const a = nodeById[road.a], b = nodeById[road.b];
  return a.row === b.row ? {forward: 'eastbound', reverse: 'westbound', forwardArrow: '→', reverseArrow: '←'} : {forward: 'southbound', reverse: 'northbound', forwardArrow: '↓', reverseArrow: '↑'};
}
export function blocked(state: Closure, direction: 'forward' | 'reverse') { return state === 'closed' || state === direction; }
export function toggleDirection(state: Closure, direction: 'forward' | 'reverse'): Closure {
  const forward = direction === 'forward' ? !blocked(state, 'forward') : blocked(state, 'forward');
  const reverse = direction === 'reverse' ? !blocked(state, 'reverse') : blocked(state, 'reverse');
  return forward && reverse ? 'closed' : forward ? 'forward' : reverse ? 'reverse' : 'open';
}
export function crossStreet(road: Road, endpoint: 'a' | 'b',network:CityMap=defaultMap) {
  const {roads}=network;
  const node = road[endpoint];
  return roads.find(r => r.name !== road.name && (r.a === node || r.b === node))?.name || node;
}
export function trafficColor(ratio: number) {
  return `hsl(${110 * (1 - Math.max(0, Math.min(1, ratio)))} 36% 54%)`;
}
// One centre-line label per named road, on a central segment between junctions.
export function labelsForMap(network:CityMap) { const {roads,nodeById}=network; return [...new Set(roads.map(r => r.name))].map(name => {
  const segments = roads.filter(r => r.name === name);
  const road = segments[Math.floor((segments.length - 1) / 2)];
  const a = nodeById[road.a], b = nodeById[road.b];
  let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  return {name, x:(a.x+b.x)/2, y:(a.y+b.y)/2, angle:Number(angle.toFixed(4)), major:road.major};
});}
export const roadLabels=labelsForMap(defaultMap);
