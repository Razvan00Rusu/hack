import { test, expect } from '@playwright/test';

test('third-person free steering, uncluttered view, closures and exit', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await page.locator('[data-road-id="4-3_4-4"]').click({position:{x:40,y:10}});
  await page.getByRole('button',{name:'Close both',exact:true}).click();
  await page.getByRole('button',{name:'Drive car',exact:true}).click();
  const view=page.getByRole('region',{name:'Third-person driving',exact:true});
  await expect(view).toBeVisible();
  await expect(page.locator('.driving-nav,.driving-dashboard,.driving-turns')).toHaveCount(0);
  await expect(page.locator('.driving-minimap b,.driving-minimap small')).toHaveCount(0);
  await expect(page.getByRole('img',{name:/Live minimap/})).toBeVisible();
  await expect(page.getByTestId('driving-route')).toHaveAttribute('points',/\S+ \S+/);
  const surface=page.getByRole('img',{name:/Third-person driving\. W/});
  await expect(surface).toBeFocused();
  const initial=await page.getByTestId('driver-position').getAttribute('transform');
  await page.keyboard.down('w');await page.clock.runFor(1200);
  await page.keyboard.down('a');await page.clock.runFor(400);await page.keyboard.up('a');await page.keyboard.up('w');
  await expect(page.getByTestId('driver-position')).not.toHaveAttribute('transform',initial!);
  const turned=await page.getByTestId('driver-position').getAttribute('transform');
  expect(turned?.split('rotate')[1]).not.toBe(initial?.split('rotate')[1]);
  await page.keyboard.down(' ');await page.clock.runFor(1000);await page.keyboard.up(' ');
  const stopped=await page.getByTestId('driver-position').getAttribute('transform');
  await page.clock.runFor(500);await expect(page.getByTestId('driver-position')).toHaveAttribute('transform',stopped!);
  await expect(view).toBeVisible();
  await expect(page.locator('.driving-minimap [data-closure="4-3_4-4"]')).toHaveCount(1);
  await page.screenshot({path:'/tmp/greenwave-third-person.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/greenwave-third-person-mobile.png',fullPage:true});
  await surface.focus();await page.keyboard.press('Escape');await expect(view).toHaveCount(0);
  await page.getByRole('button',{name:'Drive car',exact:true}).click();
  await page.getByRole('button',{name:'Reset',exact:true}).click();await expect(view).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('driving follows map changes and reset retains the chosen map', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Drive car',exact:true}).click();
  const view=page.getByRole('region',{name:'Third-person driving',exact:true});
  await expect(view).toBeVisible();
  await page.getByLabel('City map',{exact:true}).selectOption('suburban');
  await expect(view).toHaveCount(0);
  await page.getByRole('button',{name:'Drive car',exact:true}).click();
  await expect(view).toBeVisible();
  await expect(page.locator('.driving-minimap svg > line')).toHaveCount(20);
  await page.keyboard.press('w');
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(view).toHaveCount(0);
  await expect(page.getByLabel('City map',{exact:true})).toHaveValue('suburban');
  expect(errors).toEqual([]);
});
