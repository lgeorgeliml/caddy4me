/* Caddy4Me prototype browser test - run with: node tests/e2e/run.js */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
require('fs').mkdirSync(__dirname + '/shots', { recursive: true });
const OUT = __dirname + '/shots/';
const TILE = fs.readFileSync(__dirname + '/../fixtures/tile.png');

async function tapNorth(pg, metres) {
  const pt = await pg.evaluate((m) => {
    const map = window.__c4m.map(), me = window.__c4m.ui.me;
    map.setBearing(0); map.setView(me, 17);
    const s = map.toScreen({ lat: me.lat + m / 111195, lon: me.lon }), r = document.getElementById('map').getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, metres);
  await pg.mouse.click(pt.x, pt.y);
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    geolocation: { latitude: -32.07, longitude: 115.86, accuracy: 4 }, permissions: ['geolocation'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/TUNNEL|fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://server.arcgisonline.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ current: { wind_speed_10m: 20, wind_direction_10m: 0, wind_gusts_10m: 31 } }) }));
  const check = (c, m) => { if (!c) { errors.push('CHECK FAILED: ' + m); } else console.log('ok -', m); };

  await page.goto('http://localhost:8768/index.html');
  check(await page.locator('.keypad').count() === 1, 'lock screen shown first');
  for (const k of '1111') await page.click(`[data-k="${k}"]`);
  await page.waitForTimeout(300);
  check(/Wrong passcode/.test(await page.textContent('#app')), 'wrong passcode rejected');
  await page.screenshot({ path: OUT + '0-lock.png' });
  for (const k of '8989') await page.click(`[data-k="${k}"]`);
  await page.waitForTimeout(300);
  check(await page.locator('[data-a="newRound"]').count() === 1, 'right passcode opens app');
  await page.reload();
  check(await page.locator('[data-a="newRound"]').count() === 1, 'phone stays unlocked after reload');
  check(await page.getAttribute('meta[name="robots"]', 'content') === 'noindex, nofollow, noarchive', 'noindex tag present');
  await page.screenshot({ path: OUT + '1-home.png' });
  await page.click('[data-a="newRound"]'); await page.click('#startbtn');
  await page.waitForTimeout(800);
  // zoom out one level so 140 m north fits on screen, then tap 140 m north of me
  await page.click('[data-a="zout"]');
  const box = await page.locator('#map').boundingBox();
  const mpp = 156543.03392 * Math.cos(-32.07 * Math.PI / 180) / Math.pow(2, 17);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2 - 140 / mpp;
  await tapNorth(page, 140);
  await page.waitForTimeout(400);
  const dist = await page.textContent('#dist');
  check(/1(39|40|41)Mto/.test(dist), 'tee distance ~140 m: ' + dist);
  const teeCall = await page.textContent('#call');
  check(/5 Iron/i.test(teeCall) && /Driver runs through/.test(teeCall), 'tee call 5 iron + driver warning: ' + teeCall.slice(0, 90));
  const wind = await page.textContent('#windchip');
  check(/Wind\s*20\s*into/.test(wind), 'wind chip shows live 20 km/h into: ' + wind);
  await page.screenshot({ path: OUT + '2-hole-tee.png', fullPage: true });

  await page.click('[data-a="mode"][data-v="approach"]');
  const appr = await page.textContent('#call');
  check(/5 Hybrid/i.test(appr), 'approach into wind 140 -> 5 hybrid: ' + appr.slice(0, 80));
  await page.click('[data-a="lie"][data-v="heavyRough"]');
  await page.click('[data-a="cycleGround"]');
  await page.screenshot({ path: OUT + '3-hole-approach.png', fullPage: true });

  // walking 40 m resets lie (new shot)
  await ctx.setGeolocation({ latitude: -32.0696, longitude: 115.86, accuracy: 5 });
  await page.waitForTimeout(1500);
  const lieOn = await page.getAttribute('[data-a="lie"][data-v="fairway"]', 'class');
  check(/on/.test(lieOn), 'lie reset to fairway after walking');
  const d2 = await page.textContent('#dist');
  check(/(9[5-9]|10[0-5])Mto/.test(d2), 'distance updates as I walk: ' + d2);

  // manual wind
  await page.click('#windchip');
  await page.screenshot({ path: OUT + '4-wind.png' });
  await page.click('[data-a="wdir"][data-v="90"]');
  await page.click('[data-a="wspd"][data-v="30"]');
  await page.click('[data-a="closeModal"]');
  const call3 = await page.textContent('#call');
  check(/Aim \d+ m right/.test(call3), 'manual from-right wind gives aim right: ' + call3.slice(0, 120));
  await page.click('#windchip'); await page.click('[data-a="wlive"]'); await page.click('[data-a="closeModal"]');

  // manual distance
  await page.click('#dist');
  await page.fill('#mdist', '62');
  await page.click('[data-a="setDist"]');
  const call4 = await page.textContent('#call');
  check(/(PW|U Wedge).*(swing)/.test(call4), 'partial swing for 62 m: ' + call4.slice(0, 60));
  await page.screenshot({ path: OUT + '5-partial.png', fullPage: true });

  // hole card
  await page.click('[data-a="holeDone"]');
  const isOn = sel => page.getAttribute(sel, 'class').then(c => /\bon\b/.test(c));
  // defect: nothing should be pre-selected on a new card
  check(!(await isOn('[data-a="gir"]')), 'new card: GIR not pre-selected');
  check((await page.locator('[data-a="appr"].on').count()) === 0, 'new card: no approach pre-selected');
  check(!(await isOn('[data-a="ud"]')) && !(await isOn('[data-a="ss"]')), 'new card: Up & Down and Sand Save off');
  check(!(await page.isDisabled('[data-a="ud"]')) && !(await page.isDisabled('[data-a="ss"]')), 'new card: Up & Down and Sand Save selectable');
  await page.click('[data-a="step"][data-v="score:1"]');   // 5 on par 4
  await page.click('[data-a="step"][data-v="putts:1"]');   // 3 putts
  check(!(await isOn('[data-a="gir"]')), 'changing score/putts does not auto-select GIR');
  await page.click('[data-a="gir"]');
  const card = await page.textContent('#app');
  check(await isOn('[data-a="gir"]'), 'GIR selected when tapped');
  check(/Hole 1 · Par 4 · SI 14/.test(card) && /you get 1 stroke here/.test(card), 'card header shows par, SI, strokes');
  check(/BOGEY · 2 STABLEFORD PTS/.test(await page.textContent('#app')), 'Stableford: bogey with a stroke = 2 points');
  check(await isOn('[data-a="appr"][data-v="hit"]'), 'tapping GIR marks approach as hit');
  check(await page.isDisabled('[data-a="ud"]') && await page.isDisabled('[data-a="ss"]'), 'Up & Down and Sand Save greyed out on GIR');
  await page.click('[data-a="fw"][data-v="left"]');
  check(/Total: 0 \/ 1/.test(await page.textContent('#app')), 'fairway running total 0 / 1');
  await page.screenshot({ path: OUT + '6-card.png' });
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.screenshot({ path: OUT + '6b-card.png' });
  // approach miss -> GIR off, toggles selectable
  await page.click('[data-a="appr"][data-v="short"]');
  check(!(await isOn('[data-a="gir"]')), 'approach miss turns GIR off');
  await page.click('[data-a="ud"]');
  check(await isOn('[data-a="ud"]'), 'Up & Down can be selected');
  await page.click('[data-a="ss"]');
  check(await isOn('[data-a="ss"]'), 'Sand Save can be selected');
  check(/Sand shots\s*\S\s*1/.test(await page.textContent('#app')), 'Sand Save adds a sand shot');
  await page.click('[data-a="gir"]');
  check(await page.isDisabled('[data-a="ud"]') && await isOn('[data-a="appr"][data-v="hit"]'), 'GIR back on locks U&D, sets approach hit');
  await page.click('[data-a="step"][data-v="sand:-1"]');
  await page.click('[data-a="saveCard"]');
  check(/Hole 2/.test(await page.textContent('.hn')), 'moved to hole 2');

  // hole 2: par 5, 5 with 1 putt, up & down from sand
  await page.click('[data-a="holeDone"]');
  await page.click('[data-a="step"][data-v="putts:-1"]');
  await page.click('[data-a="step"][data-v="sand:1"]');
  check(!(await isOn('[data-a="ss"]')), 'Sand Save not pre-selected after adding a sand shot');
  await page.click('[data-a="ud"]'); await page.click('[data-a="ss"]');
  check(await isOn('[data-a="ud"]') && await isOn('[data-a="ss"]'), 'Up & Down and Sand Save selected');
  await page.click('[data-a="appr"][data-v="shortRight"]');
  await page.click('[data-a="chip"]');
  check((await page.textContent('.cval')).trim() === '0', 'Chip In sets putts to 0');
  await page.click('[data-a="chip"]');
  await page.click('[data-a="step"][data-v="putts:1"]');
  await page.click('[data-a="saveCard"]');
  await page.click('[data-a="home"]');
  await page.click('[data-a="past"]');
  await page.click('[data-a="openRound"]');
  const sum = await page.textContent('#app');
  check(/Gross\s*10\s*\+1/.test(sum), 'summary gross 10 (+1)');
  check(/5PTS/.test(sum), 'Stableford total 5 pts (2 + 3)');
  check(/daily hcp 17/.test(sum), 'round uses daily handicap 17');
  check(/Fairways\s*0\/1\s*0%/.test(sum), 'fairways 0/1 (0%)');
  check(/Sand saves\s*100%/.test(sum), 'sand save 100%');
  check(/Wasted\s*1/.test(sum), 'wasted 1 from 3-putt');
  await page.screenshot({ path: OUT + '7-summary.png', fullPage: true });

  // bag edit persists
  await page.click('[data-a="home"]');
  await page.click('[data-a="bag"]');
  await page.fill('[data-bag="5:carry"]', '128');
  await page.press('[data-bag="5:carry"]', 'Tab');
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('caddy4me.v1')).bag[5].carry);
  check(saved === 128, '7 iron carry edit persisted: ' + saved);
  await page.click('[data-a="bag"]');
  await page.screenshot({ path: OUT + '8-bag.png', fullPage: true });

  // settings: daily handicap preview
  await page.click('[data-a="home"]');
  await page.click('[data-a="settings"]');
  check((await page.textContent('#dhv')).trim() === '17', 'settings shows daily handicap 17');
  await page.fill('[data-set="ga"]', '20.4'); await page.press('[data-set="ga"]', 'Tab');
  check((await page.textContent('#dhv')).trim() === '21', 'GA 20.4 -> daily 21');
  await page.fill('[data-set="ga"]', '16.9'); await page.press('[data-set="ga"]', 'Tab');
  await page.screenshot({ path: OUT + '11-settings.png' });

  // discard a round started by mistake
  const nRounds = () => page.evaluate(() => JSON.parse(localStorage.getItem('caddy4me.v1')).rounds.length);
  await page.click('[data-a="home"]');
  const before = await nRounds();
  await page.click('[data-a="newRound"]'); await page.click('#startbtn');
  await page.waitForTimeout(300);
  await page.click('[data-a="home"]');
  check(await nRounds() === before + 1, 'mistaken round created');
  await page.click('[data-a="discard"]');
  check(/Tap again to discard/.test(await page.textContent('#app')), 'discard asks for confirmation');
  await page.screenshot({ path: OUT + '9-discard.png' });
  await page.click('[data-a="discard"]');
  check(await nRounds() === before, 'round discarded, nothing saved');
  check(await page.locator('[data-a="resume"]').count() === 0, 'no resume button after discard');

  // delete a past round from its summary
  await page.click('[data-a="past"]');
  await page.click('[data-a="openRound"]');
  await page.click('[data-a="deleteRound"]');
  check(await nRounds() === before, 'first tap does not delete');
  await page.click('[data-a="deleteRound"]');
  check(await nRounds() === before - 1, 'second tap deletes past round');
  check(/No rounds yet/.test(await page.textContent('#app')), 'past rounds list now empty');

  // before your round: thoughts + videos
  await page.click('[data-a="home"]');
  await page.click('[data-a="prep"]');
  await page.fill('#newThought', 'Smooth tempo, finish high');
  await page.click('[data-a="addThought"]');
  await page.fill('#newThought', 'Commit to the club');
  await page.click('[data-a="addThought"]');
  await page.fill('#newVTitle', 'Wedge distance control');
  await page.fill('#newVUrl', 'not a link');
  await page.click('[data-a="addVideo"]');
  check(/doesn.t look right/.test(await page.textContent('#vmsg')), 'bad video link rejected');
  await page.fill('#newVUrl', 'https://youtu.be/dQw4w9WgXcQ');
  await page.click('[data-a="addVideo"]');
  await page.fill('#newVUrl', 'javascript:alert(1)');
  await page.click('[data-a="addVideo"]');
  const vids = await page.$$eval('.vlink', as => as.map(a => a.getAttribute('href')));
  check(vids.length === 1 && vids[0] === 'https://youtu.be/dQw4w9WgXcQ', 'one safe video link saved: ' + vids.join(','));
  check(await page.getAttribute('.vlink', 'target') === '_blank', 'video opens outside the app');
  await page.reload();
  await page.click('[data-a="prep"]');
  check(await page.locator('.thought').count() === 2, 'thoughts persist after reload');
  await page.screenshot({ path: OUT + '10-prep.png', fullPage: true });
  await page.click('[data-a="delThought"][data-v="1"]');
  check(await page.locator('.thought').count() === 1, 'thought removed');

  // v0.1 data from Sunday still works after the update
  const ctx2 = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push('pageerror(v0.1): ' + e.message));
  await p2.goto('http://localhost:8768/index.html');
  await p2.evaluate(() => {
    const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: i < 2 ? 4 : null, score: i < 2 ? 5 : null, putts: i < 2 ? 2 : null, approach: i === 0 ? 'green' : 'left', upDown: false, sand: 0, penalties: 0, wasted: 0 }));
    localStorage.setItem('caddy4me.v1', JSON.stringify({ version: 1, bag: [], settings: { windSource: 'live', manual: { rel: 0, speed: 0 } },
      course: { name: 'Melville Glades', pars: [4, 4, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null] },
      rounds: [{ id: 'old', date: '2026-10-18', ground: 'normal', holes, done: false }], currentRoundId: 'old', wind: null, prep: { thoughts: [], videos: [] } }));
    localStorage.setItem('caddy4me.unlocked', '9b8fc4d93a6d0baf6466a1546478466b8b3f2ef0d7a8d7a85ad3af1f6c60a77d');
  });
  await p2.reload();
  for (const k of '8989') if (await p2.locator(`[data-k="${k}"]`).count()) await p2.click(`[data-k="${k}"]`);
  await p2.waitForTimeout(300);
  await p2.click('[data-a="past"]'); await p2.click('[data-a="openRound"]');
  const s2 = await p2.textContent('#app');
  check(/4PTS/.test(s2), 'Sunday v0.1 round gets Stableford points (hole 2 kept par 4 from Sunday): ' + (s2.match(/Stableford\s*\S+ pts/) || [''])[0]);
  const pars = await p2.evaluate(() => JSON.parse(localStorage.getItem('caddy4me.v1')).course.pars.slice(0, 3).join(','));
  check(pars === '4,4,4', 'entered pars kept, blanks filled from scorecard: ' + pars);

  // import MiScore scores into the existing 18 Oct round, keeping recorded stats
  await p2.click('[data-a="home"]'); await p2.click('[data-a="past"]');
  await p2.setInputFiles('#impfile', __dirname + '/../fixtures/scores/caddy4me-scores-2026-10-18.json');
  await p2.waitForTimeout(500);
  const s3 = await p2.textContent('#app');
  check(/Updated round 2026-10-18 – 18 holes/.test(s3), 'import banner shown');
  check(/33PTS/.test(s3), 'imported round shows 33 pts');
  check(/Gross\s*92\s*\+20/.test(s3), 'imported round shows 92 (+20)');
  check(/picked up · counted as 6/.test(s3), 'hole 9 shown as pick-up');
  const kept = await p2.evaluate(() => JSON.parse(localStorage.getItem('caddy4me.v1')).rounds.filter(r => r.date === '2026-10-18').map(r => r.holes[0].approach + '/' + r.rounds));
  check(kept.length === 1 && kept[0].startsWith('green'), 'merged into the same round, earlier stats kept: ' + kept);
  const tots = await p2.$$eval('tr.tot', rs => rs.map(r => Array.from(r.cells).slice(0, 5).map(c => c.textContent).join(' ')));
  check(tots[0] === 'OUT 36 49 13 16', 'OUT row matches card (par 36, 49, 13 pts, 16 putts): ' + tots[0]);
  check(tots[1] === 'IN 36 43 20 18', 'IN row matches card (par 36, 43, 20 pts, 18 putts): ' + tots[1]);
  check(tots[2] === 'TOT 72 92 33 34', 'TOT row matches card (72, 92, 33 pts, 34 putts): ' + tots[2]);
  const hdrBg = await p2.$eval('.htab thead th', e => getComputedStyle(e).backgroundColor);
  const totBg = await p2.$eval('tr.tot td', e => getComputedStyle(e).backgroundColor);
  check(hdrBg !== 'rgba(0, 0, 0, 0)' && totBg !== 'rgba(0, 0, 0, 0)', 'header and total rows shaded (Twilight colours): ' + hdrBg + ' / ' + totBg);
  await p2.evaluate(() => document.querySelector('.htab').scrollIntoView());
  await p2.screenshot({ path: OUT + '13-table.png' });
  await p2.screenshot({ path: OUT + '12-import.png', fullPage: true });
  await p2.setInputFiles('#impfile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') }).catch(() => {});

  // a phone already on v0.2 (old Offcourse SI) gets the Blue Men SI
  const p3 = await (await browser.newContext()).newPage();
  p3.on('pageerror', e => errors.push('pageerror(v0.2): ' + e.message));
  await p3.goto('http://localhost:8768/index.html');
  await p3.evaluate(() => {
    const old = [13, 14, 3, 7, 16, 5, 8, 11, 9, 2, 12, 1, 15, 17, 4, 6, 18, 10];
    localStorage.setItem('caddy4me.v1', JSON.stringify({ version: 1, bag: [], settings: { windSource: 'live', manual: { rel: 0, speed: 0 }, ga: 16.9 },
      course: { name: 'Melville Glades', pars: [4, 5, 4, 4, 3, 4, 4, 5, 3, 4, 4, 4, 5, 3, 4, 4, 3, 5], si: old, slope: 124, scratch: 72 },
      rounds: [], currentRoundId: null, wind: null, prep: { thoughts: [], videos: [] } }));
  });
  await p3.reload();
  const si3 = await p3.evaluate(() => JSON.parse(localStorage.getItem('caddy4me.v1')).course.si.join(','));
  check(si3 === '14,6,5,8,18,7,3,10,11,2,13,1,12,16,17,4,15,9', 'v0.2 phone upgraded to Blue Men SI');

  // backup from one phone, restore on a fresh install (e.g. the new Android app)
  const backup = await p2.evaluate(() => localStorage.getItem('caddy4me.v1'));
  require('fs').writeFileSync(__dirname + '/backup-test.json', backup);
  const p4 = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  p4.on('pageerror', e => errors.push('pageerror(restore): ' + e.message));
  await p4.goto('http://localhost:8768/index.html');
  for (const k of '8989') await p4.click(`[data-k="${k}"]`);
  await p4.waitForTimeout(300);
  await p4.click('[data-a="settings"]');   // v0.7: backups live in Settings
  await p4.setInputFiles('#restorefile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await p4.waitForTimeout(200);
  check(/isn.t a Caddy4Me backup/.test(await p4.textContent('#app')), 'restore rejects a non-backup file');
  await p4.setInputFiles('#restorefile', __dirname + '/backup-test.json');
  await p4.waitForTimeout(200);
  check(await p4.locator('[data-a="doRestore"]').count() === 1, 'restore asks for confirmation');
  await p4.click('[data-a="doRestore"]');
  check(/Backup restored – 1 rounds/.test(await p4.textContent('#app')), 'backup restored');
  await p4.click('[data-a="home"]'); await p4.click('[data-a="past"]'); await p4.click('[data-a="openRound"]');
  check(/33PTS/.test(await p4.textContent('#app')), 'restored round still 33 pts');
  const mf = await (await p4.request.get('http://localhost:8768/manifest.webmanifest')).json();
  check(mf.id === '/caddy4me/' && mf.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'), 'manifest ready for PWABuilder');

  // name in Settings; Enter Stats label
  await p4.click('[data-a="home"]');
  check(/(Morning|Afternoon|Evening)(?!,)/.test(await p4.textContent('.hello .name')) && !/George/.test(await p4.textContent('#app')), 'no name: plain greeting, no hard-coded name');
  await p4.click('[data-a="settings"]');
  await p4.fill('[data-set="name"]', 'Alex <b>Smith</b>'); await p4.press('[data-set="name"]', 'Tab');
  await p4.click('[data-a="home"]');
  check(/(Morning|Afternoon|Evening), Alex <b>Smith<\/b>/.test(await p4.textContent('.hello .name')), 'home greets by name (shown as plain text, not HTML)');
  await p4.click('[data-a="newRound"]'); await p4.click('#startbtn'); await p4.waitForTimeout(200);
  check((await p4.textContent('[data-a="holeDone"]')).trim() === 'Enter Stats', 'button reads "Enter Stats"');
  const pl = await p4.evaluate(() => { const s = JSON.parse(localStorage.getItem('caddy4me.v1')); return s.rounds.find(r => r.id === s.currentRoundId).player; });
  check(pl === 'Alex <b>Smith</b>', 'new round records the player name');
  await p4.click('[data-a="home"]'); await p4.click('[data-a="settings"]');
  await p4.fill('[data-set="name"]', 'Alex'); await p4.press('[data-set="name"]', 'Tab');
  await p4.screenshot({ path: OUT + '14-settings-name.png' });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
