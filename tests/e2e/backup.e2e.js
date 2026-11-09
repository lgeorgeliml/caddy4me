/* Caddy4Me prototype browser test - run with: node tests/e2e/run.js
 * Backup format (golf cases 1.3.0, backup/FORMAT.md): the prototype's Restore accepts every shared sample,
 * keeps fields it doesn't know (a newer prototype or the Android app wrote them), and its Export matches the schema.
 * Needs the pinned golf cases in ./golf-cases (as in CI) or GOLF_CASES_DIR. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const CASES = path.resolve(process.env.GOLF_CASES_DIR || path.join(ROOT, 'golf-cases'));
const BC = require(path.join(CASES, 'tools', 'backup-check.js'));
const SAMPLES = path.join(CASES, 'backup', 'samples');
const TILE = fs.readFileSync(__dirname + '/../fixtures/tile.png');
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

  await p.goto('http://localhost:8768/index.html');
  for (const k of '8989') await p.click(`[data-k="${k}"]`);
  await p.waitForTimeout(300);

  const files = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.json')).sort();
  check(files.length >= 8, files.length + ' backup samples in golf cases');
  for (const f of files) {
    const sample = JSON.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
    check(BC.check(sample).length === 0, f + ' passes the backup format');
    await p.click('[data-a="home"]').catch(() => {});
    await p.click('[data-a="settings"]');
    await p.setInputFiles('#restorefile', path.join(SAMPLES, f)); await p.waitForTimeout(200);
    check(await p.locator('#restorebanner').count() === 1, f + ': Restore accepts it (' + sample.rounds.length + ' rounds)');
    await p.click('[data-a="doRestore"]'); await p.waitForTimeout(200);
    check(new RegExp('Backup restored – ' + sample.rounds.length + ' rounds').test(await p.textContent('#restoremsg')), f + ': restored');
    // Home and Past rounds open with the restored data
    await p.click('[data-a="home"]'); await p.waitForTimeout(150);
    await p.click('[data-a="past"]'); await p.waitForTimeout(150);
    check(await p.locator('#impfile').count() === 1, f + ': Past rounds opens');
    await p.click('[data-a="home"]');
    // Export: matches the format and keeps every round and every field it didn't know
    await p.click('[data-a="settings"]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportbtn')]);
    const out = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    const errs = BC.check(out);
    check(errs.length === 0, f + ': Export matches the backup format' + (errs.length ? ' (' + errs.slice(0, 3).join('; ') + ')' : ''));
    check(out.rounds.length === sample.rounds.length, f + ': Export keeps all ' + sample.rounds.length + ' rounds');
    if (f === 'future-stat-1.1.json') {
      const h = out.rounds[0].holes[0];
      check(h.teeClub === sample.rounds[0].holes[0].teeClub && out.rounds[0].weather && out.rounds[0].weather.tempC === 27, f + ': unknown round and hole fields survive Restore → Export');
      check(Array.isArray(out.practiceLog) && out.formatVersion === '1.1', f + ': unknown top-level field and formatVersion survive');
    }
    if (f === 'product-backup.json') check(out.product && out.product.app === sample.product.app, f + ': the Android product block survives');
    if (f === 'v02-offcourse-si.json') {
      check(out.course.siSource === 'miscore-blue' && out.course.slope === 124 && out.course.scratch === 72, f + ': old course data upgraded on Restore');
    }
  }
  // a file that isn't a backup is refused
  const bad = path.join(__dirname, 'shots', 'not-a-backup.json');
  fs.mkdirSync(path.dirname(bad), { recursive: true }); fs.writeFileSync(bad, JSON.stringify({ version: 2, rounds: [] }));
  await p.setInputFiles('#restorefile', bad); await p.waitForTimeout(200);
  check(/isn’t a Caddy4Me backup file/.test(await p.textContent('#restoremsg')), 'a file that is not a backup is refused');

  await browser.close();
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log(okN + ' checks passed');
})().catch(e => { console.log('Error: ' + e.message); process.exit(1); });
