'use client';
import { useEffect, useRef } from 'react';
import { position as networkPosition, Simulation, type Car } from '../lib/simulation';

type Props = { simulation: Simulation; car: Car; frame: number; paused: boolean; onExit: () => void; onChange: () => void };
export default function DrivingView({ simulation: s, car, frame, paused, onExit, onChange }: Props) {
  const {nodes,roads,nodeById,roadById}=s.network;
  const position=(c:Car)=>networkPosition(c,s.network);
  const canvas = useRef<HTMLCanvasElement>(null);
  const camera = useRef<{x:number; y:number; heading:number; time:number} | null>(null);
  const loads = s.loads();
  useEffect(() => {
    const held = new Set<string>();
    const apply = () => {
      car.throttle = Number(held.has('w') || held.has('arrowup')) - Number(held.has('s') || held.has('arrowdown'));
      car.steering = Number(held.has('d') || held.has('arrowright')) - Number(held.has('a') || held.has('arrowleft'));
      car.brake = held.has(' ');
      onChange();
    };
    const stop = () => { held.clear(); apply(); };
    const key = (e: KeyboardEvent) => {
      if (!(e.target as HTMLElement)?.closest('.driving-view') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ' && (e.target as HTMLElement)?.closest('button')) return;
      if (!['w','s','a','d','arrowup','arrowdown','arrowleft','arrowright',' ','escape'].includes(k)) return;
      e.preventDefault();
      if (k === 'escape') { onExit(); return; }
      held.add(k); apply();
    };
    const up = (e: KeyboardEvent) => { if (held.delete(e.key.toLowerCase())) apply(); };
    const visibility = () => { if (document.hidden) stop(); };
    canvas.current?.focus({preventScroll:true});
    canvas.current?.addEventListener('blur', stop);
    window.addEventListener('keydown', key); window.addEventListener('keyup', up); window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', visibility);
    const surface = canvas.current;
    return () => { car.throttle = 0; car.steering = 0; car.brake = false; surface?.removeEventListener('blur',stop); window.removeEventListener('keydown', key); window.removeEventListener('keyup', up); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', visibility); };
  }, [s, car, onChange, onExit]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const w = 1000, h = 620, horizon = 225, focal = 440;
    const vehicle = position(car), a = nodeById[car.from], b = nodeById[car.to];
    const heading = vehicle.angle * Math.PI / 180;
    const carDx = Math.cos(heading), carDy = Math.sin(heading);
    const target = {x:vehicle.x-carDx*25,y:vehicle.y-carDy*25,heading,time:s.time};
    if (!camera.current) camera.current = target;
    const cam = camera.current, blend = 1-Math.exp(-Math.min(.15,Math.max(0,s.time-cam.time))*7);
    cam.x += (target.x-cam.x)*blend; cam.y += (target.y-cam.y)*blend;
    cam.heading += Math.atan2(Math.sin(heading-cam.heading),Math.cos(heading-cam.heading))*blend;
    cam.time = s.time;
    const dx=Math.cos(cam.heading),dy=Math.sin(cam.heading),p=cam;
    const world = (x: number, y: number, height = 0) => ({ side: -(x-p.x)*dy+(y-p.y)*dx, depth: (x-p.x)*dx+(y-p.y)*dy, height });
    type Vertex = ReturnType<typeof world>;
    const project = (v: Vertex) => ({ x:w/2+v.side*focal/v.depth, y:horizon+(11-v.height)*focal/v.depth });
    // Clip polygons against the camera's near plane before perspective division.
    const polygon = (vertices: Vertex[], color: string) => {
      const clipped: Vertex[] = [];
      vertices.forEach((v, i) => { const prev = vertices[(i+vertices.length-1)%vertices.length];
        if ((v.depth >= 2) !== (prev.depth >= 2)) { const t = (2-prev.depth)/(v.depth-prev.depth); clipped.push({depth:2,side:prev.side+(v.side-prev.side)*t,height:prev.height+(v.height-prev.height)*t}); }
        if (v.depth >= 2) clipped.push(v);
      });
      if (clipped.length < 3) return;
      ctx.beginPath(); clipped.map(project).forEach((v,i) => i ? ctx.lineTo(v.x,v.y) : ctx.moveTo(v.x,v.y)); ctx.closePath(); ctx.fillStyle=color; ctx.fill();
    };
    const sky = ctx.createLinearGradient(0,0,0,horizon); sky.addColorStop(0,'#a9c5d0'); sky.addColorStop(1,'#e5ede7'); ctx.fillStyle=sky; ctx.fillRect(0,0,w,horizon);
    ctx.fillStyle='#acb5a1'; ctx.fillRect(0,horizon,w,h-horizon);
    for (const r of roads) {
      const start=nodeById[r.a], end=nodeById[r.b], nx=-(end.y-start.y)/r.length, ny=(end.x-start.x)/r.length;
      const strip = (width: number, color: string) => polygon([world(start.x+nx*width,start.y+ny*width),world(end.x+nx*width,end.y+ny*width),world(end.x-nx*width,end.y-ny*width),world(start.x-nx*width,start.y-ny*width)],color);
      strip(15,'#d0d2c7'); strip(10, '#525c60');
      for(let t=0;t<r.length;t+=18) {
        const x=start.x+(end.x-start.x)*t/r.length, y=start.y+(end.y-start.y)*t/r.length;
        polygon([world(x+nx*.3,y+ny*.3),world(x+(end.x-start.x)*7/r.length+nx*.3,y+(end.y-start.y)*7/r.length+ny*.3),world(x+(end.x-start.x)*7/r.length-nx*.3,y+(end.y-start.y)*7/r.length-ny*.3),world(x-nx*.3,y-ny*.3)],'#d5d8c9');
      }
    }
    const objects: {depth:number; draw:()=>void}[]=[];
    for (const r of roads) {
      const state = s.closures[r.id];
      if (!state || state === 'open') continue;
      for (const from of [r.a,r.b]) {
        if (state !== 'closed' && (state === 'forward' ? from !== r.a : from !== r.b)) continue;
        const start=nodeById[from], end=nodeById[from===r.a?r.b:r.a];
        const ux=(end.x-start.x)/r.length, uy=(end.y-start.y)/r.length, nx=-uy, ny=ux;
        // Barriers occupy the blocked inbound lane, leaving the opposite lane open.
        const x=start.x+ux*15+(state==='closed'?0:-nx*4.5), y=start.y+uy*15+(state==='closed'?0:-ny*4.5);
        const halfWidth=state==='closed'?10:4.5;
        objects.push({depth:world(x,y).depth,draw:()=>{
          for(let i=0;i<8;i++) {
            const l=-halfWidth+i*halfWidth/4, rr=l+halfWidth/4;
            polygon([world(x+nx*l,y+ny*l,.5),world(x+nx*rr,y+ny*rr,.5),world(x+nx*rr,y+ny*rr,2.3),world(x+nx*l,y+ny*l,2.3)],i%2?'#fff3df':'#e35336');
          }
          const v=world(x,y,4.5);
          if(v.depth<2)return;
          const q=project(v),scale=Math.min(5,focal/v.depth);
          ctx.fillStyle='#b93225';ctx.fillRect(q.x-5*scale,q.y-1.5*scale,10*scale,3*scale);
          ctx.fillStyle='#fff';ctx.font=`bold ${Math.max(7,scale*1.1)}px Arial`;ctx.textAlign='center';ctx.fillText('ROAD CLOSED',q.x,q.y+.4*scale);ctx.textAlign='start';
        }});
      }
    }
    for(const n of nodes.filter(n=>nodeById[`${n.row}-${n.col+1}`] && nodeById[`${n.row+1}-${n.col}`])) {
      const right=nodeById[`${n.row}-${n.col+1}`], bottom=nodeById[`${n.row+1}-${n.col}`];
      const corners=[[n.x+22,n.y+22],[right.x-22,right.y+22],[right.x-22,bottom.y-22],[n.x+22,bottom.y-22]];
      objects.push({depth:world((n.x+right.x)/2,(n.y+bottom.y)/2).depth,draw:()=>{
        for(let i=0;i<4;i++){const c=corners[i],d=corners[(i+1)%4]; polygon([world(...c as [number,number]),world(...d as [number,number]),world(d[0],d[1],18),world(c[0],c[1],18)],i%2?'#9ba5a1':'#bdc2b8');}
        polygon(corners.map(c=>world(c[0],c[1],18)),'#d5d7ca');
      }});
    }
    for(const other of s.cars.filter(c=>c.id!==car.id)) {
      const q=position(other), v=world(q.x,q.y);
      if(v.depth<2) continue;
      objects.push({depth:v.depth,draw:()=>{const screen=project(v),scale=focal/v.depth;ctx.fillStyle=other.rerouted?'#9d81b1':'#d8e2bc';ctx.fillRect(screen.x-2*scale,screen.y-2.8*scale,4*scale,2.8*scale);ctx.fillStyle='#374d58';ctx.fillRect(screen.x-1.6*scale,screen.y-2.5*scale,3.2*scale,scale);ctx.fillStyle='#d9947d';ctx.fillRect(screen.x-1.8*scale,screen.y-.7*scale,.7*scale,.4*scale);ctx.fillRect(screen.x+scale,screen.y-.7*scale,.7*scale,.4*scale);}});
    }
    for(const n of nodes.filter(n=>n.signal)) {
      const v=world(n.x-dy*12,n.y+dx*12,7);if(v.depth<2)continue;
      const horizontal=a.row===b.row,green=s.signals.green(n.id,horizontal?'ew':'ns');
      objects.push({depth:v.depth,draw:()=>{const q=project(v),scale=focal/v.depth;ctx.fillStyle='#303c3d';ctx.fillRect(q.x-scale,q.y-scale,2*scale,3*scale);ctx.beginPath();ctx.arc(q.x,q.y,Math.max(1,.6*scale),0,Math.PI*2);ctx.fillStyle=green?'#9bc66a':'#e47e64';ctx.fill();}});
    }
    objects.filter(o=>o.depth>0).sort((a,b)=>b.depth-a.depth).forEach(o=>o.draw());
    // The player's car is part of the same perspective scene, directly ahead of the chase camera.
    const body = (side: number, along: number, height: number) => world(vehicle.x+carDx*along-carDy*side,vehicle.y+carDy*along+carDx*side,height);
    polygon([body(-2.2,-4,0),body(2.2,-4,0),body(2.2,4,0),body(-2.2,4,0)],'#263c36');
    polygon([body(-2.2,-4,.6),body(2.2,-4,.6),body(2.2,-4,2.6),body(-2.2,-4,2.6)],'#c3d99a');
    polygon([body(-2.2,-4,2.6),body(2.2,-4,2.6),body(2.2,3,2.6),body(-2.2,3,2.6)],'#d8edac');
    polygon([body(-1.8,-2,2.6),body(1.8,-2,2.6),body(1.6,-.8,4),body(-1.6,-.8,4)],'#334f5b');
    polygon([body(-1.6,-.8,4),body(1.6,-.8,4),body(1.6,1.5,4),body(-1.6,1.5,4)],'#ecf5d4');
    for(const side of [-1,1]) polygon([body(side*2.2,-3.95,1),body(side*1.3,-3.95,1),body(side*1.3,-3.95,1.6),body(side*2.2,-3.95,1.6)],car.brake?'#ff4f36':'#be6554');
  }, [s, car, frame]);
  const remaining = [position(car), ...car.route.map(id=>nodeById[id])];
  return <section className="driving-view" aria-label="Third-person driving">
    <canvas ref={canvas} width="1000" height="620" tabIndex={0} onPointerDown={e=>e.currentTarget.focus()} aria-label="Third-person driving. W or Up accelerates, S or Down reverses, A and D or Left and Right steer, Space brakes." role="img"/>
    <div className="driving-top"><span>DRIVING #{car.id} · {roadById[car.road].name}</span><button onClick={onExit}>Exit driving · Esc</button></div>
    <div className="driving-minimap"><svg viewBox="0 0 1040 780" role="img" aria-label="Live minimap with all traffic, closures, your position and current route">
      {roads.map(r=>{const a=nodeById[r.a],b=nodeById[r.b],closed=s.closures[r.id]&&s.closures[r.id]!=='open';return <line key={r.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={closed?'#e09b7c':`hsl(${110-Math.min(1,(loads[r.id]||0)/r.capacity)*110} 30% 55%)`} strokeWidth="9" strokeDasharray={closed?'12 7':undefined}/>;})}
      <polyline data-testid="driving-route" points={remaining.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#dafa8b" strokeWidth="12" strokeLinejoin="round"/>
      {s.cars.filter(c=>c.id!==car.id).map(c=>{const p=position(c);return <circle key={c.id} cx={p.x} cy={p.y} r="4" fill="#e1e5dd"/>;})}
      <circle cx={nodeById[car.destination].x} cy={nodeById[car.destination].y} r="12" fill="none" stroke="#fff" strokeWidth="5"/>
      <g data-testid="driver-position" transform={`translate(${position(car).x} ${position(car).y}) rotate(${position(car).angle})`}><circle r="19" fill="#213b36" stroke="#e9ffc3" strokeWidth="3"/><path d="M14 0L-9 -9L-5 0L-9 9Z" fill="#e9ffc3"/></g>
          {roads.filter(r=>s.closures[r.id] && s.closures[r.id]!=='open').map(r=>{const a=nodeById[r.a],b=nodeById[r.b];return <g key={r.id} data-closure={r.id}><title>{r.name}: {s.closures[r.id]==='closed'?'road closed':s.closures[r.id]==='forward'?'A to B closed':'B to A closed'}</title><path d={`M${(a.x+b.x)/2-8} ${(a.y+b.y)/2-8}l16 16m0 -16l-16 16`} stroke="#ff7657" strokeWidth="7"/></g>;})}
    </svg></div>
    <div className="driving-hud"><span className="driving-speed">{Math.round(paused || car.finished ? 0 : (car.speed||0)*3.6)} <small>km/h</small></span><span>{paused ? 'Paused' : car.finished ? 'Arrived' : 'W / S drive · A / D steer · Space brake'}</span></div>
    {(car.drive?.warning || car.rerouted) && <p className={'driving-notice'+(car.drive?.warning?' warning':'')} role="status">{car.drive?.warning || car.reason}</p>}
  </section>;
}
