/* Caddy4Me prototype browser test - run with: node tests/e2e/run.js */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
require('fs').mkdirSync(__dirname + '/shots', { recursive: true });
const OUT = __dirname + '/shots/';
const TILE = fs.readFileSync(__dirname + '/../fixtures/tile.png');
const SCORES = __dirname + '/../fixtures/scores/caddy4me-scores-2026-10-18.json';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    geolocation: { latitude: -32.0749, longitude: 115.8742, accuracy: 4 }, permissions: ['geolocation'], serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errors = [];
  let okN = 0;
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|fonts\.g|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
  await p.route('https://server.arcgisonline.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await p.route('https://clarity.maptiles.arcgis.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await p.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ current: { wind_speed_10m: 15, wind_direction_10m: 200, wind_gusts_10m: 25 } }) }));
  const check = (c, m) => { if (!c) { errors.push('CHECK FAILED: ' + m); console.log('FAIL -', m); } else { okN++; console.log('ok -', m); } };
  const S = () => p.evaluate(() => window.__c4m.S);

  await p.goto('http://localhost:8768/index.html');
  for (const k of '8989') await p.click(`[data-k="${k}"]`);
  await p.waitForTimeout(300);

  // ---- version ----
  await p.click('[data-a="settings"]');
  check(/Caddy4Me v0\.8 · 1 Nov 2026/.test(await p.textContent('#appver')), 'version shown at the bottom of Settings');
  // ---- defect: file pickers accept any file (v0.7: restore lives in Settings) ----
  check(await p.evaluate(() => !document.getElementById('restorefile').hasAttribute('accept')), 'Restore backup picker has no file-type filter');
  await p.setInputFiles('#restorefile', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await p.waitForTimeout(200);
  check(/isn’t a Caddy4Me backup file/.test(await p.textContent('#app')), 'wrong file for restore gives a clear message');
  await p.click('[data-a="home"]'); await p.click('[data-a="past"]');
  check(await p.evaluate(() => !document.getElementById('impfile').hasAttribute('accept')), 'Import scores picker has no file-type filter');
  // a scores file shared from Drive/WhatsApp often arrives with a generic type
  await p.setInputFiles('#impfile', { name: 'caddy4me-scores-2026-10-18.json', mimeType: 'application/octet-stream', buffer: fs.readFileSync(SCORES) });
  await p.waitForTimeout(400);
  check(/Added round 2026-10-18/.test(await p.textContent('#app')), 'scores file with a generic file type imports');
  await p.click('[data-a="home"]'); await p.click('[data-a="past"]');
  await p.setInputFiles('#impfile', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: TILE });
  await p.waitForTimeout(200);
  check(/isn’t a Caddy4Me scores file/.test(await p.textContent('#impmsg')), 'wrong file for import gives a clear message');
  await p.click('[data-a="home"]');

  // ---- My Bag: strategy row, add and remove clubs ----
  await p.click('[data-a="bag"]');
  check(await p.locator('.stratrow').count() === 1, 'Course strategy row in My Bag');
  check(/Smart Bogey Golf · updated/.test(await p.textContent('.stratrow')), 'row shows default mode and updated date');
  await p.fill('#ncName', '3 Wood'); await p.fill('#ncCarry', '172'); await p.fill('#ncTotal', '160');
  await p.click('[data-a="addClub"]');
  check(/Total must be at least the carry/.test(await p.textContent('#ncmsg')), 'add club validates total vs carry');
  await p.fill('#ncTotal', '199'); await p.click('[data-a="addClub"]'); await p.waitForTimeout(150);
  let s = await S();
  check(s.bag.length === 11 && s.bag[1].name === '3 Wood' && s.bag[1].type === 'wood', 'new 3 Wood added, sorted after the driver, typed as a wood');
  check(/3 Wood added – course strategy updated/.test(await p.textContent('#app')), 'banner confirms strategy updated');
  await p.fill('#ncName', '3 wood'); await p.fill('#ncCarry', '170'); await p.fill('#ncTotal', '190'); await p.click('[data-a="addClub"]');
  check(/already have a club/.test(await p.textContent('#ncmsg')), 'duplicate club name refused');
  await p.screenshot({ path: OUT + 'v06-bag.png', fullPage: true });

  // ---- strategy page ----
  await p.click('.stratrow'); await p.waitForTimeout(150);
  check(await p.locator('.scard').count() === 18, '18 hole cards');
  check(/Updated \d+ \w+ from your bag \(11 clubs\) and 1 round/.test(await p.textContent('#stratmeta')), 'updated line counts bag and imported round');
  check(/Played 1 time/.test(await p.textContent('#sh-1')), 'history from the imported round');
  await p.screenshot({ path: OUT + 'v06-strategy.png' });
  await p.click('[data-a="stratMode"][data-v="attack"]'); await p.waitForTimeout(100);
  s = await S();
  check(s.settings.strategyMode === 'attack', 'default mode saved');
  check(/3W/.test(await p.textContent('#app')), 'Attacking plan uses the new 3 Wood');
  await p.fill('[data-note="7"]', 'Pin usually back left. Wind stronger than it feels.');
  await p.waitForTimeout(100);
  s = await S();
  check(s.holeNotes[6] === 'Pin usually back left. Wind stronger than it feels.', 'hole note saved as you type');
  await p.locator('#sh-7').screenshot({ path: OUT + 'v06-card7.png' });
  const allStrips = () => p.evaluate(() => [...document.querySelectorAll('.sstrip')].map(e => e.textContent).join(' | '));
  const before7 = await allStrips();

  // change a club: plan rebuilds, notes stay
  await p.click('[data-a="bag"]');
  await p.fill('[data-bag="0:total"]', '250'); await p.press('[data-bag="0:total"]', 'Tab');
  await p.fill('[data-bag="0:carry"]', '228'); await p.press('[data-bag="0:carry"]', 'Tab');
  await p.click('.stratrow'); await p.waitForTimeout(100);
  const after7 = await allStrips();
  check(before7 !== after7, 'longer driver changes the plan');
  check((await p.inputValue('[data-note="7"]')).startsWith('Pin usually back left'), 'notes untouched by the rebuild');
  // remove a club
  await p.click('[data-a="bag"]');
  const idx = (await S()).bag.findIndex(c => c.name === '3 Wood');
  await p.click(`[data-a="delClub"][data-v="${idx}"]`);
  check(/Tap again to remove/.test(await p.textContent('.delclub.sure')), 'remove asks for a second tap');
  await p.click(`[data-a="delClub"][data-v="${idx}"]`); await p.waitForTimeout(100);
  s = await S();
  check(!s.bag.some(c => c.name === '3 Wood') && s.bag.length === 10, '3 Wood removed');
  await p.click('.stratrow');
  check(!/3W/.test(await p.textContent('#app')), 'plan no longer uses the 3 Wood');
  await p.click('[data-a="stratMode"][data-v="bogey"]');

  // reload keeps notes and mode
  await p.reload(); await p.waitForTimeout(300);
  s = await S();
  check(s.settings.strategyMode === 'bogey' && /Pin usually/.test(s.holeNotes[6]), 'mode and notes survive a reload');

  // ---- start round with a mode ----
  await p.click('[data-a="newRound"]'); await p.waitForTimeout(150);
  check(await p.locator('.modeopt').count() === 3 && /Smart Bogey Golf/.test(await p.textContent('.modeopt.on')), 'start modal: 3 modes, default selected');
  await p.click('[data-a="pickMode"][data-v="points"]');
  check(/Stableford Points/.test(await p.textContent('.modeopt.on')), 'can pick a different mode for this round');
  await p.screenshot({ path: OUT + 'v06-start.png' });
  await p.click('#startbtn'); await p.waitForTimeout(900);
  s = await S();
  const r = s.rounds.find(x => x.id === s.currentRoundId);
  check(r && r.strategy && r.strategy.mode === 'points' && r.strategy.holes.length === 18, 'round saves the Points plan at the start');
  check(s.settings.strategyMode === 'bogey', 'picking a mode for one round leaves the default alone');
  check(/PLAN/.test(await p.textContent('#planstrip')) && /→/.test(await p.textContent('#planstrip')), 'plan strip under the hole title');
  const hh = await p.locator('.holehead').boundingBox(), ps = await p.locator('#planstrip').boundingBox(), dist = await p.locator('#dist').boundingBox();
  check(ps.y > hh.y && ps.y < dist.y, 'strip sits between the hole title and the distance');
  await p.screenshot({ path: OUT + 'v06-hole.png' });
  await p.click('[data-a="nextHole"]'); await p.waitForTimeout(150);
  await p.click('#planstrip'); await p.waitForTimeout(150);
  check(/HOLE 2 · STABLEFORD POINTS/.test(await p.textContent('#planmodal')), 'plan opens for the current hole');
  check(/plays \d+ m, uphill/.test(await p.textContent('#planmodal')), 'social round shows uphill plays-like on hole 2');
  await p.click('#modal [data-a="closeModal"]');
  for (let i = 0; i < 5; i++) await p.click('[data-a="nextHole"]');
  await p.click('#planstrip'); await p.waitForTimeout(150);
  check(/My notes\s*Pin usually back left/.test(await p.textContent('#planmodal')), 'my notes show in the hole 7 plan');
  await p.screenshot({ path: OUT + 'v06-plan.png' });
  await p.click('#modal [data-a="closeModal"]');
  const strip7 = await p.textContent('#planstrip');
  // bag change mid-round: the round keeps its plan
  await p.click('[data-a="home"]'); await p.click('[data-a="bag"]');
  await p.fill('[data-bag="0:total"]', '180'); await p.press('[data-bag="0:total"]', 'Tab');
  await p.click('[data-a="home"]'); await p.click('[data-a="resume"]'); await p.waitForTimeout(500);
  await p.evaluate(() => { const u = window.__c4m.ui; }); // resume goes to first open hole (1)
  for (let i = 0; i < 6; i++) await p.click('[data-a="nextHole"]');
  check((await p.textContent('#planstrip')) === strip7, 'round keeps its starting plan after a bag edit');

  // old round with no plan (started before v0.6) gets one
  const legacy = await p.evaluate(() => { const r = window.__c4m.S.rounds.find(x => x.id === window.__c4m.S.currentRoundId); delete r.strategy; return true; });
  await p.click('[data-a="nextHole"]'); await p.waitForTimeout(100);
  check(legacy && /PLAN/.test(await p.textContent('#planstrip')), 'a round without a saved plan gets today’s plan');

  check(errors.filter(e => !e.startsWith('CHECK')).length === 0, 'no page errors');
  console.log(okN + ' ok');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
