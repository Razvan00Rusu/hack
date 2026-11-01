import{chromium}from'@playwright/test';import{resolve}from'node:path';import{readFileSync,writeFileSync}from'node:fs';
const preview=process.argv.includes('--preview'),out='reports/full-length',file=preview?'preview':'report';
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];let requests=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))requests++;});
 await page.goto('file://'+resolve(out+'/'+file+'.html'));await page.locator('#loading').filter({hasText:'ready'}).waitFor({timeout:60000,state:'attached'});
 if(errors.length)throw new Error(errors.join('; '));
 if(await page.locator('#comparison').inputValue()!=='demand'||await page.locator('#playback-mode').inputValue()!=='demand')throw new Error('Own AI timing is not the default');
 const headline=await page.locator('#overall-chart').innerText();if(!headline.includes('%')&&!headline.includes('Not comparable'))throw new Error('Missing percentage baseline');
 await page.screenshot({path:out+'/'+file+'-overview.png',fullPage:true});
 await page.locator('#comparison').selectOption('fixed');await page.locator('#comparison').selectOption('demand');
 await page.getByRole('button',{name:'Scenario playback',exact:true}).click();
 await page.locator('[data-time="600"]').click();if(await page.locator('#time-label').innerText()!=='10:00')throw new Error('Jump to staged incident failed');
 const before=await page.locator('#time-label').innerText();await page.clock.install();await page.locator('#play').click();await page.clock.runFor(500);await page.locator('#play').click();if(await page.locator('#time-label').innerText()===before)throw new Error('Playback failed');
 if(await page.locator('#stability-table tr').count()!==3)throw new Error('Missing stability diagnostics');
 if(await page.locator('#explorer svg').count()!==4)throw new Error('Missing graphs');
 await page.screenshot({path:out+'/'+file+'-playback.png',fullPage:true});
 await page.getByRole('button',{name:'Overview',exact:true}).click();await page.locator('#filter-closure').selectOption('mixed');await page.locator('#filter-seed').selectOption('42');
 if(!preview){const count=await page.locator('#page-label').innerText();if(!count.includes('30 runs'))throw new Error('Filtering matrix failed: '+count);}
 await page.getByRole('button',{name:'Method & data',exact:true}).click();await page.setViewportSize({width:390,height:844});if(!await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))throw new Error('Mobile overflow');
 if(errors.length||requests)throw new Error(JSON.stringify({errors,requests}));
 const result={verifiedAt:new Date().toISOString(),file:out+'/'+file+'.html',ownAiDefault:true,percentageReference:true,playback:'passed',graphs:4,stabilityRows:3,mobile:'passed',externalRequests:requests,errors};writeFileSync(out+'/'+file+'-verification.json',JSON.stringify(result,null,2));console.log(result);
 }finally{await browser.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
