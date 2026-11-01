#!/usr/bin/env node
/* Caddy4Me shared golf test cases - prototype runner.
 *
 *   node tests/golf-cases/run.js [path to caddy4me-golf-cases checkout]
 *
 * Default path: ./golf-cases (where GitHub Actions checks out the pinned version from golf-cases.version).
 * Runs every case against this prototype's logic. Exit code 1 if any case fails.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const E = require(path.join(ROOT, 'engine.js'));
const C = require(path.join(ROOT, 'course.js'));
const ST = require(path.join(ROOT, 'strategy.js'));

const DIR = path.resolve(process.argv[2] || path.join(ROOT, 'golf-cases'));
const load = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const index = load('cases/index.json');
const BAGS = load('fixtures/bags.json');
const ROUNDS = load('fixtures/rounds.json');
const COURSES = { 'melville-glades': load('fixtures/course-melville-glades.json') };
const BOOKS = { 'melville-glades': load('fixtures/book-melville-glades.json') };
const PARSI = load('fixtures/course-par-si.json');

const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const hole = (course, n) => C.hole(COURSES[course], n);
const stratCache = {};

const FN = {
  dailyHandicap: i => E.dailyHandicap(i.ga, i.slope, i.scratch, i.par),
  strokesOnHole: i => E.strokesOnHole(i.dailyHcp, i.si),
  stablefordPoints: i => E.stablefordPoints(i.par, i.score, i.strokes),
  windFromLive: i => { const w = E.windFromLive(i.speedKmh, i.fromDeg, i.shotBearingDeg); return { head: r2(w.head), cross: r2(w.cross) }; },
  recommend: i => {
    const r = E.recommend(Object.assign({}, i, { bag: BAGS[i.bag] }));
    return { club: r.club.name, swing: r.swing, playsLike: r.playsLike, up: r.up ? r.up.name : null, down: r.down ? r.down.name : null, hasWarning: !!r.warning, hasAim: !!r.aim };
  },
  holeStats: i => E.holeStats(ROUNDS[i.round].holes[i.hole - 1]),
  roundSummary: i => { const hs = ROUNDS[i.round].holes; return E.roundSummary(i.holes ? hs.slice(i.holes[0] - 1, i.holes[1]) : hs); },
  analyseRounds: i => {
    const a = E.analyseRounds(i.rounds.map(k => ROUNDS[k]), i.n);
    const o = { count: a.count, enough: a.enough };
    if (a.enough) { o.roundsUsed = a.rounds.map(r => r.date); o.avg = a.avg; o.trendPts = a.trend.pts; o.suggestions = a.suggestions.map(x => ({ key: x.key, shots: x.shots })); }
    return o;
  },
  greenFMB: i => { const f = C.greenFMB(i.player, hole(i.course, i.hole)); return { front: r1(f.front), middle: r1(f.middle), back: r1(f.back), inside: f.inside }; },
  bunkersAhead: i => C.bunkersAhead(i.player, hole(i.course, i.hole), i.max).map(x => ({ reach: r1(x.reach), carry: r1(x.carry), nearGreen: x.nearGreen })),
  holeBearing: i => r1(C.holeBearing(hole(i.course, i.hole))),
  'buildStrategy.hole': i => {
    const key = [i.book, i.bag, i.mode, i.dailyHcp, i.rounds, i.noElevation].join('|');
    if (!stratCache[key]) {
      const sets = { none: [], miscore: Object.keys(ROUNDS).filter(k => k.startsWith('miscore')), all: Object.keys(ROUNDS) };
      stratCache[key] = ST.buildStrategy({ book: BOOKS[i.book], bag: BAGS[i.bag], mode: i.mode, dailyHcp: i.dailyHcp, pars: PARSI.pars, si: PARSI.si,
        rounds: sets[i.rounds].map(k => ROUNDS[k]), strokesOnHole: E.strokesOnHole, dailyHcpFor: r => r.dailyHcp, thoughts: [], noElevation: i.noElevation });
    }
    const h = stratCache[key].holes[i.hole - 1];
    return Object.assign({}, h, { shots: h.shots.map(x => ({ kind: x.kind, club: x.club })) });
  }
};

// compare only what `expected` specifies; numbers within tol
function diff(exp, act, tol, at) {
  if (exp === null || typeof exp !== 'object') {
    if (typeof exp === 'number' && typeof act === 'number') return Math.abs(exp - act) <= tol + 1e-9 ? null : at + ': expected ' + exp + ', got ' + act;
    return exp === act ? null : at + ': expected ' + JSON.stringify(exp) + ', got ' + JSON.stringify(act);
  }
  if (act === null || typeof act !== 'object') return at + ': expected an object/array, got ' + JSON.stringify(act);
  if (Array.isArray(exp)) {
    if (!Array.isArray(act) || act.length !== exp.length) return at + ': expected ' + exp.length + ' items, got ' + (Array.isArray(act) ? act.length : typeof act);
    for (let k = 0; k < exp.length; k++) { const d = diff(exp[k], act[k], tol, at + '[' + k + ']'); if (d) return d; }
    return null;
  }
  for (const k of Object.keys(exp)) { const d = diff(exp[k], act[k], tol, at ? at + '.' + k : k); if (d) return d; }
  return null;
}

let pass = 0, fail = 0;
const failures = [];
index.suites.forEach(s => {
  const file = load('cases/' + s.suite + '.json');
  let sp = 0, sf = 0;
  file.cases.forEach(c => {
    const fn = FN[c.fn];
    let d;
    if (!fn) d = 'no runner for fn "' + c.fn + '"';
    else { try { d = diff(c.expected, fn(c.input), c.tol || 0, ''); } catch (e) { d = 'threw ' + e.message; } }
    if (d) { sf++; failures.push(c.id + ' (' + c.fn + ') ' + d); } else sp++;
  });
  pass += sp; fail += sf;
  console.log((sf ? 'FAIL ' : 'ok   ') + s.suite.padEnd(11) + sp + '/' + (sp + sf));
});
failures.slice(0, 40).forEach(f => console.log('  ' + f));
if (failures.length > 40) console.log('  … and ' + (failures.length - 40) + ' more');
console.log('golf cases ' + (index.version || '') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
