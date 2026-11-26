// Run: node tests/strategy.test.js
const St = require('../strategy.js'), E = require('../engine.js'), B = require('../course-book.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected true'); }
const bag = () => E.clone(E.DEFAULT_BAG);
const build = (o) => St.buildStrategy(Object.assign({ book: B, bag: bag(), mode: 'bogey', dailyHcp: 17, pars: E.COURSE.pars, si: E.COURSE.si, rounds: [], strokesOnHole: E.strokesOnHole }, o || {}));
const hole = (st, n) => st.holes[n - 1];
const clubs = (h) => h.shots.map(x => x.club);

// ---------- yardage book data ----------
t('book has 18 holes with Members distances', () => { eq(B.holes.length, 18); ok(B.holes.every(h => h.m > 100 && h.tees.members === h.m)); });
t('book pars match the Blue Men card', () => eq(B.holes.map(h => h.par).join(','), E.COURSE.pars.join(',')));
t('book total is 6,061 m from the Members tee', () => eq(B.holes.reduce((a, h) => a + h.m, 0), 6061));
t('every hole has a tip, green note and video', () => ok(B.holes.every(h => h.tip && h.greenNote && /youtube/.test(h.video))));
t('hole 17 is downhill, hole 2 uphill', () => { ok(B.holes[16].elev.rise < 0); ok(B.holes[1].elev.rise > 0); });

// ---------- basics ----------
const sb = build();
t('builds 18 plans in Smart Bogey mode', () => { eq(sb.holes.length, 18); eq(sb.mode, 'bogey'); eq(sb.modeLabel, 'Smart Bogey Golf'); });
t('every plan has shots, a strip and a cue', () => ok(sb.holes.every(h => h.shots.length >= 1 && h.strip && h.cue)));
t('every plan reaches the green', () => ok(sb.holes.every(h => h.reached)));
t('par 3s start with a tee shot that is not a lay-up from a driver', () => ok([5, 9, 14, 17].every(n => hole(sb, n).shots[0].club !== 'Driver')));
t('unknown mode falls back to bogey', () => eq(build({ mode: 'zzz' }).mode, 'bogey'));
t('no bag -> null', () => eq(build({ bag: [] }), null));

// ---------- handicap shots and targets ----------
t('daily 17: one shot everywhere except hole 5 (SI 18)', () => { eq(hole(sb, 5).strokes, 0); ok(sb.holes.filter(h => h.n !== 5).every(h => h.strokes === 1)); });
t('bogey target = par+1 with a shot, par without', () => { eq(hole(sb, 1).target, 5); eq(hole(sb, 5).target, 3); });
t('points target = net par', () => { const p = build({ mode: 'points' }); eq(hole(p, 1).target, 5); ok(/net par/.test(hole(p, 1).targetText)); });
t('attack target = par', () => eq(hole(build({ mode: 'attack' }), 1).target, 4));
t('daily 0: bogey mode targets par', () => eq(hole(build({ dailyHcp: 0 }), 1).target, 4));

// ---------- hazards and doglegs ----------
t('hole 4 bogey: driver stays in the bag (left bunker ~196 m)', () => { const h = hole(sb, 4); ok(h.shots[0].club !== 'Driver'); ok(/left bunker/.test(h.shots[0].text)); });
t('hole 10: driver would run through the dog-leg', () => { const h = hole(sb, 10); ok(h.shots[0].club !== 'Driver'); ok(/dog-leg/.test(h.shots[0].text)); });
t('hole 13 points: aiming left lets driver play past the right bunker', () => eq(hole(build({ mode: 'points' }), 13).shots[0].club, 'Driver'));
t('hole 13 bogey: driver stays in the bag', () => ok(hole(sb, 13).shots[0].club !== 'Driver'));
t('par 5 lay-up leaves about a full wedge', () => { const h = hole(sb, 2); ok(h.shots.some(x => x.kind === 'layup' && /full PW/.test(x.text))); });
t('hole 9 bogey: lays up short of the front bunkers', () => { const h = hole(sb, 9); eq(h.shots[0].kind, 'layup'); });
t('hole 9 attack: goes at the green', () => eq(hole(build({ mode: 'attack' }), 9).shots[0].kind, 'approach'));
t('elevation shows on uphill hole 2', () => ok(/uphill/.test(hole(sb, 2).shots.slice(-1)[0].text)));
t('noElevation (tournament) removes plays-like text', () => { const st = build({ noElevation: true }); ok(st.holes.every(h => h.shots.every(x => !/plays/.test(x.text)))); });

// ---------- safe miss ----------
t('back-to-front green with no front bunker: miss short (hole 11 has none)', () => eq(hole(sb, 11).miss, 'short'));
t('hole 1: front-right bunker -> miss left', () => eq(hole(sb, 1).miss, 'left'));
t('hole 5: bunkers all round -> no safe miss', () => { eq(hole(sb, 5).miss, null); ok(/No safe miss/.test(hole(sb, 5).missText)); });

