import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync,writeFileSync } from 'node:fs';
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];let externalRequests=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('http'))externalRequests++;});
 await page.goto('file://'+resolve('reports/initial-pass/report.html'));
 if(errors.length)throw new Error(errors.join('; '));
 await page.waitForSelector('#matrix tr');
 if(await page.locator('#matrix tr').count()!==90)throw new Error('Missing report rows');
 await page.screenshot({path:'reports/initial-pass/overview.png',fullPage:true});
 await page.locator('#comparison').selectOption('demand');
 await page.locator('#filter-map').selectOption('suburban');await page.locator('#filter-traffic').selectOption('high');await page.locator('#filter-closure').selectOption('full');
 if(await page.locator('#matrix tr').count()!==5)throw new Error('Scenario filters failed');
 await page.locator('#matrix button').last().click();
 if(await page.locator('#playback-mode').inputValue()!=='demand')throw new Error('Playback mode did not follow scenario');
 await page.locator('#timeline').fill('37');await page.locator('#timeline').dispatchEvent('input');
 if(!(await page.locator('#time-label').innerText()).includes('37'))throw new Error('Replay scrubbing failed');
 if(await page.locator('#explorer svg').count()!==4)throw new Error('Missing comparison charts');
 const before=await page.locator('#time-label').innerText();await page.clock.install();await page.locator('#play').click();await page.clock.runFor(500);await page.locator('#play').click();
 if(await page.locator('#time-label').innerText()===before)throw new Error('Replay animation failed');
 await page.screenshot({path:'reports/initial-pass/playback.png',fullPage:true});
 await page.getByRole('button',{name:'Method & data',exact:true}).click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download-json').click()]);
 if(download.suggestedFilename()!=='greenwave-initial-results.json')throw new Error('JSON export failed');
 await page.setViewportSize({width:390,height:844});
 if(!await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))throw new Error('Mobile report overflows');
 await page.screenshot({path:'reports/initial-pass/mobile.png',fullPage:true});
 if(errors.length||externalRequests)throw new Error(JSON.stringify({errors,externalRequests}));
 const data=JSON.parse(readFileSync('reports/initial-pass/results.json','utf8'));
 if(data.audit.some((a:any)=>a.provider==='openai'?data.results.find((r:any)=>r.id===a.runId)?.provider!=='openai':data.results.find((r:any)=>r.id===a.runId)?.provider!=='openrouter'))throw new Error('Mixed provider run');
 const result={verifiedAt:new Date().toISOString(),rows:90,scenarioRows:5,graphs:4,playback:'passed',filters:'passed',exports:'passed',mobile:'passed',externalRequests,errors};
 writeFileSync('reports/initial-pass/verification.json',JSON.stringify(result,null,2));console.log(result);
 } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
