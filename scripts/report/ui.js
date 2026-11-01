const D=JSON.parse(document.getElementById('experiment-data').textContent);
const $=id=>document.getElementById(id),runs=D.results;
const colors={shortest:'#748396',openai:'#ce724a',openrouter:'#318777'};
const names={shortest:'Shortest path',openai:'OpenAI Decisions',openrouter:'Jev 1.13'};
const model=r=>r.arm==='shortest-fixed'?'shortest':r.provider;
const fmt=(v,n=1)=>v===null||v===undefined?'—':Number(v).toLocaleString('en-GB',{maximumFractionDigits:n,minimumFractionDigits:n});
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const armName=r=>`${names[model(r)]} · ${r.signalMode==='demand'?'AI signals':'fixed signals'}`;
const label={central:'Central grid',suburban:'Suburban corridors',low:'Low demand',mid:'Mid demand',high:'High demand',none:'No closure',partial:'One-way block',full:'Full closure'};
const modeArms=mode=>['shortest-fixed',`openai-${mode}`,`openrouter-${mode}`];
const groupRuns=mode=>runs.filter(r=>modeArms(mode).includes(r.arm));
const scenarioIds=[...new Set(runs.map(r=>`${r.mapId}-${r.traffic}-${r.closure}`))];
let comparison='fixed',scenario=scenarioIds[0],playbackMode='fixed',time=0,playing=false;
function badge(m){return `<span class="system-tag"><i style="background:${colors[m]}"></i>${names[m]}</span>`;}
function bars(target,entries,max=0){max=max||Math.max(120,...entries.map(e=>e.value))*1.08;$(target).innerHTML=entries.map(e=>`<div class="summary-bar"><div class="bar-meta"><span>${e.label}</span><strong class="bar-value">${fmt(e.value)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(.2,e.value/max*100)}%;background:${e.color}"></div></div></div>`).join('');}
function breakdown(target,field,values){const selected=groupRuns(comparison);$(target).innerHTML=values.map(v=>`<div class="mini-bars"><h4>${label[v]}</h4>${['shortest','openai','openrouter'].map(m=>{const score=avg(selected.filter(r=>r[field]===v&&model(r)===m).map(r=>r.score));return `<div class="mini-row"><span class="mini-label">${m==='shortest'?'Shortest':m==='openai'?'OpenAI':'Jev'}</span><span class="bar-track"><span class="bar-fill" style="display:block;background:${colors[m]};width:${Math.min(100,score/160*100)}%"></span></span><span class="mini-value">${fmt(score)}</span></div>`;}).join('')}</div>`).join('');}
function renderSummary(){
 const selected=groupRuns(comparison),scores=Object.fromEntries(['shortest','openai','openrouter'].map(m=>[m,avg(selected.filter(r=>model(r)===m).map(r=>r.score))]));
 bars('overall-chart',['shortest','openai','openrouter'].map(m=>({label:badge(m),value:scores[m],color:colors[m]})));
 $('comparison-note').textContent=comparison==='fixed'?'Primary routing comparison. All three methods use identical fixed signal timing. Each score averages 18 equally weighted cells.':'Complete-system comparison. Each AI controls routing and its own signal timing; shortest-path/fixed remains the reference. This comparison does not isolate routing quality.';
 const winner=Object.keys(scores).reduce((a,b)=>scores[a]>scores[b]?a:b);
 const bullets=[];
 bullets.push(`<p><span class="finding-number">${names[winner]}</span> has the highest observed average in this view at ${fmt(scores[winner])}. ${winner==='shortest'?'Neither AI beats the reference on the overall index in this view.':'That is '+fmt(scores[winner]-100)+' points above the shortest-path reference.'}</p>`);
 for(const m of ['openai','openrouter']){
  const a=selected.filter(r=>model(r)===m),completed=a.reduce((sum,r)=>sum+r.metrics.completed,0),baselineCompleted=selected.filter(r=>model(r)==='shortest').reduce((sum,r)=>sum+r.metrics.completed,0),wins=a.filter(r=>r.score>100.1).length;
  const best=[...a].sort((a,b)=>b.score-a.score)[0],worst=[...a].sort((a,b)=>a.score-b.score)[0];
  bullets.push(`<p>${names[m]} beats the reference in <span class="finding-number">${wins}/18 cells</span>. Best: ${label[best.mapId]}, ${best.traffic}, ${label[best.closure].toLowerCase()} at ${fmt(best.score)}. Weakest: ${label[worst.mapId]}, ${worst.traffic}, ${label[worst.closure].toLowerCase()} at ${fmt(worst.score)}. It completed ${completed} trips in total, against ${baselineCompleted} for shortest path.</p>`);
 }
 bullets.push('<p class="muted">These are single-run observations. Small score differences may be noise. A higher composite score can coincide with fewer completed trips in pooled totals, because scenarios are weighted equally and waiting and time also count. Every AI has the same legal-candidate and reroute-improvement constraints.</p>');$('findings').innerHTML=bullets.join('');
 breakdown('map-chart','mapId',['central','suburban']);breakdown('traffic-chart','traffic',['low','mid','high']);breakdown('closure-chart','closure',['none','partial','full']);
 bars('timing-chart',['shortest-fixed','openai-fixed','openai-demand','openrouter-fixed','openrouter-demand'].map(arm=>{const a=runs.filter(r=>r.arm===arm);return {label:esc(armName(a[0])),value:avg(a.map(r=>r.score)),color:colors[model(a[0])]};}));
}
function renderApi(){
 const actual=D.audit||runs.flatMap(r=>r.api),count=D.apiRequests+2;
 $('headline-stats').innerHTML=`<div><strong>${runs.length}</strong><span>short runs · 18 cells</span></div><div><strong>2 maps</strong><span>42 vs 17 nodes</span></div><div><strong>75s</strong><span>per run · one seed</span></div><div><strong>${count}</strong><span>API calls, including preflight</span></div>`;
 $('api-summary').innerHTML=['openai','openrouter'].map(m=>{
  const a=actual.filter(a=>a.provider===m),rr=runs.filter(r=>r.provider===m),routeOk=rr.reduce((s,r)=>s+r.routeAccepted,0),signalOk=rr.reduce((s,r)=>s+r.signalAccepted,0),fallback=rr.reduce((s,r)=>s+r.routeFallbacks+r.signalFallbacks,0),tokens=a.reduce((s,r)=>s+(r.usage?.input_tokens||0),0),cost=a.reduce((s,r)=>s+(r.usage?.cost||0),0);
  return `<div class="api-row">${badge(m)}<div class="api-numbers"><span>${a.length} calls</span><span>${fmt(avg(a.map(a=>a.latencyMs)),0)}ms mean</span><span>${a.filter(a=>a.status!==200).length} HTTP/network failures</span></div><div class="api-numbers"><span>${routeOk} route answers</span><span>${signalOk} signal answers</span><span>${fallback} local fallbacks</span></div><div class="api-numbers"><span>${fmt(tokens,0)} input tokens</span><span>${m==='openrouter'?'Reported cost $'+cost.toFixed(4):'Dollar cost not supplied'}</span></div></div>`;
 }).join('')+`<p class="muted">${D.apiRequests} benchmark calls plus 2 preflights. Three benchmark calls belong to an interrupted arm that was rerun; they are included in usage, not counted as completed experimental runs. No provider retries were made automatically.</p>`;
}
function renderMatrix(){
 const selected=runs.filter(r=>($('filter-map').value==='all'||r.mapId===$('filter-map').value)&&($('filter-traffic').value==='all'||r.traffic===$('filter-traffic').value)&&($('filter-closure').value==='all'||r.closure===$('filter-closure').value));
 $('matrix').innerHTML=selected.map(r=>`<tr><td>${label[r.mapId]} / ${r.traffic} / ${label[r.closure]}</td><td>${badge(model(r))} ${r.signalMode==='demand'?'<span class="badge">AI signals</span>':''}</td><td class="num">${fmt(r.score)}</td><td class="num">${r.metrics.completed}/${r.metrics.requested}</td><td class="num">${r.metrics.unfinished}</td><td class="num">${fmt(r.metrics.meanTruncatedTime)}s</td><td class="num">${fmt(r.metrics.totalWaiting,0)}s</td><td>${r.routeAccepted} / ${r.signalAccepted}</td><td><button data-scenario="${r.mapId}-${r.traffic}-${r.closure}" data-mode="${r.signalMode==='demand'?'demand':'fixed'}">Replay</button></td></tr>`).join('');
 $('matrix').querySelectorAll('button').forEach(b=>b.onclick=()=>{scenario=b.dataset.scenario;playbackMode=b.dataset.mode;$('scenario-select').value=scenario;$('playback-mode').value=playbackMode;time=0;setTab('explorer');renderExplorer();});
}
function selectedRuns(){return modeArms(playbackMode).map(arm=>runs.find(r=>r.id===`${scenario}--${arm}`));}
function chart(id,selected,field){
 const width=620,height=215,left=42,right=12,top=14,bottom=30;
 const value=s=>field==='queue'?s.queued+s.external:s[field];
 const maximum=Math.max(4,...selected.flatMap(r=>r.series.map(value)))*1.1;
 const x=t=>left+t/75*(width-left-right),y=v=>height-bottom-v/maximum*(height-bottom-top);
 let content='';for(let i=0;i<=4;i++){const v=maximum*i/4;content+=`<line x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8dc"/><text x="${left-7}" y="${y(v)+3}" text-anchor="end" fill="#77857d" font-size="9">${fmt(v,0)}</text>`;}
 for(const t of [0,15,30,45,60,75])content+=`<text x="${x(t)}" y="${height-8}" text-anchor="middle" fill="#77857d" font-size="9">${t}s</text>`;
 for(const t of [15,50])content+=`<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${height-bottom}" stroke="#cc8b5c" stroke-dasharray="3 4" opacity=".7"/>`;
 for(const r of selected)content+=`<path d="${r.series.map((s,i)=>`${i?'L':'M'}${x(s.time).toFixed(2)},${y(value(s)).toFixed(2)}`).join(' ')}" fill="none" stroke="${colors[model(r)]}" stroke-width="2.1"/>`;
 content+=`<line class="chart-cursor" x1="${x(time)}" x2="${x(time)}" y1="${top}" y2="${height-bottom}" stroke="#85917f" opacity=".6"/>`;
 $(id).innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${id.replaceAll('-',' ')} comparison"><title>Comparison over 75 simulated seconds</title>${content}</svg><div class="chart-legend">${selected.map(r=>`<span><i style="background:${colors[model(r)]}"></i>${names[model(r)]}: ${fmt(value(r.series.at(-1)),0)}</span>`).join('')}</div>`;
 $(id).querySelector('svg').onclick=e=>{const rect=e.currentTarget.getBoundingClientRect();time=Math.min(75,Math.max(0,((e.clientX-rect.left)/rect.width*width-left)/(width-left-right)*75));drawReplay();};
}
function renderExplorer(){
 const selected=selectedRuns(),first=selected[0],network=D.maps[first.mapId];
 $('scenario-description').textContent=`${network.name} · ${label[first.traffic]} · ${label[first.closure]}. ${first.metrics.requested} scheduled trips, demand 0–45s. ${first.closure==='none'?'No road closure.':network.roadById[network.incidentRoad].name+' blocked at 15s, reopened at 50s.'} Each arm uses identical scheduled origins, destinations and departure times.`;
 $('replay-maps').innerHTML=selected.map((r,i)=>`<article class="replay-card"><h3>${badge(model(r))}</h3><p class="map-description">${r.signalMode==='demand'?'Own AI timing':'Fixed timing'} · score ${fmt(r.score)}</p><canvas id="map-${i}" width="1040" height="780" aria-label="Recorded ${names[model(r)]} traffic playback"></canvas><div class="tooltip" id="tooltip-${i}"></div><div class="replay-stats" id="replay-stats-${i}"></div></article>`).join('');
 for(const [id,field] of [['completed-chart','completed'],['queue-chart','queue'],['waiting-chart','waiting'],['active-chart','active']])chart(id,selected,field);
 $('event-list').innerHTML=first.closure==='none'?'<span>20s & 40s: API checkpoints</span><span>45s: demand stops</span>':'<span>15s: closure starts</span><span>20s & 40s: API checkpoints</span><span>45s: demand stops</span><span>50s: road reopens</span>';
 const all=runs.filter(r=>r.mapId===first.mapId&&r.traffic===first.traffic&&r.closure===first.closure);
 $('scenario-metrics').innerHTML=all.map(r=>`<tr><td>${esc(armName(r))}</td><td>${r.metrics.completed}/${r.metrics.requested}</td><td>${r.metrics.notAdmitted}</td><td>${fmt(r.metrics.meanCompleted)}s</td><td>${fmt(r.metrics.p95Completed)}s</td><td>${fmt(r.metrics.meanTruncatedTime)}s</td><td>${fmt(r.metrics.totalWaiting,0)}s</td><td>${r.metrics.maxQueue}</td><td>${r.metrics.reroutes}</td><td>${fmt(r.metrics.localSeconds,0)}s</td></tr>`).join('');
 $('decision-log').innerHTML=all.filter(r=>r.decisions.length).map(r=>`<details><summary>${esc(armName(r))} · ${r.routeAccepted+r.signalAccepted} accepted answers · ${r.routeFallbacks+r.signalFallbacks} fallbacks</summary>${r.decisions.map(d=>`<details><summary>${fmt(d.time,0)}s / ${d.kind} / ${d.result.answers.filter(a=>a.source==='api').length} accepted</summary><pre>${esc(JSON.stringify(d.result,null,2))}</pre></details>`).join('')}</details>`).join('');
 selected.forEach((r,i)=>{$(`map-${i}`).onmousemove=e=>{const rect=e.currentTarget.getBoundingClientRect(),p={x:(e.clientX-rect.left)/rect.width*1040,y:(e.clientY-rect.top)/rect.height*780},f=r.frames.reduce((best,f)=>Math.abs(f.time-time)<Math.abs(best.time-time)?f:best),nearest=f.cars.map(c=>{const road=network.roads[c[1]],a=network.nodeById[road.a],b=network.nodeById[road.b];return {id:c[0],d:Math.hypot(a.x+(b.x-a.x)*c[2]-p.x,a.y+(b.y-a.y)*c[2]-p.y)};}).sort((a,b)=>a.d-b.d)[0],tip=$(`tooltip-${i}`);if(nearest?.d<20){tip.textContent=`Vehicle #${nearest.id}`;tip.style.display='block';tip.style.left=Math.min(rect.width-90,e.clientX-rect.left)+'px';tip.style.top=(e.clientY-rect.top+65)+'px';}else tip.style.display='none';};$(`map-${i}`).onmouseleave=()=>$(`tooltip-${i}`).style.display='none';});
 drawReplay();
}
function drawMap(canvas,r){
 const ctx=canvas.getContext('2d'),network=D.maps[r.mapId];ctx.clearRect(0,0,1040,780);ctx.fillStyle='#eaeddf';ctx.fillRect(0,0,1040,780);
 ctx.fillStyle='#d8e2c8';ctx.fillRect(0,0,1040,38);if(r.mapId==='suburban'){ctx.fillRect(65,200,350,120);ctx.fillRect(620,430,320,100);ctx.fillStyle='#b8d9df';ctx.fillRect(0,744,1040,36);}
 const before=r.frames.filter(f=>f.time<=time+1e-6).at(-1)||r.frames[0],after=r.frames.find(f=>f.time>time)||before;
 const ratio=after.time===before.time?0:(time-before.time)/(after.time-before.time),afterCars=new Map(after.cars.map(c=>[c[0],c]));
 const load={};for(const c of before.cars)load[c[1]]=(load[c[1]]||0)+1;
 network.roads.forEach((road,index)=>{
  const a=network.nodeById[road.a],b=network.nodeById[road.b],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=dy/len,ny=-dx/len;
  ctx.lineCap='round';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='#ced5c2';ctx.lineWidth=road.major?19:13;ctx.stroke();ctx.strokeStyle='#fafaf2';ctx.lineWidth=road.major?15:10;ctx.stroke();
  ctx.beginPath();ctx.moveTo(a.x+nx*13,a.y+ny*13);ctx.lineTo(b.x+nx*13,b.y+ny*13);ctx.strokeStyle=`hsl(${110*(1-Math.min(1,(load[index]||0)/road.capacity))} 34% 49%)`;ctx.lineWidth=2;ctx.stroke();
  const state=before.closures[road.id];if(state&&state!=='open')for(const sign of state==='closed'?[-1,1]:[state==='forward'?1:-1]){
   ctx.beginPath();ctx.moveTo(a.x+nx*sign*4,a.y+ny*sign*4);ctx.lineTo(b.x+nx*sign*4,b.y+ny*sign*4);ctx.strokeStyle='#ca6545';ctx.lineWidth=5;ctx.setLineDash([9,5]);ctx.stroke();ctx.setLineDash([]);
   ctx.save();ctx.translate((a.x+b.x)/2+nx*sign*4,(a.y+b.y)/2+ny*sign*4);ctx.rotate(Math.atan2(dy,dx)+(sign===-1?Math.PI:0));ctx.fillStyle='#9f3c2d';ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(-4,-5);ctx.lineTo(-4,5);ctx.closePath();ctx.fill();ctx.restore();
  }
 });
 const seen=new Set();ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillStyle='#828f79';for(const road of network.roads){if(seen.has(road.name))continue;seen.add(road.name);const matching=network.roads.filter(r=>r.name===road.name),m=matching[Math.floor(matching.length/2)],a=network.nodeById[m.a],b=network.nodeById[m.b];ctx.save();ctx.translate((a.x+b.x)/2,(a.y+b.y)/2-18);let angle=Math.atan2(b.y-a.y,b.x-a.x);if(angle>Math.PI/2)angle-=Math.PI;ctx.rotate(angle);ctx.fillText(road.name,0,0);ctx.restore();}
 const signals=network.nodes.filter(n=>n.signal);signals.forEach((n,i)=>{const phase=before.signals[i];ctx.beginPath();ctx.arc(n.x,n.y,9,0,Math.PI*2);ctx.fillStyle='#fffffa';ctx.fill();ctx.beginPath();ctx.arc(n.x,n.y,5,0,Math.PI*2);ctx.fillStyle=phase==='ew'?'#6d9343':phase==='ns'?'#257e97':'#be5149';ctx.fill();});
 for(const c of before.cars){const road=network.roads[c[1]],a=network.nodeById[road.a],b=network.nodeById[road.b];let x=a.x+(b.x-a.x)*c[2],y=a.y+(b.y-a.y)*c[2];const next=afterCars.get(c[0]);if(next){const nr=network.roads[next[1]],na=network.nodeById[nr.a],nb=network.nodeById[nr.b];x+=(na.x+(nb.x-na.x)*next[2]-x)*ratio;y+=(na.y+(nb.y-na.y)*next[2]-y)*ratio;}ctx.beginPath();ctx.arc(x,y,3.9,0,Math.PI*2);ctx.fillStyle=c[3]?'#9d64b1':colors[model(r)];ctx.fill();}
 const sample=r.series[Math.min(r.series.length-1,Math.floor(time))];return sample;
}
function drawReplay(){
 $('timeline').value=time;$('time-label').textContent=fmt(time)+'s';
 selectedRuns().forEach((r,i)=>{const s=drawMap($(`map-${i}`),r);$(`replay-stats-${i}`).innerHTML=`<span><b>${s.completed}</b> completed</span><span><b>${s.queued+s.external}</b> queue</span><span><b>${s.external}</b> outside</span>`;});
 document.querySelectorAll('.chart-cursor').forEach(l=>{const x=42+time/75*(620-54);l.setAttribute('x1',x);l.setAttribute('x2',x);});
}
function setTab(id){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.id===id));document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));if(id!=='explorer'){playing=false;$('play').textContent='Play';}else drawReplay();window.scrollTo({top:0,behavior:'instant'});}
function download(name,data,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}
function csv(){const columns=['id','mapId','traffic','closure','arm','score','requested','completed','unfinished','notAdmitted','completionRate','meanCompleted','p95Completed','meanTruncatedTime','exposure','totalWaiting','stoppedSeconds','externalWait','maxQueue','reroutes','localSeconds','routeAccepted','routeFallbacks','signalAccepted','signalFallbacks','demandHash'];return [columns.join(','),...runs.map(r=>columns.map(k=>JSON.stringify(r[k]??r.metrics[k]??'')).join(','))].join('\n');}
function methods(){
 $('design').innerHTML=`<p>${runs.length} runs across two maps, three demand levels and three incident conditions. Each cell has five arms: shortest-path/fixed, OpenAI/fixed, Jev/fixed, OpenAI/own-AI signals, and Jev/own-AI signals. No arm combines the paid providers.</p><p>Both models are pinned: <code>gpt-6-luna</code> and <code>typesafe/jev-1.13</code>. Whole-network traffic visibility and the same candidate-generation code are used for both.</p><p>Seed 42. An external, immutable demand schedule supplies ${D.protocol.initialDemand} initial requests plus low/mid/high arrivals at 0.5/1.5/3 vehicles per second through 45s. 45% of trips target a shared main-road corridor. Blocked entries queue FIFO per origin and are never dropped from the denominator. Demand hashes match across all arms in each scenario.</p><p>Closures start at 15s and reopen at 50s, on Oxford Street in the central map or Upper Richmond Road in the suburbs. Partial closes the forward direction; full closes both. Physics steps are 50ms. No model can author a road or bypass a closure.</p><p>The central network has ${D.maps.central.nodes.length} nodes, ${D.maps.central.roads.length} links and ${D.maps.central.nodes.filter(n=>n.signal).length} signals. Suburbs has ${D.maps.suburban.nodes.length} nodes, ${D.maps.suburban.roads.length} links and ${D.maps.suburban.nodes.filter(n=>n.signal).length} signals, with longer roads and fewer true crossroads.</p>`;
 $('provenance').textContent=`Generated ${D.generatedAt}. ${D.apiRequests} benchmark calls, including 3 from an interrupted run, plus 2 successful preflights. Request payload bytes: ${fmt(D.requestBytes,0)}. Credentials and request headers are excluded from the report and audit.`;
 $('generated').textContent=new Date(D.generatedAt).toLocaleDateString('en-GB');
}
$('comparison').onchange=e=>{comparison=e.target.value;renderSummary();};['filter-map','filter-traffic','filter-closure'].forEach(id=>$(id).onchange=renderMatrix);
$('scenario-select').innerHTML=scenarioIds.map(id=>{const r=runs.find(r=>r.id===id+'--shortest-fixed');return `<option value="${id}">${label[r.mapId]} / ${r.traffic} / ${label[r.closure]}</option>`;}).join('');
$('scenario-select').onchange=e=>{scenario=e.target.value;time=0;renderExplorer();};$('playback-mode').onchange=e=>{playbackMode=e.target.value;renderExplorer();};$('timeline').oninput=e=>{time=Number(e.target.value);drawReplay();};$('play').onclick=()=>{if(time>=75)time=0;playing=!playing;$('play').textContent=playing?'Pause':'Play';};
$('download-csv').onclick=()=>download('greenwave-initial-metrics.csv',csv(),'text/csv');$('download-json').onclick=()=>download('greenwave-initial-results.json',JSON.stringify(D),'application/json');$('download-audit').onclick=()=>download('greenwave-api-audit.json',JSON.stringify(D.audit,null,2),'application/json');
renderApi();renderSummary();renderMatrix();renderExplorer();methods();document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
let last=performance.now();function animate(now){const dt=Math.min((now-last)/1000,.1);last=now;if(playing){time=Math.min(75,time+dt*Number($('replay-speed').value));drawReplay();if(time>=75){playing=false;$('play').textContent='Play';}}requestAnimationFrame(animate);}requestAnimationFrame(animate);
