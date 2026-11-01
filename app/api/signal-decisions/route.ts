import { cityMaps } from '../../../lib/maps';
import { isDecisionProvider } from '../../../lib/decision-providers';
import { decideSignalTimings, parseSignalInput } from '../../../lib/signal-decisions';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const origin=request.headers.get('origin');
  if (origin && origin!==new URL(request.url).origin) return Response.json({error:'Invalid origin'}, {status:403});
  let junctions; let provider:'openai'|'openrouter'='openai';
  try {
    const text=await request.text();
    if (text.length>50000) return Response.json({error:'Request too large'}, {status:413});
    const body=JSON.parse(text);if(!cityMaps[body.mapId||'central'])throw new Error('Invalid map');
    if(body.provider!==undefined && !isDecisionProvider(body.provider)) throw new Error('Invalid provider');
    provider=body.provider||'openai'; junctions=parseSignalInput(body,cityMaps[body.mapId||'central']);
  } catch { return Response.json({error:'Invalid signal snapshot'}, {status:400}); }
  return Response.json(await decideSignalTimings(junctions,{provider}), {headers:{'Cache-Control':'no-store'}});
}
