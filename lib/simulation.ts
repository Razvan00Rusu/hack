export type Node = { id: string; x: number; y: number; signal: boolean; row: number; col: number };
export type Road = { id: string; a: string; b: string; name: string; major: boolean; length: number; capacity: number };
export type Closure = 'open' | 'forward' | 'reverse' | 'closed';
export type RouteVersion = { nodes: string[]; time: number; reason: string };
export type Sample = { averageVehicleAge: number | null; time: number; vehicles: number; completed: number; reroutes: number; congested: number; completedChange: number; reroutesChange: number };
export type NetworkEvent = { id: number; time: number; label: string };
export type Car = { originalRoute: string[]; travelled: string[]; routeHistory: RouteVersion[]; finished?: boolean; id: number; from: string; to: string; road: string; progress: number; destination: string; route: string[]; origin: string; rerouted: boolean; reason: string; born: number; wait: number };
export type Decision = { id: number; time: number; node: string; car: number; reason: string; road: string; kind: 'closure' | 'congestion' | 'system' };
const xs = [65, 215, 365, 510, 655, 805, 965];
const ys = [75, 205, 325, 445, 575, 705];
const horizontal = ['Marylebone Road', 'Weymouth Street', 'New Cavendish Street', 'Mortimer Street', 'Oxford Street', 'Grosvenor Street'];
const vertical = ['Edgware Road', 'Baker Street', 'Marylebone High Street', 'Harley Street', 'Regent Street', 'Great Portland Street', 'Tottenham Court Road'];
export const nodes: Node[] = ys.flatMap((y, r) => xs.map((x, c) => ({ id: `${r}-${c}`, x: x + (r - 2) * (c > 3 ? -10 : 8), y: y - c * 5 + (c === 4 ? 14 : 0), signal: (r === 0 || r === 4 || c === 1 || c === 4) && r > 0 && r < 5 && c > 0 && c < 6, row: r, col: c })));
export const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
export const roads: Road[] = [];
for (const n of nodes) for (const [r, c] of [[n.row, n.col + 1], [n.row + 1, n.col]]) {
  const b = nodeById[`${r}-${c}`]; if (!b) continue;
  const h = n.row === r; const major = h ? n.row === 0 || n.row === 4 : n.col === 1 || n.col === 4 || n.col === 6;
  roads.push({ id: `${n.id}_${b.id}`, a: n.id, b: b.id, name: h ? horizontal[r] : vertical[c], major, length: Math.hypot(b.x - n.x, b.y - n.y), capacity: major ? 12 : 6 });
}
export const roadById = Object.fromEntries(roads.map(r => [r.id, r]));
export const boundary = nodes.filter(n => n.row === 0 || n.row === 5 || n.col === 0 || n.col === 6);
export const incidentRoad = '4-3_4-4';
export function traversable(road: Road, from: string, closures: Record<string, Closure>) { return closures[road.id] !== 'closed' && !(closures[road.id] === 'forward' && from === road.a) && !(closures[road.id] === 'reverse' && from === road.b); }
export function pathCost(path: string[], loads: Record<string, number>, adaptive: boolean) {
  let cost = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const r = between(path[i], path[i + 1]), load = (loads[r.id] || 0) / r.capacity;
    cost += r.length / (r.major ? 30 : 21) * (adaptive ? 1 + 5 * load * load : 1) + (nodeById[path[i+1]].signal ? 0.7 : 0.15);
  }
  return cost;
}
export function route(start: string, end: string, closures: Record<string, Closure>, loads: Record<string, number> = {}, adaptive = true): string[] {
  const dist: Record<string, number> = { [start]: 0 }, prev: Record<string, string> = {}; const todo = new Set(nodes.map(n => n.id));
  while (todo.size) {
    const current = [...todo].reduce((a, b) => (dist[a] ?? Infinity) < (dist[b] ?? Infinity) ? a : b);
    if (!Number.isFinite(dist[current])) break;
    todo.delete(current); if (current === end) break;
    for (const road of roads.filter(r => r.a === current || r.b === current)) {
      if (!traversable(road, current, closures)) continue;
      const next = road.a === current ? road.b : road.a;
      const load = (loads[road.id] || 0) / road.capacity;
      const cost = road.length / (road.major ? 30 : 21) * (adaptive ? 1 + 5 * load * load : 1) + (nodeById[next].signal ? 0.7 : 0.15);
      if ((dist[next] ?? Infinity) > dist[current] + cost) { dist[next] = dist[current] + cost; prev[next] = current; }
    }
  }
  if (start !== end && !prev[end]) return [];
  const path = [end]; while (path[0] !== start) path.unshift(prev[path[0]]); return path;
}
export function between(a: string, b: string) { return roads.find(r => (r.a === a && r.b === b) || (r.a === b && r.b === a))!; }
export function position(car: Car) { const a = nodeById[car.from], b = nodeById[car.to]; const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); return { x: a.x + dx * car.progress + dy / len * 4, y: a.y + dy * car.progress - dx / len * 4, angle: Math.atan2(dy, dx) * 180 / Math.PI }; }
export class Simulation {
  cars: Car[] = []; finishedCars: Car[] = []; history: Sample[] = []; events: NetworkEvent[] = []; eventId = 0; time = 0; completed = 0; reroutes = 0; tripSeconds = 0; spawned = 0; closures: Record<string, Closure> = {}; adaptive = true; demand = 1; decisions: Decision[] = []; seed = 42; spawnCredit = 0; decisionId = 0;
  random() { this.seed = (1664525 * this.seed + 1013904223) >>> 0; return this.seed / 4294967296; }
  constructor() { for (let i = 0; i < 75; i++) { this.spawn(); const c = this.cars.at(-1); if (c) c.progress = this.random() * 0.85; } this.sample(); }
  loads() { const result: Record<string, number> = {}; for (const c of this.cars) result[c.road] = (result[c.road] || 0) + 1; return result; }
  averageVehicleAge() {
    return this.cars.length ? this.cars.reduce((sum, car) => sum + this.time - car.born, 0) / this.cars.length : null;
  }
  sample() {
    const loads = this.loads();
    const beforeWindow = this.history.findLast(s => s.time <= this.time - 10 + 1e-8);
    const value: Sample = { averageVehicleAge: this.averageVehicleAge(), time: this.time, vehicles: this.cars.length, completedChange: this.completed - (beforeWindow?.completed || 0), reroutesChange: this.reroutes - (beforeWindow?.reroutes || 0), completed: this.completed, reroutes: this.reroutes, congested: roads.filter(r => (loads[r.id] || 0) / r.capacity > 0.8).length };
    if (this.history.at(-1)?.time === this.time) this.history[this.history.length - 1] = value;
    else this.history.push(value);
    this.history = this.history.slice(-901);
  }
  event(label: string) { this.events.push({ id: ++this.eventId, time: this.time, label }); this.events = this.events.slice(-300); this.sample(); }
  setDemand(value: number) { if (this.demand === value) return; this.demand = value; this.event(`Demand ${value.toFixed(1)}×`); }
  setAdaptive(value: boolean) { if (this.adaptive === value) return; this.adaptive = value; this.replan(true); this.event(value ? 'Coordinated routing' : 'Shortest-path routing'); }
  updateRoute(c: Car, path: string[], reason: string) {
    if (path.join() === c.route.join() || !path.length) return;
    c.route = [...path]; c.rerouted = true; this.reroutes++; c.reason = reason;
    c.routeHistory.push({ nodes: [...c.travelled, ...path], time: this.time, reason });
  }
  spawn() {
    if (this.cars.length >= 450) return;
    // Entry probabilities follow the capacity of roads touching each boundary node.
    const weights = boundary.map(n => roads.filter(r => r.a === n.id || r.b === n.id).reduce((s, r) => s + r.capacity, 0));
    let pick = this.random() * weights.reduce((a, b) => a + b, 0), index = 0;
    while (pick > weights[index] && index < boundary.length - 1) pick -= weights[index++];
    const start = boundary[index], ends = boundary.filter(n => Math.abs(n.row - start.row) + Math.abs(n.col - start.col) > 4);
    const end = ends[Math.floor(this.random() * ends.length)]; const path = route(start.id, end.id, this.closures, this.loads(), this.adaptive); if (path.length < 2) return;
    const road = between(path[0], path[1]);
    if (this.cars.some(c => c.road === road.id && c.from === start.id && c.progress < 0.08)) return;
    this.cars.push({ originalRoute: route(start.id, end.id, {}, {}, false), travelled: [start.id], routeHistory: [{nodes: [...path], time: this.time, reason: 'Initial recommendation'}], id: ++this.spawned, from: path[0], to: path[1], origin: path[0], destination: end.id, road: road.id, progress: 0, route: path.slice(1), rerouted: false, reason: 'Following the fastest available route.', born: this.time, wait: 0 });
  }
  setClosure(id: string, state: Closure) {
    if ((this.closures[id] || 'open') === state) return;
    this.closures[id] = state;
    const road = roadById[id], horizontal = nodeById[road.a].row === nodeById[road.b].row;
    const direction = state === 'forward' ? (horizontal ? 'Eastbound' : 'Southbound') : (horizontal ? 'Westbound' : 'Northbound');
    this.replan(true);
    this.event(`${roadById[id].name}: ${state === 'open' ? 'reopened' : state === 'closed' ? 'closed' : state === 'forward' ? `${direction} (A → B) blocked` : `${direction} (B → A) blocked`}`);
    this.log('system', nodeById[roadById[id].a], 0, id, state === 'open' ? `${roadById[id].name} reopened. Routes can use this link again.` : `${roadById[id].name}: ${state === 'closed' ? 'both directions closed' : state === 'forward' ? `${direction} (A → B) blocked` : `${direction} (B → A) blocked`}. Vehicles already on the link clear it; upstream traffic replans.`);
  }
  log(kind: Decision['kind'], node: Node, car: number, road: string, reason: string) { this.decisions.unshift({ id: ++this.decisionId, time: this.time, node: node.id, car, road, reason, kind }); this.decisions = this.decisions.slice(0, 40); }
  replan(force = false) {
    const loads = this.loads();
    // Reserve a fraction of planned downstream demand, not just current occupancy.
    if (this.adaptive) for (const car of this.cars) for (let i = 0; i < car.route.length - 1; i++) {
      const id = between(car.route[i], car.route[i + 1]).id;
      loads[id] = (loads[id] || 0) + 0.25;
    }
    for (const c of this.cars) {
      if (!force && (!this.adaptive || !nodeById[c.to].signal)) continue;
      const old = c.route;
      const path = route(c.to, c.destination, this.closures, loads, this.adaptive);
      if (!path.length || path.join() === old.join()) continue;
      // Compare both remaining routes against current costs to avoid tiny oscillations.
      const invalid = old.some((n, i) => i < old.length - 1 && !traversable(between(n, old[i + 1]), n, this.closures));
      if (!invalid && (!this.adaptive || pathCost(path, loads, true) >= pathCost(old, loads, true) * 0.85)) continue;
      if (this.adaptive) {
        for (let i = 0; i < old.length - 1; i++) { const id = between(old[i], old[i+1]).id; loads[id] = Math.max(0, (loads[id] || 0) - 0.25); }
        for (let i = 0; i < path.length - 1; i++) { const id = between(path[i], path[i+1]).id; loads[id] = (loads[id] || 0) + 0.25; }
      }
      const reason = invalid ? `Road closure ahead. Divert via ${path.length > 1 ? between(path[0], path[1]).name : 'your destination'}.` : `Traffic building ahead. Use ${path.length > 1 ? between(path[0], path[1]).name : 'the final approach'} to spread demand.`;
      this.updateRoute(c, path, reason);
      if (this.decisions[0]?.time !== this.time) this.log(invalid ? 'closure' : 'congestion', nodeById[c.to], c.id, c.road, c.reason);
    }
  }
  tick(dt: number) {
    this.time += dt; this.spawnCredit += dt * 3.6 * this.demand;
    while (this.spawnCredit >= 1) { this.spawnCredit--; this.spawn(); }
    if (Math.floor(this.time / 4) !== Math.floor((this.time - dt) / 4)) this.replan();
    const loads = this.loads(), exited = new Set<number>();
    const ordered = [...this.cars].sort((a, b) => b.progress - a.progress);
    for (const c of ordered) {
      const road = roadById[c.road];
      const ahead = this.cars.filter(o => o.id !== c.id && o.road === c.road && o.from === c.from && o.progress > c.progress).sort((a, b) => a.progress - b.progress)[0];
      const signal = nodeById[c.to]; const horizontal = nodeById[c.from].row === signal.row;
      const green = (Math.floor((this.time + signal.col * 1.4) / 7) % 2 === 0) === horizontal;
      const limit = ahead ? Math.max(c.progress, ahead.progress - 0.065) : signal.signal && !green ? 0.89 : 1;
      const speed = (road.major ? 29 : 21) / (1 + Math.max(0, (loads[road.id] || 0) / road.capacity - 0.7) * 1.5);
      const oldProgress = c.progress; c.progress = Math.min(limit, c.progress + dt * speed / road.length);
      if (c.progress === oldProgress) c.wait += dt;
      if (c.progress >= 0.999) {
        if (c.to === c.destination) { exited.add(c.id); c.travelled.push(c.to); c.finished = true; this.finishedCars.push(c); this.finishedCars = this.finishedCars.slice(-100); this.completed++; this.tripSeconds += this.time - c.born; continue; }
        if (c.route[0] !== c.to || c.route.length < 2 || !traversable(between(c.to, c.route[1]), c.to, this.closures)) this.updateRoute(c, route(c.to, c.destination, this.closures, loads, this.adaptive), 'Replanned at the junction because the previous route is unavailable.');
        if (c.route.length < 2) { c.progress = 0.99; continue; }
        const next = c.route[1], link = between(c.to, next);
        if (this.cars.some(o => o.id !== c.id && o.road === link.id && o.from === c.to && o.progress < 0.075)) { c.progress = 0.99; continue; }
        c.travelled.push(c.to);
        c.from = c.to; c.to = next; c.road = link.id; c.progress = 0; c.route = c.route.slice(1);
      }
    }
    this.cars = this.cars.filter(c => !exited.has(c.id));
    if (Math.floor(this.time) !== Math.floor(this.time - dt)) this.sample();
  }
}
