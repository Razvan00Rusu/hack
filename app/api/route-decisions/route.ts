import { cityMaps } from '../../../lib/maps';
import { isDecisionProvider } from '../../../lib/decision-providers';
import { decideRoutes, parseRouteInput } from '../../../lib/route-decisions';
export const runtime='nodejs';
export async function POST(request:Request) {
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin) return Response.json({error:'Invalid origin'},{status:403});
  let junctions,provider;
  try {
    const text=await request.text();if(text.length>500000) return Response.json({error:'Request too large'},{status:413});
    const body=JSON.parse(text);if(!cityMaps[body.mapId||'central'])throw new Error('Invalid map');if(!isDecisionProvider(body.provider)) throw new Error('Invalid provider');
    provider=body.provider;junctions=parseRouteInput(body,cityMaps[body.mapId||'central']);
  }catch{return Response.json({error:'Invalid route snapshot'},{status:400});}
  return Response.json(await decideRoutes(junctions,{provider}),{headers:{'Cache-Control':'no-store'}});
}
