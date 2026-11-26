/* Caddy4Me prototype browser test - run with: node tests/e2e/run.js
 * v0.11 9-hole rounds (spec "9-hole rounds and the Consistency Factor", golf cases 1.7.0): Settings nine ratings and the
 * Consistency Factor, Start round 18 / 9 holes and Front / Back nine, the arrows within the nine, strokes on the nine,
 * the nine's last hole finishing the round, a 9-row summary, Past rounds, Last 5 nines on Past rounds and Home beside an
 * unchanged Last 5 rounds, Resume after a force-close, Tournament Mode, Export / Restore with `nine`, and 9-hole scores files.
 * Needs the pinned golf cases in ./golf-cases (as in CI) or GOLF_CASES_DIR, for the backup format checker. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const CASES = path.resolve(process.env.GOLF_CASES_DIR || path.join(ROOT, 'golf-cases'));
const BC = require(path.join(CASES, 'tools', 'backup-check.js'));
const OUT = __dirname + '/shots/';
fs.mkdirSync(OUT, { recursive: true });
const TILE = fs.readFileSync(__dirname + '/../fixtures/tile.png');
const SC = d => __dirname + '/../fixtures/scores/caddy4me-scores-' + d + '.json';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
    geolocation: { latitude: -32.0749, longitude: 115.8742, accuracy: 4 }, permissions: ['geolocation'], serviceWorkers: 'block', acceptDownloads: true });
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
  const hn = async () => (await txt('#hn')).replace(/\s+/g, ' ');
  const cur = async () => { const s = await S(); return s.rounds.find(x => x.id === s.currentRoundId); };
  async function saveHoles(n) { for (let k = 0; k < n; k++) { await p.click('[data-a="holeDone"]'); await p.waitForTimeout(80); await p.click('[data-a="saveCard"]'); await p.waitForTimeout(250); } }

  await p.goto('http://localhost:8768/index.html');
  for (const k of '8989') await p.click(`[data-k="${k}"]`);
  await p.waitForTimeout(300);

  // ---- no rounds: no Last 5 card of either length (decisions 2-4) ----
  check(await p.locator('#home5').count() === 0 && await p.locator('#home9').count() === 0, 'Home: no Last 5 rounds or Last 5 nines card with no finished rounds');

  // ---- Settings: GA 16.6, nine ratings prefilled with the checked values, daily handicaps with the Consistency Factor ----
  await p.click('[data-a="settings"]');
  await p.fill('[data-set="ga"]', '16.6'); await p.dispatchEvent('[data-set="ga"]', 'change'); await p.waitForTimeout(100);
  const v = sel => p.inputValue(sel);
  check(await v('[data-set="n9slope:front"]') === '127' && await v('[data-set="n9scratch:front"]') === '36' && await v('[data-set="n9slope:back"]') === '121' && await v('[data-set="n9scratch:back"]') === '36',
    'Settings prefills the checked Melville nines: front 127 / 36, back 121 / 36');
  check((await txt('#dhv')).trim() === '17' && (await txt('#dh9front')).trim() === '9' && (await txt('#dh9back')).trim() === '8', 'daily handicap preview at GA 16.6: 18 holes 17, front nine 9, back nine 8');
  check(/0\.9986, Golf Australia’s Consistency Factor/.test(await txt('#app')), 'Settings names the Consistency Factor in the formula');
  // a half-stroke scratch is kept as a decimal
  await p.fill('[data-set="n9scratch:back"]', '36.5'); await p.dispatchEvent('[data-set="n9scratch:back"]', 'change'); await p.waitForTimeout(100);
  check((await S()).course.nines.back.scratch === 36.5 && (await txt('#dh9back')).trim() === '9', 'a half-stroke nine scratch (36.5) is kept and the back nine preview follows (9)');
  await p.fill('[data-set="n9scratch:back"]', '36'); await p.dispatchEvent('[data-set="n9scratch:back"]', 'change'); await p.waitForTimeout(100);
  await p.locator('#dh9').screenshot({ path: OUT + 'v11-settings-dh.png' });
  await p.click('[data-a="home"]');

  // ---- Start round: 18 / 9 holes, then Front / Back nine ----
  await p.click('[data-a="newRound"]'); await p.waitForTimeout(100);
  check(await p.locator('#lenseg [data-v="18"].on').count() === 1 && await p.locator('#nineseg').count() === 0, 'Start round opens on 18 holes with no nine choice');
  check(/18 holes \(par 72\) · daily handicap 17/.test(await txt('#startdh')), 'start sheet: 18 holes, daily handicap 17');
  await p.click('[data-a="pickLen"][data-v="9"]');
  check(await p.locator('#nineseg [data-v="front"].on').count() === 1 && await p.locator('#nineseg button').count() === 2, '9 holes shows Front nine / Back nine, Front first');
  check(/Front nine \(holes 1–9, par 36\) · daily handicap 9/.test(await txt('#startdh')), 'front nine: daily handicap 9');
  await p.click('[data-a="pickNine"][data-v="back"]');
  check(/Back nine \(holes 10–18, par 36\) · daily handicap 8/.test(await txt('#startdh')), 'back nine: daily handicap 8');
  await p.screenshot({ path: OUT + 'v11-start-nine.png' });
  await p.click('#startbtn'); await p.waitForTimeout(700);
  let r = await cur();
  check(r.nine === 'back' && r.dailyHcp === 8 && r.holes.length === 18 && r.holes.every(h => h.score == null), 'a back-nine round: nine "back", daily handicap 8, all 18 hole entries kept');
  check(r.strategy.holes.length === 9 && r.strategy.holes[0].n === 10 && r.strategy.nine === 'back', 'the plan is built for the back nine (holes 10–18)');
  check(/^Hole 10/.test(await hn()) && !(await p.locator('#planstrip').isHidden()), 'the round opens on hole 10 with its plan strip');

  // ---- the arrows stay within the nine ----
  await p.click('[data-a="prevHole"]'); await p.waitForTimeout(100);
  check(/^Hole 10/.test(await hn()), '‹ on hole 10 stays on hole 10');
  for (let k = 0; k < 9; k++) { await p.click('[data-a="nextHole"]'); await p.waitForTimeout(60); }
  check(/^Hole 18/.test(await hn()), '› stops at hole 18');
  for (let k = 0; k < 8; k++) { await p.click('[data-a="prevHole"]'); await p.waitForTimeout(60); }
  check(/^Hole 10 · PAR 4 · SI 2/.test(await hn()), 'back to hole 10 (18-hole SI shown)');

  // ---- hole card: strokes on the nine, 9-dot progress ----
  await p.click('[data-a="holeDone"]'); await p.waitForTimeout(100);
  check(/Hole 10 · Par 4 · SI 2/.test(await txt('#app')) && /you get 1 stroke here/.test(await txt('#app')), 'hole 10 card: SI 2, 1 stroke');
  check(await p.locator('.progress.nine span').count() === 9 && /Hole 10 of the back nine/.test(await p.getAttribute('.progress', 'aria-label')), 'card progress shows the nine (9 marks)');
  await p.click('[data-a="saveCard"]'); await p.waitForTimeout(250);
  check(/^Hole 11/.test(await hn()), 'Save moves to hole 11');
  await saveHoles(4);
  check(/^Hole 15/.test(await hn()), 'on hole 15');
  await p.click('[data-a="holeDone"]'); await p.waitForTimeout(100);
  check(/Hole 15 · Par 4 · SI 17/.test(await txt('#app')) && /no handicap stroke here/.test(await txt('#app')), 'hole 15 (SI 17, rank 9 on the back nine) gets no stroke at 8');
  await p.screenshot({ path: OUT + 'v11-card-15.png' });
  await p.click('[data-a="saveCard"]'); await p.waitForTimeout(250);
  await saveHoles(3);   // 16, 17, 18: Save on 18 finishes the round
  r = (await S()).rounds.find(x => x.nine === 'back');
  check(r.done === true && r.holes.slice(9).every(h => h.score != null) && r.holes.slice(0, 9).every(h => h.score == null), 'Save on hole 18 finishes the back nine (done; front nine blank)');
  check(r.holes[14].points === 2 && r.holes[9].points === 3, 'points with the nine strokes: hole 10 par with a stroke = 3, hole 15 par without = 2');
  const sum = await txt('#app');
  check(/ROUND COMPLETE/.test(sum) && /Melville Glades · Back nine/.test(sum), 'summary: round complete, Back nine');
  const rows = await p.$$eval('.htab tbody tr', trs => trs.map(t => t.cells[0].textContent));
  check(rows.length === 11 && rows[0] === '10' && rows[8] === '18' && rows[9] === 'IN' && rows[10] === 'TOT' && rows.indexOf('OUT') < 0, 'summary table: holes 10–18, then IN and TOT (' + rows.join(' ') + ')');
  check(/Target 18/.test(sum), 'points chart targets 18 on a nine');
  const pts = r.holes.reduce((a, h) => a + (h.points || 0), 0);
  check(new RegExp(pts + '\\s*PTS').test(sum), 'summary total ' + pts + ' points');
  await p.screenshot({ path: OUT + 'v11-summary-back.png', fullPage: true });

  // ---- Past rounds and Home with one nine ----
  await p.click('[data-a="home"]'); await p.click('[data-a="past"]'); await p.waitForTimeout(150);
  const list = await p.$$eval('[data-a="openRound"]', bs => bs.map(b => b.textContent));
  check(/over 9 holes · Back nine$/.test(list[0]), 'Past rounds: "… over 9 holes · Back nine" (' + list[0] + ')');
  check(await p.locator('#anal').count() === 0 && /Last 5 nines/.test(await txt('#anal9')) && /Finish 1 more nine to see your trends and suggestions\./.test(await txt('#anal9')),
    'Past rounds: no Last 5 rounds panel (no 18-hole rounds); Last 5 nines asks for 1 more nine');
  await p.click('[data-a="home"]');
  check(await p.locator('#home5').count() === 0 && /LAST 5 NINES/.test(await txt('#home9')) && /Finish 1 more nine/.test(await txt('#home9')), 'Home: Last 5 nines card asks for 1 more nine; no Last 5 rounds card');

  // ---- second nine: defaults to the length and nine last played; force-close mid-nine, then Resume ----
  await p.click('[data-a="newRound"]'); await p.waitForTimeout(100);
  check(await p.locator('#lenseg [data-v="9"].on').count() === 1 && await p.locator('#nineseg [data-v="back"].on').count() === 1, 'Start round defaults to 9 holes, Back nine (last played)');
  await p.click('[data-a="pickNine"][data-v="front"]'); await p.click('#startbtn'); await p.waitForTimeout(700);
  check(/^Hole 1 /.test(await hn()), 'a front nine opens on hole 1');
  await saveHoles(3);
  await p.reload(); await p.waitForTimeout(500);   // force-close
  check(/Resume · Hole 4/.test(await txt('#app')) && /next up hole 4 · front nine/.test(await txt('#app')), 'after a force-close Home offers Resume · Hole 4 (front nine)');
  await p.click('[data-a="resume"]'); await p.waitForTimeout(600);
  check(/^Hole 4/.test(await hn()), 'Resume opens hole 4');
  await saveHoles(5);
  check(/^Hole 9/.test(await hn()), 'on hole 9');
  await p.click('[data-a="nextHole"]'); await p.waitForTimeout(80);
  check(/^Hole 9/.test(await hn()), '› on hole 9 of a front nine stays on hole 9');
  await saveHoles(1);
  const rows2 = await p.$$eval('.htab tbody tr', trs => trs.map(t => t.cells[0].textContent));
  check(rows2.length === 11 && rows2[0] === '1' && rows2[9] === 'OUT' && rows2[10] === 'TOT', 'front nine summary: holes 1–9, OUT and TOT');
  r = (await S()).rounds.find(x => x.nine === 'front');
  check(r.done && r.dailyHcp === 9 && r.holes.slice(9).every(h => h.score == null), 'front nine done at daily handicap 9, back nine blank');

  // ---- Last 5 nines full with 2 nines; Last 5 rounds unchanged beside it ----
  await p.click('[data-a="home"]'); await p.waitForTimeout(100);
  check((await p.locator('#home9 .bar5').count()) === 2 && /Points/.test(await txt('#home9')) && await p.locator('#home5').count() === 0, 'Home: Last 5 nines card with 2 bars');
  await p.click('#home9'); await p.waitForTimeout(150);
  const a9 = await txt('#anal9');
  check(/Last 2 nines/.test(a9) && /Averages per nine/.test(a9) && !/a round/.test(a9), 'Past rounds: Last 2 nines panel, averages per nine');
  await p.click('[data-a="home"]');

  // ---- Tournament Mode in a 9-hole round ----
  await p.click('[data-a="settings"]'); await p.click('[data-a="tour"]'); await p.click('[data-a="home"]');
  await p.click('[data-a="newRound"]'); await p.waitForTimeout(100);
  check(await p.locator('#lenseg [data-v="9"].on').count() === 1 && await p.locator('#nineseg [data-v="front"].on').count() === 1, 'Start round defaults to 9 holes, Front nine (last played)');
  await p.click('#startbtn'); await p.waitForTimeout(700);
  r = await cur();
  check(r.tournament && r.nine === 'front' && r.strategy.noElevation === true && r.strategy.holes.length === 9, 'tournament nine: plan fixed for the nine without plays-like');
  check(await p.locator('#tourtag').count() === 1 && await p.locator('.tournote').count() === 1 && await p.locator('#call').count() === 0 && !(await p.locator('#planstrip').isHidden()),
    'tournament nine: distance only, no call card, plan strip shown');
  await p.click('[data-a="home"]');
  check(/Available after your tournament round/.test(await txt('#home9')) && await p.locator('#home5').count() === 0, 'Last 5 nines waits until after the tournament round (no 18-hole rounds yet, so no Last 5 rounds card)');
  await p.click('[data-a="discard"]'); await p.click('[data-a="discard"]'); await p.waitForTimeout(100);
  await p.click('[data-a="settings"]'); await p.click('[data-a="tour"]'); await p.click('[data-a="home"]');

  // ---- Last 5 rounds unchanged beside Last 5 nines (three imported MiScore 18-hole rounds) ----
  for (const d of ['2026-10-18', '2026-10-03', '2026-09-26']) {
    await p.click('[data-a="past"]'); await p.setInputFiles('#impfile', SC(d)); await p.waitForTimeout(300); await p.click('[data-a="home"]');
  }
  const h5 = await txt('#home5');
  check((await p.locator('#home5 .bar5').count()) === 3 && /Points\s*31\.7/.test(h5) && /Gross\s*94/.test(h5), 'Last 5 rounds unchanged by the nines: 3 rounds, 31.7 pts, gross 94');
  check((await p.locator('#home9 .bar5').count()) === 2, 'Last 5 nines still counts only the 2 nines');
  const hb5 = await p.locator('#home5').boundingBox(), hb9 = await p.locator('#home9').boundingBox();
  check(hb5.y < hb9.y, 'Home: Last 5 nines sits under Last 5 rounds');
  await p.screenshot({ path: OUT + 'v11-home-both.png', fullPage: true });

  // ---- Export keeps nine and the nine ratings; Restore brings them back ----
  await p.click('[data-a="settings"]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportbtn')]);
  const file = await dl.path(), out = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errs = BC.check(out);
  check(errs.length === 0, 'Export matches the backup format' + (errs.length ? ' (' + errs.slice(0, 3).join('; ') + ')' : ''));
  check(out.rounds.filter(x => x.nine).map(x => x.nine).sort().join(',') === 'back,front' && out.rounds.every(x => x.holes.length === 18) && out.course.nines.front.slope === 127,
    'Export: two rounds with nine, all with 18 hole entries, and course.nines');
  await p.evaluate(() => { localStorage.removeItem('caddy4me.v1'); }); await p.reload(); await p.waitForTimeout(400);
  check((await S()).rounds.length === 0, 'a wiped phone has no rounds');
  await p.click('[data-a="settings"]');
  await p.setInputFiles('#restorefile', file); await p.waitForTimeout(200); await p.click('[data-a="doRestore"]'); await p.waitForTimeout(200);
  const s2 = await S();
  check(s2.rounds.filter(x => x.nine).length === 2 && s2.rounds.find(x => x.nine === 'back').dailyHcp === 8 && s2.course.nines.back.slope === 121, 'Restore brings the nines back (nine, daily handicap, ratings)');

  // ---- Import scores: 9-hole files ----
  const base = JSON.parse(fs.readFileSync(SC('2026-10-18'), 'utf8'));
  function nineFile(date, from, to, dh) {
    const f = JSON.parse(JSON.stringify(base)); f.date = date; f.dailyHcp = dh;
    f.holes = f.holes.filter(h => h.n >= from && h.n <= to); return f;
  }
  const fFront = OUT + 'nine-front.json', fBack = OUT + 'nine-back.json', fOld = OUT + 'nine-on-18.json';
  fs.writeFileSync(fFront, JSON.stringify(nineFile('2026-11-30', 1, 9, 9)));
  fs.writeFileSync(fBack, JSON.stringify(nineFile('2026-12-01', 10, 18, 8)));
  fs.writeFileSync(fOld, JSON.stringify(nineFile('2026-10-03', 1, 9, 17)));
  await p.click('[data-a="home"]'); await p.click('[data-a="past"]');
  await p.setInputFiles('#impfile', fFront); await p.waitForTimeout(300);
  let s3 = await S(), rf = s3.rounds.find(x => x.date === '2026-11-30');
  check(rf && rf.nine === 'front' && rf.done === true && rf.dailyHcp === 9 && rf.holes.length === 18, 'a front-nine scores file on a new date becomes a front-nine round (done, daily handicap 9)');
  check(/Added round 2026-11-30 – 9 holes from MiScore card \(front nine\)/.test(await txt('#app')) && /OUT/.test(await txt('.htab')) && !/IN/.test(await txt('.htab')), 'import message names the nine; summary shows OUT');
  await p.click('[data-a="home"]'); await p.click('[data-a="past"]');
  await p.setInputFiles('#impfile', fBack); await p.waitForTimeout(300);
  s3 = await S(); const rb = s3.rounds.find(x => x.date === '2026-12-01');
  check(rb && rb.nine === 'back' && rb.done === true, 'a back-nine scores file becomes a back-nine round');
  await p.click('[data-a="home"]'); await p.click('[data-a="past"]');
  await p.setInputFiles('#impfile', fOld); await p.waitForTimeout(300);
  s3 = await S(); const ro = s3.rounds.filter(x => x.date === '2026-10-03');
  check(ro.length === 1 && !ro[0].nine && ro[0].done === true, 'a 9-hole file merged into a round already on the phone keeps it an 18-hole round');
  await p.click('[data-a="home"]');
  check((await p.locator('#home9 .bar5').count()) === 4 && (await p.locator('#home5 .bar5').count()) === 3, 'Home: Last 5 nines counts the 2 imported nines (4), Last 5 rounds still 3');

  check(errors.filter(e => !e.startsWith('CHECK')).length === 0, 'no page errors');
  console.log(okN + ' ok'); console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.log('Error: ' + e.message); process.exit(1); });