// ---------- bag changes refresh the plan ----------
t('longer driver changes the plan on a short par 4', () => {
  const b = bag(); b[0].carry = 230; b[0].total = 255;
  const a = hole(sb, 11).strip, c = hole(build({ bag: b }), 11).strip;
  ok(a !== c, 'strip should change: ' + a + ' / ' + c);
});
t('bag signature changes with carry, total, partials and new clubs', () => {
  const s0 = St.bagSignature(bag());
  const b1 = bag(); b1[3].carry++; ok(St.bagSignature(b1) !== s0);
  const b2 = bag(); b2[8].partials['3/4']++; ok(St.bagSignature(b2) !== s0);
  const b3 = bag(); b3.push({ id: 'x1', name: '4 Hybrid', carry: 160, total: 175 }); ok(St.bagSignature(b3) !== s0);
});
t('a new club gets used', () => {
  const b = bag(); b.push({ id: 'x2', name: '3 Wood', carry: 172, total: 199 });
  ok(build({ bag: b, mode: 'attack' }).holes.some(h => h.shots.some(x => x.club === '3 Wood')));
});
t('removing the hybrid takes it out of every plan', () => {
  const b = bag().filter(c => c.id !== '5H');
  ok(build({ bag: b }).holes.every(h => h.shots.every(x => x.club !== '5 Hybrid')));
});
t('club type guessed for a typed-in club', () => eq(St.usable([{ name: '4 Hybrid', carry: 160, total: 175 }])[0].type, 'hybrid'));
t('short names', () => { eq(St.shortName({ name: '7 Iron' }), '7i'); eq(St.shortName({ name: '5 Wood' }), '5W'); eq(St.shortName({ name: 'Driver' }), 'Driver'); eq(St.shortName({ name: 'U Wedge' }), 'UW'); });

// ---------- history ----------
function round(date, f) {
  const holes = E.COURSE.pars.map((p, i) => ({ n: i + 1, par: p, si: E.COURSE.si[i], score: p + 1, putts: 2, fairway: 'hit', approach: null, penalties: 0, sand: 0 }));
  f && f(holes); return { id: date, date, dailyHcp: 17, holes };
}
const rounds = [round('2026-10-01', h => { h[6].fairway = 'right'; h[6].approach = 'short'; }), round('2026-10-08', h => { h[6].fairway = 'right'; h[6].approach = 'short'; }), round('2026-10-15', h => { h[4].putts = 3; })];
const sh = build({ rounds, dailyHcpFor: r => r.dailyHcp });
t('history counted per hole', () => { ok(/Played 3 times/.test(hole(sh, 7).history)); ok(/right 2/.test(hole(sh, 7).history)); });
t('repeated fairway misses drive the cue', () => ok(/missed right here 2 times/.test(hole(sh, 7).cue)));
t('repeated approach misses show in why', () => ok(hole(sh, 7).why.some(w => /short 2 times/.test(w))));
t('points worked out from daily handicap when missing', () => ok(/2 pts/.test(hole(sh, 1).history)));
t('pick-ups count for score only', () => {
  const r = round('2026-10-20', h => { h[2].pickup = true; h[2].fairway = 'left'; });
  const H = St.holeHistory([r], 3); eq(H.played, 1); eq(H.fwL, 0);
});
t('swing thoughts reused in cues', () => ok(build({ thoughts: ['Smooth tempo'] }).holes.some(h => /Smooth tempo/.test(h.cue))));

// ---------- v0.9: bags with no wedge (golf cases 1.2.0) ----------
const noWedge = () => bag().filter(c => c.type !== 'wedge');
t('no wedge: a plan for all 18 holes in every mode', () => ['bogey', 'points', 'attack'].forEach(m => { const p = build({ bag: noWedge(), mode: m }); eq(p.holes.length, 18); ok(p.holes.every(h => h.reached), m); }));
t('no wedge: lay-up leaves a full 9 iron, played with a full swing', () => {
  const h = hole(build({ bag: noWedge() }), 2);
  ok(/your full 9i \(105 m\)/.test(h.shots[1].text)); eq(h.shots[2].club, '9 Iron'); ok(/^9i to /.test(h.shots[2].text));
});
t('no wedge: short approaches never name a partial swing', () => ok(build({ bag: noWedge() }).holes.every(h => h.shots.every(x => !/[\u00be\u00bd]/.test(x.text)))));
t('one club: every shot is that club', () => ok(build({ bag: bag().filter(c => c.id === '7i') }).holes.every(h => h.shots.every(x => x.club === '7 Iron'))));
t('driver only: still a plan (no crash)', () => eq(build({ bag: bag().filter(c => c.id === 'D') }).holes.length, 18));

