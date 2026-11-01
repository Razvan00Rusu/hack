export type Node = { id: string; x: number; y: number; signal: boolean; row: number; col: number };
export type Road = { id: string; a: string; b: string; name: string; major: boolean; length: number; capacity: number };
export type CityMap = { id:string; name:string; description:string; nodes:Node[]; roads:Road[]; nodeById:Record<string,Node>; roadById:Record<string,Road>; boundary:Node[]; incidentRoad:string };
const xs = [65, 215, 365, 510, 655, 805, 965];
const ys = [75, 205, 325, 445, 575, 705];
const horizontal = ['Marylebone Road', 'Weymouth Street', 'New Cavendish Street', 'Mortimer Street', 'Oxford Street', 'Grosvenor Street'];
const vertical = ['Edgware Road', 'Baker Street', 'Marylebone High Street', 'Harley Street', 'Regent Street', 'Great Portland Street', 'Tottenham Court Road'];
const nodes: Node[] = ys.flatMap((y, r) => xs.map((x, c) => ({ id: `${r}-${c}`, x: x + (r - 2) * (c > 3 ? -10 : 8), y: y - c * 5 + (c === 4 ? 14 : 0), signal: (r === 0 || r === 4 || c === 1 || c === 4) && r > 0 && r < 5 && c > 0 && c < 6, row: r, col: c })));
const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
const roads: Road[] = [];
for (const n of nodes) for (const [r, c] of [[n.row, n.col + 1], [n.row + 1, n.col]]) {
  const b = nodeById[`${r}-${c}`]; if (!b) continue;
  const h = n.row === r; const major = h ? n.row === 0 || n.row === 4 : n.col === 1 || n.col === 4 || n.col === 6;
  roads.push({ id: `${n.id}_${b.id}`, a: n.id, b: b.id, name: h ? horizontal[r] : vertical[c], major, length: Math.hypot(b.x - n.x, b.y - n.y), capacity: major ? 12 : 6 });
}
const roadById = Object.fromEntries(roads.map(r => [r.id, r]));
const boundary = nodes.filter(n => n.row === 0 || n.row === 5 || n.col === 0 || n.col === 6);
const incidentRoad = '4-3_4-4';

const central:CityMap={id:'central',name:'Central London grid',description:'Synthetic Marylebone / Fitzrovia grid with dense crossroads.',nodes,roads,nodeById,roadById,boundary,incidentRoad};
const suburbanNodes:Node[]=[];
for(let row=0;row<3;row++)for(let col=0;col<5;col++)suburbanNodes.push({id:`${row}-${col}`,row,col,x:90+col*210,y:160+row*220,signal:col===2});
suburbanNodes.push({id:'-1-1',row:-1,col:1,x:300,y:55,signal:false},{id:'3-3',row:3,col:3,x:720,y:725,signal:false});
const suburbanById=Object.fromEntries(suburbanNodes.map(n=>[n.id,n]));
const suburbanRoads:Road[]=[];
function link(a:string,b:string,name:string,major=true){const x=suburbanById[a],y=suburbanById[b];suburbanRoads.push({id:`${a}_${b}`,a,b,name,major,length:Math.hypot(x.x-y.x,x.y-y.y),capacity:major?18:8});}
for(let row=0;row<3;row++)for(let col=0;col<4;col++)link(`${row}-${col}`,`${row}-${col+1}`,['Upper Richmond Road','Sheen Road','Mortlake Road'][row],row!==1);
for(const col of [0,2,4])for(let row=0;row<2;row++)link(`${row}-${col}`,`${row+1}-${col}`,['Barnes Lane','Station Road','Park Avenue'][col/2]);
link('-1-1','0-1','Church Lane',false);link('2-3','3-3','Riverside Drive',false);
const suburban:CityMap={id:'suburban',name:'London suburbs',description:'Illustrative Richmond / Barnes corridors, T-junctions and two access spurs. Not real street geometry.',nodes:suburbanNodes,roads:suburbanRoads,nodeById:suburbanById,roadById:Object.fromEntries(suburbanRoads.map(r=>[r.id,r])),boundary:['0-0','0-4','2-0','2-4','-1-1','3-3'].map(id=>suburbanById[id]),incidentRoad:'0-2_0-3'};
export const cityMaps:Record<string,CityMap>={central,suburban};
export const defaultMap=central;
