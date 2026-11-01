// Run: node tests/engine.test.js
const E = require('../engine.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion'); }
const calm = { head: 0, cross: 0 };
const rec = (o) => E.recommend(Object.assign({ mode: 'approach', wind: calm, lie: 'fairway', ground: 'normal' }, o));

// --- geo
t('distance ~111m per 0.001 deg lat', () => { const d = E.distanceM({ lat: -32, lon: 115.8 }, { lat: -32.001, lon: 115.8 }); ok(Math.abs(d - 111.2) < 0.5, d); });
t('bearing north = 0', () => { ok(Math.abs(E.bearingDeg({ lat: -32, lon: 115.8 }, { lat: -31.99, lon: 115.8 })) < 0.01); });
t('bearing east = 90', () => { ok(Math.abs(E.bearingDeg({ lat: -32, lon: 115.8 }, { lat: -32, lon: 115.81 }) - 90) < 0.1); });

// --- wind
t('wind from target = headwind', () => { const w = E.windFromLive(20, 90, 90); ok(Math.abs(w.head - 20) < 1e-9); ok(Math.abs(w.cross) < 1e-9); });
t('wind from behind = tail', () => { const w = E.windFromLive(20, 270, 90); ok(Math.abs(w.head + 20) < 1e-9); });
t('wind from right of line', () => { const w = E.windFromLive(20, 180, 90); ok(w.cross > 19.9, w.cross); }); // facing east, south is right
t('relative 270 = from left', () => { const w = E.windFromRelative(10, 270); ok(w.cross < -9.9); });
t('label calm', () => eq(E.windLabel({ head: 1, cross: 1 }), 'Calm'));

// --- spec worked check
t('140m calm fairway normal -> 6 iron full', () => { const r = rec({ distance: 140 }); eq(r.club.name, '6 Iron'); eq(r.swing, 'full'); eq(r.playsLike, 140); });
t('between clubs leans longer: 142 -> 5 iron', () => { eq(rec({ distance: 142 }).club.name, '5 Iron'); });
t('exact 7 iron 128 (E=128)', () => { eq(rec({ distance: 128 }).club.name, '7 Iron'); });
t('headwind 20 km/h at 120 -> +12% = 134 -> 6 iron', () => { const r = rec({ distance: 120, wind: { head: 20, cross: 0 } }); eq(r.playsLike, 134); eq(r.club.name, '6 Iron'); ok(r.reasons[0].indexOf('Into wind +14') === 0, r.reasons[0]); });
t('tailwind 20 at 140 -> -6% = 132 -> 6 iron', () => { const r = rec({ distance: 140, wind: { head: -20, cross: 0 } }); eq(r.playsLike, 132); eq(r.club.name, '6 Iron'); });
t('wind cap 25%', () => { eq(rec({ distance: 100, wind: { head: 80, cross: 0 } }).playsLike, 125); });
t('crosswind from right -> aim right', () => { const r = rec({ distance: 150, wind: { head: 0, cross: 20 } }); eq(r.aim, 'Aim 5 m right'); });
t('crosswind from left -> aim left', () => { const r = rec({ distance: 150, wind: { head: 0, cross: -20 } }); eq(r.aim, 'Aim 5 m left'); });
t('small drift no aim note', () => { eq(rec({ distance: 60, wind: { head: 0, cross: 10 } }).aim, ''); });
t('heavy rough +10% excludes woods', () => { const r = rec({ distance: 180, lie: 'heavyRough' }); ok(r.club.type !== 'wood'); eq(r.club.name, '5 Hybrid'); ok(r.warning.indexOf('Out of reach') === 0); });
t('bunker irons only', () => { const r = rec({ distance: 150, lie: 'bunker' }); eq(r.club.type, 'iron'); });
t('light rough 130 -> 134 -> 6 iron', () => { const r = rec({ distance: 130, lie: 'lightRough' }); eq(r.playsLike, 134); eq(r.club.name, '6 Iron'); });
t('firm adds release note', () => { const r = rec({ distance: 150, ground: 'firm' }); ok(r.notes.some(n => n.indexOf('Firm: land it') === 0), r.notes.join('|')); });
t('soft uses carry only: 139 -> 5 iron', () => { eq(rec({ distance: 139, ground: 'soft' }).club.name, '5 Iron'); });
t('out of reach 230 -> driver + layup', () => { const r = rec({ distance: 230 }); eq(r.club.name, 'Driver'); ok(r.warning.indexOf('Out of reach') === 0); ok(r.notes.some(n => n.indexOf('lay up 137 m') >= 0), r.notes.join('|')); });
t('up/down alternatives', () => { const r = rec({ distance: 140 }); eq(r.up.name, '5 Iron'); eq(r.down.name, '7 Iron'); });

