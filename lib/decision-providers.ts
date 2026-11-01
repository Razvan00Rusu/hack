export type DecisionProvider = 'openai' | 'openrouter';
export type RoutingProvider = 'local' | DecisionProvider;
export const decisionProviders = {
  openai: { label: 'OpenAI Decisions', model: 'gpt-6-luna', key: 'OPENAI_API_KEY' },
  openrouter: { label: 'OpenRouter · Jev 1.13', model: 'typesafe/jev-1.13', key: 'OPENROUTER_API_KEY' },
} as const;
export function isDecisionProvider(v: unknown): v is DecisionProvider { return v==='openai'||v==='openrouter'; }
export type ChoiceQuestion = {type:'choice'; name:string; instructions:string; choices:{value:string;description:string}[]};
export type ChoiceRequest = {input:string; questions:ChoiceQuestion[]};
export type ChoiceResult = {answers:unknown[]; unavailable?:boolean; reason?:string; provider:DecisionProvider; model:string; latencyMs:number};
export const isObject = (v:unknown):v is Record<string,unknown> => typeof v==='object'&&v!==null&&!Array.isArray(v);
