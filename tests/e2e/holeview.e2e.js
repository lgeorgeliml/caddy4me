/* Caddy4Me prototype browser test - run with: node tests/e2e/run.js */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'); const C = require(__dirname + '/../../course.js'); const D = require(__dirname + '/../../course-melville.js');
require('fs').mkdirSync(__dirname + '/shots', { recursive: true });
let fails = 0; const errors = [];
const check = (c, m) => { console.log((c ? 'ok' : 'FAIL') + ' - ' + m); if (!c) fails++; };
const h1 = C.hole(D, 1), h2 = C.hole(D, 2), tee1 = C.ll(h1.line[0]);
const expF = C.greenFMB(tee1, h1);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, geolocation: { latitude: tee1.lat, longitude: tee1.lon, accuracy: 4 }, permissions: ['geolocation'], serviceWorkers: 'block' });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  const tiles = [];
  await p.route(/arcgis/, r => { tiles.push(r.request().url()); r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(__dirname + '/../fixtures/tile.png') }); });
  await p.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { wind_speed_10m: 12, wind_direction_10m: 200, wind_gusts_10m: 20 } }) }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.goto('http://localhost:8768/index.html');
  for (const k of '8989') await p.click(`[data-k="${k}"]`);
  await p.waitForTimeout(300);
  await p.click('[data-a="newRound"]'); await p.click('#startbtn'); await p.waitForTimeout(1200);
  // hole view
  const bearing = await p.evaluate(() => window.__c4m.map().bearing);
  check(Math.abs(bearing - C.holeBearing(h1)) < 0.5, 'hole 1 turned to run up the screen (bearing ' + bearing.toFixed(1) + '°)');
  const gtop = await p.evaluate(() => { const m = window.__c4m.map(), h = window.__c4m; return null; });
  const geo = await p.evaluate(() => { const m = window.__c4m.map(); const D = window.C4M_COURSE.holes[0], C = window.C4MCourse;
    const tee = m.toScreen(C.ll(D.line[0])), green = m.toScreen(C.greenCentre(D)); return { tee, green, w: m.size().w, h: m.size().h }; });
  check(geo.green.y < geo.tee.y && Math.abs(geo.green.x - geo.tee.x) < 40, 'green at the top, tee at the bottom');
  check(geo.green.y > 0 && geo.tee.y < geo.h, 'whole hole fits on screen');
  const shapes = await p.evaluate(() => document.querySelectorAll('.sm-over polygon').length);
  check(shapes === 1 + 1 + 1 + 1, 'outlines drawn: fairway, tee, bunker, green (' + shapes + ')');
  // F/M/B
  const gb = await p.textContent('#greenbox');
  const nums = (gb.match(/\d+/g) || []).map(Number);
  check(Math.abs(nums[0] - expF.front) <= 1 && Math.abs(nums[1] - expF.middle) <= 1 && Math.abs(nums[2] - expF.back) <= 1,
    'front/middle/back from the tee: ' + nums.slice(0, 3).join('/') + ' (expected ' + [expF.front, expF.middle, expF.back].map(Math.round).join('/') + ')');
  check(/drag flag/.test(gb), 'pin not set yet: "drag flag" prompt');
  const bk = await p.textContent('#bunkerbox');
  check(/Greenside bunker\s*reach\s*29[3-5]\s*carry\s*30[3-5]/.test(bk), 'greenside bunker reach/carry shown: ' + bk.replace(/\s+/g, ' ').trim());
  // GPS under the title
  const pos = await p.evaluate(() => { const hn = document.getElementById('hn').getBoundingClientRect(), g = document.getElementById('gpstag').getBoundingClientRect();
    return { below: g.top >= hn.bottom - 1, inTop: !!document.querySelector('.topbar #gpstag'), dx: Math.abs((g.left + g.right) / 2 - (hn.left + hn.right) / 2) }; });
  check(pos.below && !pos.inTop && pos.dx < 20, 'GPS indicator sits just under the hole title');
  await p.screenshot({ path: __dirname + '/shots/v05-hole1.png', fullPage: true });
  // approach mode: big number = middle, caddie call uses it
  await p.click('[data-a="mode"][data-v="approach"]');
  const dist1 = await p.textContent('#dist');
  check(new RegExp('^' + Math.round(expF.middle) + 'M').test(dist1.trim()) && /middle of green/.test(dist1), 'approach: big number is the middle of the green: ' + dist1.trim());
  check(/YOUR CALL/.test(await p.textContent('#call')), 'club call works from the green distance');
  // drag the pin flag 12 m towards the back
  const drag = await p.evaluate(() => { const m = window.__c4m.map(), C = window.C4MCourse, D = window.C4M_COURSE.holes[0];
    const c = C.greenCentre(D), back = { lat: c.lat - 0.00009, lon: c.lon - 0.00004 }; const a = m.toScreen(c), z = m.toScreen(back), r = document.getElementById('map').getBoundingClientRect();
    return { ax: r.left + a.x, ay: r.top + a.y, zx: r.left + z.x, zy: r.top + z.y, back }; });
  await p.mouse.move(drag.ax, drag.ay); await p.mouse.down(); await p.mouse.move((drag.ax + drag.zx) / 2, (drag.ay + drag.zy) / 2, { steps: 4 }); await p.mouse.move(drag.zx, drag.zy, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(200);
  const pinTxt = await p.textContent('#greenbox'); const pinD = Number((pinTxt.match(/Pin\s*(\d+)/) || [])[1]);
  const expPin = C.dist(tee1, drag.back);
  check(Math.abs(pinD - expPin) <= 2, 'pin dragged: distance to pin ' + pinD + ' (expected ~' + Math.round(expPin) + ')');
  check(/to the pin/.test(await p.textContent('#dist')), 'big number switches to the pin');
  const saved = await p.evaluate(() => { const S = window.__c4m.S; return !!S.rounds.find(r => r.id === S.currentRoundId).pins[0]; });
  check(saved, 'pin saved with the round');
  await p.click('[data-a="nextHole"]'); await p.waitForTimeout(300);
  const b2 = await p.evaluate(() => window.__c4m.map().bearing);
  check(Math.abs(b2 - C.holeBearing(h2)) < 0.5, 'hole 2 turns to its own direction');
  check(/drag flag/.test(await p.textContent('#greenbox')), 'hole 2 pin starts unset');
  await p.click('[data-a="prevHole"]'); await p.waitForTimeout(300);
  check(/Pin\s*\d+/.test(await p.textContent('#greenbox')), 'hole 1 pin remembered when coming back');
  // walking 150 m along the hole updates F/M/B
  const mid = C.ll(h1.line[1]);
  await ctx.setGeolocation({ latitude: mid.lat, longitude: mid.lon, accuracy: 4 }); await p.waitForTimeout(1200);
  const e2 = C.greenFMB(mid, h1), n2 = ((await p.textContent('#greenbox')).match(/\d+/g) || []).map(Number);
  check(Math.abs(n2[1] - e2.middle) <= 1, 'F/M/B update as you walk: middle ' + n2[1] + ' (expected ' + Math.round(e2.middle) + ')');
  // recentre returns to the hole view
  await p.evaluate(() => { const m = window.__c4m.map(); m.setBearing(0); });
  await p.click('[data-a="recenter"]'); await p.waitForTimeout(200);
  check(Math.abs(await p.evaluate(() => window.__c4m.map().bearing) - C.holeBearing(h1)) < 0.5, 'recentre button returns to the hole view');
  // Save label
  await p.click('[data-a="holeDone"]');
  check((await p.textContent('[data-a="saveCard"]')).trim() === 'Save', 'hole card button reads "Save"');
  await p.click('[data-a="backHole"]');
  // imagery switch
  await p.click('[data-a="home"]'); await p.click('[data-a="settings"]');
  check(/OpenStreetMap data from 2026-10-25/.test(await p.textContent('#coursestat')), 'Settings shows the course map source and date');
  await p.click('[data-a="imagery"][data-v="clarity"]');
  tiles.length = 0; await p.click('[data-a="home"]'); await p.click('[data-a="resume"]'); await p.waitForTimeout(800);
  const srcs = await p.evaluate(() => Array.from(document.querySelectorAll('.sm-tile')).map(i => i.getAttribute('src')));
  check(srcs.length > 0 && srcs.every(u => /clarity\.maptiles\.arcgis\.com/.test(u)), 'Clarity imagery used after switching (' + srcs.length + ' tiles)');
  const hBefore = await p.evaluate(() => document.getElementById('greenbox').getBoundingClientRect().height);
  // refresh course map: an incomplete download is rejected and the current map kept
  await p.route('https://overpass-api.de/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ osm3s: { timestamp_osm_base: 'x' }, elements: [] }) }));
  await p.click('[data-a="home"]'); await p.click('[data-a="settings"]'); await p.click('#refreshbtn'); await p.waitForTimeout(600);
  check(/incomplete/.test(await p.textContent('#coursemsg')) && /18 holes/.test(await p.textContent('#coursestat')), 'bad course download rejected, current map kept');
  await p.screenshot({ path: __dirname + '/shots/v05-settings.png' });
  // tournament mode keeps F/M/B, hides advice
  await p.click('[data-a="home"]'); await p.click('[data-a="discard"]'); await p.click('[data-a="discard"]');
  await p.click('[data-a="settings"]'); await p.click('#tourtgl'); await p.click('[data-a="home"]'); await p.click('[data-a="newRound"]'); await p.click('#startbtn'); await p.waitForTimeout(800);
  const tTxt = await p.textContent('#app');
  check(!(await p.isHidden('#greenbox')) && /Front/.test(tTxt) && !/YOUR CALL|Plays like/.test(tTxt), 'Tournament Mode: front/middle/back shown, no advice');
  await p.click('[data-a="home"]'); await p.click('[data-a="discard"]'); await p.click('[data-a="discard"]');
  await p.click('[data-a="settings"]'); await p.click('#tourtgl'); await p.click('[data-a="home"]');
  // last 5 analysis: seed 6 finished rounds + 1 part round
  await p.evaluate(() => {
    const S = JSON.parse(localStorage.getItem('caddy4me.v1'));
    const mk = (d, f) => ({ id: d + 'T08:00:00.000Z', date: d, done: true, dailyHcp: 17, holes: Array.from({ length: 18 }, (_, i) => Object.assign({ n: i + 1, par: 4, si: i + 1, sand: 0, penalties: 0, wasted: 0 }, f(i))) });
    const leaky = i => ({ score: 6, putts: i < 3 ? 3 : 2, gir: false, fairway: i % 3 ? 'left' : 'hit', approach: i % 2 ? 'short' : 'shortLeft', upDown: false, penalties: i < 3 ? 1 : 0, wasted: i < 3 ? 2 : 0 });
    S.rounds = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06'].map(d => mk(d, leaky));
    const part = mk('2026-10-13', leaky); part.holes[17].score = null; part.done = false; S.rounds.push(part);
    S.currentRoundId = null; localStorage.setItem('caddy4me.v1', JSON.stringify(S));
  });
  await p.reload(); await p.waitForTimeout(400);
  await p.click('[data-a="past"]');
  const an = await p.textContent('#anal');
  check(/Last 5 rounds/.test(an), 'analysis uses the last 5 finished rounds (part round ignored)');
  check((await p.locator('.bar5').count()) === 5 && /08\/09/.test(an) && !/01\/09/.test(an), 'chart shows the 5 most recent finished rounds');
  check((await p.locator('.sug').count()) === 3 && /Penalty shots|Three-putts|Wasted shots|Approaches/.test(an), 'top 3 suggestions shown');
  check(/Averages per round/.test(an) && /Greens in regulation/.test(an), 'averages shown');
  await p.screenshot({ path: __dirname + '/shots/v05-analysis.png', fullPage: true });
  // hidden mid-tournament
  await p.click('[data-a="home"]'); await p.click('[data-a="settings"]'); await p.click('#tourtgl'); await p.click('[data-a="home"]'); await p.click('[data-a="newRound"]'); await p.click('#startbtn'); await p.waitForTimeout(400);
  await p.click('[data-a="home"]'); await p.click('[data-a="past"]');
  check(/Available after your tournament round/.test(await p.textContent('#app')) && (await p.locator('.sug').count()) === 0, 'analysis hidden during a tournament round');
  check(!errors.length, 'no page errors ' + errors.join(' | '));
  await b.close(); process.exit(fails ? 1 : 0);
})();