// --- partials
t('66m -> U wedge 3/4', () => { const r = rec({ distance: 66 }); eq(r.club.id, 'UW'); eq(r.swing, '3/4'); });
t('60m -> PW 1/2', () => { const r = rec({ distance: 60 }); eq(r.club.id, 'PW'); eq(r.swing, '1/2'); });
t('52m -> U wedge 1/2', () => { const r = rec({ distance: 52 }); eq(r.club.id, 'UW'); eq(r.swing, '1/2'); });
t('74m -> PW 3/4 (79) nearer than UW 3/4 (66)', () => { const r = rec({ distance: 74 }); eq(r.club.id, 'PW'); eq(r.swing, '3/4'); });
t('78m -> full U wedge (not partial zone)', () => { const r = rec({ distance: 78 }); eq(r.club.id, 'UW'); eq(r.swing, 'full'); });
t('30m -> pitch', () => { const r = rec({ distance: 30 }); eq(r.swing, 'pitch'); eq(r.club.id, 'UW'); });
t('edited partials used', () => { const bag = E.clone(E.DEFAULT_BAG); bag[9].partials['1/2'] = 40; const r = rec({ distance: 58, bag }); eq(r.club.id, 'PW'); eq(r.swing, '1/2'); });

// --- tee
t('tee 220 landing -> driver', () => { const r = E.recommend({ mode: 'tee', distance: 220, wind: calm, ground: 'normal' }); eq(r.club.name, 'Driver'); eq(r.warning, ''); });
t('tee 190 landing -> 5 wood, driver runs through', () => { const r = E.recommend({ mode: 'tee', distance: 190, wind: calm, ground: 'normal' }); eq(r.club.name, '5 Wood'); eq(r.warning, 'Driver runs through by 19 m'); });
t('tee 190 firm -> hybrid (5W total 198 > 195)', () => { const r = E.recommend({ mode: 'tee', distance: 190, wind: calm, ground: 'firm' }); eq(r.club.name, '5 Hybrid'); });
t('tee 190 into 20 km/h -> P 213 -> driver ok', () => { const r = E.recommend({ mode: 'tee', distance: 190, wind: { head: 20, cross: 0 }, ground: 'normal' }); eq(r.club.name, 'Driver'); eq(r.warning, ''); });
t('tee ignores lie', () => { const r = E.recommend({ mode: 'tee', distance: 220, wind: calm, lie: 'bunker', ground: 'normal' }); eq(r.club.name, 'Driver'); });

