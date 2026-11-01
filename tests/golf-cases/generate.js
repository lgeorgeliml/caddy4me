#!/usr/bin/env node
/* Caddy4Me shared golf test cases - generator (reference implementation = this prototype).
 *
 * Run from the prototype repo root:   node tests/golf-cases/generate.js <path to caddy4me-golf-cases checkout>
 *
 * Writes cases/*.json and fixtures/*.json into the cases repo. Each case is
 *   { id, fn, input, expected, tol?, note? }
 * Runners compare only the fields present in `expected`; numbers may differ by up to `tol` (default 0).
 * Expected answers come from the prototype's logic, which is what has been tested on the course.
 * After the first set, cases change only through a signed-off spec (see the cases repo README).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const E = require(path.join(ROOT, 'engine.js'));
const C = require(path.join(ROOT, 'course.js'));
const ST = require(path.join(ROOT, 'strategy.js'));
const COURSE = require(path.join(ROOT, 'course-melville.js'));
const BOOK = require(path.join(ROOT, 'course-book.js'));
const VERSION = (require(path.join(ROOT, 'version.js')) || {}).C4M_VERSION || null;

const OUT = path.resolve(process.argv[2] || path.join(ROOT, '..', 'caddy4me-golf-cases'));
const SCORES = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'tests', 'fixtures', 'scores');
fs.mkdirSync(path.join(OUT, 'cases'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'fixtures'), { recursive: true });

const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const pick = (o, keys) => keys.reduce((a, k) => (o[k] !== undefined ? (a[k] = o[k], a) : a), {});
function write(file, obj) { fs.writeFileSync(path.join(OUT, file), JSON.stringify(obj, null, 1) + '\n'); }
const suites = [];
function suite(name, title, cases) {
  cases.forEach((c, i) => { c.id = name + '-' + String(i + 1).padStart(4, '0'); });
  // put id first for readability
  const ordered = cases.map(c => Object.assign({ id: c.id }, c));
  write('cases/' + name + '.json', { suite: name, title: title, format: 1, cases: ordered });
  suites.push({ suite: name, title: title, count: cases.length });
}

/* ---------- fixtures (data both apps load) ---------- */
const BAGS = {
  'default': E.clone(E.DEFAULT_BAG),
  'long-hitter': E.clone(E.DEFAULT_BAG).map(c => c.id === 'D' ? Object.assign(c, { carry: 228, total: 250 }) : c)
    .concat([{ id: 'x3w', name: '3 Wood', type: 'wood', carry: 190, total: 212 }]).sort((a, b) => b.total - a.total),
  'no-hybrid': E.clone(E.DEFAULT_BAG).filter(c => c.id !== '5H')
};
write('fixtures/bags.json', BAGS);
write('fixtures/course-melville-glades.json', COURSE);
write('fixtures/book-melville-glades.json', BOOK);
write('fixtures/course-par-si.json', E.COURSE);

