'use client';
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Crosshair, Clock3, Flag, GitBranch, Layers, Navigation, Pause, Play, RotateCcw, Route, TrafficCone, X, Zap } from 'lucide-react';
import { decisionProviders, type DecisionProvider } from '../lib/decision-providers';
import type { RouteResult } from '../lib/route-requests';
import { timingPlans, type SignalResult } from '../lib/signals';
import RoadSegment from './road-segment';
import RoadControls from './road-controls';
import { labelsForMap } from '../lib/road-display';
import TrendMetric, { elapsed } from './trend-metric';
import { cityMaps, defaultMap, type CityMap } from '../lib/maps';
import { Simulation, position, between as networkBetween, type Car, type DecisionSettings } from '../lib/simulation';
const clock = (s: number) => `08:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pointList = (c: Car,network:CityMap) => [position(c,network), ...c.route.map(id => network.nodeById[id])].map(p => `${p.x},${p.y}`).join(' ');
const historyColor = (index: number) => `hsl(${(265 + index * 137.508) % 360} 57% 45%)`;
const routePoints = (path: string[],network:CityMap) => path.map(id => `${network.nodeById[id].x},${network.nodeById[id].y}`).join(' ');
export default function TrafficLab() {
  const sim = useRef<Simulation | null>(null);
  const [frame, setFrame] = useState(0), [paused, setPaused] = useState(false), [speed, setSpeed] = useState(1), [selectedRoad, setSelectedRoad] = useState<string | null>(null), [selectedCar, setSelectedCar] = useState<number | null>(null), [following, setFollowing] = useState(false), [heat, setHeat] = useState(true), [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const routeRequests=useRef(new Set<AbortController>());
  const signalRequest = useRef<AbortController | null>(null);
  const [hiddenRoutes, setHiddenRoutes] = useState<Record<string, boolean>>({});
  const visible = (key: string) => !hiddenRoutes[`${selectedCar}:${key}`];
  const toggleRoute = (key: string) => setHiddenRoutes(v => ({...v, [`${selectedCar}:${key}`]: !v[`${selectedCar}:${key}`]}));
  const requestRouteDecisions=(engine:Simulation)=>{
    for(const batch of engine.takeRouteBatches()) {
      const controller=new AbortController();routeRequests.current.add(controller);
      const timeout=setTimeout(()=>controller.abort(),5000);
      fetch('/api/route-decisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mapId:engine.network.id,provider:batch.provider,junctions:batch.junctions}),signal:controller.signal})
        .then(async r=>{if(!r.ok)throw new Error('Routing request failed');return await r.json() as RouteResult;})
        .catch(()=>({answers:[]} as RouteResult))
        .then(result=>{if(sim.current===engine){engine.receiveRouteBatch(batch,result);setFrame(f=>f+1);}})
        .finally(()=>{clearTimeout(timeout);routeRequests.current.delete(controller);});
    }
  };
  const requestSignalTimings = (engine: Simulation) => {
    if (signalRequest.current) return;
    const batch=engine.signals.takeRequest(engine.time,engine.signalObservations());
    if (!batch) return;
    const controller=new AbortController(); signalRequest.current=controller;
    const timeout=setTimeout(()=>controller.abort(),5000);
    fetch('/api/signal-decisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mapId:engine.network.id,provider:batch.provider,junctions:batch.junctions}),signal:controller.signal})
      .then(async response=>{if (!response.ok) throw new Error('Signal request failed'); return await response.json() as SignalResult;})
      .catch(()=>({answers:batch.junctions.map(j=>({node:j.node,plan:'balanced' as const,source:'fallback' as const,reason:'Signal request failed or timed out. Fixed timing fallback.'}))}))
      .then(result=>{if (sim.current===engine) {engine.signals.receive(batch,result,engine.time); setFrame(f=>f+1);}})
      .finally(()=>{clearTimeout(timeout); if (signalRequest.current===controller) signalRequest.current=null;});
  };
  useEffect(()=>()=>{signalRequest.current?.abort();for(const c of routeRequests.current)c.abort();},[]);
  useEffect(() => { sim.current = new Simulation(); setFrame(f => f + 1); }, []);
  useEffect(() => { let last = performance.now(), accumulator = 0; const timer = setInterval(() => { const now = performance.now(); accumulator += Math.min((now - last) / 1000, 0.15) * speed; last = now; if (!paused && sim.current) { while (accumulator >= 0.05) { sim.current.tick(0.05); accumulator -= 0.05; } requestRouteDecisions(sim.current); requestSignalTimings(sim.current); setFrame(f => f + 1); } else accumulator = 0; }, 50); return () => clearInterval(timer); }, [paused, speed]);
  const network=sim.current?.network||defaultMap;
  const {nodes,roads,nodeById,roadById}=network, roadLabels=labelsForMap(network);
  const between=(a:string,b:string)=>networkBetween(a,b,network);
  const s = sim.current, loads = s?.loads() || {}, car = s?.cars.find(c => c.id === selectedCar) || s?.finishedCars.find(c => c.id === selectedCar), road = selectedRoad ? roadById[selectedRoad] : null;
  const directionalLoads: Record<string, {forward:number;reverse:number}> = {};
  for (const c of s?.cars || []) { const counts = directionalLoads[c.road] ||= {forward:0,reverse:0}; counts[c.from === roadById[c.road].a ? 'forward' : 'reverse']++; }
  const roadCars = s?.cars.filter(c => c.road === selectedRoad || c.route.some((n, i) => i + 1 < c.route.length && between(n, c.route[i + 1]).id === selectedRoad)) || [];
  const congestion = roads.filter(r => (loads[r.id] || 0) / r.capacity > 0.8).length;
  const signalDecisions = s?.decisions.filter(d => d.node === selectedSignal && d.car > 0) || [];
  const routeApiReviews=s?.routeReviews.filter(r=>r.node===selectedSignal)||[];
  const timingReviews = s?.signals.reviews.filter(r=>r.node===selectedSignal) || [];
  const selectedSignalState = selectedSignal ? s?.signals.states[selectedSignal] : undefined;
  const selectedSignalStats = selectedSignal ? s?.signalObservations().find(j=>j.node===selectedSignal) : undefined;
  const signalRequests = s?.requests.filter(r => r.node === selectedSignal) || [];
  const selectSignal = (id: string) => { setSelectedSignal(id); setSelectedRoad(null); setSelectedCar(null); setFollowing(false); };
  const mutate = (fn: (s: Simulation) => void) => { if (sim.current) fn(sim.current); setFrame(f => f + 1); };
  const selectRoad = (id: string) => { setSelectedRoad(id); setSelectedSignal(null); setSelectedCar(null); setFollowing(false); };
  const selectCar = (id: number) => { setSelectedCar(id); setSelectedSignal(null); setSelectedRoad(null); };
  const view = following && car ? (() => { const p = position(car,network); return `${p.x - 220} ${p.y - 165} 440 330`; })() : '0 0 1040 780';
  return <div className="app" data-frame={frame % 2}>
    <main><section className="workspace">
      <div className="trends-heading"><span className="eyebrow">NETWORK IMPACT OVER TIME</span><span>Simulated time · 1s samples · orange markers = changes</span></div>
      <div className="metrics">
        <TrendMetric label="VEHICLES ON NETWORK" value={s?.cars.length || 0} unit="vehicles" icon={<Navigation size={17}/>} foot="Current occupancy" series={s?.history || []} events={s?.events || []} field="vehicles" color="#708749"/>
        <TrendMetric label="COMPLETED JOURNEYS" value={s?.history.at(-1)?.completedChange || 0} unit="trips / 10s" icon={<Flag size={17}/>} foot={`${s?.completed || 0} total · trailing 10 simulated seconds`} series={s?.history || []} events={s?.events || []} field="completedChange" color="#558b91"/>
        <TrendMetric label="ROUTES ADAPTED" value={s?.history.at(-1)?.reroutesChange || 0} unit="changes / 10s" icon={<GitBranch size={17}/>} foot={`${s?.reroutes || 0} total · trailing 10 simulated seconds`} series={s?.history || []} events={s?.events || []} field="reroutesChange" color="#9470b6"/>
        <TrendMetric label="CONGESTED LINKS" value={congestion} unit="links" icon={<Activity size={17}/>} foot="Above 80% of link capacity" series={s?.history || []} events={s?.events || []} field="congested" color="#bc8055"/>
        <TrendMetric label="AVG TIME ON NETWORK" value={s?.averageVehicleAge() ?? null} unit="sim seconds" icon={<Clock3 size={17}/>} foot="Mean elapsed time of active vehicles" series={s?.history || []} events={s?.events || []} field="averageVehicleAge" color="#5b87b3" precision={1}/>
      </div>
      {!!s?.events.length && <div className="event-strip" aria-label="Network change timeline">{s.events.slice(-3).map(e => <span key={e.id}><i/>{elapsed(e.time)} · {e.label}</span>)}</div>}
      <div className="map-panel"><div className="map-top"><div><span className="map-title">Network overview</span><span className="map-subtitle">{network.name}</span></div><div className="view-switch"><button className={!following ? 'active' : ''} onClick={() => setFollowing(false)}><Layers size={14}/> Network</button><button className={following ? 'active' : ''} onClick={() => { const c = car || s?.cars[0]; if (c) { selectCar(c.id); setFollowing(true); } }}><Navigation size={14}/> Follow car</button></div></div>
        <div className="map-wrap"><svg className="map" viewBox={view} role="img" aria-label="Interactive simulated London road network. Click a traffic light, road or moving vehicle.">
          <defs><pattern id="grain" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".5" fill="#b9baaf" opacity=".15"/></pattern><pattern id="blocked-lane-hatch" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="#bf6e54" strokeWidth="1" opacity=".4"/></pattern></defs>
          <rect x="-1000" y="-1000" width="4000" height="3000" fill="#eeeee6"/><rect width="1040" height="780" fill="url(#grain)"/>
          {nodes.filter(n => nodeById[`${n.row}-${n.col+1}`] && nodeById[`${n.row+1}-${n.col}`]).map(n => { const right = nodeById[`${n.row}-${n.col + 1}`], bottom = nodeById[`${n.row + 1}-${n.col}`]; return <g key={n.id}>{[0, 1, 2].map(i => <rect key={i} x={n.x + 18 + i * 38} y={n.y + 19} width={29} height={bottom.y - n.y - 38} rx="3" fill={(n.row === 1 && n.col === 2) || (n.row === 3 && n.col === 0) ? '#dbe2cd' : '#e2e2d8'} stroke="#d8d9cf" strokeWidth=".8"/>)}<path d={`M${n.x + 10},${n.y + 60} L${right.x - 10},${right.y + 60}`} stroke="#f7f7f0" strokeWidth="5"/></g>; })}
          <path d="M0 0H310L310 47 0 64Z" fill="#d8e1ca"/><text x="110" y="24" className="park-label">{network.id==='central'?'REGENT’S PARK':'RICHMOND PARK'}</text><path d="M0 645L49 692 125 780H0Z" fill="#d8e1ca"/>
          {roads.map(r => <RoadSegment network={network} key={r.id} road={r} state={s?.closures[r.id] || 'open'} selected={selectedRoad === r.id} heat={heat} forwardLoad={directionalLoads[r.id]?.forward || 0} reverseLoad={directionalLoads[r.id]?.reverse || 0} onSelect={() => selectRoad(r.id)}/>)}
          <g className="district-label"><text x="270" y="288">{network.id==='central'?'MARYLEBONE':'RICHMOND'}</text><text x="775" y="285">{network.id==='central'?'FITZROVIA':'BARNES'}</text><text x="350" y="668">{network.id==='central'?'MAYFAIR':'MORTLAKE'}</text><text x="810" y="670">{network.id==='central'?'SOHO':'PARKSIDE'}</text></g>
          {road && roadCars.slice(0, 70).map(c => <polyline key={c.id} points={pointList(c,network)} fill="none" stroke="#8b70c9" strokeWidth="2" opacity=".16" pointerEvents="none"/>)}
          {car && <g pointerEvents="none" strokeLinecap="round" strokeLinejoin="round" fill="none">
            {visible('original') && <polyline data-route-layer="original" points={routePoints(car.originalRoute,network)} stroke="#657286" strokeWidth="7" strokeDasharray="9 7" opacity=".65" transform="translate(-3 -3)"/>}
            {car.routeHistory.map((version, i) => visible(`version-${i}`) && <polyline data-route-layer={`version-${i}`} key={i} points={routePoints(version.nodes,network)} stroke={historyColor(i)} strokeWidth="3" strokeDasharray={`${9+i%3*3} ${5+i%2*2}`} opacity=".8" transform={`translate(${3 + i%4*2} ${3 + i%4*2})`}/>)}
            {visible('current') && <><polyline points={car.finished ? routePoints(car.travelled,network) : pointList(car,network)} stroke="#fbfff3" strokeWidth="7"/><polyline data-route-layer="current" points={car.finished ? routePoints(car.travelled,network) : pointList(car,network)} stroke="#527c28" strokeWidth="4"/></>}
          </g>}
          {nodes.filter(n => n.signal).map(n => { const phase=s?.signals.states[n.id].phase || 'ew'; return <g key={n.id} data-signal-phase={phase} className="signal" role="button" tabIndex={0} aria-label={`Traffic light ${n.id}`} aria-pressed={selectedSignal === n.id} onClick={() => selectSignal(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSignal(n.id); } }}><title>{`Traffic light ${n.id}: ${phase==='all-red'?'all-red clearance':phase==='ew'?'east / west green':'north / south green'}`}</title>{selectedSignal === n.id && <circle cx={n.x} cy={n.y} r="14" fill="none" stroke="#6e8248" strokeWidth="2"/>}<circle cx={n.x} cy={n.y} r="9" fill="#fbfcf4" stroke="#cbd3bd"/><circle cx={n.x} cy={n.y} r="4" fill={phase==='all-red'?'#b9573e':phase==='ew'?'#769541':'#558b91'}/></g>; })}
          {s?.cars.map(c => { const p = position(c,network); return <g key={c.id} className="vehicle" onClick={e => { e.stopPropagation(); selectCar(c.id); }} transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`} role="button" aria-label={`Vehicle ${c.id}`}><rect x="-10" y="-9" width="20" height="18" fill="transparent"/>{c.id === selectedCar && <circle r="12" fill="#8ca454" opacity=".25"/>}<rect x="-4" y="-2.3" width="8" height="4.6" rx="1.4" fill={c.id === selectedCar ? '#324c0c' : c.rerouted ? '#9672b9' : c.id % 4 === 0 ? '#77796b' : '#8f9f72'}/><rect x="1" y="-1.7" width="1.5" height="3.4" rx=".4" fill="#fcfff2" opacity=".8"/></g>; })}
          {roadLabels.map(label=><text key={label.name} data-road-name={label.name} x={label.x} y={label.y} className={'street-label centred-road-label '+(label.major?'major-road-label':'')} dominantBaseline="central" transform={`rotate(${label.angle} ${label.x} ${label.y})`}>{label.name}</text>)}
          {road && (['a','b'] as const).map(endpoint=>{const n=nodeById[road[endpoint]];return <g key={endpoint} pointerEvents="none"><line x1={n.x} x2={n.x} y1={n.y-10} y2={n.y-18} stroke="#6b8150"/><circle cx={n.x} cy={n.y-25} r="8" fill="#faffef" stroke="#8d9f70"/><text x={n.x} y={n.y-25} dominantBaseline="central" textAnchor="middle" fontSize="9" fill="#637d40">{endpoint.toUpperCase()}</text></g>;})}
        </svg>
        <div className="north">N<span>↑</span></div>
        <div className="map-tools"><button className={heat ? 'active' : ''} onClick={() => setHeat(!heat)} title="Toggle roadside traffic bars" aria-label="Toggle roadside traffic bars"><Layers size={18}/></button><button onClick={() => { setFollowing(false); setSelectedRoad(null); setSelectedCar(null); setSelectedSignal(null); }} title="Reset map view" aria-label="Reset map view"><Crosshair size={18}/></button></div>
        {following && car && <div className="satnav"><Navigation size={23}/><div><b>{car.route.length > 1 ? `Continue to ${between(car.route[0], car.route[1]).name}` : 'Approaching destination'}</b><p>{car.reason}</p><small>Following vehicle #{car.id} · overhead satnav preview</small></div><button className="icon-btn" onClick={() => setFollowing(false)} aria-label="Exit follow view"><X size={16}/></button></div>}
        <div className="map-legend"><span className="traffic-bar-legend"><i/>Low → high load</span><span><i style={{background:'#9672b9'}}/> Rerouted</span><span><i style={{background:'#b9573e'}}/> Closed</span></div>
        </div><div className="playback"><button className="play" onClick={() => setPaused(!paused)} aria-label={paused ? 'Play simulation' : 'Pause simulation'}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button><span className="time">{clock(s?.time || 0)}</span><span className="time-caption">MONDAY MORNING</span><div className="speed">{[1, 2, 4].map(v => <button key={v} className={speed === v ? 'active' : ''} onClick={() => setSpeed(v)}>{v}×</button>)}</div><button className="reset" onClick={() => { signalRequest.current?.abort(); for(const c of routeRequests.current)c.abort(); const previous=sim.current; const next=new Simulation(previous?.decisionSettings,{network:previous?.network}); next.setAdaptive(previous?.adaptive ?? true); next.setDemand(previous?.demand ?? 1); next.setSignalProvider(previous?.signals.provider || 'openai'); next.setSignalMode(previous?.signals.mode || 'fixed'); sim.current=next; setSelectedSignal(null); setSelectedCar(null); setSelectedRoad(null); setFollowing(false); setHiddenRoutes({}); setPaused(false); setFrame(f => f + 1); }}><RotateCcw size={13}/> Reset</button></div></div>
    </section><aside><div className="aside-title"><span className="eyebrow">NETWORK CONTROL</span></div>
      <section className="control-section decision-settings"><label htmlFor="city-map">City map</label><select id="city-map" value={network.id} onChange={e=>{signalRequest.current?.abort();for(const c of routeRequests.current)c.abort();const previous=sim.current;const next=new Simulation(previous?.decisionSettings,{network:cityMaps[e.target.value]});next.setAdaptive(previous?.adaptive??true);next.setDemand(previous?.demand??1);next.setSignalProvider(previous?.signals.provider||'openai');next.setSignalMode(previous?.signals.mode||'fixed');sim.current=next;setSelectedCar(null);setSelectedRoad(null);setSelectedSignal(null);setFollowing(false);setHiddenRoutes({});setFrame(f=>f+1);}}>{Object.values(cityMaps).map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select><p className="hint">{network.description} Switching maps starts a new run.</p></section>
      <section className="control-section"><div className="section-title"><Zap size={17}/><h2>Routing intelligence</h2></div><div className="policy-toggle"><button className={!s?.adaptive ? 'active' : ''} onClick={() => mutate(s => {s.setAdaptive(false);})}>Shortest path</button><button className={s?.adaptive ? 'active' : ''} onClick={() => mutate(s => {s.setAdaptive(true);})}><span/>Coordinated</button></div><label className="demand-label" htmlFor="demand">Traffic demand <b>{s?.demand.toFixed(1) || '1.0'}×</b></label><input id="demand" type="range" min="0.5" max="3" step="0.1" value={s?.demand || 1} onChange={e => mutate(s => {s.setDemand(Number(e.target.value));})}/><div className="range-label"><span>Quiet streets</span><span>Rush hour</span></div></section>
      <section className="control-section decision-settings" aria-label="Decision experiment settings">
        <div className="section-title"><GitBranch size={17}/><h2>Decision requests</h2></div>
        <p className="hint">Each traffic light reviews vehicles approaching its junction using the selected route provider.</p>
        <label htmlFor="routing-provider">Routing provider</label>
        <select id="routing-provider" value={s?.decisionSettings.provider || 'local'} onChange={e=>{for(const c of routeRequests.current)c.abort(); mutate(s=>s.setDecisionSettings({provider:e.target.value as DecisionSettings['provider']}));}}>
          <option value="local">Local heuristic</option>{Object.entries(decisionProviders).map(([id,p])=><option key={id} value={id}>{p.label} · {p.model}</option>)}
        </select>
        {s?.routeUnavailable && <p className="signal-warning" role="status">Set {s.decisionSettings.provider==='openrouter'?'OPENROUTER_API_KEY':'OPENAI_API_KEY'} on the server and restart, then reselect this provider. Local routing fallback is active.</p>}
        <label htmlFor="decision-information">Traffic information</label>
        <select id="decision-information" value={s?.decisionSettings.information || 'network'} onChange={e => mutate(s => s.setDecisionSettings({information: e.target.value as DecisionSettings['information']}))}>
          <option value="local">Junction roads only</option><option value="neighbours">Junction + neighbouring roads</option><option value="network">Whole network + planned flow</option>
        </select>
        <p className="hint">{s?.decisionSettings.information === 'local' ? 'Sees occupancy on roads touching this light.' : s?.decisionSettings.information === 'neighbours' ? 'Sees occupancy on roads within one neighbouring junction.' : 'Sees all road occupancy and planned route reservations.'} All modes know the map, closures and each approaching vehicle's destination. Unseen roads use free-flow costs.</p>
        <label htmlFor="decision-cadence">Request frequency</label>
        <select id="decision-cadence" value={s?.decisionSettings.cadence || 'interval'} onChange={e => mutate(s => s.setDecisionSettings({cadence: e.target.value as DecisionSettings['cadence']}))}>
          <option value="every-vehicle">Once per vehicle approaching each light</option><option value="interval">Periodically for approaching vehicles</option>
        </select>
        {s?.decisionSettings.cadence !== 'every-vehicle' && <><label htmlFor="decision-interval">Simulated seconds between requests</label><select id="decision-interval" value={s?.decisionSettings.intervalSeconds || 4} onChange={e => mutate(s => s.setDecisionSettings({intervalSeconds: Number(e.target.value) as DecisionSettings['intervalSeconds']}))}>{[1,4,10].map(n => <option key={n} value={n}>{n} seconds</option>)}</select></>}
        <label className="batch-setting"><input type="checkbox" checked={s?.decisionSettings.batch ?? true} onChange={e => mutate(s => s.setDecisionSettings({batch: e.target.checked}))}/>Batch lights due on the same simulation step</label>
        <p className="hint">Each vehicle gets a choice among validated routes. Batching combines lights due together into one request. Local heuristic runs stay offline.</p>
        <div className="request-totals" aria-label="Decision request totals"><span><b>{s?.batchCount || 0}</b> review batches</span><span><b>{s?.requestCount || 0}</b> junction reviews</span><span><b>{s?.vehicleDecisionCount || 0}</b> vehicle reviews</span></div>
        {s?.decisionSettings.provider!=='local' && <div className="request-totals" aria-label="Route API totals"><span><b>{s?.routeApiRequests || 0}</b> route API batches</span><span><b>{s?.routeAccepted || 0}</b> accepted route answers</span><span><b>{s?.routeFallbacks || 0}</b> local route fallbacks</span></div>}
        <p className="hint">Reset keeps these settings and restarts the same seed. Changes during a run are marked on the charts. Closure safety checks always run.</p>
      </section>
      <section className="control-section decision-settings" aria-label="Signal timing experiment">
        <div className="section-title"><Clock3 size={17}/><h2>Signal timing</h2></div>
        <label htmlFor="signal-timing-mode">Signal controller</label>
        <select id="signal-timing-mode" value={s?.signals.mode || 'fixed'} onChange={e=>mutate(s=>s.setSignalMode(e.target.value as 'fixed'|'decisions'))}>
          <option value="fixed">Fixed timing</option><option value="decisions">Demand-based · Decisions API</option>
        </select>
        <label htmlFor="signal-provider">Signal provider</label>
        <select id="signal-provider" value={s?.signals.provider || 'openai'} onChange={e=>{signalRequest.current?.abort(); mutate(s=>s.setSignalProvider(e.target.value as DecisionProvider));}}>{Object.entries(decisionProviders).map(([id,p])=><option key={id} value={id}>{p.label} · {p.model}</option>)}</select>
        <p className="hint">Independent of routing. Fixed uses 7s green per direction. Demand-based reviews queues, waiting time and 10s traffic flow every 4 simulated seconds in one API request.</p>
        <p className="hint">Plans use 5–12s greens and 1s all-red clearance. Changes start at the next green boundary. Failed or stale requests use fixed timing.</p>
        {s?.signals.unavailable && <p className="signal-warning" role="status">Set {decisionProviders[s.signals.provider].key} on the server and restart, then switch this experiment off and on. Fixed timing fallback is active.</p>}
        <div className="request-totals" aria-label="Signal timing totals"><span><b>{s?.signals.requestCount || 0}</b> signal request batches</span><span><b>{s?.signals.accepted || 0}</b> accepted junction answers</span><span><b>{s?.signals.fallbacks || 0}</b> junction fallbacks</span><span><b>{s?.cars.filter(c=>c.stopped).length || 0}</b> stopped vehicles</span><span><b>{s?.stoppedSeconds.toFixed(1) || '0.0'}</b> accumulated stopped vehicle seconds</span></div>
        <p className="hint">Reset preserves both experiment settings and the seed. Request latency and fallbacks are part of this manual comparison.</p>
      </section>
      {(road || selectedCar) && <section className="control-section inspector"><div className="section-title"><Route size={17}/><h2>{road ? 'Road inspector' : 'Vehicle inspector'}</h2><button className="icon-btn" onClick={() => {setSelectedCar(null); setSelectedRoad(null); setFollowing(false);}} aria-label="Close inspector"><X size={15}/></button></div>{road ? <><h3>{road.name}</h3><p className="subcopy">{road.major ? 'Arterial' : 'Local street'} · selected segment A ↔ B</p><div className="inspector-stats"><span><b>{loads[road.id] || 0}</b> on link</span><span><b>{roadCars.length}</b> planned routes</span></div><RoadControls network={network} road={road} state={s?.closures[road.id] || 'open'} onChange={state=>mutate(s=>s.setClosure(road.id,state))}/>
<small className="hint">Purple lines show vehicles planning to use this link. Existing occupants clear before the closure.</small></> : car ? <><h3>Vehicle #{car.id} <span className="tiny-pill">{car.finished ? 'ARRIVED' : car.rerouted ? 'REROUTED' : 'EN ROUTE'}</span></h3><p className="subcopy">Entry {car.origin} <ArrowRight size={12}/> Exit {car.destination}</p><div className="route-history" aria-label="Vehicle route history">
        <p className="route-history-caption">Compare routes · click a layer to hide it</p>
        <RouteLayer label="Original dumb route" detail="Free-flow shortest path · ignores traffic and incidents" color="#657286" dashed active={visible('original')} onClick={() => toggleRoute('original')}/>
        {car.routeHistory.map((version, i) => <RouteLayer key={i} label={i === 0 ? 'Initial recommendation' : `Reroute ${i}`} detail={`${clock(version.time)} · ${version.reason}`} color={historyColor(i)} dashed active={visible(`version-${i}`)} onClick={() => toggleRoute(`version-${i}`)}/>)}
        <RouteLayer label={car.finished ? 'Completed journey' : 'Current route'} detail={car.finished ? 'Actual roads travelled' : 'Solid green · remaining journey from this car'} color="#527c28" active={visible('current')} onClick={() => toggleRoute('current')}/>
        <p className="hint">Dashed paths keep the full plan at each decision. Small offsets separate overlapping routes.</p>
      </div><p className="reason"><GitBranch size={15}/>{car.reason}</p><button className="text-button" onClick={() => setFollowing(!following)}><Navigation size={14}/>{following ? 'Return to network' : 'Follow this journey'}<ArrowRight size={14}/></button></> : <p className="subcopy">This vehicle has completed its journey. Select another car.</p>}</section>}
      <section className="decision-section" aria-label="Traffic light decisions">
        <div className="section-title"><GitBranch size={17}/><h2>{selectedSignal ? `Traffic light ${selectedSignal}` : 'Junction decisions'}</h2>{selectedSignal && <button className="icon-btn" aria-label="Close traffic light inspector" onClick={() => setSelectedSignal(null)}><X size={15}/></button>}</div>
        {selectedSignal ? <><p className="signal-summary">{s?.adaptive ? 'Coordinated routing' : 'Shortest path routing'} · {selectedSignalState?.phase==='all-red'?'All-red clearance':selectedSignalState?.phase==='ew'?'East / west green':'North / south green'}</p><div className="signal-timing-history" aria-label="Signal timing decisions"><p className="hint">{s?.signals.mode==='decisions'?'Demand-based timing':'Fixed timing'} · next greens E/W {timingPlans[selectedSignalState?.plan || 'balanced'].ew}s / N/S {timingPlans[selectedSignalState?.plan || 'balanced'].ns}s</p>{selectedSignalStats && <p className="hint">E/W {selectedSignalStats.ew.queued} queued · {selectedSignalStats.ew.queueWait.toFixed(1)}s stopped · {selectedSignalStats.ew.arrivals} in / {selectedSignalStats.ew.departures} out<br/>N/S {selectedSignalStats.ns.queued} queued · {selectedSignalStats.ns.queueWait.toFixed(1)}s stopped · {selectedSignalStats.ns.arrivals} in / {selectedSignalStats.ns.departures} out<br/>Flow counts cover the last 10 simulated seconds.</p>}{timingReviews.slice(0,3).map((r,i)=><p className="timing-review" key={`${r.request}-${i}`}>{clock(r.time)} · {r.source==='api'?decisionProviders[r.provider].label:'Fixed fallback'} · {timingPlans[r.plan].label}<br/>{r.reason}{r.confidence!==undefined && <><br/>Confidence {(r.confidence*100).toFixed(0)}%</>}{r.latencyMs!==undefined && <><br/>{r.latencyMs.toFixed(0)}ms provider latency</>}</p>)}</div><div className="request-history" aria-label="Route provider decisions">{routeApiReviews.slice(0,3).map((r,i)=><p key={i}>Vehicle #{r.car} · {r.provider==='local'?'Local heuristic':decisionProviders[r.provider].label} · {r.source==='api'?'API answer':'Local fallback'}<br/>{r.reason}{r.latencyMs!==undefined && <><br/>{r.latencyMs.toFixed(0)}ms provider latency</>}</p>)}</div><div className="request-history" aria-label="Recent junction requests">{signalRequests.slice(0, 3).map(r => <p key={r.id}>{r.settings.provider==='local'?'Local review':'API batch'} #{r.batchId} · {clock(r.time)}<br/>{r.cars.length} vehicles · {Object.keys(r.observedLoads).length} observed roads · {r.changed} reroutes<br/>{r.settings.provider==='local'?'Local heuristic':decisionProviders[r.settings.provider].label} · {r.settings.information} · {r.settings.cadence === 'every-vehicle' ? 'per vehicle' : `every ${r.settings.intervalSeconds}s`}</p>)}</div><div className="decision-feed">{signalDecisions.length ? signalDecisions.slice(0, 8).map(d => <button className="decision-item" key={d.id} onClick={() => { selectCar(d.car); setSelectedSignal(d.node); }}><div className={'decision-symbol '+d.kind}>{d.kind === 'closure' ? <TrafficCone size={15}/> : <GitBranch size={15}/>}</div><div><div className="decision-meta">VEHICLE #{d.car}<time>{clock(d.time)}</time></div><p>{d.reason}</p><small>Signal junction {d.node}</small></div></button>) : <div className="feed-empty"><div className="empty-icon"><GitBranch size={25}/></div><b>No recent route reviews at this traffic light.</b><p>{s?.adaptive ? 'Route reviews appear here when this traffic light requests a decision.' : 'Switch to Coordinated routing to let traffic lights recommend routes based on demand.'}</p></div>}</div></> : <div className="feed-empty"><div className="empty-icon"><GitBranch size={25}/></div><b>Click a traffic light on the map.</b><p>Inspect requests and vehicle route reviews at that junction.</p></div>}
      </section>
    </aside></main>
  </div>;
}
function RouteLayer({label, detail, color, dashed = false, active, onClick}: {label: string; detail: string; color: string; dashed?: boolean; active: boolean; onClick: () => void}) {
  return <button className={'route-layer '+(active ? '' : 'hidden-layer')} aria-pressed={active} onClick={onClick} title={detail}><span className="route-swatch" style={{borderTopColor:color, borderTopStyle:dashed ? 'dashed' : 'solid'}}/><span><b>{label}</b><small>{detail}</small></span><span className="layer-check">{active ? '✓' : '+'}</span></button>;
}
