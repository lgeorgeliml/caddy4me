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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
