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
 * New cases are always appended at the end of their suite, so earlier ids stay the same (1.7.0: 9-hole rounds and the
 * Consistency Factor, with 9-hole rounds in their own fixture, fixtures/nines.json).
 *   CASES_VERSION=1.7.0 node tests/golf-cases/generate.js <cases checkout>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const E = require(path.join(ROOT, 'engine.js'));
const C = require(path.join(ROOT, 'course.js'));
const ST = require(path.join(ROOT, 'strategy.js'));
const RU = require(path.join(ROOT, 'rules.js'));
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
  'no-hybrid': E.clone(E.DEFAULT_BAG).filter(c => c.id !== '5H'),
  // 1.2.0: bags with no wedge (the lay-up and short shots use the shortest club, full swing)
  'no-wedge': E.clone(E.DEFAULT_BAG).filter(c => c.type !== 'wedge'),
  'one-club': E.clone(E.DEFAULT_BAG).filter(c => c.id === '7i')
};
write('fixtures/bags.json', BAGS);
write('fixtures/course-melville-glades.json', COURSE);
write('fixtures/book-melville-glades.json', BOOK);
// 1.4.0: a map-built book (Phase 3, PR 11). Same holes, with every field that only a club course tour can give removed:
// no aim line, green slope, usual wind, extra hazards, tip, green note, links or name. Map data (lengths, elevation,
// green depth, doglegs, bunkers) stays. Real new-course books come from the converter in PR 12.
const TOUR_FIELDS = ['tip', 'greenNote', 'slope', 'drive', 'wind', 'extra', 'page', 'video', 'name'];
const MAP_BOOK = E.clone(BOOK);
MAP_BOOK.course = BOOK.course + ' (map-built test copy)';
MAP_BOOK.sources = BOOK.sources.filter(x => !/course tour/i.test(x));
MAP_BOOK.holes.forEach(h => TOUR_FIELDS.forEach(k => { delete h[k]; }));
write('fixtures/book-melville-glades-map.json', MAP_BOOK);
const BOOKS = { 'melville-glades': BOOK, 'melville-glades-map': MAP_BOOK };
// 1.5.0: real course books built from OpenStreetMap (spec Phase 3, PR 12). They are made by the Android repo's
// tools/build-book.js --assemble and kept in the cases repo (fixtures/course-books.json lists them), so this
// generator reads them from there rather than writing them. Their cases use the book's own pars and stroke indexes.
const COURSE_BOOKS_FILE = path.join(OUT, 'fixtures', 'course-books.json');
const COURSE_BOOKS = fs.existsSync(COURSE_BOOKS_FILE) ? JSON.parse(fs.readFileSync(COURSE_BOOKS_FILE, 'utf8')).books : [];
COURSE_BOOKS.forEach(cb => { BOOKS[cb.book] = JSON.parse(fs.readFileSync(path.join(OUT, 'fixtures', 'book-' + cb.book + '.json'), 'utf8')); });
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

/* 1.7.0: 9-hole rounds and the Consistency Factor (spec "9-hole rounds and the Consistency Factor", CAD-36, CAD-37, CAD-39).
 * The nines George's 9-hole ratings were checked on in MiScore (CAD-39, 25 Nov 2026), at his default tees, with the daily
 * handicap MiScore gave him at GA 16.6. The generator stops if the formula doesn't give MiScore's number. */
