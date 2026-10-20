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

  /* Melville Glades (Offcourse scorecard) - editable in Settings */
  var COURSE = {
    name: 'Melville Glades',
    pars: [4, 5, 4, 4, 3, 4, 4, 5, 3, 4, 4, 4, 5, 3, 4, 4, 3, 5],
    si:   [13, 14, 3, 7, 16, 5, 8, 11, 9, 2, 12, 1, 15, 17, 4, 6, 18, 10],
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
  function normApproach(a) { return a === 'green' ? 'hit' : a; }

  /* ---------- stats ---------- */
  function holeStats(h) {
    if (h == null || h.score == null) return null;
    var putts = h.putts || 0;
    var gir = (h.score - putts) <= (h.par - 2);
    var udAttempt = !gir;
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
    (holes || []).forEach(function (h) {
      var st = holeStats(h); if (!st) return;
      s.holes++; s.score += h.score; s.par += h.par; s.putts += h.putts || 0;
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
    s.girPct = pct(s.gir, s.holes);
    s.udPct = pct(s.udMade, s.ud);
    s.sandPct = pct(s.sandSaved, s.sandAtt);
    s.fwPct = pct(s.fwHit, s.fw);
    s.puttsPerGir = s.gir ? Math.round(10 * s.girPutts / s.gir) / 10 : null;
    return s;
  }

  var api = {
    K: K, LIES: LIES, DEFAULT_BAG: DEFAULT_BAG, COURSE: COURSE, APPROACH9: APPROACH9, clone: clone,
    dailyHandicap: dailyHandicap, strokesOnHole: strokesOnHole, stablefordPoints: stablefordPoints, normApproach: normApproach,
    distanceM: distanceM, bearingDeg: bearingDeg,
    windFromLive: windFromLive, windFromRelative: windFromRelative, windLabel: windLabel,
    recommend: recommend, swingWord: swingWord,
    holeStats: holeStats, suggestUpDown: suggestUpDown, defaultWasted: defaultWasted, roundSummary: roundSummary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C4M = api;
})(this);
