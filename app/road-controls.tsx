import { type Road, type Closure } from '../lib/simulation';
import { blocked, crossStreet, directions, toggleDirection } from '../lib/road-display';
export default function RoadControls({road,state,onChange}: {road:Road;state:Closure;onChange:(state:Closure)=>void}) {
  const d=directions(road);
  return <div className="road-controls">
    <div className="segment-endpoints"><span><b>A</b>{crossStreet(road,'a')}</span><span><b>B</b>{crossStreet(road,'b')}</span></div>
    <div className="direction-controls">
      {(['forward','reverse'] as const).map(dir=>{const closed=blocked(state,dir);return <button key={dir} className={'direction-control '+(closed?'is-blocked':'')} aria-label={`${closed?'Unblock':'Block'} ${d[dir]}`} aria-pressed={closed} onClick={()=>onChange(toggleDirection(state,dir))}>
        <span className="direction-arrow">{d[`${dir}Arrow`]}</span><span className="direction-info"><b>{d[dir]} <small>{dir==='forward'?'A → B':'B → A'}</small></b><span>{dir==='forward'?crossStreet(road,'a'):crossStreet(road,'b')} → {dir==='forward'?crossStreet(road,'b'):crossStreet(road,'a')}</span></span><span className="direction-status">{closed?'Blocked · reopen':'Open · block'}</span>
      </button>;})}
    </div>
    <div className="closure-options"><button className={state==='open'?'selected':''} onClick={()=>onChange('open')}>Open both</button><button className={state==='closed'?'selected danger':''} onClick={()=>onChange('closed')}>Close both</button></div>
    <p className="hint">Click a direction to toggle it. Hatched red marks only the blocked half; arrows show the blocked direction. Cars already on that half clear the link.</p>
  </div>;
}
