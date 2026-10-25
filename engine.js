/* Caddy4Me caddie engine v0.1
 * Pure functions: no DOM, no network. Works in the browser (window.C4M)
 * and in Node (module.exports) so it can be unit-tested.
 * Every tunable number lives in K below - tune after test rounds.
 */
(function (root) {
  'use strict';

  var K = {
    headPctPerKmh: 0.006,   // +0.6% plays-like per km/h headwind
    tailPctPerKmh: 0.003,   // -0.3% per km/h tailwind
    windCapPct: 0.25,       // max +/-25%
    driftPerKmhPerM: 0.0015,// crosswind drift metres = k * |cross| * D
    minAimNoteM: 2,
    betweenClubsSlackM: 3,  // approach: shortest club with E >= P - 3
    teeSlackM: 5,           // tee: longest club with E <= P + 5
    rollShare: { soft: 0, normal: 0.3, firm: 0.6 },   // approach E = carry + g*(total-carry)
    teeGround: { soft: 0.93, normal: 1.0, firm: 1.05 },// tee E = total * f
    partial: { '3/4': 0.85, '1/2': 0.65 },
    partialBelowFullUwM: 4, // use partials when P < E(UW) - 4
    pitchBelowM: 45,
    layupLeaveClubId: 'PW'
  };

  var LIES = {
    fairway:     { label: 'Fairway',     factor: 1.00, allow: null, note: '' },
    lightRough:  { label: 'Light rough', factor: 1.03, allow: null, note: 'May come out hot' },
    heavyRough:  { label: 'Heavy rough', factor: 1.10, allow: ['hybrid', 'iron', 'wedge'], note: 'Less spin, expect run-out' },
    bunker:      { label: 'Bunker',      factor: 1.05, allow: ['iron', 'wedge'], note: 'Ball first, take one more' },
    hardpan:     { label: 'Hardpan',     factor: 1.00, allow: null, note: 'Pick it clean' }
  };

  var DEFAULT_BAG = [
    { id: 'D',  name: 'Driver',   type: 'wood',   carry: 177, total: 209 },
    { id: '5W', name: '5 Wood',   type: 'wood',   carry: 165, total: 189 },
    { id: '5H', name: '5 Hybrid', type: 'hybrid', carry: 151, total: 168 },
    { id: '5i', name: '5 Iron',   type: 'iron',   carry: 143, total: 157 },
    { id: '6i', name: '6 Iron',   type: 'iron',   carry: 135, total: 145 },
    { id: '7i', name: '7 Iron',   type: 'iron',   carry: 125, total: 135 },
    { id: '8i', name: '8 Iron',   type: 'iron',   carry: 120, total: 124 },
    { id: '9i', name: '9 Iron',   type: 'iron',   carry: 105, total: 113 },
    { id: 'PW', name: 'PW',       type: 'wedge',  carry: 93,  total: 96, partials: { '3/4': 79, '1/2': 60 } },
    { id: 'UW', name: 'U Wedge',  type: 'wedge',  carry: 78,  total: 82, partials: { '3/4': 66, '1/2': 51 } }
  ];

  /* Melville Glades, Blue Men tees (from a MiScore card, 18 Oct 2026) - editable in Settings */
  var COURSE = {
    name: 'Melville Glades', tees: 'Blue Men', siSource: 'miscore-blue',
    pars: [4, 5, 4, 4, 3, 4, 4, 5, 3, 4, 4, 4, 5, 3, 4, 4, 3, 5],
    si:   [14, 6, 5, 8, 18, 7, 3, 10, 11, 2, 13, 1, 12, 16, 17, 4, 15, 9],
    oldSi: [13, 14, 3, 7, 16, 5, 8, 11, 9, 2, 12, 1, 15, 17, 4, 6, 18, 10], // v0.2 Offcourse values, replaced
    slope: 124, scratch: 72
  };
  var APPROACH9 = ['longLeft', 'long', 'longRight', 'left', 'hit', 'right', 'shortLeft', 'short', 'shortRight'];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function r0(x) { return Math.round(x); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  var RAD = Math.PI / 180;

  /* ---------- geo ---------- */
  function distanceM(a, b) {
    var R = 6371008.8;
    var dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function bearingDeg(a, b) {
    var y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
    var x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
            Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  /* ---------- wind ----------
   * Live wind: speed km/h blowing FROM fromDeg (meteorological).
   * theta = from - bearing. theta 0 = straight into the player, 90 = from the right.
   * head > 0 = headwind. cross > 0 = from the right (ball drifts left).
   */
  function windFromLive(speedKmh, fromDeg, shotBearingDeg) {
    var th = (fromDeg - shotBearingDeg) * RAD;
    return { head: speedKmh * Math.cos(th), cross: speedKmh * Math.sin(th) };
  }
  /* Manual wind: relDeg relative to the shot (0 into, 90 from right, 180 helping, 270 from left). */
  function windFromRelative(speedKmh, relDeg) {
    var th = relDeg * RAD;
    return { head: speedKmh * Math.cos(th), cross: speedKmh * Math.sin(th) };
  }
  function windLabel(w) {
    if (!w) return 'No wind data';
    var s = Math.sqrt(w.head * w.head + w.cross * w.cross);
    if (s < 3) return 'Calm';
    var parts = [];
    if (Math.abs(w.head) >= 3) parts.push(w.head > 0 ? 'into' : 'helping');
    if (Math.abs(w.cross) >= 3) parts.push(w.cross > 0 ? 'from right' : 'from left');
    return r0(s) + ' km/h · ' + parts.join(', ');
  }

  function windPct(head) {
    var p = head >= 0 ? K.headPctPerKmh * head : K.tailPctPerKmh * head;
    return clamp(p, -K.windCapPct, K.windCapPct);
  }

  /* ---------- recommendation ----------
   * input: { distance, mode:'approach'|'tee', wind:{head,cross}|null, lie, ground, bag }
   */
  function recommend(input) {
    var D = Number(input.distance);
    if (!(D > 0)) return null;
    var mode = input.mode === 'tee' ? 'tee' : 'approach';
    var ground = K.rollShare.hasOwnProperty(input.ground) ? input.ground : 'normal';
    var lieKey = mode === 'tee' ? 'fairway' : (LIES[input.lie] ? input.lie : 'fairway');
    var lie = LIES[lieKey];
    var bag = (input.bag && input.bag.length ? input.bag : DEFAULT_BAG).filter(function (c) { return c.carry > 0; });
    var w = input.wind || { head: 0, cross: 0 };

    var pct = windPct(w.head);
    var afterWind = D * (1 + pct);
    var P = afterWind * lie.factor;
    var reasons = [];
    var windM = afterWind - D;
    if (Math.abs(windM) >= 1) reasons.push((windM > 0 ? 'Into wind +' : 'Helping wind −') + Math.abs(r0(windM)) + ' m');
    var lieM = P - afterWind;
    if (Math.abs(lieM) >= 1) reasons.push(lie.label + ' +' + r0(lieM) + ' m');

    var drift = K.driftPerKmhPerM * Math.abs(w.cross) * D;
    var aim = '';
    if (drift >= K.minAimNoteM) aim = 'Aim ' + r0(drift) + ' m ' + (w.cross > 0 ? 'right' : 'left');

    var allowed = bag.filter(function (c) { return !lie.allow || lie.allow.indexOf(c.type) >= 0; });
    var res = {
      mode: mode, distance: r0(D), playsLike: r0(P), aim: aim, reasons: reasons,
      notes: [], warning: '', club: null, swing: 'full', up: null, down: null
    };
    if (lie.note) res.notes.push(lie.note);

    if (mode === 'tee') {
      var tf = K.teeGround[ground];
      var opts = allowed.map(function (c) { return { club: c, swing: 'full', E: c.total * tf }; })
                        .sort(function (a, b) { return a.E - b.E; });
      var pick = null;
      for (var i = 0; i < opts.length; i++) if (opts[i].E <= P + K.teeSlackM) pick = i;
      if (pick === null) pick = 0;
      setPick(res, opts, pick);
      var drv = opts.filter(function (o) { return o.club.type === 'wood' && o.club.id === 'D'; })[0];
      if (drv && drv.E > P + K.teeSlackM) res.warning = 'Driver runs through by ' + r0(drv.E - P) + ' m';
      res.reasons.push(res.club.name + ' finishes ~' + r0(opts[pick].E) + ' m with roll');
      return res;
    }

    // approach
    var g = K.rollShare[ground];
    var full = allowed.map(function (c) { return { club: c, swing: 'full', E: c.carry + g * (c.total - c.carry) }; })
                      .sort(function (a, b) { return a.E - b.E; });
    var shortest = full[0];

    if (shortest && P < shortest.E - K.partialBelowFullUwM) {
      // partial-swing zone
      var parts = [];
      allowed.forEach(function (c) {
        if (c.type !== 'wedge') return;
        Object.keys(K.partial).forEach(function (sw) {
          var carry = (c.partials && c.partials[sw]) ? c.partials[sw] : c.carry * K.partial[sw];
          parts.push({ club: c, swing: sw, E: carry });
        });
      });
      parts.push(shortest);
      parts.sort(function (a, b) { return a.E - b.E; });
      if (P < K.pitchBelowM) {
        var uw = allowed.filter(function (c) { return c.type === 'wedge'; })
                        .sort(function (a, b) { return a.carry - b.carry; })[0];
        res.club = uw || shortest.club; res.swing = 'pitch';
        res.notes.push('Feel shot – fly it ' + r0(P) + ' m');
        return res;
      }
      var best = 0;
      for (var j = 1; j < parts.length; j++) if (Math.abs(parts[j].E - P) < Math.abs(parts[best].E - P)) best = j;
      setPick(res, parts, best);
      res.reasons.push(swingWord(parts[best].swing) + ' carries ~' + r0(parts[best].E) + ' m');
      return res;
    }

    var k = -1;
    for (var m = 0; m < full.length; m++) if (full[m].E >= P - K.betweenClubsSlackM) { k = m; break; }
    if (k === -1) {
      k = full.length - 1;
      var leave = bag.filter(function (c) { return c.id === K.layupLeaveClubId; })[0];
      res.warning = 'Out of reach by ' + r0(P - full[k].E) + ' m';
      if (leave && D - leave.carry > 0) res.notes.push('Or lay up ' + r0(D - leave.carry) + ' m to leave a full ' + leave.name + ' (' + leave.carry + ' m)');
    }
    setPick(res, full, k);
    if (g > 0 && res.club.total > res.club.carry) {
      var roll = r0(g * (res.club.total - res.club.carry));
      if (ground === 'firm' && roll >= 2) res.notes.push('Firm: land it ~' + roll + ' m short, let it release');
    }
    return res;
  }

  function swingWord(s) { return s === 'full' ? 'Full' : s === 'pitch' ? 'Pitch' : s + ' swing'; }
  function setPick(res, list, i) {
    res.club = list[i].club; res.swing = list[i].swing; res.clubE = r0(list[i].E);
    var up = list[i + 1], dn = list[i - 1];
    res.up = up ? { name: up.club.name, swing: up.swing, E: r0(up.E) } : null;
    res.down = dn ? { name: dn.club.name, swing: dn.swing, E: r0(dn.E) } : null;
  }

  /* ---------- Stableford (Golf Australia) ---------- */
  function dailyHandicap(ga, slope, scratch, par) {
    if (ga == null || isNaN(ga)) return null;
    return Math.round((ga * slope / 113 + (scratch - par)) * 0.93);
  }
  function strokesOnHole(dh, si) {
    if (dh == null || !si) return 0;
    if (dh >= 0) return Math.floor(dh / 18) + (si <= dh % 18 ? 1 : 0);
    var plus = -dh; // plus handicap gives strokes back from SI 18 upwards
    return -(Math.floor(plus / 18) + (si > 18 - plus % 18 ? 1 : 0));
  }
  function stablefordPoints(par, score, strokes) {
    if (score == null || !par) return null;
    return Math.max(0, par + (strokes || 0) - score + 2);
  }
  /* Merge a scores file (e.g. from MiScore) into a round: scores, putts, points, pickups.
     Other stats already recorded on the round are kept. */
  function mergeScores(round, file) {
    var n = 0;
    file.holes.forEach(function (fh) {
      var h = round.holes[fh.n - 1]; if (!h) return;
      h.par = fh.par; h.score = fh.score; h.putts = fh.putts == null ? null : fh.putts;
      h.points = fh.points; h.pickup = !!fh.pickup;
      if (fh.si) h.si = fh.si;
      if (fh.pickup) { h.fairway = null; h.approach = null; h.upDown = null; h.sandSave = null; }
      n++;
    });
    if (file.dailyHcp != null) round.dailyHcp = file.dailyHcp;
    round.done = round.holes.every(function (x) { return x.score != null; });
    round.source = file.source || 'import';
    return n;
  }
  function normApproach(a) { return a === 'green' ? 'hit' : a; }

  /* ---------- stats ---------- */
  function holeStats(h) {
    if (h == null || h.score == null) return null;
    var putts = h.putts || 0;
    var gir = typeof h.gir === 'boolean' ? h.gir : (h.score - putts) <= (h.par - 2); // explicit GIR wins
    var udAttempt = !gir && h.upDown != null; // only count holes where U&D was recorded
    var sandAttempt = (h.sand || 0) >= 1 && !gir;
    var sandSaveFlag = h.sandSave != null ? h.sandSave : h.upDown; // v0.1 rounds had no sandSave
    return {
      gir: gir,
      upDownAttempt: udAttempt,
      upDownMade: udAttempt && h.upDown === true,
      sandSaveAttempt: sandAttempt,
      sandSaved: sandAttempt && sandSaveFlag === true,
      threePutts: Math.max(0, putts - 2),
      fairwayAttempt: h.par >= 4 && h.fairway != null,
      fairwayHit: h.par >= 4 && h.fairway === 'hit',
      points: h.points != null ? h.points : null
    };
  }
  function suggestUpDown(h) { return (h.putts || 0) <= 1 && h.score <= h.par; }
  function defaultWasted(putts) { return Math.max(0, (putts || 0) - 2); }

  function roundSummary(holes) {
    var s = { holes: 0, score: 0, par: 0, putts: 0, gir: 0, girPutts: 0, ud: 0, udMade: 0,
              sandAtt: 0, sandSaved: 0, wasted: 0, penalties: 0, sandShots: 0,
              fw: 0, fwHit: 0, chipIns: 0, points: 0, pointsHoles: 0, miss: {} };
    APPROACH9.forEach(function (k) { s.miss[k] = 0; });
    s.statHoles = 0; s.pickups = 0;
    (holes || []).forEach(function (h) {
      if (h && h.pickup && h.score != null) { // picked up: counts for score + points only
        s.holes++; s.pickups++; s.score += h.score; s.par += h.par; s.putts += h.putts || 0;
        if (h.points != null) { s.points += h.points; s.pointsHoles++; }
        return;
      }
      var st = holeStats(h); if (!st) return;
      s.holes++; s.statHoles++; s.score += h.score; s.par += h.par; s.putts += h.putts || 0;
      if (st.gir) { s.gir++; s.girPutts += h.putts || 0; }
      if (st.upDownAttempt) { s.ud++; if (st.upDownMade) s.udMade++; }
      if (st.sandSaveAttempt) { s.sandAtt++; if (st.sandSaved) s.sandSaved++; }
      s.wasted += h.wasted || 0; s.penalties += h.penalties || 0; s.sandShots += h.sand || 0;
      var a = normApproach(h.approach);
      if (a && s.miss.hasOwnProperty(a)) s.miss[a]++;
      if (st.fairwayAttempt) { s.fw++; if (st.fairwayHit) s.fwHit++; }
      if (h.chipIn) s.chipIns++;
      if (st.points != null) { s.points += st.points; s.pointsHoles++; }
    });
    function pct(a, b) { return b ? Math.round(100 * a / b) : null; }
    s.toPar = s.score - s.par;
    s.girPct = pct(s.gir, s.statHoles);
    s.udPct = pct(s.udMade, s.ud);
    s.sandPct = pct(s.sandSaved, s.sandAtt);
    s.fwPct = pct(s.fwHit, s.fw);
    s.puttsPerGir = s.gir ? Math.round(10 * s.girPutts / s.gir) / 10 : null;
    return s;
  }

  /* ---------- last 5 rounds analysis (v0.5) ----------
   * rounds: [{ id, date, tournament, holes (with points) }]
   * Counts finished 18-hole rounds only; needs at least 2. Fixed rules, no AI.
   */
  var MISS_SHORT = ['short', 'shortLeft', 'shortRight'], MISS_LEFT = ['left', 'longLeft', 'shortLeft'], MISS_RIGHT = ['right', 'longRight', 'shortRight'];
  function analyseRounds(rounds, n) {
    n = n || 5;
    var done = (rounds || []).filter(function (r) { return r.holes && r.holes.length >= 18 && r.holes.slice(0, 18).every(function (h) { return h.score != null; }); })
      .sort(function (a, b) { return (a.date + a.id) < (b.date + b.id) ? 1 : -1; }).slice(0, n).reverse();   // oldest -> newest
    var res = { count: done.length, enough: done.length >= 2, rounds: [], avg: null, suggestions: [] };
    if (!res.enough) return res;
    var T = { pts: 0, gross: 0, toPar: 0, putts: 0, three: 0, gir: 0, girPutts: 0, stat: 0, fw: 0, fwHit: 0, ud: 0, udMade: 0, sa: 0, ss: 0, pen: 0, wst: 0, miss: {} };
    APPROACH9.forEach(function (k) { T.miss[k] = 0; });
    done.forEach(function (r) {
      var s = roundSummary(r.holes);
      var three = r.holes.filter(function (h) { return !h.pickup && (h.putts || 0) >= 3; }).length;
      res.rounds.push({ id: r.id, date: r.date, tournament: !!r.tournament, pts: s.points, gross: s.score, toPar: s.toPar, putts: s.putts, three: three,
        girPct: s.girPct, fwPct: s.fwPct, udPct: s.udPct });
      T.pts += s.points; T.gross += s.score; T.toPar += s.toPar; T.putts += s.putts; T.three += three; T.gir += s.gir; T.girPutts += s.girPutts; T.stat += s.statHoles;
      T.fw += s.fw; T.fwHit += s.fwHit; T.ud += s.ud; T.udMade += s.udMade; T.sa += s.sandAtt; T.ss += s.sandSaved; T.pen += s.penalties; T.wst += s.wasted;
      APPROACH9.forEach(function (k) { T.miss[k] += s.miss[k]; });
    });
    var N = done.length;
    function pct(a, b) { return b ? Math.round(100 * a / b) : null; }
    function one(x) { return Math.round(x * 10) / 10; }
    var misses = APPROACH9.filter(function (k) { return k !== 'hit'; }).reduce(function (a, k) { return a + T.miss[k]; }, 0);
    function share(keys) { return misses ? keys.reduce(function (a, k) { return a + T.miss[k]; }, 0) / misses : 0; }
    var A = res.avg = {
      pts: one(T.pts / N), gross: one(T.gross / N), toPar: one(T.toPar / N), putts: one(T.putts / N), three: one(T.three / N),
      ppg: T.gir ? Math.round(100 * T.girPutts / T.gir) / 100 : null, girPct: pct(T.gir, T.stat), fwPct: pct(T.fwHit, T.fw), udPct: pct(T.udMade, T.ud),
      sandPct: pct(T.ss, T.sa), sandAtt: T.sa, pen: one(T.pen / N), wasted: one(T.wst / N), miss: T.miss, misses: misses,
      shortShare: Math.round(100 * share(MISS_SHORT)), leftShare: Math.round(100 * share(MISS_LEFT)), rightShare: Math.round(100 * share(MISS_RIGHT))
    };
    // trend: last round vs the average of the earlier ones
    var last = res.rounds[N - 1], earlier = res.rounds.slice(0, -1);
    res.trend = { pts: one(last.pts - earlier.reduce(function (a, r) { return a + r.pts; }, 0) / earlier.length) };
    var S = [];
    function add(key, est, title, detail, tip) { if (est > 0) S.push({ key: key, shots: Math.round(est * 10) / 10, title: title, detail: detail, tip: tip }); }
    if (A.three >= 2) add('threeputt', A.three - 1, 'Three-putts', A.three + ' three-putts a round',
      'Lag putting: practise 10–15 m putts to finish within a club length.');
    if (A.ppg != null && A.ppg > 2.1) add('ppg', (A.ppg - 2) * (T.gir / N), 'Putting after hitting greens', A.ppg + ' putts per green in regulation',
      'Speed control: 10 minutes on the practice green before each round.');
    if (misses >= 5 && A.shortShare >= 40) add('short', (share(MISS_SHORT) - 0.25) * (misses / N) * 0.5 + 0.1, 'Approaches finishing short', A.shortShare + '% of missed greens are short',
      'Take one more club into greens, and check your carry numbers in My Bag.');
    var side = A.leftShare >= A.rightShare ? 'left' : 'right', sideShare = Math.max(A.leftShare, A.rightShare);
    if (misses >= 5 && sideShare >= 40) add('side', (sideShare / 100) * (misses / N) * 0.4, 'Approaches missing ' + side, sideShare + '% of missed greens finish ' + side,
      'Alignment and aim: check your set-up with an alignment stick.');
    if (T.fw >= 10 && A.fwPct < 40) add('fairway', (0.5 - A.fwPct / 100) * (T.fw / N) * 0.5, 'Fairways', A.fwPct + '% of fairways hit',
      'Choose a tee club you can keep in play on tight holes.');
    if (T.ud >= 5 && A.udPct < 25) add('updown', (0.35 - A.udPct / 100) * (T.ud / N), 'Up and down', A.udPct + '% up and down',
      'Chipping practice: get the ball on the green and within 2 m.');
    if (T.sa >= 3 && A.sandPct < 20) add('sand', (0.3 - A.sandPct / 100) * (T.sa / N), 'Sand saves', A.sandPct + '% sand saves',
      'Greenside bunker practice: splash out onto the green first time.');
    if (A.pen >= 2) add('penalty', A.pen - 1, 'Penalty shots', A.pen + ' penalty shots a round',
      'Course management: aim away from trouble and take the penalty-free side.');
    if (A.wasted >= 4) add('wasted', A.wasted - 2, 'Wasted shots', A.wasted + ' wasted shots a round',
      'Pre-shot routine and tempo to cut duffs and chips that don’t reach the green.');
    S.sort(function (a, b) { return b.shots - a.shots; });
    res.suggestions = S.slice(0, 3);
    return res;
  }

  var api = {
    K: K, LIES: LIES, DEFAULT_BAG: DEFAULT_BAG, COURSE: COURSE, APPROACH9: APPROACH9, clone: clone,
    dailyHandicap: dailyHandicap, mergeScores: mergeScores, analyseRounds: analyseRounds, strokesOnHole: strokesOnHole, stablefordPoints: stablefordPoints, normApproach: normApproach,
    distanceM: distanceM, bearingDeg: bearingDeg,
    windFromLive: windFromLive, windFromRelative: windFromRelative, windLabel: windLabel,
    recommend: recommend, swingWord: swingWord,
    holeStats: holeStats, suggestUpDown: suggestUpDown, defaultWasted: defaultWasted, roundSummary: roundSummary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C4M = api;
})(this);
