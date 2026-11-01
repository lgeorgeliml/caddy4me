/* Caddy4Me prototype browser test - run with: node tests/e2e/run.js */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'); let fails = 0; const errors = [];
require('fs').mkdirSync(__dirname + '/shots', { recursive: true });
const check = (c, m) => { console.log((c ? 'ok' : 'FAIL') + ' - ' + m); if (!c) fails++; };
const BANNED = /Plays like|YOUR CALL|Driver|Wood|Hybrid|Iron|Wedge|\bPW\b|Aim \d|lay up|runs through|Out of reach|swing|into|helping|from right|from left|Firm: land/i;

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
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, geolocation: { latitude: -32.07, longitude: 115.86, accuracy: 4 }, permissions: ['geolocation'], serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.route('https://server.arcgisonline.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(__dirname + '/../fixtures/tile.png') }));
  await p.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { wind_speed_10m: 20, wind_direction_10m: 0, wind_gusts_10m: 31 } }) }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.goto('http://localhost:8768/index.html');
  for (const k of '8989') await p.click(`[data-k="${k}"]`);
  await p.waitForTimeout(300);
  const homeTxt = await p.textContent('#app');
  check(/Club advice from a device isn’t allowed in competition \(Rule 4\.3\)\. Use Tournament Mode to turn off features not allowed during competition\./.test(homeTxt), 'Home note has the Tournament Mode wording');
  await p.click('[data-a="settings"]');
  const st = await p.textContent('#app');
  check(/Use Tournament Mode to turn off features not allowed during competition/.test(st), 'Settings has the Tournament Mode wording');
  check(/Tournament Mode off/.test(st), 'Tournament Mode starts off');
  await p.click('#tourtgl');
  check(/Tournament Mode on/.test(await p.textContent('#app')), 'switch turns on');
  await p.click('[data-a="home"]');
  check(/TOURNAMENT MODE/.test(await p.textContent('#app')), 'Home shows TOURNAMENT MODE tag');
  // spy on the caddie engine
  await p.evaluate(() => { window.__recCalls = 0; const f = window.C4M.recommend; window.C4M.recommend = function () { window.__recCalls++; return f.apply(this, arguments); }; });
  await p.click('[data-a="newRound"]'); await p.click('#startbtn'); await p.waitForTimeout(800);
  check(await p.locator('#tourtag').count() === 1, 'hole screen shows TOURNAMENT badge');
  for (const sel of ['#playslike', '#groundstat', '#call', '.mapseg', '#liebox']) check(await p.locator(sel).count() === 0, 'hidden in Tournament Mode: ' + sel);
  const box = await p.locator('#map').boundingBox();
  const mpp = 156543.03392 * Math.cos(-32.07 * Math.PI / 180) / Math.pow(2, 17);
  await p.click('[data-a="zout"]');
  await tapNorth(p, 140); await p.waitForTimeout(400);
  const holeTxt = await p.evaluate(() => { const c = document.getElementById('app').cloneNode(true); const ps = c.querySelector('#planstrip'); if (ps) ps.remove(); return c.textContent; });
  const stripTxt = await p.textContent('#planstrip');
  check(/PLAN/.test(stripTxt) && !/plays/i.test(stripTxt), 'v0.6: pre-round plan strip shown in Tournament Mode, no plays-like text (' + stripTxt.trim() + ')');
  await p.click('#planstrip'); await p.waitForTimeout(200);
  const planTxt = await p.textContent('#planmodal');
  check(!/plays \d+ m, (up|down)hill/.test(planTxt), 'v0.6: tournament plan has no plays-like heights: ' + planTxt.slice(0,300));
  await p.click('#modal [data-a="closeModal"]'); await p.waitForTimeout(100);
  check(/1(39|40|41)M/.test(holeTxt), 'GPS distance still shown (~140 m)');
  check(/Wind forecast\s*20\s*km\/h from N · forecast/.test(holeTxt), 'forecast wind shown as raw forecast only');
  check(!BANNED.test(holeTxt), 'no advice, plays-like or wind/lie calculation text on hole screen' + ((holeTxt.match(BANNED) || [''])[0] ? ' (found: ' + holeTxt.match(BANNED)[0] + ')' : ''));
  check(await p.evaluate(() => window.__recCalls) === 0, 'caddie engine never run in Tournament Mode');
  await p.click('#windchip'); await p.waitForTimeout(200);
  check(await p.locator('#modal:not([hidden])').count() === 0, 'wind tile does not open the wind override');
  await p.screenshot({ path: __dirname + '/shots/tour-hole.png' });
  // settings locked during the round
  await p.click('[data-a="home"]'); await p.click('[data-a="settings"]');
  check(await p.isDisabled('#tourtgl') && /Locked on for the round in progress/.test(await p.textContent('#app')), 'switch locked during a tournament round');
  await p.screenshot({ path: __dirname + '/shots/tour-settings.png' });
  // play all 18 holes quickly
  await p.click('[data-a="home"]'); await p.click('[data-a="resume"]'); await p.waitForTimeout(300);
  for (let h = 1; h <= 18; h++) { await p.click('[data-a="holeDone"]'); await p.click('[data-a="saveCard"]'); await p.waitForTimeout(80); }
  const sum = await p.textContent('#app');
  check(/TOURNAMENT · ROUND COMPLETE/.test(sum), 'summary labelled TOURNAMENT');
  await p.click('[data-a="home"]'); await p.click('[data-a="settings"]');
  check(!(await p.isDisabled('#tourtgl')), 'switch unlocked after the round is finished');
  await p.click('#tourtgl');
  check(/Tournament Mode off/.test(await p.textContent('#app')), 'switch turns off after the round');
  // social round: caddie back
  await p.click('[data-a="home"]'); await p.click('[data-a="newRound"]'); await p.click('#startbtn'); await p.waitForTimeout(600);
  await p.click('[data-a="zout"]');
  await tapNorth(p, 140); await p.waitForTimeout(400);
  check(/YOUR CALL/.test(await p.textContent('#app')) && await p.locator('#tourtag').count() === 0, 'social round: club call back, no badge');
  // switching on mid social round protects that round
  await p.click('[data-a="home"]'); await p.click('[data-a="settings"]'); await p.click('#tourtgl');
  check(await p.isDisabled('#tourtgl'), 'switching on mid-round locks the current round');
  await p.click('[data-a="home"]'); await p.click('[data-a="resume"]'); await p.waitForTimeout(400);
  check(await p.locator('#call').count() === 0 && await p.locator('#tourtag').count() === 1, 'current round now in Tournament Mode');
  // discard unlocks
  await p.click('[data-a="home"]'); await p.click('[data-a="discard"]'); await p.click('[data-a="discard"]');
  await p.click('[data-a="settings"]');
  check(!(await p.isDisabled('#tourtgl')), 'discarding the round unlocks the switch');
  await p.click('[data-a="home"]'); await p.click('[data-a="past"]');
  check(/Tournament · /.test(await p.textContent('#app')), 'Past rounds labels the tournament round');
  check(!errors.length, 'no page errors ' + errors.join(' | '));
  await b.close(); process.exit(fails ? 1 : 0);
})();
