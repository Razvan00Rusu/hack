import {requestChoices} from '../../lib/decision-adapter';
import {buildRouteDecisionRequest,parseRouteInput,parseRouteAnswers} from '../../lib/route-decisions';
import {buildSignalDecisionRequest,parseSignalInput,parseSignalAnswers,fixedFallback} from '../../lib/signal-decisions';
import type {Simulation} from '../../lib/simulation';
import type {DecisionProvider,ChoiceRequest} from '../../lib/decision-providers';
export async function makeFullDecisions(s:Simulation,provider:DecisionProvider,fetcher:typeof fetch){
 s.requestDecisions();const batches=s.takeRouteBatches();if(batches.length>1)throw new Error('Unexpected unbatched routing');
 const batch=batches[0],signals=s.signals.mode==='decisions'?s.signals.takeRequest(s.time,s.signalObservations()):null;
 const routes=batch?parseRouteInput({junctions:batch.junctions},s.network):[];
 const observations=signals?parseSignalInput({junctions:signals.junctions},s.network):[];
 const rq=routes.length?buildRouteDecisionRequest(routes):{input:'',questions:[]},sq=observations.length?buildSignalDecisionRequest(observations):{input:'',questions:[]};
 const questions=[...rq.questions,...sq.questions];
 // Lossless removal of duplicated whole-network traffic evidence. Paths and costs remain in each question's choices.
 const input='Synthetic city traffic. For route questions, choose only an offered legal route and require at least 15% cost improvement to reroute. '+
 'Unobserved traffic is free-flow. For signal questions, reduce queue waiting using bounded green plans, favour balanced when demand is similar, and avoid starving the opposing axis. '+
 JSON.stringify({map:s.network.id,routing:{observedLoads:routes[0]?.observedLoads||{}},signals:observations});
 const request:ChoiceRequest={input,questions};
 const result=questions.length?await requestChoices(provider,request,{apiKey:'broker-managed',fetcher}):{answers:[],provider,model:'',latencyMs:0,reason:'No eligible questions.'};
 let routeAnswers=0,routeFallbacks=0,signalAnswers=0,signalFallbacks=0;
 if(batch){const parsed=parseRouteAnswers(result,routes);s.receiveRouteBatch(batch,parsed);routeAnswers=parsed.answers.filter(a=>a.source==='api').length;routeFallbacks=parsed.answers.length-routeAnswers;}
 if(signals){const parsed=result.reason?{...fixedFallback(observations,result.reason),unavailable:result.unavailable}:parseSignalAnswers(result,observations);s.signals.receive(signals,{...parsed,latencyMs:result.latencyMs},s.time);signalAnswers=parsed.answers.filter(a=>a.source==='api').length;signalFallbacks=parsed.answers.length-signalAnswers;}
 return {time:s.time,questions:questions.length,routeAnswers,routeFallbacks,signalAnswers,signalFallbacks,latencyMs:result.latencyMs,error:result.reason||null};
}
