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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
