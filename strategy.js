/* Caddy4Me course strategy v0.6
 * Builds an 18-hole game plan from the yardage book, My Bag, past rounds and handicap shots.
 * Three modes: 'bogey' (Smart Bogey Golf), 'points' (Stableford Points), 'attack' (Attacking).
 * Pure functions: browser (window.C4MStrategy) and Node (module.exports). No live data is used,
 * so a plan saved at the start of a round counts as notes prepared before the round (Rule 4.3).
 */
(function (root) {
  'use strict';
  var MODES = {
    bogey: { label: 'Smart Bogey Golf', margin: 15, spread: 12, aim: 'middle' },
    points: { label: 'Stableford Points', margin: 12, spread: 10, aim: 'middle' },
    attack: { label: 'Attacking', margin: 5, spread: 6, aim: 'flag' }
  };
  var SIDE_WORD = { left: 'left', right: 'right', centre: 'middle', front: 'front', back: 'back', 'front-left': 'front left', 'front-right': 'front right' };

  function r5(x) { return Math.round(x / 5) * 5; }
  function isDriver(c) { return c.id === 'D' || /driver/i.test(c.name || ''); }
  function shortName(c) {
    var n = c.name || c.id || '';
    var m = n.match(/^(\d)\s*(Iron|Wood|Hybrid)$/i);
    if (m) return m[1] + { iron: 'i', wood: 'W', hybrid: 'H' }[m[2].toLowerCase()];
    if (/driver/i.test(n)) return 'Driver';
    return n.replace(/\s*Wedge$/i, 'W').replace(/^U\s*W$/i, 'UW');
  }
  function clubType(c) {
    if (c.type) return c.type;
    if (isDriver(c) || /wood/i.test(c.name)) return 'wood';
    if (/hybrid|rescue/i.test(c.name)) return 'hybrid';
    if (/wedge|^pw$|^sw$|^gw$|^lw$|^uw$/i.test(c.name)) return 'wedge';
    return 'iron';
  }
  function usable(bag) {
    return (bag || []).filter(function (c) { return c && c.carry > 0 && c.total > 0; })
      .map(function (c) { return { id: c.id, name: c.name, type: clubType(c), carry: +c.carry, total: +c.total, partials: c.partials || null }; })
      .sort(function (a, b) { return b.total - a.total || b.carry - a.carry; });
  }
  function bagSignature(bag) {
    return usable(bag).map(function (c) {
      return c.name + ':' + c.carry + '/' + c.total + (c.partials ? '/' + (c.partials['3/4'] || '') + '/' + (c.partials['1/2'] || '') : '');
    }).join('|');
  }
  // the wedge used for lay-ups: the longest-carrying wedge (full swing)
  function layupWedge(clubs) {
    var w = clubs.filter(function (c) { return c.type === 'wedge'; });
    if (!w.length) w = clubs.slice(-1);
    return w.sort(function (a, b) { return b.carry - a.carry; })[0];
  }
  // shortest club that carries at least x; null if none
  function clubToCarry(clubs, x) {
    var ok = clubs.filter(function (c) { return c.carry >= x; });
    return ok.length ? ok.sort(function (a, b) { return a.carry - b.carry; })[0] : null;
  }
  // longest club whose total stays within x (+tol)
  function clubToTotal(clubs, x, tol) {
    var ok = clubs.filter(function (c) { return c.total <= x + (tol || 0); });
    return ok.length ? ok.sort(function (a, b) { return b.total - a.total; })[0] : null;
  }

  /* ---------- history on each hole ---------- */
  function holeHistory(rounds, n, dailyHcpFor, strokesOnHole) {
    var H = { played: 0, scoreSum: 0, pts: 0, ptsN: 0, fwL: 0, fwR: 0, fwHit: 0, pen: 0, putts: 0, puttN: 0, three: 0, miss: { short: 0, long: 0, left: 0, right: 0 }, sand: 0 };
    (rounds || []).forEach(function (r) {
      var h = r && r.holes && r.holes[n - 1];
      if (!h || h.score == null) return;
      H.played++; H.scoreSum += h.score;
      var pts = h.points;
      if (pts == null && strokesOnHole && dailyHcpFor) {
        var dh = dailyHcpFor(r), s = strokesOnHole(dh, h.si);
        if (dh != null) pts = Math.max(0, h.par + s - h.score + 2);
      }
      if (pts != null) { H.pts += pts; H.ptsN++; }
      if (h.pickup) return;   // picked up: score and points only
      if (h.fairway === 'left') H.fwL++; else if (h.fairway === 'right') H.fwR++; else if (h.fairway === 'hit') H.fwHit++;
      H.pen += h.penalties || 0; H.sand += h.sand || 0;
      if (h.putts != null) { H.putts += h.putts; H.puttN++; if (h.putts >= 3) H.three++; }
      var a = h.approach || '';
      if (/short/i.test(a)) H.miss.short++;
      if (/long/i.test(a)) H.miss.long++;
      if (/left/i.test(a)) H.miss.left++;
      if (/right/i.test(a)) H.miss.right++;
    });
    H.avg = H.played ? Math.round(H.scoreSum / H.played * 10) / 10 : null;
    H.avgPts = H.ptsN ? Math.round(H.pts / H.ptsN * 10) / 10 : null;
    H.avgPutts = H.puttN ? Math.round(H.putts / H.puttN * 10) / 10 : null;
    return H;
  }

  /* ---------- geometry from the book ---------- */
  function fairwayBunkers(h) { return (h.bunkers || []).filter(function (b) { return !b.greenside; }); }
  function greensideSides(h) {
    var s = {};
    (h.bunkers || []).forEach(function (b) { if (b.greenside) s[b.side] = true; });
    return s;
  }
  // does a shot from `from` (metres to green) with club c land near a fairway bunker it can't carry?
  function bunkerTrouble(h, from, c, cfg) {
    var land = from - c.total, hit = null;
    fairwayBunkers(h).forEach(function (b) {
      if (b.toGreenFar > from - 20) return;                  // behind or right beside the player
      var reachFromHere = from - b.toGreenFar, carryFromHere = from - b.toGreenNear;
      var inZone = c.total >= reachFromHere - cfg.spread && c.total <= carryFromHere + cfg.spread / 2;
      var carries = c.carry >= carryFromHere + cfg.margin;
      if (inZone && !carries && !hit) hit = { side: b.side, reach: Math.round(reachFromHere), carry: Math.round(carryFromHere) };
    });
    return hit && land > -10 ? hit : null;
  }

  /* ---------- one hole ---------- */
  function planHole(h, ctx) {
    var cfg = MODES[ctx.mode] || MODES.bogey, mode = ctx.mode in MODES ? ctx.mode : 'bogey';
    var clubs = ctx.clubs, deck = clubs.filter(function (c) { return !isDriver(c); }), wedge = ctx.wedge;
    var s = ctx.strokes, par = h.par, D0 = h.m;
    var rise = ctx.noElevation ? 0 : (h.elev && Math.abs(h.elev.rise) >= 3 ? h.elev.rise : 0);
    var gs = greensideSides(h), frontTrouble = !!(gs.front || gs['front-left'] || gs['front-right']);
    var hist = ctx.history || { played: 0, miss: { short: 0, long: 0, left: 0, right: 0 } };
    var shots = [], why = [], danger = [];

    function goAllowed(c) {
      if (mode === 'attack') return true;
      if (mode === 'points') return c.type !== 'wood' || !frontTrouble;
      return c.type === 'iron' || c.type === 'wedge' || (c.type === 'hybrid' && !frontTrouble);
    }
    // approach from `from` metres: club to the green, or null if out of range / not allowed
    // club that reaches the green from `from` metres (lands a little short of the middle and releases)
    function reachClub(from, list) {
      var P = from + rise, need = P - 8;
      if (frontTrouble && h.green) need = Math.max(need, P - h.green.front + 6);
      return clubToCarry(list, need);
    }
    // wedge shots inside a full wedge: full or partial swing closest to the distance
    function wedgeShot(from) {
      var P = from + rise, best = null;
      clubs.filter(function (c) { return c.type === 'wedge'; }).forEach(function (c) {
        [['', c.carry], [' \u00be', c.partials && c.partials['3/4']], [' \u00bd', c.partials && c.partials['1/2']]].forEach(function (o) {
          if (!o[1]) return;
          var d = Math.abs(o[1] - P);
          if (!best || d < best.d) best = { d: d, club: c, swing: o[0], carry: o[1] };
        });
      });
      return best;
    }

    /* safe miss (worked out first so lay-ups and approaches can favour that side) */
    var bad = { short: false, long: false, left: false, right: false };
    Object.keys(gs).forEach(function (k) {
      if (k === 'front') bad.short = true;
      if (k === 'front-left') { bad.short = true; bad.left = true; }
      if (k === 'front-right') { bad.short = true; bad.right = true; }
      if (k === 'left') bad.left = true;
      if (k === 'right') bad.right = true;
      if (k === 'back') bad.long = true;
    });
    (h.extra || []).forEach(function (x) { if (x.side && bad[x.side] !== undefined && /drop/i.test(x.what)) bad[x.side] = true; });
    var btf = /back-to-front/.test(h.slope || '');
    if (btf) bad.long = true;
    var order = btf ? ['short', 'left', 'right', 'long'] : ['short', 'right', 'left', 'long'];
    var miss = order.filter(function (k) { return !bad[k]; })[0] || null;

    /* tee shot (par 4/5) */
    var pos = D0;
    if (par >= 4) {
      var tee = null, rejected = [];
      for (var i = 0; i < clubs.length; i++) {
        var c = clubs[i];
        if (c.type === 'wedge') break;
        var trouble = bunkerTrouble(h, D0, c, cfg);
        // aiming away from a one-sided bunker is enough in Points and Attacking modes
        if (trouble && mode !== 'bogey' && h.drive && /left|right/.test(trouble.side) && h.drive.indexOf(trouble.side) < 0 && /left|right/.test(h.drive)) trouble = null;
        var corner = h.dogleg ? D0 - h.dogleg.cornerToGreen : null;
        var through = corner != null && h.dogleg.angle >= 25 && c.total > corner + (mode === 'attack' ? 40 : 20);
        if (!trouble && !through) { tee = c; break; }
        rejected.push({ c: c, trouble: trouble, through: through, corner: corner });
      }
      if (!tee) tee = clubs.filter(function (c) { return c.type !== 'wedge'; }).slice(-1)[0] || clubs[0];
      var tline = shortName(tee) + ' off the tee (about ' + tee.total + ' m)';
      var aim = h.drive ? ', aim ' + h.drive : '';
      var because = '';
      if (rejected.length) {
        var rj = rejected[0];
        if (rj.trouble) because = ' – stays short of the ' + SIDE_WORD[rj.trouble.side] + ' bunker at ' + rj.trouble.reach + '–' + rj.trouble.carry + ' m';
        else if (rj.through) because = ' – the ' + h.dogleg.dir + ' dog-leg turns at about ' + Math.round(rj.corner) + ' m, so ' + shortName(rj.c) + ' would run through it';
        why.push(shortName(rj.c) + ' left in the bag' + because.replace(' – ', ': '));
      } else {
        var carried = fairwayBunkers(h).filter(function (b) { var cf = D0 - b.toGreenNear; return cf > 60 && cf < tee.carry; });
        if (carried.length) because = ' – carries the ' + SIDE_WORD[carried[0].side] + ' bunker (' + Math.round(D0 - carried[0].toGreenNear) + ' m)';
      }
      shots.push({ kind: 'tee', club: tee, text: tline + aim + because });
      pos = Math.max(0, D0 - tee.total);
    }

    /* shots to the green */
    var guard = 0, reached = false, aimTxt = cfg.aim === 'flag' ? 'the flag' : 'the middle of the green';
    function plays(from) { var P = Math.round(from + rise); return rise ? ' (plays ' + P + ' m, ' + (rise > 0 ? 'uphill' : 'downhill') + ')' : ''; }
    while (guard++ < 4) {
      var list = (shots.length === 0) ? clubs : deck;            // driver only from the tee
      if (pos + rise <= wedge.carry + 4) {                        // wedge range: full or partial wedge
        var w = wedgeShot(pos);
        shots.push({ kind: 'approach', club: w.club, text: shortName(w.club) + w.swing + ' to ' + aimTxt + ', ' + Math.round(pos) + ' m' + plays(pos) });
        reached = true; break;
      }
      var rc = reachClub(pos, list);
      var want = pos - wedge.carry;
      var lc = want >= 50 ? clubToTotal(deck, want, 10) : null;  // a lay-up that leaves a full wedge
      if (rc && (goAllowed(rc) || !lc)) {
        var safe = !goAllowed(rc) && miss && mode !== 'attack';
        shots.push({ kind: 'approach', club: rc, text: shortName(rc) + ' to ' + (safe ? 'the ' + (miss === 'short' ? 'front' : miss) + ' side of the green' : aimTxt) + ', ' + Math.round(pos) + ' m' + plays(pos) });
        if (safe) why.push(shortName(rc) + ' is a long club for this green, so play to the safe side');
        reached = true; break;
      }
      if (!lc) lc = rc ? rc : deck[0];                            // out of range: as far as the longest club goes
      if (par === 3) {                                            // par 3 you can't (or shouldn't) reach: stay short of the trouble
        var limit = pos - (h.green ? h.green.front : 12) - 10;
        (h.bunkers || []).forEach(function (b) { if (b.greenside && /front/.test(b.side)) limit = Math.min(limit, pos - b.toGreenFar - cfg.spread); });
        lc = clubToTotal(clubs, limit, 0) || deck[deck.length - 1];
      }
      var t2 = bunkerTrouble(h, pos, lc, cfg);
      if (t2) { var shorter = clubToTotal(deck, t2.reach - cfg.spread, 0); if (shorter) lc = shorter; }
      var leave = Math.max(0, Math.round(pos - lc.total));
      if (par === 3) {
        shots.push({ kind: 'layup', club: lc, text: shortName(lc) + ' short of the green (about ' + lc.total + ' m), leaving a ' + leave + ' m pitch' });
        why.push((rc ? shortName(rc) + ' is the club to reach, but it is a long club over ' + (frontTrouble ? 'front bunkers' : 'trouble') : 'No club in the bag reaches this green') + ' – lay up and pitch on');
      } else {
        shots.push({ kind: 'layup', club: lc, text: shortName(lc) + ' lay-up to about ' + leave + ' m out' + (Math.abs(leave - wedge.carry) <= 12 ? ' – your full ' + shortName(wedge) + ' (' + wedge.carry + ' m)' : '') +
          (t2 ? ', short of the ' + SIDE_WORD[t2.side] + ' bunker' : '') });
      }
      pos = leave;
    }

    /* target score */
    var target = mode === 'bogey' ? par + (s >= 1 ? 1 : 0) : mode === 'points' ? par + s : par;
    var shotsToGreen = shots.length;
    if (mode === 'attack' && par === 5 && shotsToGreen <= 2) target = par - 1;
    var targetWord = target - par === -1 ? 'birdie' : target === par ? 'par' : target - par === 1 ? 'bogey' : 'double bogey';

    var missText = miss ? 'Safe miss: ' + miss + (btf && miss === 'short' ? ' – the green slopes back to front' : miss === 'short' ? ' – nothing in front of this green' : ' – no bunker on that side') : 'No safe miss – aim for the middle of the green';
    var histMiss = Object.keys(hist.miss).sort(function (a, b) { return hist.miss[b] - hist.miss[a]; })[0];
    if (hist.miss[histMiss] >= 2 && histMiss !== miss) why.push('Your approaches here have finished ' + histMiss + ' ' + hist.miss[histMiss] + ' times');

    /* dangers */
    fairwayBunkers(h).forEach(function (b) {
      var from = D0 - b.toGreenFar, to = D0 - b.toGreenNear;
      if (to > 40 && from < D0 - 30) danger.push(cap(SIDE_WORD[b.side]) + ' bunker ' + Math.max(0, Math.round(from)) + '–' + Math.round(to) + ' m from the tee');
    });
    Object.keys(gs).forEach(function (k) { danger.push('Greenside bunker ' + SIDE_WORD[k]); });
    (h.extra || []).forEach(function (x) { danger.push(x.what + ' ' + x.side + (x.note ? ' (' + x.note + ')' : '')); });
    if (h.wind) danger.push('Wind usually ' + (h.wind === 'into' ? 'into you' : h.wind === 'behind' ? 'behind you' : h.wind.replace(/-/g, ' ')));

    /* history line */
    var histText = hist.played ? 'Played ' + hist.played + ' time' + (hist.played > 1 ? 's' : '') + ' · average ' + hist.avg + (hist.avgPts != null ? ' · ' + hist.avgPts + ' pts' : '') : 'No rounds on this hole yet';
    if (hist.fwL + hist.fwR >= 2) histText += ' · fairway missed left ' + hist.fwL + ', right ' + hist.fwR;
    if (hist.pen) histText += ' · ' + hist.pen + ' penalt' + (hist.pen === 1 ? 'y' : 'ies');

    var cue = coachingCue(h, { shots: shots, hist: hist, wedge: wedge, thoughts: ctx.thoughts, miss: miss, btf: btf, n: h.n });

    var strip = shots.map(function (x) { return shortName(x.club); }).join(' → ') + ' · ' + (cfg.aim === 'flag' ? 'at flag' : 'middle') + (miss ? ' · miss ' + miss : '');
    return {
      n: h.n, par: par, si: h.si, m: D0, strokes: s, target: target, targetText: 'Aim for ' + targetWord + (target === par + s && s ? ' = net par, 2 points' : '') + (s ? ' \u00b7 ' + s + ' shot' + (s > 1 ? 's' : '') + ' here' : ''),
      shots: shots.map(function (x) { return { kind: x.kind, club: x.club.name, text: x.text }; }),
      strip: strip, miss: miss, missText: missText, green: h.greenNote || '', cue: cue, danger: danger, why: why, history: histText,
      rise: rise, reached: reached
    };
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* one coaching cue per hole: the shot that matters most here */
  function coachingCue(h, o) {
    var H = o.hist, th = (o.thoughts || []).filter(Boolean);
    var thought = th.length ? th[(o.n - 1) % th.length] : null;
    if (h.par >= 4 && H.fwL + H.fwR >= 2) {
      var side = H.fwL >= H.fwR ? 'left' : 'right', other = side === 'left' ? 'right' : 'left';
      return 'Tee: you’ve missed ' + side + ' here ' + Math.max(H.fwL, H.fwR) + ' times – start it at the ' + other + ' edge and hold your finish.' + (thought ? ' Thought: “' + thought + '”' : '');
    }
    if (H.pen >= 2) return 'Tee: penalties here before – take the club that stays in play and make a smooth swing.' + (thought ? ' Thought: “' + thought + '”' : '');
    if (H.avgPutts != null && H.avgPutts >= 2.5) return 'Putting: lag the first putt to a 1 m circle – two putts is a win on this green.';
    if (/tier|level|contour|multi/.test(h.slope || '')) return 'Putting: on a green with levels, pick the level first – land your approach on the flag’s level and lag to the hole.';
    if (/severe/.test(h.slope || '')) return 'Putting: below the hole is everything here – from above, just die it at the hole.';
    if (/narrow/.test(h.slope || '')) return 'Short game: if you miss, chip with a 9 iron and let it run – the green is narrow.';
    var lay = o.shots.filter(function (x) { return x.kind === 'layup'; })[0];
    if (lay && h.par > 3) return 'Wedge: your lay-up leaves a full ' + shortName(o.wedge) + ' – pick a spot on the green and swing to your ' + o.wedge.carry + ' m number.';
    if (h.par === 3) return 'Tee: commit to the club, smooth tempo and a full finish.' + (thought ? ' Thought: “' + thought + '”' : '');
    if (o.btf) return 'Putting: leave it below the hole – an uphill putt you can hit firmly.';
    if (thought) return 'Swing thought: “' + thought + '”';
    return 'Pick a small target on every shot and commit to it.';
  }

  /* ---------- whole course ---------- */
  function buildStrategy(opts) {
    var book = opts.book, mode = MODES[opts.mode] ? opts.mode : 'bogey';
    var clubs = usable(opts.bag);
    if (!book || !book.holes || !clubs.length) return null;
    var wedge = layupWedge(clubs);
    var pars = opts.pars || [], si = opts.si || [];
    var rounds = (opts.rounds || []).filter(function (r) { return r && r.holes && r.holes.some(function (h) { return h && h.score != null; }); });
    var strokesOnHole = opts.strokesOnHole || function (dh, x) { return dh == null || !x ? 0 : Math.floor(dh / 18) + (x <= dh % 18 ? 1 : 0); };
    var holes = book.holes.map(function (bh, i) {
      var h = Object.assign({}, bh, { par: pars[i] || bh.par, si: si[i] || bh.si });
      var s = strokesOnHole(opts.dailyHcp, h.si);
      return planHole(h, { mode: mode, clubs: clubs, wedge: wedge, strokes: s, thoughts: opts.thoughts, noElevation: !!opts.noElevation,
        history: holeHistory(rounds, h.n, opts.dailyHcpFor, strokesOnHole) });
    });
    return { v: 1, mode: mode, modeLabel: MODES[mode].label, bagSig: bagSignature(opts.bag), rounds: rounds.length, dailyHcp: opts.dailyHcp, noElevation: !!opts.noElevation, holes: holes };
  }

  var api = { MODES: MODES, buildStrategy: buildStrategy, bagSignature: bagSignature, holeHistory: holeHistory, shortName: shortName, usable: usable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C4MStrategy = api;
})(this);
