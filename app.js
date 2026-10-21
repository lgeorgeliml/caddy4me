/* Caddy4Me app v0.1 - screens, GPS, wind, storage */
(function () {
  'use strict';
  var E = window.C4M;
  var KEY = 'caddy4me.v1';
  var WIND_MAX_AGE = 10 * 60 * 1000;
  var NEW_SHOT_M = 30;
  var LIE_KEYS = ['fairway', 'lightRough', 'heavyRough', 'bunker', 'hardpan'];
  var GROUNDS = [['soft', 'Soft'], ['normal', 'Normal'], ['firm', 'Firm']];
  var WIND_DIRS = [[315, 'Into from L'], [0, 'Into'], [45, 'Into from R'], [270, 'From left'], [null, ''], [90, 'From right'], [225, 'Help from L'], [180, 'Helping'], [135, 'Help from R']];
  var WIND_SPEEDS = [[0, 'Calm'], [10, 'Light'], [20, 'Moderate'], [30, 'Strong'], [40, 'Very strong']];

  var app = document.getElementById('app');
  var modal = document.getElementById('modal');
  var S = load();
  if (!S.course.si || S.course.siSource !== E.COURSE.siSource) S = migrate(S);
  save(); // persist any upgrade from older saved data
  var ui = freshHoleUi({ screen: 'home', holeIdx: 0, me: null, acc: null, gpsErr: '', card: null, summaryId: null, confirmReset: false });
  var map = null, watchId = null, wakeLock = null, windTimer = null, windBusy = false, windErr = false;

  /* ---------- storage ---------- */
  function defaults() {
    return { version: 1, bag: E.clone(E.DEFAULT_BAG),
      settings: { windSource: 'live', manual: { rel: 0, speed: 0 } },
      course: { name: 'Melville Glades', pars: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null] },
      rounds: [], currentRoundId: null, wind: null,
      prep: { thoughts: [], videos: [] } };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.version === 1) { var d = defaults(); Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; }); return migrate(s); }
    } catch (e) { /* fall through */ }
    return defaults();
  }
  function migrate(s) {
    var C = E.COURSE;
    s.course.pars = (s.course.pars || []).map(function (p, i) { return p || C.pars[i]; });
    while (s.course.pars.length < 18) s.course.pars.push(C.pars[s.course.pars.length]);
    if (!s.course.si) s.course.si = C.si.slice();
    // v0.2 shipped Offcourse stroke indexes; swap them for the Blue Men card unless the player edited them
    if (s.course.siSource !== C.siSource) {
      if (s.course.si.join(',') === C.oldSi.join(',')) s.course.si = C.si.slice();
      s.course.siSource = C.siSource;
      (s.rounds || []).forEach(function (r) { r.holes.forEach(function (h, i) { if (h.si && h.si === C.oldSi[i]) h.si = C.si[i]; }); });
    }
    if (s.course.slope == null) s.course.slope = C.slope;
    if (s.course.scratch == null) s.course.scratch = C.scratch;
    if (s.settings.ga === undefined) s.settings.ga = 16.9;
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function cur() { return S.rounds.filter(function (r) { return r.id === S.currentRoundId; })[0] || null; }
  function roundById(id) { return S.rounds.filter(function (r) { return r.id === id; })[0] || null; }
  function compass(d) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8]; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function freshHoleUi(o) { o.target = null; o.mode = 'tee'; o.lie = 'fairway'; o.manualDist = null; o.shotFrom = null; o.centered = o.centered || false; return o; }
  function minsAgo(t) { var m = Math.round((Date.now() - t) / 60000); return m <= 0 ? 'just now' : m + ' min ago'; }
  function playerName() { return (S.settings.name || '').trim(); }
  function signed(n) { return n === 0 ? 'E' : (n > 0 ? '+' + n : String(n)); }

  /* ---------- V2 look: icons + photos ---------- */
  var IMG = { amen: 'images/amen-corner.jpg', bunker: 'images/bunker.jpg', fairway: 'images/fairway.jpg', ball: 'images/golf-ball.jpg' };
  var ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
    arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    drop: '<path d="M12 3c3 4 5 6.5 5 9.5A5 5 0 0 1 7 12.5C7 9.5 9 7 12 3z"/>',
    bag: '<path d="M7 21l3-17"/><path d="M14 21l-1-17"/><rect x="6" y="13" width="12" height="8" rx="2"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    save: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    flag: '<path d="M7 21V3l10 4-10 4"/>',
    fairway: '<path d="M4 20l4-16h8l4 16"/><path d="M12 6v3M12 12v3"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>'
  };
  function ic(name, cls) { return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>'; }
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function niceDate(iso) {
    var d = iso ? new Date(iso + 'T12:00:00') : new Date();
    return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function longDate(iso) {
    var d = new Date(iso + 'T12:00:00');
    var day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
    return day + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].charAt(0) + MONTHS[d.getMonth()].slice(1).toLowerCase();
  }
  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; }
  function mood() { var h = new Date().getHours(); return h < 9 ? 'First light, dew on the greens' : h < 17 ? 'A good day for a walk' : 'Twilight round'; }
  // running Stableford total as a glowing line (Summary)
  function pointsChart(hs) {
    var tot = 0, pts = [];
    hs.forEach(function (h, i) { if (h.score != null) { tot += (h.points || 0); pts.push([i, tot]); } });
    if (pts.length < 2) return '';
    var W = 326, H = 132, top = Math.max(36, tot);
    var xy = pts.map(function (p) { return [5 + p[0] * (316 / 17), 118 - (p[1] / top) * 108]; });
    var d = 'M' + xy[0][0].toFixed(1) + ' ' + xy[0][1].toFixed(1);
    for (var i = 1; i < xy.length; i++) {
      var mx = ((xy[i - 1][0] + xy[i][0]) / 2).toFixed(1);
      d += ' C' + mx + ' ' + xy[i - 1][1].toFixed(1) + ',' + mx + ' ' + xy[i][1].toFixed(1) + ',' + xy[i][0].toFixed(1) + ' ' + xy[i][1].toFixed(1);
    }
    var e = xy[xy.length - 1], y36 = (118 - (36 / top) * 108).toFixed(1);
    return '<div class="card chartcard"><div class="top"><span>POINTS THROUGH THE ROUND</span><span>Target 36</span></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Running Stableford total, ' + tot + ' points after ' + pts.length + ' holes">' +
      '<defs><filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>' +
      '<line x1="0" y1="' + y36 + '" x2="' + W + '" y2="' + y36 + '" stroke="#3A3F3B" stroke-dasharray="3 5"/>' +
      '<line x1="0" y1="118" x2="' + W + '" y2="118" stroke="#262A26"/>' +
      '<path d="' + d + '" fill="none" stroke="#A6F36A" stroke-width="6" opacity=".55" filter="url(#glow)"/>' +
      '<path d="' + d + '" fill="none" stroke="#A6F36A" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + e[0].toFixed(1) + '" cy="' + e[1].toFixed(1) + '" r="5" fill="#A6F36A" stroke="#0A0B0A" stroke-width="2"/></svg>' +
      '<div class="axis"><span>Hole 1</span><span>9</span><span>18</span></div></div>';
  }
  function ring(value, max) {
    var C = 2 * Math.PI * 48, f = Math.max(0, Math.min(1, value / max));
    return '<svg width="118" height="118" viewBox="0 0 118 118" aria-hidden="true"><circle cx="59" cy="59" r="48" fill="none" stroke="#262A26" stroke-width="11"/>' +
      (f > 0 ? '<circle cx="59" cy="59" r="48" fill="none" stroke="#A6F36A" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + (C * f).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 59 59)"/>' : '') + '</svg>';
  }

  /* ---------- navigation ---------- */
  function go(screen) {
    if (ui.screen === 'hole' && screen !== 'hole') stopHole();
    ui.screen = screen; ui.confirmReset = false; ui.confirmDiscard = false; ui.confirmDelete = false; ui.pendingRestore = null; ui.restoreMsg = "";
    closeModal();
    window.scrollTo(0, 0);
    render();
  }
  function render() {
    var s = ui.screen;
    if (s === 'home') app.innerHTML = homeHtml();
    else if (s === 'hole') { renderHole(); return; }
    else if (s === 'card') app.innerHTML = cardHtml();
    else if (s === 'summary') app.innerHTML = summaryHtml();
    else if (s === 'past') app.innerHTML = pastHtml();
    else if (s === 'bag') app.innerHTML = bagHtml();
    else if (s === 'prep') app.innerHTML = prepHtml();
    else if (s === 'settings') app.innerHTML = settingsHtml();
  }

  /* ---------- home ---------- */
  function homeHtml() {
    var r = cur(), open = r && !r.done;
    var nextHole = open ? firstOpenHole(r) + 1 : 1;
    var dh = currentDH();
    var weather = S.wind && Date.now() - S.wind.at < 3 * 3600000 ? '<span class="weather">' + ic('wind') + Math.round(S.wind.speed) + ' km/h ' + compass(S.wind.from) + '</span>' : '';
    // most recent round with scores (not the one in progress)
    var last = S.rounds.slice().reverse().filter(function (x) { return x !== (open ? r : null) && x.holes.some(function (h) { return h.score != null; }); })[0];
    var lastCard = '';
    if (last) {
      var ls = E.roundSummary(holesWithPoints(last));
      lastCard = '<button class="card lastround" data-a="openRound" data-v="' + esc(last.id) + '">' +
        '<div class="top"><span>LAST ROUND</span><span>' + esc(niceDate(last.date)) + '</span></div>' +
        '<div class="body"><div><div class="kv"><div class="k">Gross</div><div class="v">' + ls.score + ' <small>' + (ls.holes < 18 ? ls.holes + ' holes' : signed(ls.toPar)) + '</small></div></div>' +
        '<div class="kv"><div class="k">Putts</div><div class="v">' + ls.putts + ' <small>total</small></div></div></div>' +
        '<div class="ring">' + ring(ls.points, 36) + '<div class="c"><b>' + (ls.pointsHoles ? ls.points : '–') + '</b><span>PTS</span></div></div></div></button>' +
        '<div class="duo"><div class="mini"><div class="h">' + ic('fairway') + '<span>FAIRWAYS</span></div><div class="v">' + ls.fwHit + '<small>/' + ls.fw + '</small></div></div>' +
        '<div class="mini"><div class="h">' + ic('flag') + '<span>GREENS</span></div><div class="v">' + ls.gir + '<small>/' + ls.statHoles + '</small></div></div></div>';
    }
    var tp = S.prep.thoughts.length, vp = S.prep.videos.length;
    function rowBtn(a, icon, title, sub) {
      return '<button class="row-btn" data-a="' + a + '"><span class="badge">' + ic(icon) + '</span><span class="t"><b>' + title + '</b><span>' + sub + '</span></span>' + ic('right') + '</button>';
    }
    return '<div class="home">' +
      '<div class="hello"><div><div class="date">' + niceDate() + '</div><div class="name">' + greeting() + (playerName() ? ', ' + esc(playerName()) : '') + '</div></div>' + weather + '</div>' +
      '<div class="photo herocard"><img src="' + IMG.amen + '" alt="Stone bridge over the creek to a par-3 green lined with azaleas">' +
      '<span class="over tag lime">MELVILLE GLADES</span>' +
      '<div class="over cap"><div class="mood">' + mood() + '</div><div class="info">' + (open ? 'Round in progress · next up hole ' + nextHole : '18 holes · Daily handicap ' + (dh != null ? dh : '–')) + '</div></div></div>' +
      lastCard +
      rowBtn('prep', 'drop', 'Before your round', (tp ? tp + ' swing thought' + (tp > 1 ? 's' : '') : 'Add swing thoughts') + ' · ' + vp + ' video' + (vp === 1 ? '' : 's')) +
      (open ? '<button class="btn primary" data-a="resume">Resume · Hole ' + nextHole + ic('play') + '</button>' +
              '<button class="btn" data-a="newRound">Start a new round</button>' +
              '<button class="btn small danger" data-a="discard">' + (ui.confirmDiscard ? 'Tap again to discard – nothing is saved' : 'Discard this round') + '</button>'
            : '<button class="btn primary" data-a="newRound">Start round' + ic('play') + '</button>') +
      '<div class="list">' +
      rowBtn('past', 'chart', 'Past rounds', S.rounds.length + ' saved · import scores') +
      rowBtn('bag', 'bag', 'My bag', S.bag.length + ' clubs · carry &amp; total') +
      rowBtn('settings', 'gear', 'Settings', 'Handicap &amp; course') +
      rowBtn('export', 'save', 'Export backup', 'Save a copy of your bag and rounds') +
      (ui.pendingRestore ? '<div class="banner">This replaces everything on this phone with the backup (' + ui.pendingRestore.rounds.length + ' rounds). ' +
        '<button class="btn small danger" data-a="doRestore">Restore now</button><button class="btn small" data-a="cancelRestore">Cancel</button></div>'
        : '<label class="row-btn filebtn"><span class="badge">' + ic('save') + '</span><span class="t"><b>Restore backup</b><span>Load a saved copy onto this phone</span></span>' + ic('right') +
          '<input type="file" id="restorefile" accept=".json,application/json" hidden></label>') + '</div>' +
      (ui.restoreMsg ? '<p class="warn">' + esc(ui.restoreMsg) + '</p>' : '') +
      '<p class="note">For social and practice rounds. Club advice from a device isn’t allowed in competition (Rule 4.3).</p></div>';
  }
  function firstOpenHole(r) { for (var i = 0; i < 18; i++) if (r.holes[i].score == null) return i; return 17; }
  function newRound() {
    var holes = [];
    for (var i = 0; i < 18; i++) holes.push({ n: i + 1, par: S.course.pars[i], si: S.course.si[i], score: null, putts: null, approach: null, upDown: null, sand: 0, penalties: 0, wasted: 0 });
    var r = { id: new Date().toISOString(), date: today(), ground: 'normal', holes: holes, done: false, dailyHcp: currentDH(), player: playerName() || null };
    S.rounds.push(r); S.currentRoundId = r.id; save();
    ui.holeIdx = 0; freshHoleUi(ui); go('hole');
  }

  /* ---------- hole screen ---------- */
  function renderHole() {
    var lies = LIE_KEYS.map(function (k) { return '<button class="chip" data-a="lie" data-v="' + k + '">' + E.LIES[k].label + '</button>'; }).join('');
    app.innerHTML =
      '<div class="hole">' +
      '<div class="topbar"><button class="ibtn" data-a="home" aria-label="Home">' + ic('home') + '</button>' +
      '<span class="tag line gpstag" id="gpstag"><span class="dotl"></span><span id="gpstxt">GPS</span></span>' +
      '<div class="pair"><button class="ibtn" data-a="prevHole" aria-label="Previous hole">' + ic('left') + '</button>' +
      '<button class="ibtn" data-a="nextHole" aria-label="Next hole">' + ic('right') + '</button></div></div>' +
      '<button class="bigdist" data-a="manualDist" id="dist" aria-label="Distance – tap to type one"></button>' +
      '<div class="trio"><button class="stat" data-a="wind" id="windchip" aria-label="Wind – tap to change"></button>' +
      '<div class="stat" id="playslike"></div>' +
      '<button class="stat" data-a="cycleGround" id="groundstat" aria-label="Ground – tap to change"></button></div>' +
      '<div class="mapwrap"><div id="map"></div>' +
      '<div class="mapseg"><div class="seg"><button data-a="mode" data-v="tee">Tee</button><button data-a="mode" data-v="approach">Approach</button></div></div>' +
      '<div class="maphint" id="maphint" hidden></div>' +
      '<div class="mapbtns"><button data-a="zin" aria-label="Zoom in">+</button><button data-a="zout" aria-label="Zoom out">−</button>' +
      '<button data-a="recenter" aria-label="Centre on me">◎</button></div></div>' +
      '<div id="liebox" class="shotopts"><div class="label">Lie</div><div class="chips">' + lies + '</div></div>' +
      '<section class="call" id="call"></section>' +
      '<button class="btn primary" data-a="holeDone">Enter Stats</button></div>';
    map = new window.SatMap($('map'), { zoom: 18, onTap: onMapTap });
    if (ui.me) { map.setView(ui.me, 18); map.setMe(ui.me, ui.acc); ui.centered = true; }
    if (ui.target) map.setTarget(ui.target);
    startGps(); requestWake(); maybeFetchWind(false);
    if (!windTimer) windTimer = setInterval(function () { maybeFetchWind(false); }, 60000);
    updateHole();
  }
  function stopHole() {
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null; map = null;
    if (windTimer) { clearInterval(windTimer); windTimer = null; }
    if (wakeLock) { try { wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
  }
  function startGps() {
    if (watchId != null) return;
    if (!navigator.geolocation) { ui.gpsErr = 'No GPS on this device'; return; }
    watchId = navigator.geolocation.watchPosition(function (p) {
      ui.gpsErr = '';
      ui.me = { lat: p.coords.latitude, lon: p.coords.longitude };
      ui.acc = p.coords.accuracy || 0;
      if (map) {
        if (!ui.centered) { map.setView(ui.me, 18); ui.centered = true; }
        map.setMe(ui.me, ui.acc);
      }
      checkNewShot();
      maybeFetchWind(false);
      updateHole();
    }, function (err) {
      ui.gpsErr = err.code === 1 ? 'Location is blocked – allow it for this site in Chrome' : 'Waiting for GPS…';
      updateHole();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function checkNewShot() {
    if (!ui.shotFrom || !ui.me) return;
    if (E.distanceM(ui.me, ui.shotFrom) < NEW_SHOT_M) return;
    // the player has walked to their ball: new shot
    if (ui.mode === 'tee') { ui.mode = 'approach'; ui.target = null; if (map) map.setTarget(null); }
    ui.lie = 'fairway'; ui.shotFrom = null;
  }
  function onMapTap(ll) {
    ui.target = ll; ui.manualDist = null;
    if (map) map.setTarget(ll);
    if (ui.me) ui.shotFrom = ui.me;
    updateHole();
  }
  function requestWake() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && ui.screen === 'hole') { requestWake(); maybeFetchWind(false); }
  });

  function maybeFetchWind(force) {
    var pos = ui.me;
    if (!pos || windBusy) return;
    var age = S.wind ? Date.now() - S.wind.at : Infinity;
    if (!force && age < WIND_MAX_AGE) return;
    if (force && age < 2 * 60000) return;
    windBusy = true;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + pos.lat.toFixed(4) + '&longitude=' + pos.lon.toFixed(4) +
      '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh&timezone=auto';
    fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      var c = j.current;
      S.wind = { speed: c.wind_speed_10m, from: c.wind_direction_10m, gust: c.wind_gusts_10m, at: Date.now() };
      windErr = false; save();
    }).catch(function () { windErr = true; }).then(function () { windBusy = false; if (ui.screen === 'hole') updateHole(); });
  }

  function shotGeometry() {
    if (ui.manualDist) return { D: ui.manualDist, bearing: ui.target && ui.me ? E.bearingDeg(ui.me, ui.target) : null, src: 'entered' };
    if (ui.target && ui.me) return { D: E.distanceM(ui.me, ui.target), bearing: E.bearingDeg(ui.me, ui.target), src: 'gps' };
    return { D: null, bearing: null, src: null };
  }
  function shotWind(bearing) {
    var m = S.settings.manual;
    if (S.settings.windSource === 'manual') {
      var w = E.windFromRelative(m.speed, m.rel);
      return { w: w, rel: m.rel, label: 'Manual · ' + E.windLabel(w), speed: m.speed };
    }
    if (!S.wind) return { w: null, rel: null, label: windErr ? 'Wind unavailable – tap to set' : 'Wind: loading…', speed: 0 };
    if (bearing == null) return { w: null, rel: null, label: 'Live ' + Math.round(S.wind.speed) + ' km/h from ' + compass(S.wind.from) + ' · set a target', speed: S.wind.speed };
    var wl = E.windFromLive(S.wind.speed, S.wind.from, bearing);
    return { w: wl, rel: S.wind.from - bearing, label: 'Live · ' + E.windLabel(wl), speed: S.wind.speed };
  }
  function windArrow(rel, speed) {
    if (rel == null || speed < 3) return '';
    // arrow shows where the wind blows, relative to the shot (up = towards target)
    return '<svg class="arr" viewBox="0 0 26 26" aria-hidden="true"><g transform="rotate(' + (rel + 180) + ' 13 13)">' +
      '<path d="M13 3 L20 13 H15.5 V23 H10.5 V13 H6 Z" fill="#A6F36A"/></g></svg>';
  }
  function windTile(sw, bearing) {
    var manual = S.settings.windSource === 'manual';
    var v, s;
    if (!manual && !S.wind) { v = '—'; s = windErr ? 'tap to set' : 'loading…'; }
    else if (!manual && bearing == null) { v = Math.round(S.wind.speed); s = 'km/h from ' + compass(S.wind.from); }
    else {
      v = Math.round(manual ? sw.speed : S.wind.speed);
      var lab = E.windLabel(sw.w), i = lab.indexOf(' · ');
      s = (i >= 0 ? lab.slice(i + 3) : lab.toLowerCase()) + (manual ? ' · set' : '');
    }
    return '<span class="k">Wind</span><span class="v">' + windArrow(sw.rel, sw.speed) + v + '</span><span class="s">' + esc(s) + '</span>';
  }
  var GROUND_LABEL = { soft: ['Soft', 'wet / dewy'], normal: ['Normal', 'usual run'], firm: ['Firm', 'extra run'] };

  function updateHole() {
    if (ui.screen !== 'hole' || !$('dist')) return;
    var r = cur();
    var g = shotGeometry(), sw = shotWind(g.bearing);
    $('windchip').innerHTML = windTile(sw, g.bearing);
    var gl = GROUND_LABEL[r.ground] || GROUND_LABEL.normal;
    $('groundstat').innerHTML = '<span class="k">Ground</span><span class="v">' + gl[0] + '</span><span class="s">' + gl[1] + '</span>';

    var hint = $('maphint'), msg = '', bad = false;
    if (ui.gpsErr) { msg = ui.gpsErr; bad = ui.gpsErr.indexOf('blocked') >= 0; }
    else if (!ui.me) msg = 'Waiting for GPS…';
    else if (ui.acc > 10) { msg = 'GPS weak ±' + Math.round(ui.acc) + ' m'; bad = true; }
    else if (!ui.target && !ui.manualDist) msg = ui.mode === 'tee' ? 'Tap your landing spot' : 'Tap the pin or your target';
    hint.hidden = !msg; hint.textContent = msg; hint.classList.toggle('gpsbad', bad);
    $('gpstxt').textContent = ui.me ? 'GPS ±' + Math.round(ui.acc || 0) + ' M' : (ui.gpsErr && bad ? 'GPS BLOCKED' : 'GPS…');
    $('gpstag').classList.toggle('bad', !ui.me || ui.acc > 10);

    var head = '<span class="hn">Hole ' + (ui.holeIdx + 1) + ' <span>· PAR ' + holePar(r, ui.holeIdx) + ' · SI ' + holeSI(r, ui.holeIdx) + '</span></span>';
    var d = $('dist');
    if (g.D) d.innerHTML = head + '<span class="num"><b>' + Math.round(g.D) + '</b><i>M</i></span><span class="src">' +
      (g.src === 'entered' ? 'entered · tap to change' : (ui.mode === 'tee' ? 'to your landing spot' : 'to target') + ' · tap to type') + '</span>';
    else d.innerHTML = head + '<span class="num"><b>—</b><i>M</i></span><span class="src">tap the map, or tap here to type</span>';

    Array.prototype.forEach.call(app.querySelectorAll('[data-a="mode"]'), function (b) { b.classList.toggle('on', b.dataset.v === ui.mode); });
    Array.prototype.forEach.call(app.querySelectorAll('[data-a="lie"]'), function (b) { b.classList.toggle('on', b.dataset.v === ui.lie); });
    $('liebox').hidden = ui.mode === 'tee';

    var call = $('call'), pl = $('playslike');
    if (!g.D) {
      pl.innerHTML = '<span class="k">Plays like</span><span class="v">—</span><span class="s">metres</span>';
      call.innerHTML = '<div class="ctop"><span class="k">YOUR CALL</span></div><div class="empty">' + (ui.mode === 'tee' ? 'Tap where you want the tee shot to finish.' : 'Tap the pin or your target on the map.') + '</div>';
      return;
    }
    var rec = E.recommend({ distance: g.D, mode: ui.mode, wind: sw.w, lie: ui.lie, ground: r.ground, bag: S.bag });
    pl.innerHTML = '<span class="k">Plays like</span><span class="v">' + rec.playsLike + '</span><span class="s">' + (rec.mode === 'tee' ? 'landing zone' : 'metres') + '</span>';
    var swing = rec.swing === 'full' ? 'full' : rec.swing === 'pitch' ? 'pitch' : rec.swing + ' swing';
    var lines = rec.reasons.concat(rec.notes);
    if (!sw.w && S.settings.windSource !== 'manual') lines.push('Wind not included');
    call.innerHTML =
      '<div class="ctop"><span class="k">YOUR CALL</span></div>' +
      (rec.warning ? '<div class="warn">' + esc(rec.warning) + '</div>' : '') +
      '<div class="club">' + esc(rec.club.name) + '<span class="swing">' + esc(swing) + '</span></div>' +
      (rec.aim ? '<div class="aim">' + esc(rec.aim) + '</div>' : '') +
      (lines.length ? '<ul>' + lines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="alts">' +
      (rec.down ? '<div>↓ ' + esc(rec.down.name) + (rec.down.swing !== 'full' ? ' ' + esc(rec.down.swing) : '') + ' · ' + rec.down.E + ' m</div>' : '') +
      (rec.up ? '<div>↑ ' + esc(rec.up.name) + (rec.up.swing !== 'full' ? ' ' + esc(rec.up.swing) : '') + ' · ' + rec.up.E + ' m</div>' : '') +
      '</div>';
  }

  function changeHole(delta) {
    var n = ui.holeIdx + delta;
    if (n < 0 || n > 17) return;
    ui.holeIdx = n; freshHoleUi(ui);
    if (map) map.setTarget(null);
    maybeFetchWind(true);
    updateHole();
  }

  /* ---------- modals ---------- */
  function openModal(html) { modal.innerHTML = '<div class="sheet">' + html + '</div>'; modal.hidden = false; }
  function closeModal() { modal.hidden = true; modal.innerHTML = ''; }
  function windModal() {
    var m = S.settings.manual, manual = S.settings.windSource === 'manual';
    var live = S.wind ? 'Live: ' + Math.round(S.wind.speed) + ' km/h from ' + compass(S.wind.from) + ', gusts ' + Math.round(S.wind.gust) + ' (' + minsAgo(S.wind.at) + ')' : 'Live wind not loaded yet';
    var dirs = WIND_DIRS.map(function (d) {
      if (d[0] == null) return '<div class="mid">You<br>↑ target</div>';
      return '<button class="chip' + (manual && m.rel === d[0] ? ' on' : '') + '" data-a="wdir" data-v="' + d[0] + '">' + d[1] + '</button>';
    }).join('');
    var sp = WIND_SPEEDS.map(function (s) { return '<button class="chip' + (manual && m.speed === s[0] ? ' on' : '') + '" data-a="wspd" data-v="' + s[0] + '">' + s[1] + (s[0] ? ' ' + s[0] : '') + '</button>'; }).join('');
    openModal('<h2>Wind for this shot</h2><p class="muted">' + esc(live) + '</p>' +
      '<button class="btn small' + (manual ? '' : ' primary') + '" data-a="wlive">Use live wind</button>' +
      '<div class="label">Or set it yourself (target is up)</div><div class="compass">' + dirs + '</div>' +
      '<div class="label">Strength (km/h)</div><div class="chips">' + sp + '</div>' +
      '<button class="btn primary" data-a="closeModal">Done</button>');
  }
  function distModal() {
    openModal('<h2>Enter distance</h2><p class="muted">Use this if GPS is poor or you have a rangefinder number.</p>' +
      '<input class="numin" id="mdist" type="number" inputmode="numeric" min="1" max="350" placeholder="metres" value="' + (ui.manualDist || '') + '">' +
      '<button class="btn primary" data-a="setDist">Use this distance</button>' +
      '<button class="btn small" data-a="clearDist">Back to GPS distance</button>');
    setTimeout(function () { var i = $('mdist'); if (i) i.focus(); }, 50);
  }

  /* ---------- course + handicap ---------- */
  function coursePar() { return S.course.pars.reduce(function (a, p, i) { return a + (p || E.COURSE.pars[i]); }, 0); }
  function currentDH() { return E.dailyHandicap(S.settings.ga, S.course.slope, S.course.scratch, coursePar()); }
  function roundDH(r) { return r.dailyHcp != null ? r.dailyHcp : currentDH(); }
  function holeSI(r, i) { return (r.holes[i].si) || S.course.si[i] || E.COURSE.si[i]; }
  function holePar(r, i) { return r.holes[i].par || S.course.pars[i] || E.COURSE.pars[i]; }
  function holePoints(r, i, h) {
    h = h || r.holes[i];
    return E.stablefordPoints(h.par || holePar(r, i), h.score, E.strokesOnHole(roundDH(r), holeSI(r, i)));
  }
  function holesWithPoints(r) {
    return r.holes.map(function (h, i) {
      var c = Object.assign({}, h);
      if (c.score != null) { c.par = c.par || holePar(r, i); if (c.points == null) c.points = holePoints(r, i, c); }
      return c;
    });
  }

  /* ---------- hole card (v0.2, MiScore-style layout) ---------- */
  var GRID = [['longLeft', '↖'], ['long', '↑'], ['longRight', '↗'], ['left', '←'], ['hit', '✓'], ['right', '→'], ['shortLeft', '↙'], ['short', '↓'], ['shortRight', '↘']];
  var GRID_LABEL = { longLeft: 'Long left', long: 'Long', longRight: 'Long right', left: 'Left', hit: 'Hit', right: 'Right', shortLeft: 'Short left', short: 'Short', shortRight: 'Short right' };

  function openCard(idx) {
    var r = cur(), h = r.holes[idx], par = holePar(r, idx), saved = h.score != null;
    ui.holeIdx = idx;
    ui.card = { par: par, si: holeSI(r, idx), score: saved ? h.score : par, putts: saved ? h.putts : 2,
      chipIn: !!h.chipIn, fairway: h.fairway || null, approach: E.normApproach(h.approach) || null,
      upDown: h.upDown, sandSave: h.sandSave != null ? h.sandSave : null, girOverride: saved ? (typeof h.gir === 'boolean' ? h.gir : !!(E.holeStats(h) || {}).gir) : false, // new card: GIR off until tapped
      sand: h.sand || 0, penalties: h.penalties || 0, wasted: saved ? (h.wasted || 0) : 0,
      touched: { approach: saved, upDown: saved, sandSave: saved, wasted: saved } };
    autoCard();
    go('card');
  }
  function autoCard() {
    var c = ui.card;
    c.putts = Math.max(0, Math.min(c.putts, c.score));
    if (c.putts > 0) c.chipIn = false;
    // Nothing is pre-selected: GIR, Up & Down and Sand Save stay off until the player taps them (MiScore style)
    c.gir = c.girOverride === true;
    if (c.gir) { c.upDown = null; c.sandSave = null; }
    else {
      if (c.upDown == null) c.upDown = false;
      if (c.sandSave == null) c.sandSave = false;
    }
    if (!c.touched.wasted) c.wasted = E.defaultWasted(c.putts);
    var r = cur();
    c.strokes = E.strokesOnHole(roundDH(r), c.si);
    c.points = E.stablefordPoints(c.par, c.score, c.strokes);
  }
  function cardTotals() {
    var r = cur(), c = ui.card;
    var hs = holesWithPoints(r).map(function (h, i) {
      if (i !== ui.holeIdx) return h;
      return { par: c.par, score: c.score, putts: c.putts, gir: c.gir, fairway: c.par >= 4 ? c.fairway : null, approach: c.approach,
        upDown: c.upDown, sandSave: c.sandSave, sand: c.sand, penalties: c.penalties, wasted: c.wasted, chipIn: c.chipIn, points: c.points };
    });
    return E.roundSummary(hs);
  }
  function cstep(field, label, totalTxt, hint, extra) {
    var v = ui.card[field];
    return '<div class="sec"><h3>' + label + '</h3>' + (hint ? '<div class="hint">' + hint + '</div>' : '') +
      '<div class="cstep"><button class="circ" data-a="step" data-v="' + field + ':-1" aria-label="' + label + ' minus"' + (v <= 0 ? ' disabled' : '') + '>−</button>' +
      '<span class="cval">' + v + '</span>' +
      '<button class="circ" data-a="step" data-v="' + field + ':1" aria-label="' + label + ' plus">+</button></div>' +
      (totalTxt != null ? '<div class="pills"><span class="pill">' + totalTxt + '</span></div>' : '') + (extra || '') + '</div>';
  }
  function toggle(action, label, on, enabled) {
    return '<button class="tgl' + (on ? ' on' : '') + '" data-a="' + action + '"' + (enabled ? '' : ' disabled') + '><span class="dot"></span>' + label + '</button>';
  }
  function cardHtml() {
    var c = ui.card, n = ui.holeIdx + 1, T = cardTotals(), toPar = c.score - c.par;
    var strokesTxt = c.strokes === 1 ? '1 stroke' : c.strokes + ' strokes';
    var fw = c.par >= 4 ? '<div class="sec"><h3>Fairway hit</h3><div class="cstep">' +
      [['left', '←'], ['hit', '✓'], ['right', '→']].map(function (f) {
        return '<button class="circ big' + (c.fairway === f[0] ? ' on' : '') + '" data-a="fw" data-v="' + f[0] + '" aria-label="Fairway ' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div><div class="pills"><span class="pill">Total: <b>' + T.fwHit + ' / ' + T.fw + '</b></span></div></div>' : '';
    var grid = GRID.map(function (g) {
      return '<button class="circ big' + (c.approach === g[0] ? ' on' : '') + '" data-a="appr" data-v="' + g[0] + '" aria-label="Approach ' + GRID_LABEL[g[0]] + '">' + g[1] + '</button>';
    }).join('');
    var NAMES = { '-3': 'ALBATROSS', '-2': 'EAGLE', '-1': 'BIRDIE', '0': 'PAR', '1': 'BOGEY', '2': 'DOUBLE' };
    var rname = NAMES[String(toPar)] || (toPar > 0 ? '+' + toPar : String(toPar));
    var prog = cur().holes.map(function (h, i) { return '<span class="' + (i === ui.holeIdx ? 'now' : h.score != null ? 'done' : '') + '"></span>'; }).join('');
    return '<div class="photo cardhead"><img src="' + IMG.fairway + '" alt="">' +
      '<div class="over topbar"><button class="ibtn glass" data-a="backHole" aria-label="Back to hole">' + ic('left') + '</button>' +
      '<span class="tsub" style="color:#fff">Hole ' + n + ' · Par ' + c.par + ' · SI ' + c.si + '</span><span style="width:48px"></span></div>' +
      '<div class="over mid"><span class="tag white">' + ic('check') + rname + ' · ' + c.points + ' STABLEFORD PT' + (c.points === 1 ? '' : 'S') + '</span>' +
      '<div class="score"><button class="circ" data-a="step" data-v="score:-1" aria-label="Score minus">−</button>' +
      '<span class="bigv">' + c.score + '</span><button class="circ plus" data-a="step" data-v="score:1" aria-label="Score plus">+</button></div>' +
      '<span class="line2">' + (c.strokes ? 'you get ' + strokesTxt + ' here' : 'no handicap stroke here') + ' · round ' + T.points + ' pts</span></div></div>' +
      '<div class="progress" aria-label="Hole ' + n + ' of 18">' + prog + '</div>' +
      '<div class="pad cardpad">' +
      cstep('putts', 'Putts', null, null, '<div class="pills">' + toggle('chip', 'Chip In', c.chipIn, true) + '<span class="pill">Total putts: <b>' + T.putts + '</b></span></div>') +
      fw +
      '<div class="sec"><h3>Green in regulation</h3><div class="pills">' + toggle('gir', 'Green hit', c.gir, true) +
      '<span class="pill">Total: <b>' + T.gir + ' / ' + T.holes + '</b></span></div></div>' +
      '<div class="sec"><h3>Approach shot</h3><div class="grid9">' + grid + '</div>' +
      '<div class="pills">' + toggle('ud', 'Up &amp; Down', c.upDown === true, !c.gir) + toggle('ss', 'Sand Save', c.sandSave === true, !c.gir) + '</div>' +
      '<div class="pills"><span class="pill">U&amp;D <b>' + T.udMade + ' / ' + T.ud + '</b></span><span class="pill">Sand saves <b>' + T.sandSaved + ' / ' + T.sandAtt + '</b></span></div></div>' +
      cstep('sand', 'Sand shots', 'Total: <b>' + T.sandShots + '</b>') +
      cstep('wasted', 'Wasted shots', 'Total: <b>' + T.wasted + '</b>', 'Duffs, shanks, whiffs, 3-putts, chips not on') +
      cstep('penalties', 'Penalty shots', 'Total: <b>' + T.penalties + '</b>') +
      '</div><div class="footbar"><button class="btn" data-a="backHole">Cancel</button><button class="btn primary" data-a="saveCard">' + (n < 18 ? 'Save · Hole ' + (n + 1) : 'Finish round') + '</button></div>';
  }
  function saveCard() {
    var r = cur(), c = ui.card, h = r.holes[ui.holeIdx];
    if (r.dailyHcp == null) r.dailyHcp = currentDH();
    h.par = c.par; h.si = c.si; h.score = c.score; h.putts = c.putts; h.chipIn = c.chipIn; h.gir = c.gir;
    h.fairway = c.par >= 4 ? c.fairway : null; h.approach = c.approach;
    h.upDown = c.gir ? null : c.upDown; h.sandSave = c.sandSave; h.sand = c.sand; h.penalties = c.penalties; h.wasted = c.wasted;
    h.points = c.points;
    r.done = r.holes.every(function (x) { return x.score != null; });
    save();
    if (ui.holeIdx < 17) { ui.holeIdx++; freshHoleUi(ui); go('hole'); }
    else { ui.summaryId = r.id; go('summary'); }
  }

  /* ---------- settings ---------- */
  function settingsHtml() {
    var dh = currentDH();
    var siVals = S.course.si.slice().sort(function (a, b) { return a - b; }).join(',');
    var siOk = siVals === Array.from({ length: 18 }, function (_, i) { return i + 1; }).join(',');
    var rows = S.course.pars.map(function (p, i) {
      return '<tr><td><b>' + (i + 1) + '</b></td><td><input class="smallin" type="number" inputmode="numeric" data-set="par:' + i + '" value="' + p + '"></td>' +
        '<td><input class="smallin" type="number" inputmode="numeric" data-set="si:' + i + '" value="' + S.course.si[i] + '"></td></tr>';
    }).join('');
    return '<div class="bar"><div class="nav"><button class="arrow" data-a="home" aria-label="Home">⌂</button><div class="title">Settings</div><span style="width:56px"></span></div></div>' +
      '<div class="pad"><h2>Player</h2>' +
      '<label class="namefield">Your name<input type="text" maxlength="40" autocomplete="name" data-set="name" placeholder="e.g. Alex" value="' + esc(S.settings.name || '') + '"></label>' +
      '<p class="muted">Shown on the Home screen, on each new round and in backup file names. Each person uses Caddy4Me on their own phone with their own bag and handicap.</p>' +
      '<h2>Handicap</h2>' +
      '<div class="bagrow"><div class="nums">' +
      '<label>GA handicap<input type="number" inputmode="decimal" step="0.1" data-set="ga" value="' + (S.settings.ga != null ? S.settings.ga : '') + '"></label>' +
      '<label>Slope<input type="number" inputmode="numeric" data-set="slope" value="' + S.course.slope + '"></label>' +
      '<label>Scratch rating<input type="number" inputmode="decimal" step="0.1" data-set="scratch" value="' + S.course.scratch + '"></label></div></div>' +
      '<div class="tile dh"><div class="k">Daily handicap</div><div class="v" id="dhv">' + (dh != null ? dh : '–') + '</div>' +
      '<div class="muted">(GA × slope ÷ 113 + (scratch − par ' + coursePar() + ')) × 0.93. Fixed for a round when it starts.</div></div>' +
      '<h2>Melville Glades holes</h2>' + (siOk ? '' : '<p class="warn">Stroke indexes must be 1–18, each used once.</p>') +
      '<table class="settab"><thead><tr><th>Hole</th><th>Par</th><th>Stroke index</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="muted">Blue Men tees, from your MiScore card (18 Oct 2026).</p></div>';
  }
  app.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.set) return;
    var p = t.dataset.set.split(':'), v = Number(t.value);
    if (p[0] === 'name') { S.settings.name = t.value.trim().slice(0, 40); }
    else if (p[0] === 'ga') { if (t.value === '' || isNaN(v) || v < -10 || v > 54) return; S.settings.ga = Math.round(v * 10) / 10; }
    else if (p[0] === 'slope') { if (!(v >= 55 && v <= 155)) return; S.course.slope = Math.round(v); }
    else if (p[0] === 'scratch') { if (!(v >= 55 && v <= 85)) return; S.course.scratch = Math.round(v * 10) / 10; }
    else if (p[0] === 'par') { if (!(v >= 3 && v <= 6)) return; S.course.pars[+p[1]] = Math.round(v); }
    else if (p[0] === 'si') { if (!(v >= 1 && v <= 18)) return; S.course.si[+p[1]] = Math.round(v); }
    save(); render();
  });

  /* ---------- summary & past ---------- */
  function summaryHtml() {
    var r = roundById(ui.summaryId); if (!r) return homeHtml();
    var hs = holesWithPoints(r), s = E.roundSummary(hs);
    function tile(k, v, sub) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (sub ? '<div class="muted">' + sub + '</div>' : '') + '</div>'; }
    function pc(v) { return v == null ? '–' : v + '%'; }
    var fwMark = { hit: '✓', left: '←', right: '→' };
    function totRow(label, from, to) {
      var part = hs.slice(from, to), t = E.roundSummary(part);
      var par = part.reduce(function (a, h, j) { return a + (h.par || holePar(r, from + j)); }, 0);
      return '<tr class="tot"><td>' + label + '</td><td>' + par + '</td><td>' + (t.holes ? t.score : '') + '</td><td>' + (t.pointsHoles ? t.points : '') + '</td>' +
        '<td>' + (t.holes ? t.putts : '') + '</td><td>' + (t.fw ? t.fwHit + '/' + t.fw : '') + '</td><td>' + (t.statHoles ? t.gir : '') + '</td>' +
        '<td>' + (t.ud ? t.udMade + '/' + t.ud : '') + '</td><td>' + (t.holes ? t.penalties : '') + '</td><td>' + (t.holes ? t.wasted : '') + '</td></tr>';
    }
    var rowList = hs.map(function (h, i) {
      if (h.score == null) return '<tr><td>' + h.n + '</td><td>' + holePar(r, i) + '</td><td colspan="8">–</td></tr>';
      if (h.pickup) return '<tr><td>' + h.n + '</td><td>' + h.par + '</td><td><b>P</b></td><td><b>' + (h.points || 0) + '</b></td><td colspan="6" class="muted">picked up \u00b7 counted as ' + h.score + '</td></tr>';
      var st = E.holeStats(h);
      return '<tr data-a="editHole" data-v="' + i + '"><td>' + h.n + '</td><td>' + h.par + '</td><td><b>' + h.score + '</b></td><td><b>' + h.points + '</b></td><td>' + (h.putts != null ? h.putts : '') + '</td>' +
        '<td>' + (h.par >= 4 && h.fairway ? fwMark[h.fairway] : '') + '</td><td>' + (st.gir ? '✓' : '') + '</td>' +
        '<td>' + (st.upDownAttempt ? (h.upDown ? '✓' : '✗') : '') + '</td><td>' + (h.penalties || '') + '</td><td>' + (h.wasted || '') + '</td></tr>';
    });
    var rows = rowList.slice(0, 9).join('') + totRow('OUT', 0, 9) + rowList.slice(9).join('') + totRow('IN', 9, 18) + totRow('TOT', 0, 18);
    var grid = GRID.map(function (g) { return '<div class="gcell' + (g[0] === 'hit' ? ' hitc' : '') + '"><span>' + g[1] + '</span><b>' + s.miss[g[0]] + '</b></div>'; }).join('');
    return '<div class="photo sumhead"><img src="' + IMG.amen + '" alt="Stone bridge and par-3 green at the corner of the course" style="object-position:50% 40%">' +
      '<div class="over topbar"><button class="ibtn glass" data-a="home" aria-label="Home">' + ic('left') + '</button>' +
      '<span class="tag white">' + ic('flag') + (r.done ? 'ROUND COMPLETE' : s.holes + ' OF 18 HOLES') + '</span>' +
      '<button class="ibtn glass" data-a="export" aria-label="Export backup">' + ic('save') + '</button></div>' +
      '<div class="over big"><div class="n"><b>' + (s.pointsHoles ? s.points : '–') + '</b><i>PTS</i></div>' +
      '<div class="when">' + ((r.player || playerName()) ? esc(r.player || playerName()) + ' · ' : '') + esc(longDate(r.date)) + ' · Melville Glades</div></div></div>' +
      '<div class="pad"><div class="tiles">' +
      tile('Gross', s.holes ? s.score : '–', s.holes ? signed(s.toPar) + ' · daily hcp ' + roundDH(r) : 'daily hcp ' + roundDH(r)) +
      tile('Putts', s.putts, (s.puttsPerGir != null ? s.puttsPerGir + ' per GIR · ' : '') + s.chipIns + ' chip-ins') +
      tile('Greens', s.gir + '<small class="muted">/' + s.statHoles + '</small>', pc(s.girPct) + (s.pickups ? ' · ' + s.pickups + ' pick-ups' : '')) +
      tile('Fairways', s.fwHit + '<small class="muted">/' + s.fw + '</small>', pc(s.fwPct)) +
      tile('Up &amp; down', pc(s.udPct), s.udMade + ' of ' + s.ud) +
      tile('Sand saves', pc(s.sandPct), s.sandSaved + ' of ' + s.sandAtt + ' · ' + s.sandShots + ' sand shots') +
      tile('Wasted', s.wasted, 'shots') +
      tile('Penalties', s.penalties, 'shots') +
      '</div>' + pointsChart(hs) +
      '<h2>Approach shots</h2><div class="sumgrid">' + grid + '</div>' +
      '<h2>Hole by hole</h2><div class="tablebox"><table class="htab"><thead><tr><th>#</th><th>Par</th><th>Sc</th><th>Pts</th><th>Pt</th><th>FW</th><th>GIR</th><th>U&amp;D</th><th>Pen</th><th>Wst</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted">Tap a hole to edit it.</p>' +
      (!r.done && r.id === S.currentRoundId ? '<button class="btn primary" data-a="resume">Back to the round</button>' : '') +
      '<button class="btn small" data-a="export">Export backup</button><button class="btn small" data-a="home">Home</button>' +
      '<button class="btn small danger" data-a="deleteRound">' + (ui.confirmDelete ? 'Tap again to delete this round for good' : 'Delete this round') + '</button></div>';
  }
  function removeRound(id) {
    S.rounds = S.rounds.filter(function (r) { return r.id !== id; });
    if (S.currentRoundId === id) S.currentRoundId = null;
    save();
  }
  function pastHtml() {
    var list = S.rounds.slice().reverse().map(function (r) {
      var s = E.roundSummary(r.holes);
      return '<button class="btn small" data-a="openRound" data-v="' + esc(r.id) + '">' + esc(r.date) + ' · ' +
        (s.holes ? s.score + ' (' + signed(s.toPar) + ') over ' + s.holes + ' holes' : 'not started') + '</button>';
    }).join('');
    return '<div class="bar"><div class="nav"><button class="arrow" data-a="home" aria-label="Home">⌂</button><div class="title">Past rounds</div><span style="width:56px"></span></div></div>' +
      '<div class="pad">' + (list || '<p class="sub">No rounds yet.</p>') +
      '<h2>Import scores</h2><p class="muted">Load a Caddy4Me scores file (e.g. from your MiScore card). It updates strokes, putts and Stableford points for that date and keeps the other stats you entered.</p>' +
      '<p class="warn" id="impmsg">' + esc(ui.importMsg || '') + '</p>' +
      '<label class="btn small primary filebtn">Choose scores file<input type="file" id="impfile" accept=".json,application/json" hidden></label></div>';
  }
  function importScores(file) {
    var rd = new FileReader();
    rd.onload = function () {
      var f;
      try { f = JSON.parse(rd.result); } catch (e) { ui.importMsg = 'That file isn\u2019t a scores file.'; render(); return; }
      if (!f || f.type !== 'caddy4me-scores' || !/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') || !Array.isArray(f.holes) ||
          !f.holes.every(function (h) { return h && h.n >= 1 && h.n <= 18 && h.par >= 3 && h.par <= 6 && (h.score == null || (h.score >= 1 && h.score <= 20)); })) {
        ui.importMsg = 'That file isn\u2019t a valid Caddy4Me scores file.'; render(); return;
      }
      var r = S.rounds.filter(function (x) { return x.date === f.date; })[0];
      var created = false;
      if (!r) {
        var holes = [];
        for (var i = 0; i < 18; i++) holes.push({ n: i + 1, par: S.course.pars[i], si: S.course.si[i], score: null, putts: null, approach: null, upDown: null, sand: 0, penalties: 0, wasted: 0 });
        r = { id: f.date + 'T00:00:00.000Z', date: f.date, ground: 'normal', holes: holes, done: false };
        S.rounds.push(r); created = true;
      }
      var n = E.mergeScores(r, f);
      save();
      ui.importMsg = '';
      ui.summaryId = r.id; go('summary');
      setTimeout(function () { alertBanner((created ? 'Added' : 'Updated') + ' round ' + f.date + ' \u2013 ' + n + ' holes from ' + (f.source || 'file')); }, 30);
    };
    rd.readAsText(file);
  }
  function alertBanner(msg) {
    var b = document.createElement('div'); b.className = 'banner'; b.textContent = msg;
    app.insertBefore(b, app.firstChild.nextSibling);
    setTimeout(function () { b.remove(); }, 6000);
  }
  app.addEventListener('change', function (e) { if (e.target.id === 'impfile' && e.target.files[0]) importScores(e.target.files[0]); });
  app.addEventListener('change', function (e) {
    if (e.target.id !== 'restorefile' || !e.target.files[0]) return;
    var rd = new FileReader();
    rd.onload = function () {
      var b = null;
      try { b = JSON.parse(rd.result); } catch (err) { b = null; }
      if (!b || b.version !== 1 || !Array.isArray(b.rounds) || !Array.isArray(b.bag) || !b.course) {
        ui.restoreMsg = 'That file isn\u2019t a Caddy4Me backup.'; ui.pendingRestore = null;
      } else { ui.restoreMsg = ''; ui.pendingRestore = b; }
      render();
    };
    rd.readAsText(e.target.files[0]);
  });

  /* ---------- bag ---------- */
  function bagHtml() {
    var rows = S.bag.map(function (c, i) {
      var p = c.partials ? '<label>¾ carry<input type="number" inputmode="numeric" data-bag="' + i + ':p34" value="' + c.partials['3/4'] + '"></label>' +
                           '<label>½ carry<input type="number" inputmode="numeric" data-bag="' + i + ':p12" value="' + c.partials['1/2'] + '"></label>' : '';
      return '<div class="bagrow"><div class="club">' + esc(c.name) + '</div><div class="nums">' +
        '<label>Carry m<input type="number" inputmode="numeric" data-bag="' + i + ':carry" value="' + c.carry + '"></label>' +
        '<label>Total m<input type="number" inputmode="numeric" data-bag="' + i + ':total" value="' + c.total + '"></label>' + p + '</div></div>';
    }).join('');
    return '<div class="bar"><div class="nav"><button class="arrow" data-a="home" aria-label="Home">⌂</button><div class="title">My Bag</div><span style="width:56px"></span></div></div>' +
      '<div class="pad"><p class="sub">Your average distances in metres. Changes save straight away.</p>' + rows +
      '<button class="btn small" data-a="resetBag">' + (ui.confirmReset ? 'Tap again to reset all distances' : 'Reset to default distances') + '</button></div>';
  }
  app.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.bag) return;
    var parts = t.dataset.bag.split(':'), c = S.bag[+parts[0]], v = Math.round(Number(t.value));
    if (!(v > 0 && v < 400)) { t.value = ''; return; }
    if (parts[1] === 'carry') c.carry = v; else if (parts[1] === 'total') c.total = v;
    else if (parts[1] === 'p34') c.partials['3/4'] = v; else if (parts[1] === 'p12') c.partials['1/2'] = v;
    save();
  });

  /* ---------- before your round ---------- */
  function safeUrl(u) {
    u = String(u || '').trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { var x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') && x.hostname.indexOf('.') > 0 ? x.href : null; } catch (e) { return null; }
  }
  function prepHtml() {
    var P = S.prep, r = cur(), open = r && !r.done;
    var th = P.thoughts.map(function (t, i) {
      return '<div class="thought"><span class="num">' + (i + 1) + '</span><div class="ttext">' + esc(t) + '</div><button class="chip" data-a="delThought" data-v="' + i + '" aria-label="Remove">✕</button></div>';
    }).join('') || '<p class="muted">No swing thoughts yet.</p>';
    var vids = P.videos.map(function (v, i) {
      return '<div class="video"><a class="vlink" href="' + esc(v.url) + '" target="_blank" rel="noopener">' +
        '<span class="vthumb"><img src="' + IMG.ball + '" alt=""><span><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#0A0B0A"/></svg></span></span>' +
        '<span class="vtitle">' + esc(v.title) + '</span></a>' +
        '<button class="chip" data-a="delVideo" data-v="' + i + '" aria-label="Remove">✕</button></div>';
    }).join('') || '<p class="muted">No videos yet.</p>';
    return '<div class="photo prephead"><img src="' + IMG.bunker + '" alt="Sunrise through pines over a bunkered green and azaleas" style="object-position:50% 35%">' +
      '<div class="over topbar"><button class="ibtn glass" data-a="home" aria-label="Home">' + ic('left') + '</button></div>' +
      '<div class="over cap"><div class="kick">BEFORE YOUR ROUND</div><h1>Dew’s still on the grass.</h1><p>A few thoughts. One warm-up. Then the first tee.</p></div></div>' +
      '<div class="pad"><h2>Swing thoughts</h2>' + th +
      '<div class="addrow"><input id="newThought" class="textin" maxlength="120" placeholder="e.g. Smooth tempo, finish high" aria-label="New swing thought"><button class="btn small" data-a="addThought">Add thought</button></div>' +
      '<h2>Warm-up videos</h2>' + vids +
      '<div class="addrow"><input id="newVTitle" class="textin" maxlength="60" placeholder="Title, e.g. Wedge distance control" aria-label="Video title">' +
      '<input id="newVUrl" class="textin" inputmode="url" placeholder="Paste YouTube link" aria-label="YouTube link"><p class="warn" id="vmsg"></p>' +
      '<button class="btn small" data-a="addVideo">Add video</button></div>' +
      '<p class="muted">Tip: in YouTube tap Share → Copy link, then paste it here. Videos open in the YouTube app.</p>' +
      '<button class="btn primary" data-a="' + (open ? 'resume' : 'newRound') + '">' + (open ? 'Resume round' : 'Walk to the first tee') + ic('arrow') + '</button></div>';
  }

  /* ---------- export ---------- */
  function exportBackup() {
    var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'caddy4me-backup-' + (playerName() ? playerName().replace(/[^A-Za-z0-9]+/g, '-') + '-' : '') + today() + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- actions ---------- */
  var A = {
    home: function () { go('home'); },
    newRound: newRound,
    resume: function () { var r = cur(); if (!r) return; ui.holeIdx = firstOpenHole(r); freshHoleUi(ui); go('hole'); },
    bag: function () { go('bag'); },
    past: function () { go('past'); },
    export: exportBackup,
    openRound: function (v) { ui.summaryId = v; go('summary'); },
    editHole: function (v) { var r = roundById(ui.summaryId); if (!r) return; S.currentRoundId = r.id; save(); openCard(+v); },
    prevHole: function () { changeHole(-1); },
    nextHole: function () { changeHole(1); },
    zin: function () { if (map) map.zoomBy(1); },
    zout: function () { if (map) map.zoomBy(-1); },
    recenter: function () { if (map && ui.me) map.setView(ui.me); },
    mode: function (v) { ui.mode = v; if (ui.mode === 'tee') ui.lie = 'fairway'; updateHole(); },
    lie: function (v) { ui.lie = v; updateHole(); },
    ground: function (v) { cur().ground = v; save(); updateHole(); },
    cycleGround: function () { var r = cur(), o = ['soft', 'normal', 'firm']; r.ground = o[(o.indexOf(r.ground) + 1) % 3]; save(); updateHole(); },
    wind: windModal,
    wlive: function () { S.settings.windSource = 'live'; save(); maybeFetchWind(true); windModal(); updateHole(); },
    wdir: function (v) { S.settings.windSource = 'manual'; S.settings.manual.rel = +v; if (!S.settings.manual.speed) S.settings.manual.speed = 10; save(); windModal(); updateHole(); },
    wspd: function (v) { S.settings.windSource = 'manual'; S.settings.manual.speed = +v; save(); windModal(); updateHole(); },
    closeModal: closeModal,
    manualDist: distModal,
    setDist: function () { var v = Math.round(Number($('mdist').value)); if (v > 0 && v < 400) { ui.manualDist = v; if (ui.me) ui.shotFrom = ui.me; } closeModal(); updateHole(); },
    clearDist: function () { ui.manualDist = null; closeModal(); updateHole(); },
    holeDone: function () { openCard(ui.holeIdx); },
    backHole: function () { go('hole'); },
    step: function (v) {
      var p = v.split(':'), f = p[0], d = +p[1], c = ui.card;
      var lim = { score: [1, 15], putts: [0, 8], sand: [0, 9], penalties: [0, 9], wasted: [0, 15] }[f];
      c[f] = Math.max(lim[0], Math.min(lim[1], c[f] + d));
      if (f === 'wasted') c.touched.wasted = true;
      autoCard(); rerenderCard();
    },
    appr: function (v) {
      var c = ui.card; c.approach = c.approach === v ? null : v; c.touched.approach = true;
      if (c.approach === 'hit') c.girOverride = true; else if (c.approach) c.girOverride = false; // a miss means no GIR
      autoCard(); rerenderCard();
    },
    gir: function () {
      var c = ui.card; c.girOverride = !c.gir;
      if (c.girOverride) { c.approach = 'hit'; c.touched.approach = true; }
      else if (c.approach === 'hit') { c.approach = null; c.touched.approach = true; }
      autoCard(); rerenderCard();
    },
    fw: function (v) { ui.card.fairway = ui.card.fairway === v ? null : v; rerenderCard(); },
    chip: function () { var c = ui.card, on = !c.chipIn; if (on) c.putts = 0; autoCard(); c.chipIn = on; rerenderCard(); },
    ud: function () { var c = ui.card; if (c.gir) return; c.upDown = !(c.upDown === true); c.touched.upDown = true; autoCard(); rerenderCard(); },
    ss: function () {
      var c = ui.card; if (c.gir) return;
      c.sandSave = !(c.sandSave === true); c.touched.sandSave = true;
      if (c.sandSave && c.sand < 1) c.sand = 1; // a sand save needs a sand shot
      autoCard(); rerenderCard();
    },
    noop: function () {},
    settings: function () { go('settings'); },
    saveCard: saveCard,
    doRestore: function () {
      if (!ui.pendingRestore) return;
      var d = defaults(), b = ui.pendingRestore;
      Object.keys(d).forEach(function (k) { if (b[k] === undefined) b[k] = d[k]; });
      S = migrate(b); window.__c4m.S = S; save();
      ui.pendingRestore = null; ui.restoreMsg = 'Backup restored \u2013 ' + S.rounds.length + ' rounds.'; render();
    },
    cancelRestore: function () { ui.pendingRestore = null; render(); },
    prep: function () { go('prep'); },
    addThought: function () {
      var t = $('newThought').value.trim(); if (!t) return;
      S.prep.thoughts.push(t); save(); render();
    },
    delThought: function (v) { S.prep.thoughts.splice(+v, 1); save(); render(); },
    addVideo: function () {
      var url = safeUrl($('newVUrl').value), title = $('newVTitle').value.trim();
      if (!url) { $('vmsg').textContent = 'That link doesn\u2019t look right \u2013 paste the full YouTube link.'; return; }
      S.prep.videos.push({ title: title || 'Video ' + (S.prep.videos.length + 1), url: url }); save(); render();
    },
    delVideo: function (v) { S.prep.videos.splice(+v, 1); save(); render(); },
    discard: function () {
      var r = cur(); if (!r) return;
      if (!ui.confirmDiscard) { ui.confirmDiscard = true; render(); return; }
      removeRound(r.id); go('home');
    },
    deleteRound: function () {
      if (!ui.confirmDelete) { ui.confirmDelete = true; render(); return; }
      removeRound(ui.summaryId); ui.summaryId = null; go('past');
    },
    resetBag: function () {
      if (!ui.confirmReset) { ui.confirmReset = true; render(); return; }
      S.bag = E.clone(E.DEFAULT_BAG); save(); ui.confirmReset = false; render();
    }
  };
  function rerenderCard() { var y = window.scrollY; render(); window.scrollTo(0, y); }
  function onClick(e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var f = A[b.dataset.a]; if (f) f(b.dataset.v, b);
  }
  app.addEventListener('click', onClick);
  modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); return; } onClick(e); });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) { reg.update(); }).catch(function () {});
    // a new release took over: reload once so the new screens show straight away
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloaded) return; reloaded = true; window.location.reload();
    });
  }
  window.__c4m = { S: S, ui: ui };

  /* ---------- passcode lock ----------
   * Keeps casual visitors out. Not strong security: the code is public.
   * Once unlocked, this phone stays unlocked (remembered in localStorage).
   */
  var PIN_HASH = 'a53c168b2d84e5a698736c5de6374d76113ad1cd44b6760acc55845c68f5b67c';
  var UNLOCK_KEY = 'caddy4me.unlocked';
  function sha256(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function isUnlocked() { try { return localStorage.getItem(UNLOCK_KEY) === PIN_HASH; } catch (e) { return false; } }
  function showLock() {
    var entry = '';
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    function draw(msg) {
      app.innerHTML = '<div class="pad lock"><h1>Caddy4Me</h1><p class="sub">Enter your passcode</p>' +
        '<div class="dots">' + [0, 1, 2, 3].map(function (i) { return '<span class="' + (i < entry.length ? 'on' : '') + '"></span>'; }).join('') + '</div>' +
        '<p class="warn" id="lockmsg">' + (msg || '&nbsp;') + '</p>' +
        '<div class="keypad">' + keys.map(function (k) { return k ? '<button data-k="' + k + '">' + k + '</button>' : '<span></span>'; }).join('') + '</div></div>';
    }
    function onKey(e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      e.stopPropagation();
      var k = b.dataset.k;
      if (k === '⌫') entry = entry.slice(0, -1); else if (entry.length < 4) entry += k;
      draw();
      if (entry.length === 4) {
        sha256('caddy4me:' + entry).then(function (h) {
          if (h === PIN_HASH) {
            try { localStorage.setItem(UNLOCK_KEY, h); } catch (err) { /* ignore */ }
            app.removeEventListener('click', onKey, true);
            render();
          } else { entry = ''; draw('Wrong passcode'); }
        });
      }
    }
    app.addEventListener('click', onKey, true);
    draw();
  }

  if (isUnlocked()) render(); else showLock();
})();