// rounds: the 3 imported MiScore rounds + synthetic rounds with full hole-card stats
function importRound(file) {
  const f = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = { id: f.date + 'T00:00:00.000Z', date: f.date, dailyHcp: f.dailyHcp, holes: f.holes.map(h => ({ n: h.n, par: h.par, si: h.si })) };
  E.mergeScores(r, f); return r;
}
const ROUNDS = {};
fs.readdirSync(SCORES).filter(f => /^caddy4me-scores-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().forEach(f => {
  const r = importRound(path.join(SCORES, f)); ROUNDS['miscore-' + r.date] = r;
});
const APPR = E.APPROACH9;
function synth(id, date, seed) {
  // deterministic pseudo-random hole cards
  let s = seed; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const holes = E.COURSE.pars.map((par, i) => {
    const gir = rnd() < 0.35, putts = gir ? (rnd() < 0.2 ? 3 : rnd() < 0.3 ? 1 : 2) : (rnd() < 0.15 ? 3 : rnd() < 0.4 ? 1 : 2);
    const score = par + (gir ? putts - 2 : 1 + Math.floor(rnd() * 3)) + (rnd() < 0.08 ? 1 : 0);
    const h = { n: i + 1, par, si: E.COURSE.si[i], score: Math.max(2, score), putts, gir,
      fairway: par >= 4 ? ['hit', 'left', 'right'][Math.floor(rnd() * 3)] : null,
      approach: gir ? 'hit' : APPR[Math.floor(rnd() * APPR.length)],
      upDown: gir ? null : rnd() < 0.3, sand: rnd() < 0.15 ? 1 : 0, penalties: rnd() < 0.1 ? 1 : 0, wasted: rnd() < 0.3 ? 1 : 0,
      firstPutt: gir ? E.PUTT_BANDS[Math.floor(rnd() * 5)][0] : null };
    if (h.approach === 'hit' && !gir) h.approach = 'short';
    if (h.sand) h.sandSave = rnd() < 0.3;
    return h;
  });
  return { id, date, dailyHcp: 17, holes };
}
['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22'].forEach((d, i) => { ROUNDS['synthetic-' + d] = synth(d + 'T08:00:00.000Z', d, 1234 + i * 77); });
// add points like the app does (holesWithPoints)
Object.values(ROUNDS).forEach(r => r.holes.forEach(h => {
  if (h.score != null && h.points == null) h.points = E.stablefordPoints(h.par, h.score, E.strokesOnHole(r.dailyHcp, h.si));
}));
write('fixtures/rounds.json', ROUNDS);

/* ---------- handicap ---------- */
{
  const cases = [];
  [-2, 0, 5.4, 9.9, 12, 16.9, 18.3, 24, 36, 54].forEach(ga => [[113, 72], [124, 72], [135, 71.2], [124, 74]].forEach(([slope, scratch]) => {
    cases.push({ fn: 'dailyHandicap', input: { ga, slope, scratch, par: 72 }, expected: E.dailyHandicap(ga, slope, scratch, 72) });
  }));
  [-4, -1, 0, 1, 9, 17, 18, 19, 27, 36, 40].forEach(dh => [1, 2, 9, 17, 18].forEach(si => {
    cases.push({ fn: 'strokesOnHole', input: { dailyHcp: dh, si }, expected: E.strokesOnHole(dh, si) });
  }));
  suite('handicap', 'Daily handicap (GA formula) and strokes received per hole', cases);
}
/* ---------- stableford ---------- */
{
  const cases = [];
  [3, 4, 5].forEach(par => [0, 1, 2].forEach(st => { for (let sc = 1; sc <= par + 5; sc++) cases.push({ fn: 'stablefordPoints', input: { par, score: sc, strokes: st }, expected: E.stablefordPoints(par, sc, st) }); }));
  suite('stableford', 'Stableford points', cases);
}
/* ---------- wind ---------- */
{
  const cases = [];
  [0, 10, 25].forEach(speed => [0, 90, 200, 315].forEach(from => [0, 45, 180, 270].forEach(brg => {
    const w = E.windFromLive(speed, from, brg);
    cases.push({ fn: 'windFromLive', input: { speedKmh: speed, fromDeg: from, shotBearingDeg: brg }, expected: { head: r2(w.head), cross: r2(w.cross) }, tol: 0.01 });
  })));
  suite('wind', 'Live wind resolved into head/tail and cross components for a shot', cases);
}
/* ---------- club recommendation ---------- */
{
  const cases = [];
  const winds = [{ head: 0, cross: 0 }, { head: 15, cross: 0 }, { head: -15, cross: 0 }, { head: 5, cross: 20 }];
  for (let d = 30; d <= 230; d += 20) winds.forEach(w => ['approach', 'tee'].forEach(mode => {
    const lies = mode === 'tee' ? ['fairway'] : ['fairway', 'lightRough', 'bunker'];
    lies.forEach(lie => ['normal', 'firm'].forEach(ground => {
      const input = { distance: d, mode, wind: w, lie, ground, bag: 'default' };
      const r = E.recommend(Object.assign({}, input, { bag: BAGS.default }));
      if (!r) return;
      cases.push({ fn: 'recommend', input, expected: { club: r.club.name, swing: r.swing, playsLike: r.playsLike,
        up: r.up ? r.up.name : null, down: r.down ? r.down.name : null, hasWarning: !!r.warning, hasAim: !!r.aim } });
    }));
  }));
  suite('recommend', 'Club recommendation: plays-like distance, club, swing and neighbours (bag from fixtures/bags.json)', cases);
}
/* ---------- hole stats and round summary ---------- */
{
  const cases = [];
  Object.entries(ROUNDS).forEach(([key, r]) => {
    r.holes.forEach(h => {
      const s = E.holeStats(h); if (!s) return;
      cases.push({ fn: 'holeStats', input: { round: key, hole: h.n }, expected: pick(s, ['gir', 'upDownAttempt', 'upDownMade', 'sandSaveAttempt', 'sandSaved', 'threePutts', 'fairwayAttempt', 'fairwayHit']) });
    });
  });
  Object.entries(ROUNDS).forEach(([key, r]) => {
    const s = E.roundSummary(r.holes);
    const exp = pick(s, ['holes', 'statHoles', 'pickups', 'score', 'par', 'toPar', 'putts', 'gir', 'girPct', 'fw', 'fwHit', 'fwPct', 'ud', 'udMade', 'udPct',
      'sandAtt', 'sandSaved', 'sandShots', 'wasted', 'penalties', 'chipIns', 'points', 'puttsPerGir', 'miss', 'putting']);
    cases.push({ fn: 'roundSummary', input: { round: key }, expected: exp });
    // front and back nine on their own
    [[0, 9], [9, 18]].forEach(([a, b]) => {
      const t = E.roundSummary(r.holes.slice(a, b));
      cases.push({ fn: 'roundSummary', input: { round: key, holes: [a + 1, b] }, expected: pick(t, ['holes', 'score', 'par', 'putts', 'points', 'gir', 'fwHit', 'fw']) });
    });
  });
  suite('rounds', 'Hole stats and round summaries (rounds from fixtures/rounds.json, holes with points already filled in)', cases);
}
/* ---------- last 5 rounds analysis ---------- */
{
  const cases = [];
  const keys = Object.keys(ROUNDS);
  const combos = [keys.slice(0, 1), keys.slice(0, 2), keys.slice(0, 3), keys.slice(3), keys, keys.slice(2)];
  combos.forEach(ks => {
    const a = E.analyseRounds(ks.map(k => ROUNDS[k]), 5);
    const exp = { count: a.count, enough: a.enough };
    if (a.enough) {
      exp.roundsUsed = a.rounds.map(r => r.date);
      exp.avg = pick(a.avg, ['pts', 'gross', 'toPar', 'putts', 'three', 'ppg', 'girPct', 'fwPct', 'udPct', 'sandPct', 'pen', 'wasted', 'shortShare', 'leftShare', 'rightShare', 'putting']);
      exp.trendPts = a.trend.pts;
      exp.suggestions = a.suggestions.map(x => ({ key: x.key, shots: x.shots }));
    }
    cases.push({ fn: 'analyseRounds', input: { rounds: ks, n: 5 }, expected: exp, tol: 0.05 });
  });
  suite('analysis', 'Last 5 rounds analysis: averages, trend and top-3 suggestions', cases);
}
/* ---------- course geometry ---------- */
{
  const cases = [];
  COURSE.holes.forEach(h => {
    const gc = C.greenCentre(h);
    const tee = C.ll(h.line[0]);
    // points along the line from the tee: start, 40%, 70%, and 30 m short of the green centre
    const L = C.dist(tee, gc);
    [0, 0.4, 0.7, (L - 30) / L].forEach((f, j) => {
      const p = { lat: r6(tee.lat + (gc.lat - tee.lat) * f), lon: r6(tee.lon + (gc.lon - tee.lon) * f) };
      const fmb = C.greenFMB(p, h), b = C.bunkersAhead(p, h, 3);
      cases.push({ fn: 'greenFMB', input: { course: 'melville-glades', hole: h.n, player: p }, expected: { front: r1(fmb.front), middle: r1(fmb.middle), back: r1(fmb.back), inside: fmb.inside }, tol: 0.5 });
      cases.push({ fn: 'bunkersAhead', input: { course: 'melville-glades', hole: h.n, player: p, max: 3 }, expected: b.map(x => ({ reach: r1(x.reach), carry: r1(x.carry), nearGreen: x.nearGreen })), tol: 0.5 });
    });
    cases.push({ fn: 'holeBearing', input: { course: 'melville-glades', hole: h.n }, expected: r1(C.holeBearing(h)), tol: 0.2 });
  });
  suite('course', 'Front / middle / back of the green, bunker reach and carry, hole bearing (fixtures/course-melville-glades.json)', cases);
}
function r6(x) { return Math.round(x * 1e6) / 1e6; }
/* ---------- course strategy ---------- */
{
  const cases = [];
  const roundSets = { none: [], miscore: Object.keys(ROUNDS).filter(k => k.startsWith('miscore')), all: Object.keys(ROUNDS) };
  const configs = [];
  ['bogey', 'points', 'attack'].forEach(mode => Object.keys(BAGS).forEach(bag => [17, 5].forEach(dh => configs.push({ mode, bag, dh, rounds: 'none', noElevation: false }))));
  ['bogey', 'points', 'attack'].forEach(mode => configs.push({ mode, bag: 'default', dh: 17, rounds: 'all', noElevation: false }, { mode, bag: 'default', dh: 17, rounds: 'miscore', noElevation: true }));
  configs.forEach(cfg => {
    const st = ST.buildStrategy({ book: BOOK, bag: BAGS[cfg.bag], mode: cfg.mode, dailyHcp: cfg.dh, pars: E.COURSE.pars, si: E.COURSE.si,
      rounds: roundSets[cfg.rounds].map(k => ROUNDS[k]), strokesOnHole: E.strokesOnHole, dailyHcpFor: r => r.dailyHcp, thoughts: [], noElevation: cfg.noElevation });
    st.holes.forEach(h => {
      cases.push({ fn: 'buildStrategy.hole', input: { book: 'melville-glades', bag: cfg.bag, mode: cfg.mode, dailyHcp: cfg.dh, rounds: cfg.rounds, noElevation: cfg.noElevation, hole: h.n },
        expected: { target: h.target, strokes: h.strokes, miss: h.miss, reached: h.reached, rise: h.rise, shots: h.shots.map(x => ({ kind: x.kind, club: x.club })) } });
    });
  });
  suite('strategy', 'Course strategy per hole: target, handicap shots, shot plan (kind + club) and safe miss. Wording is not compared.', cases);
}

/* ---------- index ---------- */
write('cases/index.json', { format: 1, version: process.env.CASES_VERSION || '1.0.0', generatedFrom: 'caddy4me prototype ' + (VERSION && VERSION.v ? 'v' + VERSION.v : ''), generatedAt: new Date().toISOString().slice(0, 10), suites });
console.log(suites.map(s => s.suite + ': ' + s.count).join('\n') + '\ntotal: ' + suites.reduce((a, s) => a + s.count, 0));
