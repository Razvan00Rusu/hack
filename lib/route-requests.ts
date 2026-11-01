import type { DecisionProvider, RoutingProvider } from './decision-providers';
export type RouteCandidate = {value:string; path:string[]; cost:number};
export type RouteVehicle = {car:number; from:string; node:string; destination:string; current:string[]; candidates:RouteCandidate[]};
export type RouteJunction = {node:string; observedLoads:Record<string,number>; vehicles:RouteVehicle[]};
export type RouteBatch = {id:number; version:number; closureVersion:number; time:number; provider:DecisionProvider; junctions:RouteJunction[]};
export type RouteAnswer = {car:number; node:string; choice?:string; confidence?:number; source:'api'|'fallback'; reason:string};
export type RouteResult = {answers:RouteAnswer[]; unavailable?:boolean; latencyMs?:number};
export type RouteApiReview = RouteAnswer & {time:number; provider:RoutingProvider; latencyMs?:number};
export const routeQuestionName = (node:string,car:number)=>`route_${node}_${car}`;