// --- stats
t('GIR par4 score4 putts2', () => { ok(E.holeStats({ par: 4, score: 4, putts: 2 }).gir); });
t('no GIR par4 score5 putts2', () => { ok(!E.holeStats({ par: 4, score: 5, putts: 2 }).gir); });
t('GIR par3 score4 putts3 (3-putt)', () => { const s = E.holeStats({ par: 3, score: 4, putts: 3 }); ok(s.gir); eq(s.threePutts, 1); });
t('up&down made', () => { const s = E.holeStats({ par: 4, score: 4, putts: 1, upDown: true }); ok(s.upDownAttempt && s.upDownMade); });
t('sand save', () => { const s = E.holeStats({ par: 4, score: 4, putts: 1, sand: 1, upDown: true }); ok(s.sandSaveAttempt && s.sandSaved); });
t('sand no save', () => { const s = E.holeStats({ par: 4, score: 6, putts: 2, sand: 2, upDown: false }); ok(s.sandSaveAttempt && !s.sandSaved); });
t('suggest up&down', () => { ok(E.suggestUpDown({ par: 4, score: 4, putts: 1 })); ok(!E.suggestUpDown({ par: 4, score: 5, putts: 1 })); });
t('default wasted from 3-putt', () => { eq(E.defaultWasted(3), 1); eq(E.defaultWasted(2), 0); });
t('round summary', () => {
  const holes = [
    { par: 4, score: 4, putts: 2, approach: 'green' },
    { par: 3, score: 4, putts: 1, approach: 'short', upDown: false, sand: 1, wasted: 1 },
    { par: 5, score: 5, putts: 1, approach: 'left', upDown: true, penalties: 1 },
    { par: 4, score: null }
  ];
  const s = E.roundSummary(holes);
  eq(s.holes, 3); eq(s.score, 13); eq(s.toPar, 1); eq(s.gir, 1); eq(s.girPct, 33); eq(s.ud, 2); eq(s.udMade, 1); eq(s.udPct, 50);
  eq(s.sandAtt, 1); eq(s.sandPct, 0); eq(s.penalties, 1); eq(s.wasted, 1); eq(s.miss.left, 1); eq(s.puttsPerGir, 2);
});

// --- v0.2: Stableford + new stats
t('GA 16.9, slope 124, scratch 72: daily handicap = 17', () => eq(E.dailyHandicap(16.9, 124, 72, 72), 17));
t('daily handicap scratch 0 slope 113 = 0', () => eq(E.dailyHandicap(0, 113, 72, 72), 0));
t('daily handicap 30.0 slope 124 rating 70 par 72', () => eq(E.dailyHandicap(30, 124, 70, 72), 29)); // (32.92-2)*.93=28.76
t('DH 17: SI 17 gets a stroke, SI 18 none', () => { eq(E.strokesOnHole(17, 17), 1); eq(E.strokesOnHole(17, 18), 0); });
t('DH 20: SI 1-2 get 2 strokes', () => { eq(E.strokesOnHole(20, 2), 2); eq(E.strokesOnHole(20, 3), 1); });
t('DH 0: no strokes', () => eq(E.strokesOnHole(0, 1), 0));
t('plus 2: SI 17 and 18 give a stroke back', () => { eq(E.strokesOnHole(-2, 17), -1); eq(E.strokesOnHole(-2, 16), 0); });
t('points: par 4, 1 stroke, score 5 = 2', () => eq(E.stablefordPoints(4, 5, 1), 2));
t('points: par 4, 1 stroke, score 4 = 3', () => eq(E.stablefordPoints(4, 4, 1), 3));
t('points: blob = 0, never negative', () => eq(E.stablefordPoints(4, 9, 1), 0));
t('course data sums to par 72, SI 1-18 unique', () => {
  eq(E.COURSE.pars.reduce((a, b) => a + b, 0), 72);
  eq(E.COURSE.si.slice().sort((a, b) => a - b).join(','), Array.from({ length: 18 }, (_, i) => i + 1).join(','));
});
t('fairway stats ignore par 3s', () => {
  const s = E.roundSummary([
    { par: 4, score: 4, putts: 2, fairway: 'hit', points: 3 },
    { par: 5, score: 6, putts: 2, fairway: 'left', points: 2 },
    { par: 3, score: 3, putts: 2, fairway: 'hit', points: 2 }]);
  eq(s.fw, 2); eq(s.fwHit, 1); eq(s.fwPct, 50); eq(s.points, 7);
});
t('explicit sand save toggle', () => {
  eq(E.holeStats({ par: 4, score: 4, putts: 1, sand: 1, upDown: true, sandSave: false }).sandSaved, false);
  eq(E.holeStats({ par: 4, score: 4, putts: 1, sand: 1, upDown: true, sandSave: true }).sandSaved, true);
});
t('9-way approach + old "green" maps to hit', () => {
  const s = E.roundSummary([{ par: 4, score: 4, putts: 2, approach: 'green' }, { par: 4, score: 5, putts: 2, approach: 'shortRight' }]);
  eq(s.miss.hit, 1); eq(s.miss.shortRight, 1);
});
t('chip-ins counted', () => eq(E.roundSummary([{ par: 4, score: 4, putts: 0, chipIn: true }]).chipIns, 1));

