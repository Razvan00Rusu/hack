import { defaultMap, type CityMap } from '../lib/maps';
import { nodeById, type Closure, type Road } from '../lib/simulation';
import { blocked, directions, trafficColor } from '../lib/road-display';
export default function RoadSegment({network=defaultMap,road, state, selected, heat, forwardLoad, reverseLoad, onSelect}: {network?:CityMap;road: Road; state: Closure; selected: boolean; heat: boolean; forwardLoad: number; reverseLoad: number; onSelect: () => void}) {
  const nodeById=network.nodeById;
  const a=nodeById[road.a], b=nodeById[road.b], angle=Number((Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI).toFixed(4));
  const length=Number(road.length.toFixed(4));
  const half=road.major ? 9.5 : 6, edge=half+4, d=directions(road,network);
  return <g data-road-id={road.id} className="road-link" transform={`translate(${a.x} ${a.y}) rotate(${angle})`} onClick={onSelect} role="button" tabIndex={0} aria-label={`${road.name} segment ${road.a} to ${road.b}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect();}}}>
    <line x2={length} stroke="#d4d5ca" strokeWidth={half*2+3}/><line x2={length} stroke="#fafaf5" strokeWidth={half*2}/>
    {selected && <rect x="10" y={-half-1} width={length-20} height={half*2+2} rx="3" fill="none" stroke="#8c9d6d" strokeWidth="1.5"/>}
    {heat && (['forward','reverse'] as const).map(dir=><line key={dir} data-traffic-direction={dir} className="traffic-edge" x1="15" x2={length-15} y1={dir==='forward' ? -edge : edge} y2={dir==='forward' ? -edge : edge} style={{stroke:trafficColor((dir==='forward'?forwardLoad:reverseLoad)/(road.capacity/2))}} strokeWidth="2.5" strokeLinecap="round" opacity=".65" pointerEvents="none"/>)}
    {(['forward','reverse'] as const).filter(dir=>blocked(state,dir)).map(dir=><g key={dir} data-blocked-direction={dir} pointerEvents="none">
      <title>{`${road.name} ${d[dir]} blocked`}</title>
      <rect x="11" y={dir==='forward'?-half:0} width={length-22} height={half} fill="#edbbaa" opacity=".8"/>
      <rect x="11" y={dir==='forward'?-half:0} width={length-22} height={half} fill="url(#blocked-lane-hatch)"/>
      {[.25,.75].map(t=><g key={t} transform={`translate(${length*t} ${dir==='forward'?-half/2:half/2}) ${dir==='reverse'?'rotate(180)':''}`}><path d="M-7 0H5M1 -3L5 0 1 3" fill="none" stroke="#b35d49" strokeWidth="1.4"/></g>)}
      <g transform={`translate(${length/2} ${dir==='forward'?-half/2:half/2})`}><circle r="4" fill="#b45c47"/><path d="M-2.5 0H2.5" stroke="#fff8f0" strokeWidth="1.4"/></g>
    </g>)}
    <line x2={length} stroke="#cfcec2" strokeWidth=".7" strokeDasharray="3 8"/>
    <line className="road-hit" x2={length}/>
  </g>;
}