const GA_NOW = 16.6;
const CAD39 = [
  { name: 'Melville Glades front nine (Melville Blue 1-9)', par: 36, scratch: 36, slope: 127, miScore: 9 },
  { name: 'Melville Glades back nine (Melville Blue 10-18)', par: 36, scratch: 36, slope: 121, miScore: 8 },
  { name: 'Wembley Old front nine (Green Hole 1-9)', par: 36, scratch: 34.5, slope: 121, miScore: 7 },
  { name: 'Wembley Old back nine (Green Hole 10-18)', par: 36, scratch: 34.5, slope: 112, miScore: 6 },
  { name: 'Wembley Tuart front nine (Green Hole 1-9)', par: 35, scratch: 33.5, slope: 114, miScore: 6 },
  { name: 'Wembley Tuart back nine (Green Hole 10-18)', par: 35, scratch: 33, slope: 110, miScore: 6 },
  { name: 'Marangaroo front nine (Blue Hole 1-9)', par: 36, scratch: 34.5, slope: 108, miScore: 6 },
  { name: 'Marangaroo back nine (Blue Hole 10-18)', par: 36, scratch: 34, slope: 104, miScore: 5 },
  { name: 'Point Walter, one time round (Blue Hole 1-9)', par: 35, scratch: 33.5, slope: 115, miScore: 6 },
  { name: 'Fremantle Public, one time round (Blue Hole 1-9)', par: 34, scratch: 31, slope: 108, miScore: 5 },
  { name: 'Collier Park Pines (Pines White)', par: 36, scratch: 35.5, slope: 117, miScore: 8 },
  { name: 'Collier Park Island (Island White)', par: 36, scratch: 36, slope: 127, miScore: 9 },
  { name: 'Collier Park Lake (Lakes White)', par: 35, scratch: 34.5, slope: 119, miScore: 8 }
];
// the checked 18-hole tee sets of Phase 3 (CAD-32) with MiScore's daily handicap at GA 16.6 (Wembley Tuart Green 12 needs the factor)
const TEES32 = [
  { name: 'Melville Glades Blue Men', slope: 124, scratch: 72, par: 72, miScore: 17 },
  { name: 'Wembley Old Green', slope: 116, scratch: 69, par: 72, miScore: 13 },
  { name: 'Wembley Tuart Green', slope: 112, scratch: 67, par: 70, miScore: 12 },
  { name: 'Point Walter Blue (the 9 twice)', slope: 115, scratch: 68, par: 70, miScore: 14 },
  { name: 'Fremantle Public Blue (the 9 twice)', slope: 108, scratch: 62, par: 68, miScore: 9 },
  { name: 'Marangaroo Blue', slope: 106, scratch: 69, par: 72, miScore: 12 },
  { name: 'Collier Park White, Pines + Island', slope: 122, scratch: 72, par: 72, miScore: 17 },
  { name: 'Collier Park White, Pines + Lake', slope: 118, scratch: 70, par: 71, miScore: 15 },
  { name: 'Collier Park White, Island + Lake', slope: 123, scratch: 71, par: 71, miScore: 17 }
];
CAD39.forEach(x => { const d = E.dailyHandicap9(GA_NOW, x.slope, x.scratch, x.par); if (d !== x.miScore) throw new Error(x.name + ': 9-hole formula gives ' + d + ', MiScore ' + x.miScore); });
TEES32.forEach(x => { const d = E.dailyHandicap(GA_NOW, x.slope, x.scratch, x.par); if (d !== x.miScore) throw new Error(x.name + ': formula gives ' + d + ', MiScore ' + x.miScore); });
const nineDH = name => CAD39.filter(x => x.name.indexOf(name) === 0)[0].miScore;
// the nines with their 18-hole stroke indexes: Melville from the card, Point Walter's first time round and Collier Pines
// (Pines + Island order, decision 13 confirmed in MiScore) from the Perth course books
const NINE_SI = {
  'melville-front': E.COURSE.si.slice(0, 9), 'melville-back': E.COURSE.si.slice(9, 18),
  'point-walter': BOOKS['point-walter'] ? BOOKS['point-walter'].holes.slice(0, 9).map(h => h.si) : null,
  'collier-pines': BOOKS['collier-park-pines-island'] ? BOOKS['collier-park-pines-island'].holes.slice(0, 9).map(h => h.si) : null
};
const NINE_PARS = {
  'melville-front': E.COURSE.pars.slice(0, 9), 'melville-back': E.COURSE.pars.slice(9, 18),
  'point-walter': BOOKS['point-walter'] ? BOOKS['point-walter'].holes.slice(0, 9).map(h => h.par) : null,
  'collier-pines': BOOKS['collier-park-pines-island'] ? BOOKS['collier-park-pines-island'].holes.slice(0, 9).map(h => h.par) : null
};
// 9-hole rounds (fixtures/nines.json). Kept out of fixtures/rounds.json, because the existing analysis and strategy cases read
// every round there. Each round keeps 18 hole entries in order with the other nine blank, as both apps store it (format 1.3).
function synthNine(key, o) {
  let s = o.seed; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const g = E.nineRange(o.nine), pars = o.pars18, sis = o.si18;
  const strokes = E.strokesOnNine(o.dailyHcp, sis.slice(g[0], g[1]));
  const holes = pars.map((par, i) => {
    const blank = { n: i + 1, par, si: sis[i], score: null, putts: null, approach: null, upDown: null, sand: 0, penalties: 0, wasted: 0 };
    if (i < g[0] || i >= g[1]) return blank;
    const gir = rnd() < 0.35, putts = gir ? (rnd() < 0.2 ? 3 : rnd() < 0.3 ? 1 : 2) : (rnd() < 0.15 ? 3 : rnd() < 0.4 ? 1 : 2);
    const score = Math.max(2, par + (gir ? putts - 2 : 1 + Math.floor(rnd() * 3)) + (rnd() < 0.08 ? 1 : 0));
    const h = Object.assign(blank, { score, putts, gir,
      fairway: par >= 4 ? ['hit', 'left', 'right'][Math.floor(rnd() * 3)] : null,
      approach: gir ? 'hit' : APPR[Math.floor(rnd() * APPR.length)],
      upDown: gir ? null : rnd() < 0.3, sand: rnd() < 0.15 ? 1 : 0, penalties: rnd() < 0.12 ? 1 : 0, wasted: rnd() < 0.35 ? 1 : 0,
      firstPutt: gir ? E.PUTT_BANDS[Math.floor(rnd() * 5)][0] : null });
    if (h.approach === 'hit' && !gir) h.approach = 'short';
    if (h.sand) h.sandSave = rnd() < 0.3;
    if ((o.pickups || []).indexOf(i + 1) >= 0) {   // picked up: net double bogey, 0 points, putts kept (as an imported MiScore card)
      Object.assign(h, { pickup: true, score: par + 2 + strokes[i - g[0]], fairway: null, approach: null, upDown: null, sandSave: null, gir: false, firstPutt: null });
    }
    h.points = h.pickup ? 0 : E.stablefordPoints(par, h.score, strokes[i - g[0]]);
    return h;
  });
  return { id: o.date + 'T07:30:00.000Z', date: o.date, courseId: o.courseId, nine: o.nine, dailyHcp: o.dailyHcp, holes };
}
const NINE_ROUNDS = {};
if (NINE_SI['point-walter'] && NINE_SI['collier-pines']) {
  const pw = BOOKS['point-walter'].holes, cp = BOOKS['collier-park-pines-island'].holes;
  [
    ['melville-front', { date: '2026-11-29', courseId: 'melville-glades', nine: 'front', pars18: E.COURSE.pars, si18: E.COURSE.si, dailyHcp: nineDH('Melville Glades front'), seed: 4321 }],
    ['melville-back', { date: '2026-12-02', courseId: 'melville-glades', nine: 'back', pars18: E.COURSE.pars, si18: E.COURSE.si, dailyHcp: nineDH('Melville Glades back'), seed: 5432 }],
    ['point-walter', { date: '2026-12-06', courseId: 'point-walter', nine: 'front', pars18: pw.map(h => h.par), si18: pw.map(h => h.si), dailyHcp: nineDH('Point Walter'), seed: 6543 }],
    ['collier-pines', { date: '2026-12-09', courseId: 'collier-park', nine: 'front', pars18: cp.map(h => h.par), si18: cp.map(h => h.si), dailyHcp: nineDH('Collier Park Pines'), seed: 7654 }],
    ['melville-back-pickups', { date: '2026-12-13', courseId: 'melville-glades', nine: 'back', pars18: E.COURSE.pars, si18: E.COURSE.si, dailyHcp: nineDH('Melville Glades back'), seed: 8765, pickups: [12, 16] }],
    ['melville-front-plus', { date: '2026-12-16', courseId: 'melville-glades', nine: 'front', pars18: E.COURSE.pars, si18: E.COURSE.si, dailyHcp: -1, seed: 9876 }]
  ].forEach(([key, o]) => { NINE_ROUNDS[key] = synthNine(key, o); });
  write('fixtures/nines.json', NINE_ROUNDS);
}

