import {test,expect} from '@playwright/test';
test('junction decisions, road controls, inspectors, playback, and mobile layout', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error' && /hydrat/i.test(message.text())) errors.push(message.text());});
  await page.goto('/');
  await expect(page.getByText('Click a traffic light on the map.')).toBeVisible();
  await expect(page.locator('.app > header, .page-heading, .bottom-note, .aside-footer, .modal-backdrop, .incident-button')).toHaveCount(0);
  await expect(page.getByText('SANDBOX', {exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Vehicle \d+/,exact:true}).first()).toBeVisible();
  await expect(page.getByRole('img',{name:'AVG TIME ON NETWORK over simulated time',exact:true})).toBeVisible();
  await expect(page.getByTestId('trend-averageVehicleAge')).toHaveAttribute('points',/\S+/);
  await page.clock.install();
  await page.clock.runFor(2200);
  await expect(page.getByTestId('trend-completedChange')).toHaveAttribute('points', /\S+ \S+/);
  await expect(page.getByTestId('trend-reroutesChange')).toBeVisible();
  await expect(page.getByTestId('trend-averageVehicleAge')).toHaveAttribute('points', /\S+ \S+/);
  await expect(page.getByText('Mean elapsed time of active vehicles')).toBeVisible();
  await page.getByRole('img',{name:'VEHICLES ON NETWORK over simulated time',exact:true}).hover();
  await expect(page.locator('.trend-tooltip')).toBeVisible();
  await page.getByRole('button',{name:'Pause simulation'}).click();
  const segment=page.locator('[data-road-id="4-3_4-4"]');
  await segment.click({position:{x:40,y:10}});
  await page.getByRole('button',{name:'Close both',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Road inspector'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Close both',exact:true})).toHaveClass(/selected/);
  await expect(page.getByRole('heading',{name:'Decision feed'})).toHaveCount(0);
  await expect(segment.locator('[data-blocked-direction]')).toHaveCount(2);
  await page.getByRole('button',{name:'Unblock westbound',exact:true}).click();
  await expect(segment.locator('[data-blocked-direction]')).toHaveCount(1);
  await expect(segment.locator('[data-blocked-direction=forward]')).toBeVisible();
  await page.getByRole('button',{name:'Unblock eastbound',exact:true}).click();
  await expect(segment.locator('[data-blocked-direction]')).toHaveCount(0);
  await page.getByRole('button',{name:'Block westbound',exact:true}).click();
  await expect(segment.locator('[data-blocked-direction=reverse]')).toBeVisible();
  await expect(segment.locator('[data-blocked-direction]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Block eastbound',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('[data-road-name="Oxford Street"]')).toHaveCount(1);
  await expect(page.locator('[data-road-name]')).toHaveCount(13);
  await expect(segment.locator('[data-traffic-direction]')).toHaveCount(2);
  await expect(segment.locator('[data-traffic-direction=forward]')).toHaveCSS('transition-property','stroke');
  await page.getByRole('button',{name:'Toggle roadside traffic bars',exact:true}).click();
  await expect(segment.locator('[data-traffic-direction]')).toHaveCount(0);
  await expect(segment.locator('[data-blocked-direction=reverse]')).toBeVisible();
  await page.getByRole('button',{name:'Toggle roadside traffic bars',exact:true}).click();
  await page.screenshot({path:'/tmp/greenwave-directional-closure.png',fullPage:true});
  await page.getByLabel('Request frequency', {exact:true}).selectOption('every-vehicle');
  await page.getByRole('button',{name:'Play simulation',exact:true}).click();
  await page.clock.runFor(100);
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  const signals = page.getByRole('button',{name:/^Traffic light /});
  // Find a light with route reviews, including unchanged recommendations.
  let junctionWithDecisions = '';
  for (let i = 0; i < await signals.count(); i++) {
    const signal = signals.nth(i);
    await signal.focus();
    await page.keyboard.press('Enter');
    await expect(signal).toHaveAttribute('aria-pressed','true');
    if (await page.locator('.decision-item').count()) {
      junctionWithDecisions = (await signal.getAttribute('aria-label'))!.replace('Traffic light ', '');
      break;
    }
  }
  expect(junctionWithDecisions).not.toBe('');
  const decisions = page.getByRole('region',{name:'Traffic light decisions'});
  for (const item of await decisions.locator('.decision-item small').all()) {
    await expect(item).toHaveText(`Signal junction ${junctionWithDecisions}`);
  }
  await decisions.getByRole('button',{name:/VEHICLE #/}).first().click();
  await expect(page.getByRole('heading',{name:'Vehicle inspector'})).toBeVisible();
  await expect(page.locator('[data-route-layer=original]')).toBeVisible();
  await expect(page.locator('[data-route-layer=version-0]')).toBeVisible();
  await expect(page.locator('[data-route-layer=current]')).toBeVisible();
  await expect(page.getByRole('button',{name:/Initial recommendation/})).toBeVisible();
  await page.getByRole('button',{name:/Original dumb route/}).click();
  await expect(page.locator('[data-route-layer=original]')).toHaveCount(0);
  await page.getByRole('button',{name:/Original dumb route/}).click();
  await expect(page.locator('[data-route-layer=original]')).toBeVisible();
  await page.getByRole('button',{name:'Follow this journey'}).click();
  await expect(page.getByText(/overhead satnav preview/)).toBeVisible();
  await page.getByLabel('Request frequency', {exact:true}).selectOption('interval');
  await page.getByLabel('Traffic information', {exact:true}).selectOption('local');
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(page.getByLabel('Traffic information', {exact:true})).toHaveValue('local');
  await expect(page.getByText('Click a traffic light on the map.')).toBeVisible();
  await page.getByRole('button',{name:'Pause simulation'}).click();
  await signals.first().focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('No recent route reviews at this traffic light.')).toBeVisible();
  await page.getByRole('button',{name:'Close traffic light inspector'}).click();
  await expect(page.getByText('Click a traffic light on the map.')).toBeVisible();
  await page.screenshot({path:'/tmp/greenwave-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('heading',{name:'Routing intelligence'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/greenwave-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('optional API signal timing batches junctions independently of routing and preserves settings on reset', async ({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  const snapshots:{junctions:{node:string;ew:{queueWait:number};ns:{arrivals:number}}[]}[]=[];
  await page.route('**/api/signal-decisions',async route=>{
    const body=route.request().postDataJSON(); snapshots.push(body);
    await route.fulfill({json:{answers:body.junctions.map((j:{node:string})=>({node:j.node,plan:'east_west',source:'api',confidence:.92,reason:'Demand on east / west approaches.'}))}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  const controller=page.getByLabel('Signal controller',{exact:true});
  await expect(controller).toHaveValue('fixed');
  await page.getByRole('button',{name:'Shortest path',exact:true}).click();
  await controller.selectOption('decisions');
  await page.getByRole('button',{name:'Play simulation',exact:true}).click();
  await expect.poll(()=>snapshots.length).toBeGreaterThan(0);
  await expect(page.getByLabel('Signal timing totals')).toContainText(`${snapshots[0].junctions.length} accepted junction answers`);
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  expect(snapshots.length).toBeGreaterThan(0); expect(snapshots[0].junctions.length).toBeGreaterThan(1);
  expect(snapshots[0].junctions[0].ew.queueWait).toBeGreaterThanOrEqual(0);
  expect(snapshots[0].junctions[0].ns.arrivals).toBeGreaterThanOrEqual(0);
  const signal=page.getByRole('button',{name:'Traffic light 1-1',exact:true});
  await signal.focus(); await page.keyboard.press('Enter');
  const history=page.getByLabel('Signal timing decisions');
  await expect(history).toContainText('OpenAI Decisions');
  await expect(history).toContainText('E/W 12s / N/S 5s');
  await expect(signal).toHaveAttribute('data-signal-phase',/ew|ns|all-red/);
  await page.screenshot({path:'/tmp/greenwave-signal-api.png',fullPage:true});
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(controller).toHaveValue('decisions');
  await expect(page.getByRole('button',{name:'Shortest path',exact:true})).toHaveClass(/active/);
  await controller.selectOption('fixed');
  await page.clock.install();
  const before=snapshots.length; await page.clock.runFor(2000);
  expect(snapshots.length).toBe(before);
  expect(errors).toEqual([]);
});

test('signal timing shows missing-key fallback and avoids repeated unavailable API requests', async ({page})=>{
  let requests=0;
  await page.route('**/api/signal-decisions',async route=>{
    requests++;const body=route.request().postDataJSON();
    await route.fulfill({json:{unavailable:true,answers:body.junctions.map((j:{node:string})=>({node:j.node,plan:'balanced',source:'fallback',reason:'OPENAI_API_KEY is not configured. Fixed timing fallback.'}))}});
  });
  await page.goto('/');
  await page.getByLabel('Signal controller',{exact:true}).selectOption('decisions');
  await expect(page.getByRole('status')).toContainText('Fixed timing fallback is active');
  await page.clock.install(); await page.clock.runFor(10000);
  expect(requests).toBe(1);
  await expect(page.getByLabel('Signal timing totals')).toContainText(`${await page.getByRole('button',{name:/^Traffic light /}).count()} junction fallbacks`);
});

test('routing and signals independently switch between Jev and OpenAI and retain providers on reset',async({page})=>{
  const calls:{kind:string;provider:string}[]=[];
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/route-decisions',async route=>{
    const b=route.request().postDataJSON();calls.push({kind:'route',provider:b.provider});
    await route.fulfill({json:{latencyMs:30,answers:b.junctions.flatMap((j:{node:string;vehicles:{car:number;candidates:{value:string}[]}[]})=>j.vehicles.map(v=>({node:j.node,car:v.car,choice:v.candidates[0].value,source:'api',confidence:.9,reason:'test'})))}});
  });
  await page.route('**/api/signal-decisions',async route=>{
    const b=route.request().postDataJSON();calls.push({kind:'signal',provider:b.provider});
    await route.fulfill({json:{latencyMs:20,answers:b.junctions.map((j:{node:string})=>({node:j.node,plan:'balanced',source:'api',confidence:.9,reason:'test'}))}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await page.getByLabel('Request frequency',{exact:true}).selectOption('every-vehicle');
  const routing=page.getByLabel('Routing provider',{exact:true}),signal=page.getByLabel('Signal provider',{exact:true});
  await routing.selectOption('openrouter');await signal.selectOption('openai');
  await page.getByLabel('Signal controller',{exact:true}).selectOption('decisions');
  await page.getByRole('button',{name:'Play simulation',exact:true}).click();
  await expect.poll(()=>calls.some(c=>c.kind==='route'&&c.provider==='openrouter')).toBe(true);
  await expect.poll(()=>calls.some(c=>c.kind==='signal'&&c.provider==='openai')).toBe(true);
  await expect(page.getByLabel('Route API totals')).not.toContainText('0 accepted route answers');
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await routing.selectOption('openai');await signal.selectOption('openrouter');
  await page.getByRole('button',{name:'Play simulation',exact:true}).click();
  await expect.poll(()=>calls.some(c=>c.kind==='route'&&c.provider==='openai')).toBe(true);
  await expect.poll(()=>calls.some(c=>c.kind==='signal'&&c.provider==='openrouter')).toBe(true);
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await page.getByRole('button',{name:'Traffic light 1-1',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByLabel('Route provider decisions')).toContainText('OpenAI Decisions');
  await expect(page.getByLabel('Signal timing decisions')).toContainText('OpenRouter · Jev 1.13');
  await page.screenshot({path:'/tmp/greenwave-provider-switch.png',fullPage:true});
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(routing).toHaveValue('openai');await expect(signal).toHaveValue('openrouter');
  expect(errors).toEqual([]);
});

test('suburban map has fewer roads and signals and remains selected after reset',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
 await page.getByLabel('City map',{exact:true}).selectOption('suburban');
 await expect(page.locator('[data-road-id]')).toHaveCount(20);
 await expect(page.getByRole('button',{name:/^Traffic light /})).toHaveCount(3);
 const road=page.locator('[data-road-id="0-2_0-3"]');await road.click({position:{x:35,y:8}});
 await page.getByRole('button',{name:'Close both',exact:true}).click();
 await expect(road.locator('[data-blocked-direction]')).toHaveCount(2);
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await expect(page.getByLabel('City map',{exact:true})).toHaveValue('suburban');
 await expect(page.locator('[data-road-id]')).toHaveCount(20);
 expect(errors).toEqual([]);
});