// ---------- map-built book (v0.10, golf cases 1.4.0): no aim line, slope, wind, extra hazards, tips or green notes ----------
const TOUR = ['tip', 'greenNote', 'slope', 'drive', 'wind', 'extra', 'page', 'video', 'name'];
const MB = E.clone(B); MB.holes.forEach(h => TOUR.forEach(k => { delete h[k]; }));
const mb = (o) => build(Object.assign({ book: MB }, o || {}));
t('map book: 18 plans, every one reaches the green', () => { const p = mb({ mode: 'points' }); eq(p.holes.length, 18); ok(p.holes.every(h => h.reached && h.cue)); });
t('map book: no Green line, no wind or extra-hazard warnings', () => { const p = mb(); ok(p.holes.every(h => h.green === '')); ok(p.holes.every(h => h.danger.every(d => !/Wind usually|Drop-off|carry only/.test(d)))); });
t('map book hole 4 points: no aim line, so aim away from the left bunker and keep the driver', () => {
  const h = hole(mb({ mode: 'points' }), 4); eq(h.shots[0].club, 'Driver'); ok(/aim right – away from the left bunker/.test(h.shots[0].text), h.shots[0].text); });
t('map book hole 13 attack: aim left, away from the right bunker', () => {
  const h = hole(mb({ mode: 'attack' }), 13); eq(h.shots[0].club, 'Driver'); ok(/aim left – away from the right bunker/.test(h.shots[0].text), h.shots[0].text); });
t('map book hole 4 bogey: still clubs down short of the bunker', () => { const h = hole(mb(), 4); ok(h.shots[0].club !== 'Driver'); ok(!/away from/.test(h.shots[0].text)); ok(/left bunker/.test(h.shots[0].text)); });
t('map book: bunkers on both sides -> no aim-away, clubs down', () => {
  const two = E.clone(MB); const h4 = two.holes[3]; const lb = h4.bunkers.find(b => !b.greenside && b.side === 'left');
  h4.bunkers.push(Object.assign({}, lb, { side: 'right' }));
  const h = hole(build({ book: two, mode: 'points' }), 4); ok(h.shots[0].club !== 'Driver'); ok(!/away from/.test(h.shots[0].text)); });
t('map book: a centre bunker is not aimed away from', () => {
  const ctr = E.clone(MB); ctr.holes[3].bunkers.forEach(b => { if (!b.greenside) b.side = 'centre'; });
  const h = hole(build({ book: ctr, mode: 'points' }), 4); ok(h.shots[0].club !== 'Driver'); ok(!/away from/.test(h.shots[0].text)); });
t('a book aim line wins: Melville hole 4 points uses the book aim, never aim-away', () => {
  const h = hole(build({ mode: 'points' }), 4); ok(/aim right-centre/.test(h.shots[0].text), h.shots[0].text); ok(!/away from/.test(h.shots[0].text)); });
t('Melville book: no plan in any mode says "away from the"', () => ['bogey', 'points', 'attack'].forEach(m => ok(build({ mode: m }).holes.every(h => h.shots.every(x => !/away from the/.test(x.text))), m)));

// ---------- v0.11: a plan for one nine (golf cases 1.7.0) ----------
const nine = (n9, dh, o) => build(Object.assign({ nine: n9, dailyHcp: dh, strokesOnNine: E.strokesOnNine }, o || {}));
t('back nine plan: 9 holes numbered 10-18', () => { const p = nine('back', 8); eq(p.holes.length, 9); eq(p.holes.map(h => h.n).join(','), '10,11,12,13,14,15,16,17,18'); eq(p.nine, 'back'); });
t('back nine at 8: a shot everywhere except hole 15 (SI 17)', () => eq(nine('back', 8).holes.map(h => h.strokes).join(''), '111110111'));
t('front nine at 9: a shot on every hole, so hole 5 targets bogey too', () => { const p = nine('front', 9); ok(p.holes.every(h => h.strokes === 1)); eq(p.holes[4].target, 4); });
t('a nine plays each hole as the 18-hole plan does with the same strokes', () => {
  const p9 = nine('front', 8, { mode: 'points' }), p18 = build({ mode: 'points', dailyHcp: 17 });
  p9.holes.forEach(h => { const h18 = hole(p18, h.n); eq(JSON.stringify(h.shots), JSON.stringify(h18.shots), 'hole ' + h.n); eq(h.strokes, h18.strokes, 'hole ' + h.n); });
});
t('without strokesOnNine the plan uses the same ranking', () => eq(build({ nine: 'back', dailyHcp: 8 }).holes.map(h => h.strokes).join(''), '111110111'));
t('no nine (or an unknown one): the 18-hole plan, with no nine field', () => { const p = build({ nine: 'middle' }); eq(p.holes.length, 18); ok(!('nine' in p)); ok(!('nine' in sb)); });

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
