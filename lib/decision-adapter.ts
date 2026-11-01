// Server-side transport shared by signal and route decisions.
import { decisionProviders, isObject, type DecisionProvider, type ChoiceRequest, type ChoiceResult } from './decision-providers';
export function buildProviderRequest(provider:DecisionProvider, request:ChoiceRequest) {
  if(provider==='openai') return {...request,model:decisionProviders.openai.model};
  return {model:decisionProviders.openrouter.model,state:request.input,questions:Object.fromEntries(request.questions.map(q=>[q.name,{type:q.type,instructions:q.instructions,criteria:Object.fromEntries(q.choices.map(c=>[c.value,c.description]))}]))};
}
export function normalizeProviderAnswers(provider:DecisionProvider, data:unknown):unknown[] {
  if(!isObject(data)) return [];
  if(provider==='openai') return Array.isArray(data.answers)?data.answers:[];
  if(!isObject(data.answers)) return [];
  return Object.entries(data.answers).map(([name,a])=>isObject(a)?{...a,name}:{name,type:'invalid'});
}
export async function requestChoices(provider:DecisionProvider, request:ChoiceRequest, options:{apiKey?:string;fetcher?:typeof fetch}={}):Promise<ChoiceResult> {
  const start=performance.now(), config=decisionProviders[provider];
  const result=(data:Partial<ChoiceResult>):ChoiceResult=>({answers:[],provider,model:config.model,latencyMs:performance.now()-start,...data});
  const apiKey=options.apiKey??process.env[config.key];
  if(!apiKey) return result({unavailable:true,reason:`${config.key} is not configured.`});
  if(!request.questions.length || request.questions.length>200 || request.questions.some(q=>q.choices.length<2)) return result({reason:'Invalid question count.'});
  try {
    const response=await(options.fetcher||fetch)(provider==='openai'?'https://api.openai.com/v1/decisions':'https://openrouter.ai/api/alpha/decisions',{
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(buildProviderRequest(provider,request)),signal:AbortSignal.timeout(3000),cache:'no-store',
    });
    if(!response.ok) return result({reason:`${config.label} returned HTTP ${response.status}.`});
    return result({answers:normalizeProviderAnswers(provider,await response.json())});
  } catch { return result({reason:`${config.label} unavailable or timed out.`}); }
}