// --- import scores + pick-ups
t('pick-up counts for score and points only', () => {
  const s = E.roundSummary([{ par: 4, score: 4, putts: 2, points: 3 }, { par: 3, score: 6, putts: null, pickup: true, points: 0 }]);
  eq(s.holes, 2); eq(s.score, 10); eq(s.points, 3); eq(s.statHoles, 1); eq(s.girPct, 100); eq(s.pickups, 1); eq(s.putts, 2);
});
t('mergeScores keeps other stats', () => {
  const r = { holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, score: i === 0 ? 5 : null, fairway: i === 0 ? 'hit' : null, sand: i === 0 ? 1 : 0 })) };
  const f = { holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, score: 4, putts: 2, points: 3, pickup: false })), dailyHcp: 17, source: 'MiScore card' };
  eq(E.mergeScores(r, f), 18); eq(r.holes[0].score, 4); eq(r.holes[0].fairway, 'hit'); eq(r.holes[0].sand, 1); eq(r.done, true); eq(r.dailyHcp, 17);
});
t('real 18 Oct scores file: 33 pts, 92 strokes', () => {
  const f = require('./fixtures/scores/caddy4me-scores-2026-10-18.json');
  const s = E.roundSummary(f.holes); eq(s.points, 33); eq(s.score, 92); eq(s.pickups, 2); eq(s.putts, 34);
});

t('Blue Men SI: unique 1-18, hole 5 is SI 18, hole 12 is SI 1', () => {
  eq(E.COURSE.si.slice().sort((a, b) => a - b).join(','), Array.from({ length: 18 }, (_, i) => i + 1).join(','));
  eq(E.COURSE.si[4], 18); eq(E.COURSE.si[11], 1);
});
t('DH 17 on Blue Men: shot on every hole except 5 (matches MiScore card)', () => {
  const shots = E.COURSE.si.map(si => E.strokesOnHole(17, si));
  eq(shots.join(''), '111101111111111111');
});
t('18 Oct points recompute from SI = card points', () => {
  const f = require('./fixtures/scores/caddy4me-scores-2026-10-18.json');
  f.holes.forEach(h => { if (!h.pickup) eq(E.stablefordPoints(h.par, h.score, E.strokesOnHole(17, h.si)), h.points, 'hole ' + h.n); });
});

// --- v0.5: last 5 rounds analysis
const mkRound = (id, date, f) => ({ id, date, holes: Array.from({ length: 18 }, (_, i) => Object.assign({ n: i + 1, par: 4, score: 5, putts: 2, points: 2, sand: 0, penalties: 0, wasted: 0 }, f(i))) });
const good = i => ({ score: 4, putts: 2, points: 3, gir: true, fairway: 'hit', approach: 'hit' });
const leaky = i => ({ score: 6, putts: i < 3 ? 3 : 2, points: 1, gir: false, fairway: i % 3 ? 'left' : 'hit', approach: i % 2 ? 'short' : 'shortLeft', upDown: false, penalties: i < 3 ? 1 : 0, wasted: i < 3 ? 2 : 0 });
t('needs 2 finished rounds', () => { const a = E.analyseRounds([mkRound('a', '2026-10-01', good)]); eq(a.enough, false); eq(a.count, 1); });
t('unfinished rounds ignored', () => {
  const part = mkRound('p', '2026-10-05', good); part.holes[17].score = null;
  const a = E.analyseRounds([mkRound('a', '2026-10-01', good), part, mkRound('b', '2026-10-02', good)]); eq(a.count, 2);
});
t('only the last 5 finished rounds, oldest first', () => {
  const rs = ['01', '02', '03', '04', '05', '06', '07'].map(d => mkRound('r' + d, '2026-10-' + d, good));
  const a = E.analyseRounds(rs); eq(a.count, 5); eq(a.rounds[0].date, '2026-10-03'); eq(a.rounds[4].date, '2026-10-07');
});
t('good rounds: averages and no suggestions', () => {
  const a = E.analyseRounds([mkRound('a', '2026-10-01', good), mkRound('b', '2026-10-02', good)]);
  eq(a.avg.pts, 54); eq(a.avg.gross, 72); eq(a.avg.girPct, 100); eq(a.avg.fwPct, 100); eq(a.suggestions.length, 0);
});
t('leaky rounds: top 3 suggestions ranked by shots', () => {
  const a = E.analyseRounds([mkRound('a', '2026-10-01', leaky), mkRound('b', '2026-10-02', leaky), mkRound('c', '2026-10-03', leaky)]);
  eq(a.avg.three, 3); eq(a.avg.pen, 3); eq(a.avg.wasted, 6); eq(a.avg.shortShare, 100); eq(a.avg.udPct, 0);
  eq(a.suggestions.length, 3);
  ok(a.suggestions[0].shots >= a.suggestions[1].shots && a.suggestions[1].shots >= a.suggestions[2].shots, 'sorted');
  ok(a.suggestions.every(s => s.tip && s.detail), 'each has a tip');
});
t('trend: last round vs earlier average', () => {
  const a = E.analyseRounds([mkRound('a', '2026-10-01', leaky), mkRound('b', '2026-10-02', good)]); eq(a.trend.pts, 54 - 18);
});
t('pick-ups excluded from 3-putts', () => {
  const r = mkRound('a', '2026-10-01', i => (i === 0 ? { pickup: true, putts: 3, points: 0 } : good(i)));
  const a = E.analyseRounds([r, mkRound('b', '2026-10-02', good)]); eq(a.rounds[0].three, 0);
});

