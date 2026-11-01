import {createHash} from 'node:crypto';
import {cityMaps} from '../lib/maps';import {Simulation} from '../lib/simulation';
for(const network of Object.values(cityMaps)){
 const s=new Simulation({}, {network});
 for(let i=0;i<1600;i++){if(i===400)s.setClosure(network.incidentRoad,'forward');if(i===900)s.setClosure(network.incidentRoad,'closed');if(i===1200)s.setClosure(network.incidentRoad,'open');s.tick(.05);}
 console.log(network.id,createHash('sha256').update(JSON.stringify({cars:s.cars,completed:s.completed,reroutes:s.reroutes,stopped:s.stoppedSeconds})).digest('hex'));
}