/* ---------- handicap ---------- */
{
  const cases = [];
  [-2, 0, 5.4, 9.9, 12, 16.9, 18.3, 24, 36, 54].forEach(ga => [[113, 72], [124, 72], [135, 71.2], [124, 74]].forEach(([slope, scratch]) => {
    cases.push({ fn: 'dailyHandicap', input: { ga, slope, scratch, par: 72 }, expected: E.dailyHandicap(ga, slope, scratch, 72) });
  }));
  [-4, -1, 0, 1, 9, 17, 18, 19, 27, 36, 40].forEach(dh => [1, 2, 9, 17, 18].forEach(si => {
    cases.push({ fn: 'strokesOnHole', input: { dailyHcp: dh, si }, expected: E.strokesOnHole(dh, si) });
  }));
  // 1.7.0 (added at the end so earlier ids stay the same). The Consistency Factor: input factor "men" or "women", missing = men.
  // The 40 cases above have no factor and give the same answers with the men's factor (checked 25 Nov 2026).
  TEES32.forEach(x => cases.push({ fn: 'dailyHandicap', input: { ga: GA_NOW, slope: x.slope, scratch: x.scratch, par: x.par }, expected: E.dailyHandicap(GA_NOW, x.slope, x.scratch, x.par), note: x.name + ' (CAD-32, MiScore ' + x.miScore + ')' }));
  const GRID_GA = [-2, 0, 5.4, 9.9, 12, 16.9, 18.3, 24, 36, 54], GRID18 = [[113, 72], [124, 72], [135, 71.2], [124, 74]];
  GRID_GA.forEach(ga => GRID18.forEach(([slope, scratch]) => {
    cases.push({ fn: 'dailyHandicap', input: { ga, slope, scratch, par: 72, factor: 'women' }, expected: E.dailyHandicap(ga, slope, scratch, 72, 'women') });
  }));
  // the first 10 inputs (GA 0.0 to 54.0 in steps of 0.1, then the 4 ratings above) where the men's factor moves the result across .5
  const crossing = [];
  for (let k = 0; k <= 540 && crossing.length < 10; k++) {
    const ga = k / 10;
    GRID18.forEach(([slope, scratch]) => {
      const plain = Math.round((ga * slope / 113 + (scratch - 72)) * 0.93);
      if (crossing.length < 10 && E.dailyHandicap(ga, slope, scratch, 72, 'men') !== plain) crossing.push({ ga, slope, scratch, plain });
    });
  }
  crossing.forEach(x => cases.push({ fn: 'dailyHandicap', input: { ga: x.ga, slope: x.slope, scratch: x.scratch, par: 72, factor: 'men' }, expected: E.dailyHandicap(x.ga, x.slope, x.scratch, 72, 'men'), note: x.plain + ' without the Consistency Factor' }));
  // GA's 9-hole daily handicap: the same GA values on 4 nine ratings at par 36, 10 with the women's factor, and the 13 checked nines
  const GRID9 = [[113, 36], [124, 36], [135, 35.5], [124, 37]];
  GRID_GA.forEach(ga => GRID9.forEach(([slope, scratch]) => {
    cases.push({ fn: 'dailyHandicap9', input: { ga, slope, scratch, par: 36 }, expected: E.dailyHandicap9(ga, slope, scratch, 36) });
  }));
  GRID_GA.forEach(ga => cases.push({ fn: 'dailyHandicap9', input: { ga, slope: 124, scratch: 36, par: 36, factor: 'women' }, expected: E.dailyHandicap9(ga, 124, 36, 36, 'women') }));
  CAD39.forEach(x => cases.push({ fn: 'dailyHandicap9', input: { ga: GA_NOW, slope: x.slope, scratch: x.scratch, par: x.par }, expected: E.dailyHandicap9(GA_NOW, x.slope, x.scratch, x.par), note: x.name + ' (CAD-39, MiScore ' + x.miScore + ')' }));
  // strokes on each hole of a nine, in the nine's 18-hole stroke index order (input si: the 9 holes' 18-hole SIs, in hole order)
  if (NINE_SI['point-walter']) [['melville-front', 'Melville Glades front nine'], ['melville-back', 'Melville Glades back nine'], ['point-walter', 'Point Walter, first time round'], ['collier-pines', 'Collier Park Pines, Pines + Island order']].forEach(([k, label]) => {
    [-2, -1, 0, 1, 4, 5, 8, 9, 10, 17, 18, 19].forEach(dh => cases.push({ fn: 'strokesOnNine', input: { dailyHcp: dh, si: NINE_SI[k] }, expected: E.strokesOnNine(dh, NINE_SI[k]), note: label }));
  });
  suite('handicap', 'Daily handicap (GA formula, from 1.7.0 with the Consistency Factor), the 9-hole daily handicap and strokes received per hole and on a nine', cases);
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
  // 1.7.0 (added at the end): 9-hole rounds from fixtures/nines.json (input nineRound), all 18 hole entries with the other nine blank
  Object.entries(NINE_ROUNDS).forEach(([key, r]) => {
    const s = E.roundSummary(r.holes);
    cases.push({ fn: 'roundSummary', input: { nineRound: key }, expected: pick(s, ['holes', 'statHoles', 'pickups', 'score', 'par', 'toPar', 'putts', 'gir', 'girPct', 'fw', 'fwHit', 'fwPct', 'ud', 'udMade', 'udPct',
      'sandAtt', 'sandSaved', 'sandShots', 'wasted', 'penalties', 'chipIns', 'points', 'puttsPerGir', 'miss', 'putting']) });
  });
  suite('rounds', 'Hole stats and round summaries (rounds from fixtures/rounds.json, holes with points already filled in; from 1.7.0 9-hole rounds from fixtures/nines.json, input nineRound)', cases);
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
  // 1.7.0 (added at the end): Last 5 nines (input nineRounds: keys in fixtures/nines.json), and each panel ignoring the other length
  function analysisExp(a) {
    const exp = { count: a.count, enough: a.enough };
    if (a.enough) {
      exp.roundsUsed = a.rounds.map(r => r.date);
      exp.avg = pick(a.avg, ['pts', 'gross', 'toPar', 'putts', 'three', 'ppg', 'girPct', 'fwPct', 'udPct', 'sandPct', 'pen', 'wasted', 'shortShare', 'leftShare', 'rightShare', 'putting']);
      exp.trendPts = a.trend.pts;
      exp.suggestions = a.suggestions.map(x => ({ key: x.key, shots: x.shots }));
    }
    return exp;
  }
  const nk = Object.keys(NINE_ROUNDS);
  [nk.slice(0, 0), nk.slice(0, 1), nk.slice(0, 2), nk.slice(0, 5), nk].forEach(ns => {
    cases.push({ fn: 'analyseNines', input: { nineRounds: ns, rounds: [], n: 5 }, expected: analysisExp(E.analyseNines(ns.map(k => NINE_ROUNDS[k]), 5)), tol: 0.05 });
  });
  cases.push({ fn: 'analyseNines', input: { nineRounds: nk, rounds: keys, n: 5 }, expected: analysisExp(E.analyseNines(nk.map(k => NINE_ROUNDS[k]).concat(keys.map(k => ROUNDS[k])), 5)), tol: 0.05 });
  [keys, keys.slice(0, 2)].forEach(ks => {
    cases.push({ fn: 'analyseRounds', input: { rounds: ks, nineRounds: nk, n: 5 }, expected: analysisExp(E.analyseRounds(ks.map(k => ROUNDS[k]).concat(nk.map(k => NINE_ROUNDS[k])), 5)), tol: 0.05 });
  });
  suite('analysis', 'Last 5 rounds analysis: averages, trend and top-3 suggestions; from 1.7.0 Last 5 nines (analyseNines, input nineRounds from fixtures/nines.json), each ignoring rounds of the other length', cases);
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
  ['bogey', 'points', 'attack'].forEach(mode => ['default', 'long-hitter', 'no-hybrid'].forEach(bag => [17, 5].forEach(dh => configs.push({ mode, bag, dh, rounds: 'none', noElevation: false }))));
  ['bogey', 'points', 'attack'].forEach(mode => configs.push({ mode, bag: 'default', dh: 17, rounds: 'all', noElevation: false }, { mode, bag: 'default', dh: 17, rounds: 'miscore', noElevation: true }));
  // 1.2.0 (added at the end so earlier case ids stay the same): no wedge in the bag, and a bag of 1 club
  ['bogey', 'points', 'attack'].forEach(mode => ['no-wedge', 'one-club'].forEach(bag => [17, 5].forEach(dh => configs.push({ mode, bag, dh, rounds: 'none', noElevation: false }))));
  // 1.4.0 (added at the end): the map-built book, so the plan on a course without a yardage book is pinned down
  ['bogey', 'points', 'attack'].forEach(mode => ['default', 'long-hitter', 'no-hybrid'].forEach(bag => [17, 5].forEach(dh => configs.push({ mode, bag, dh, rounds: 'none', noElevation: false, book: 'melville-glades-map' }))));
  // 1.5.0 (added at the end): the Perth course books, default bag, in 3 modes at the daily handicap there and 5
  COURSE_BOOKS.forEach(cb => ['bogey', 'points', 'attack'].forEach(mode => [cb.dailyHcp, 5].forEach(dh => configs.push({ mode, bag: 'default', dh, rounds: 'none', noElevation: false, book: cb.book, parsSi: 'book' }))));
  // 1.7.0 (added at the end): plans on a nine (input nine, dailyHcp = the 9-hole daily handicap, strokes as strokesOnNine) on the
  // Melville book's front and back nines and Point Walter's one time round, at George's checked 9-hole daily handicap there and 3;
  // then Wembley Tuart at its new 12 with the Consistency Factor (fixtures/course-books.json keeps 13, so the 1.5.0 cases stay as they were)
  if (BOOKS['point-walter']) {
    [['melville-glades', 'front', nineDH('Melville Glades front'), false], ['melville-glades', 'back', nineDH('Melville Glades back'), false], ['point-walter', 'front', nineDH('Point Walter'), true]]
      .forEach(([book, nine, dh9, own]) => ['bogey', 'points', 'attack'].forEach(mode => [dh9, 3].forEach(dh => {
        const cfg = { mode, bag: 'default', dh, rounds: 'none', noElevation: false, book, nine };
        if (own) cfg.parsSi = 'book';
        configs.push(cfg);
      })));
  }
  if (BOOKS['wembley-tuart']) {
    const tuart = E.dailyHandicap(GA_NOW, 112, 67, 70);   // 12 (13 without the Consistency Factor)
    ['bogey', 'points', 'attack'].forEach(mode => configs.push({ mode, bag: 'default', dh: tuart, rounds: 'none', noElevation: false, book: 'wembley-tuart', parsSi: 'book' }));
  }
  configs.forEach(cfg => {
    const bookId = cfg.book || 'melville-glades';
    const ownCard = cfg.parsSi === 'book'; // the book's own pars and stroke indexes, not Melville's card
    const st = ST.buildStrategy({ book: BOOKS[bookId], bag: BAGS[cfg.bag], mode: cfg.mode, dailyHcp: cfg.dh, pars: ownCard ? [] : E.COURSE.pars, si: ownCard ? [] : E.COURSE.si,
      rounds: roundSets[cfg.rounds].map(k => ROUNDS[k]), strokesOnHole: E.strokesOnHole, dailyHcpFor: r => r.dailyHcp, thoughts: [], noElevation: cfg.noElevation,
      nine: cfg.nine, strokesOnNine: E.strokesOnNine });
    st.holes.forEach(h => {
      const input = { book: bookId, bag: cfg.bag, mode: cfg.mode, dailyHcp: cfg.dh, rounds: cfg.rounds, noElevation: cfg.noElevation, hole: h.n };
      if (ownCard) input.parsSi = 'book';
      if (cfg.nine) input.nine = cfg.nine;
      cases.push({ fn: 'buildStrategy.hole', input,
        expected: { target: h.target, strokes: h.strokes, miss: h.miss, reached: h.reached, rise: h.rise, shots: h.shots.map(x => ({ kind: x.kind, club: x.club })) } });
    });
  });
  suite('strategy', 'Course strategy per hole: target, handicap shots, shot plan (kind + club) and safe miss. Wording is not compared. Books: melville-glades, from 1.4.0 melville-glades-map (no aim line, slope, wind, extra hazards, tips or green notes), and from 1.5.0 the Perth course books in fixtures/course-books.json (input parsSi "book": the book\'s own pars and stroke indexes). From 1.7.0 plans on a nine (input nine "front" or "back", dailyHcp the 9-hole daily handicap, the nine\'s strokes as strokesOnNine).', cases);
}

/* ---------- rules (1.1.0) ---------- */
{
  const cases = [];
  const sets = ['social', 'competition', 'club-champs-2027', '', 'toString'];      // the last three are unknown -> treated as competition
  const feats = RU.FEATURES.concat(['aiSwingCoach', 'toString']);                    // unknown features -> never allowed
  sets.forEach(rs => feats.forEach(f => cases.push({ fn: 'rulesAllows', input: { ruleSet: rs, feature: f }, expected: RU.allows(rs, f) })));
  suite('rules', 'Which features each rule set allows (Rule 4.3 competition, social). Unknown rule sets are treated as competition; unknown features are never allowed.', cases);
}

/* ---------- index ---------- */
write('cases/index.json', { format: 1, version: process.env.CASES_VERSION || '1.0.0', generatedFrom: 'caddy4me prototype ' + (VERSION && VERSION.v ? 'v' + VERSION.v : ''), generatedAt: new Date().toISOString().slice(0, 10), suites });
console.log(suites.map(s => s.suite + ': ' + s.count).join('\n') + '\ntotal: ' + suites.reduce((a, s) => a + s.count, 0));
