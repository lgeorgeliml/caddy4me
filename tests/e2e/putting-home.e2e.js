/* Caddy4Me prototype browser test - run with: node tests/e2e/run.js */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
require('fs').mkdirSync(__dirname + '/shots', { recursive: true });
const OUT = __dirname + '/shots/';
const TILE = fs.readFileSync(__dirname + '/../fixtures/tile.png');
const SC = d => __dirname + '/../fixtures/scores/caddy4me-scores-' + d + '.json';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    geolocation: { latitude: -32.0749, longitude: 115.8742, accuracy: 4 }, permissions: ['geolocation'], serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errors = []; let okN = 0;
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|fonts\.g|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
  await p.route('https://server.arcgisonline.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await p.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ current: { wind_speed_10m: 15, wind_direction_10m: 200, wind_gusts_10m: 25 } }) }));
  const check = (c, m) => { if (!c) { errors.push('CHECK FAILED: ' + m); console.log('FAIL -', m); } else { okN++; console.log('ok -', m); } };
  const S = () => p.evaluate(() => window.__c4m.S);
  const txt = sel => p.textContent(sel);

  await p.goto('http://localhost:8768/index.html');
  for (const k of '8989') await p.click(`[data-k="${k}"]`);
  await p.waitForTimeout(300);

  // ---- Home: backups gone, last-5 card ----
  check(await p.locator('[data-a="export"]').count() === 0 && await p.locator('#restorefile').count() === 0, 'Home no longer has Export or Restore backup');
  check(await p.locator('.lastround').count() === 0, 'last-round card removed from Home');
  check(/LAST 5 ROUNDS/.test(await txt('#home5')) && /Finish 2 more 18-hole rounds/.test(await txt('#home5')), 'Home card asks for 2 rounds when there are none');
  // ---- Settings: backup section ----
  await p.click('[data-a="settings"]');
  check(await p.locator('#exportbtn').count() === 1 && await p.locator('#restorefile').count() === 1, 'Settings has Export and Restore backup');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportbtn')]);
  check(/caddy4me-backup-.*\.json/.test(dl.suggestedFilename()), 'Export backup downloads from Settings');
  check(/Caddy4Me v0\.8 · 1 Nov 2026/.test(await txt('#appver')), 'version v0.8 in Settings');
  await p.click('[data-a="home"]');

  // ---- import the three MiScore rounds ----
  for (const d of ['2026-10-18', '2026-10-03', '2026-09-26']) {
    await p.click('[data-a="past"]');
    await p.setInputFiles('#impfile', SC(d)); await p.waitForTimeout(300);
    await p.click('[data-a="home"]');
  }
  const h5 = await txt('#home5'); let h5b;
  check((await p.locator('#home5 .bar5').count()) === 3, 'Home chart shows the 3 rounds');
  check(/Points\s*31\.7/.test(h5) && /Gross\s*94/.test(h5), 'Home key numbers: 31.7 pts, gross 94 (' + h5.replace(/\s+/g, ' ').slice(0, 160) + ')');
  check(await p.locator('#home5 .sug').count() === 1 || /No clear weak spot/.test(h5b = await txt('#home5')), 'Home shows the top suggestion, or says there is no clear weak spot');
  const hb = await p.locator('[data-a="newRound"]').boundingBox(), cb = await p.locator('#home5').boundingBox();
  check(hb.y < cb.y, 'Start round sits above the last-5 card');
  await p.screenshot({ path: OUT + 'v07-home.png', fullPage: true });
  await p.click('#home5'); await p.waitForTimeout(150);
  check(await p.locator('#anal').count() === 1, 'tapping the card opens Past rounds with the full panel');
  check(/No first-putt lengths yet/.test(await txt('#anputt')), 'putting table explains when there are no lengths');
  await p.click('[data-a="home"]');

  // ---- hole card: first putt length ----
  await p.click('[data-a="newRound"]'); await p.click('#startbtn'); await p.waitForTimeout(700);
  await p.click('[data-a="holeDone"]'); await p.waitForTimeout(150);
  check(await p.locator('#fputt').count() === 0, 'no putt-length row until GIR is on');
  await p.click('[data-a="gir"]');
  check(await p.locator('#fputt .chip').count() === 5, 'GIR on shows 5 putt-length options');
  check(await p.locator('#fputt .chip.on').count() === 0, 'nothing pre-selected');
  check((await p.locator('#fputt .chip').allTextContents()).join('|') === '0–3 m|3–6 m|6–10 m|10–20 m|20 m+', 'labels 0–3, 3–6, 6–10, 10–20, 20 m+');
  await p.click('[data-a="fp"][data-v="10-20"]');
  await p.click('[data-a="step"][data-v="putts:1"]'); await p.click('[data-a="step"][data-v="score:1"]');
  await p.locator('#fputt').screenshot({ path: OUT + 'v07-fputt.png' });
  await p.screenshot({ path: OUT + 'v07-card.png' });
  // GIR off clears it, back on starts blank
  await p.click('[data-a="gir"]'); check(await p.locator('#fputt').count() === 0, 'GIR off hides the row');
  await p.click('[data-a="gir"]'); check(await p.locator('#fputt .chip.on').count() === 0, 'GIR off cleared the length');
  await p.click('[data-a="fp"][data-v="10-20"]');
  await p.click('[data-a="saveCard"]'); await p.waitForTimeout(300);
  let s = await S(), r = s.rounds.find(x => x.id === s.currentRoundId);
  check(r.holes[0].firstPutt === '10-20' && r.holes[0].putts === 3 && r.holes[0].gir === true, 'hole 1 saved: GIR, 10–20 m, 3 putts');
  // hole 2: GIR, 0-3, 1 putt ; hole 3: no GIR
  await p.click('[data-a="holeDone"]'); await p.waitForTimeout(100);
  await p.click('[data-a="gir"]'); await p.click('[data-a="fp"][data-v="0-3"]'); await p.click('[data-a="step"][data-v="putts:-1"]');
  await p.click('[data-a="saveCard"]'); await p.waitForTimeout(300);
  await p.click('[data-a="holeDone"]'); await p.waitForTimeout(100);
  await p.click('[data-a="saveCard"]'); await p.waitForTimeout(300);
  s = await S(); r = s.rounds.find(x => x.id === s.currentRoundId);
  check(r.holes[1].firstPutt === '0-3' && r.holes[2].firstPutt == null, 'hole 2 0–3 m saved; hole 3 (no GIR) has none');
  // re-open hole 1 shows the saved length
  await p.click('[data-a="home"]'); await p.click('[data-a="past"]');
  await p.click(`[data-a="openRound"][data-v="${r.id}"]`); await p.waitForTimeout(150);
  const sp = await txt('#sumputt');
  check(/10–20 m\s*1\s*3\s*0\s*1/.test(sp) && /0–3 m\s*1\s*1\s*1\s*0/.test(sp), 'round summary putting table by length (' + sp.replace(/\s+/g, ' ') + ')');
  await p.locator('#sumputt').screenshot({ path: OUT + 'v07-sumputt.png' });
  await p.click('[data-a="editHole"][data-v="0"]'); await p.waitForTimeout(150);
  check(await p.locator('#fputt .chip.on[data-v="10-20"]').count() === 1, 'editing hole 1 shows the saved length');
  await p.click('[data-a="backHole"]'); await p.waitForTimeout(400);

  // ---- tournament round: Home card hidden ----
  await p.click('[data-a="home"]');
  await p.evaluate(() => { const S = window.__c4m.S; S.rounds.find(x => x.id === S.currentRoundId).tournament = true; });
  await p.click('[data-a="settings"]'); await p.click('[data-a="home"]');
  check(/Available after your tournament round/.test(await txt('#home5')), 'Home card hidden during a tournament round');

  check(errors.filter(e => !e.startsWith('CHECK')).length === 0, 'no page errors');
  console.log(okN + ' ok'); console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
