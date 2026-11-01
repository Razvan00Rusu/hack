import { writeFileSync } from 'node:fs';
import { requestChoices } from '../lib/decision-adapter';
process.loadEnvFile('.env.local');
async function main(){
  const results=[];
  for(const provider of ['openai','openrouter'] as const){
    const r=await requestChoices(provider,{input:'Synthetic traffic junction. East/west queue 9 cars, longest wait 18 seconds. North/south queue 1 car, longest wait 2 seconds.',questions:[{type:'choice',name:'preflight',instructions:'Which timing plan should serve the larger waiting queue?',choices:[{value:'east_west',description:'Longer east/west green.'},{value:'balanced',description:'Equal green times.'}]}]});
    results.push(r);console.log(JSON.stringify(r));
  }
  writeFileSync('reports/initial-pass/preflight.json',JSON.stringify(results,null,2));
}
main();