// ---------- v0.7 first putt length ----------
t('putt bands defined', () => eq(E.PUTT_BANDS.map(b => b[0]).join(','), '0-3,3-6,6-10,10-20,20+'));
t('round summary: putting table by band, GIR holes only', () => {
  const hs = [
    { n: 1, par: 4, score: 4, putts: 2, gir: true, firstPutt: '10-20' },
    { n: 2, par: 4, score: 5, putts: 3, gir: true, firstPutt: '10-20' },
    { n: 3, par: 3, score: 2, putts: 1, gir: true, firstPutt: '0-3' },
    { n: 4, par: 4, score: 5, putts: 1, gir: false, firstPutt: '0-3' },        // not a GIR: ignored
    { n: 5, par: 4, score: 6, putts: 3, pickup: true, gir: true, firstPutt: '20+' }, // pick-up: ignored
    { n: 6, par: 4, score: 4, putts: 2, gir: true }                              // no length: ignored
  ];
  const s = E.roundSummary(hs);
  eq(s.putting['10-20'].n, 2); eq(s.putting['10-20'].putts, 5); eq(s.putting['10-20'].three, 1);
  eq(s.putting['0-3'].n, 1); eq(s.putting['0-3'].one, 1); eq(s.putting['20+'].n, 0);
});
const lagR = i => ({ score: 5, putts: i < 4 ? 3 : 2, points: 2, gir: true, firstPutt: i < 6 ? '10-20' : '3-6' });
t('lag putting suggestion from 10 m+ three-putts', () => {
  const a = E.analyseRounds([mkRound('a', '2026-10-01', lagR), mkRound('b', '2026-10-02', lagR)]);
  eq(a.avg.putting['10-20'].n, 12); eq(a.avg.putting['10-20'].three, 8);
  ok(a.suggestions.some(x => x.key === 'lag'), 'lag suggested');
});
t('short putt suggestion below 85% from 0-3 m', () => {
  const sr = i => ({ score: 4, putts: i < 3 ? 2 : 1, points: 3, gir: true, firstPutt: i < 6 ? '0-3' : null });
  const a = E.analyseRounds([mkRound('a', '2026-10-01', sr), mkRound('b', '2026-10-02', sr)]);
  const x = a.suggestions.find(x => x.key === 'shortputt'); ok(x, 'short putts suggested'); ok(/50% holed/.test(x.detail), x && x.detail);
});
t('no putting-distance suggestions without lengths', () => {
  const a = E.analyseRounds([mkRound('a', '2026-10-01', good), mkRound('b', '2026-10-02', good)]);
  ok(!a.suggestions.some(x => x.key === 'lag' || x.key === 'shortputt'));
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
