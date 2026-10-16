/* Caddy4Me app v0.1 - screens, GPS, wind, storage */
(function () {
  'use strict';
  var E = window.C4M;
  var KEY = 'caddy4me.v1';
  var WIND_MAX_AGE = 10 * 60 * 1000;
  var NEW_SHOT_M = 30;
  var LIE_KEYS = ['fairway', 'lightRough', 'heavyRough', 'bunker', 'hardpan'];
  var GROUNDS = [['soft', 'Soft'], ['normal', 'Normal'], ['firm', 'Firm']];
  var APPROACH = [['green', 'On green'], ['left', 'Left'], ['right', 'Right'], ['short', 'Short'], ['long', 'Long']];
  var WIND_DIRS = [[315, 'Into from L'], [0, 'Into'], [45, 'Into from R'], [270, 'From left'], [null, ''], [90, 'From right'], [225, 'Help from L'], [180, 'Helping'], [135, 'Help from R']];
  var WIND_SPEEDS = [[0, 'Calm'], [10, 'Light'], [20, 'Moderate'], [30, 'Strong'], [40, 'Very strong']];

  var app = document.getElementById('app');
  var modal = document.getElementById('modal');
  var S = load();
  var ui = freshHoleUi({ screen: 'home', holeIdx: 0, me: null, acc: null, gpsErr: '', card: null, summaryId: null, confirmReset: false });
  var map = null, watchId = null, wakeLock = null, windTimer = null, windBusy = false, windErr = false;

  /* ---------- storage ---------- */
  function defaults() {
    return { version: 1, bag: E.clone(E.DEFAULT_BAG),
      settings: { windSource: 'live', manual: { rel: 0, speed: 0 } },
      course: { name: 'Melville Glades', pars: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null] },
      rounds: [], currentRoundId: null, wind: null };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.version === 1) { var d = defaults(); Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; }); return s; }
    } catch (e) { /* fall through */ }
    return defaults();
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
  function signed(n) { return n === 0 ? 'E' : (n > 0 ? '+' + n : String(n)); }

  /* ---------- navigation ---------- */
  function go(screen) {
    if (ui.screen === 'hole' && screen !== 'hole') stopHole();
    ui.screen = screen; ui.confirmReset = false;
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
  }

  /* ---------- home ---------- */
  function homeHtml() {
    var r = cur(), open = r && !r.done;
    var nextHole = open ? firstOpenHole(r) + 1 : 1;
    return '<div class="pad"><h1>Caddy4Me</h1><p class="sub">Your caddie at Melville Glades</p>' +
      (open ? '<button class="btn primary" data-a="resume">Resume round – Hole ' + nextHole + '</button>' +
              '<button class="btn" data-a="newRound">Start a new round</button>'
            : '<button class="btn primary" data-a="newRound">Start round – Melville Glades</button>') +
      '<button class="btn" data-a="bag">My Bag</button>' +
      '<button class="btn" data-a="past">Past rounds</button>' +
      '<button class="btn small" data-a="export">Export backup</button>' +
      '<p class="muted">For social and practice rounds. Club advice from a device isn’t allowed in competition (Rule 4.3).</p></div>';
  }
  function firstOpenHole(r) { for (var i = 0; i < 18; i++) if (r.holes[i].score == null) return i; return 17; }
  function newRound() {
    var holes = [];
    for (var i = 0; i < 18; i++) holes.push({ n: i + 1, par: S.course.pars[i] || null, score: null, putts: null, approach: null, upDown: null, sand: 0, penalties: 0, wasted: 0 });
    var r = { id: new Date().toISOString(), date: today(), ground: 'normal', holes: holes, done: false };
    S.rounds.push(r); S.currentRoundId = r.id; save();
    ui.holeIdx = 0; freshHoleUi(ui); go('hole');
  }

  /* ---------- hole screen ---------- */
  function renderHole() {
    var lies = LIE_KEYS.map(function (k) { return '<button class="chip" data-a="lie" data-v="' + k + '">' + E.LIES[k].label + '</button>'; }).join('');
    var grounds = GROUNDS.map(function (g) { return '<button class="chip" data-a="ground" data-v="' + g[0] + '">' + g[1] + '</button>'; }).join('');
    app.innerHTML =
      '<div class="bar"><div class="nav"><button class="arrow" data-a="home" aria-label="Home">⌂</button>' +
      '<button class="arrow" data-a="prevHole" aria-label="Previous hole">‹</button><div class="title" id="htitle"></div>' +
      '<button class="arrow" data-a="nextHole" aria-label="Next hole">›</button></div>' +
      '<button class="windchip" data-a="wind" id="windchip"></button></div>' +
      '<div class="mapwrap"><div id="map"></div><div class="maphint" id="maphint" hidden></div>' +
      '<div class="mapbtns"><button data-a="zin" aria-label="Zoom in">+</button><button data-a="zout" aria-label="Zoom out">−</button>' +
      '<button data-a="recenter" aria-label="Centre on me">◎</button></div></div>' +
      '<section class="shot"><div class="row spread"><button class="dist" data-a="manualDist" id="dist"></button>' +
      '<div class="seg"><button data-a="mode" data-v="tee">Tee</button><button data-a="mode" data-v="approach">Approach</button></div></div>' +
      '<div id="liebox"><div class="label">Lie</div><div class="chips">' + lies + '</div></div>' +
      '<div class="label">Ground</div><div class="chips">' + grounds + '</div></section>' +
      '<section class="call" id="call"></section>' +
      '<div class="pad"><button class="btn primary" data-a="holeDone">Hole done – enter stats</button></div>';
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
    // George has walked to his ball: new shot
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
      '<path d="M13 3 L20 13 H15.5 V23 H10.5 V13 H6 Z" fill="#000"/></g></svg>';
  }

  function updateHole() {
    if (ui.screen !== 'hole' || !$('htitle')) return;
    var r = cur(), h = r.holes[ui.holeIdx];
    var par = h.par || S.course.pars[ui.holeIdx];
    $('htitle').textContent = 'Hole ' + (ui.holeIdx + 1) + ' · Par ' + (par || '?');
    var g = shotGeometry(), sw = shotWind(g.bearing);
    $('windchip').innerHTML = windArrow(sw.rel, sw.speed) + '<span>' + esc(sw.label) + '</span>';

    var hint = $('maphint'), msg = '', bad = false;
    if (ui.gpsErr) { msg = ui.gpsErr; bad = ui.gpsErr.indexOf('blocked') >= 0; }
    else if (!ui.me) msg = 'Waiting for GPS…';
    else if (ui.acc > 10) { msg = 'GPS weak ±' + Math.round(ui.acc) + ' m'; bad = true; }
    else if (!ui.target && !ui.manualDist) msg = ui.mode === 'tee' ? 'Tap your landing spot' : 'Tap the pin or your target';
    hint.hidden = !msg; hint.textContent = msg; hint.classList.toggle('gpsbad', bad);

    var d = $('dist');
    if (g.D) d.innerHTML = Math.round(g.D) + ' m<small>' + (g.src === 'entered' ? 'entered · tap to change' : 'to target · GPS ±' + Math.round(ui.acc || 0) + ' m') + '</small>';
    else d.innerHTML = '— m<small>tap to type a distance</small>';

    Array.prototype.forEach.call(app.querySelectorAll('[data-a="mode"]'), function (b) { b.classList.toggle('on', b.dataset.v === ui.mode); });
    Array.prototype.forEach.call(app.querySelectorAll('[data-a="lie"]'), function (b) { b.classList.toggle('on', b.dataset.v === ui.lie); });
    Array.prototype.forEach.call(app.querySelectorAll('[data-a="ground"]'), function (b) { b.classList.toggle('on', b.dataset.v === r.ground); });
    $('liebox').hidden = ui.mode === 'tee';

    var call = $('call');
    if (!g.D) { call.innerHTML = '<div class="empty">' + (ui.mode === 'tee' ? 'Tap where you want the tee shot to finish.' : 'Tap the pin or your target on the map.') + '</div>'; return; }
    var rec = E.recommend({ distance: g.D, mode: ui.mode, wind: sw.w, lie: ui.lie, ground: r.ground, bag: S.bag });
    var swing = rec.swing === 'full' ? 'full' : rec.swing === 'pitch' ? 'pitch' : rec.swing + ' swing';
    var lines = rec.reasons.concat(rec.notes);
    if (!sw.w && S.settings.windSource !== 'manual') lines.push('Wind not included');
    call.innerHTML =
      (rec.warning ? '<div class="warn">' + esc(rec.warning) + '</div>' : '') +
      '<div class="club">' + esc(rec.club.name) + '<span class="swing">' + esc(swing) + '</span></div>' +
      '<div class="plays">Plays like ' + rec.playsLike + ' m' + (rec.mode === 'tee' ? ' (landing zone)' : '') + '</div>' +
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

  /* ---------- hole card ---------- */
  function openCard(idx) {
    var r = cur(), h = r.holes[idx];
    var par = h.par || S.course.pars[idx] || 4;
    ui.holeIdx = idx;
    ui.card = { par: par, score: h.score != null ? h.score : par, putts: h.putts != null ? h.putts : 2,
      approach: h.approach, upDown: h.upDown, sand: h.sand || 0, penalties: h.penalties || 0,
      wasted: h.score != null ? (h.wasted || 0) : E.defaultWasted(2),
      touched: { approach: h.score != null, upDown: h.score != null, wasted: h.score != null } };
    autoCard();
    go('card');
  }
  function autoCard() {
    var c = ui.card;
    c.putts = Math.max(0, Math.min(c.putts, c.score));
    var st = E.holeStats(c);
    if (!c.touched.approach) c.approach = st.gir ? 'green' : null;
    if (st.gir && c.approach !== 'green' && !c.touched.approach) c.approach = 'green';
    if (!st.gir && c.approach === 'green' && !c.touched.approach) c.approach = null;
    if (!c.touched.upDown) c.upDown = st.gir ? null : E.suggestUpDown(c);
    if (!c.touched.wasted) c.wasted = E.defaultWasted(c.putts);
    c.gir = st.gir;
  }
  function stepper(field, label, hint) {
    return '<div class="field"><div class="name">' + label + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>' +
      '<div class="step"><button data-a="step" data-v="' + field + ':-1" aria-label="' + label + ' minus">−</button>' +
      '<span class="val">' + ui.card[field] + '</span>' +
      '<button data-a="step" data-v="' + field + ':1" aria-label="' + label + ' plus">+</button></div></div>';
  }
  function cardHtml() {
    var c = ui.card, n = ui.holeIdx + 1;
    var app_ = APPROACH.map(function (a) { return '<button class="chip' + (c.approach === a[0] ? ' on' : '') + '" data-a="appr" data-v="' + a[0] + '">' + a[1] + '</button>'; }).join('');
    var ud = c.gir ? '' : '<div class="field"><div class="name">Up &amp; down</div><div class="chips">' +
      '<button class="chip' + (c.upDown === true ? ' on' : '') + '" data-a="ud" data-v="1">Yes</button>' +
      '<button class="chip' + (c.upDown === false ? ' on' : '') + '" data-a="ud" data-v="0">No</button></div></div>';
    var toPar = c.score - c.par;
    return '<div class="bar"><div class="nav"><button class="arrow" data-a="backHole" aria-label="Back to hole">‹</button>' +
      '<div class="title">Hole ' + n + ' card</div><span style="width:56px"></span></div></div>' +
      '<div class="pad">' +
      stepper('par', 'Par') + stepper('score', 'Score', signed(toPar) + ' to par') + stepper('putts', 'Putts') +
      '<div class="field"><div class="name">Green in regulation</div><div class="calc' + (c.gir ? ' yes' : '') + '">' + (c.gir ? 'Yes' : 'No') + '</div></div>' +
      '<div class="label">Approach result</div><div class="chips">' + app_ + '</div>' + ud +
      stepper('sand', 'Sand shots') + stepper('penalties', 'Penalty shots') +
      stepper('wasted', 'Wasted shots', 'Duffs, shanks, whiffs, 3-putts, chips not on') +
      '<button class="btn primary" data-a="saveCard">' + (n < 18 ? 'Save – go to hole ' + (n + 1) : 'Save – finish round') + '</button>' +
      '<button class="btn small" data-a="backHole">Back to hole ' + n + '</button></div>';
  }
  function saveCard() {
    var r = cur(), c = ui.card, h = r.holes[ui.holeIdx];
    h.par = c.par; h.score = c.score; h.putts = c.putts; h.approach = c.approach;
    h.upDown = c.gir ? null : c.upDown; h.sand = c.sand; h.penalties = c.penalties; h.wasted = c.wasted;
    S.course.pars[ui.holeIdx] = c.par;
    if (ui.holeIdx >= 17 || r.holes.every(function (x) { return x.score != null; })) {
      r.done = r.holes.every(function (x) { return x.score != null; });
    }
    save();
    if (ui.holeIdx < 17) { ui.holeIdx++; freshHoleUi(ui); go('hole'); }
    else { ui.summaryId = r.id; go('summary'); }
  }

  /* ---------- summary & past ---------- */
  function summaryHtml() {
    var r = roundById(ui.summaryId); if (!r) return homeHtml();
    var s = E.roundSummary(r.holes);
    function tile(k, v, sub) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (sub ? '<div class="muted">' + sub + '</div>' : '') + '</div>'; }
    function pc(v) { return v == null ? '–' : v + '%'; }
    var rows = r.holes.map(function (h, i) {
      if (h.score == null) return '<tr><td>' + h.n + '</td><td>' + (h.par || '') + '</td><td colspan="7">–</td></tr>';
      var st = E.holeStats(h);
      return '<tr data-a="editHole" data-v="' + i + '"><td>' + h.n + '</td><td>' + h.par + '</td><td><b>' + h.score + '</b></td><td>' + h.putts + '</td><td>' + (st.gir ? '✓' : '') + '</td>' +
        '<td>' + (h.approach ? h.approach[0].toUpperCase() : '') + '</td><td>' + (st.upDownAttempt ? (h.upDown ? '✓' : '✗') : '') + '</td>' +
        '<td>' + (h.penalties || '') + '</td><td>' + (h.wasted || '') + '</td></tr>';
    }).join('');
    return '<div class="bar"><div class="nav"><button class="arrow" data-a="home" aria-label="Home">⌂</button><div class="title">Round ' + esc(r.date) + '</div><span style="width:56px"></span></div></div>' +
      '<div class="pad"><div class="tiles">' +
      tile('Score', s.holes ? s.score + ' (' + signed(s.toPar) + ')' : '–', s.holes + ' holes') +
      tile('Putts', s.putts, s.puttsPerGir != null ? s.puttsPerGir + ' per GIR' : '') +
      tile('GIR', pc(s.girPct), s.gir + ' of ' + s.holes) +
      tile('Up &amp; down', pc(s.udPct), s.udMade + ' of ' + s.ud) +
      tile('Sand saves', pc(s.sandPct), s.sandSaved + ' of ' + s.sandAtt + ' · ' + s.sandShots + ' sand shots') +
      tile('Wasted', s.wasted, s.penalties + ' penalty shots') +
      '</div><h2>Approach misses</h2><p class="sub">Green ' + s.miss.green + ' · Left ' + s.miss.left + ' · Right ' + s.miss.right + ' · Short ' + s.miss.short + ' · Long ' + s.miss.long + '</p>' +
      '<h2>Hole by hole</h2><table><thead><tr><th>#</th><th>Par</th><th>Sc</th><th>Pt</th><th>GIR</th><th>App</th><th>U&amp;D</th><th>Pen</th><th>Wst</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="muted">Tap a hole to edit it.</p>' +
      (!r.done && r.id === S.currentRoundId ? '<button class="btn primary" data-a="resume">Back to the round</button>' : '') +
      '<button class="btn small" data-a="export">Export backup</button><button class="btn small" data-a="home">Home</button></div>';
  }
  function pastHtml() {
    var list = S.rounds.slice().reverse().map(function (r) {
      var s = E.roundSummary(r.holes);
      return '<button class="btn small" data-a="openRound" data-v="' + esc(r.id) + '">' + esc(r.date) + ' · ' +
        (s.holes ? s.score + ' (' + signed(s.toPar) + ') over ' + s.holes + ' holes' : 'not started') + '</button>';
    }).join('');
    return '<div class="bar"><div class="nav"><button class="arrow" data-a="home" aria-label="Home">⌂</button><div class="title">Past rounds</div><span style="width:56px"></span></div></div>' +
      '<div class="pad">' + (list || '<p class="sub">No rounds yet.</p>') + '</div>';
  }

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

  /* ---------- export ---------- */
  function exportBackup() {
    var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'caddy4me-backup-' + today() + '.json';
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
      var lim = { par: [3, 6], score: [1, 15], putts: [0, 8], sand: [0, 9], penalties: [0, 9], wasted: [0, 15] }[f];
      c[f] = Math.max(lim[0], Math.min(lim[1], c[f] + d));
      if (f === 'wasted') c.touched.wasted = true;
      autoCard(); render();
    },
    appr: function (v) { ui.card.approach = ui.card.approach === v ? null : v; ui.card.touched.approach = true; render(); },
    ud: function (v) { ui.card.upDown = v === '1'; ui.card.touched.upDown = true; render(); },
    saveCard: saveCard,
    resetBag: function () {
      if (!ui.confirmReset) { ui.confirmReset = true; render(); return; }
      S.bag = E.clone(E.DEFAULT_BAG); save(); ui.confirmReset = false; render();
    }
  };
  function onClick(e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var f = A[b.dataset.a]; if (f) f(b.dataset.v, b);
  }
  app.addEventListener('click', onClick);
  modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); return; } onClick(e); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  window.__c4m = { S: S, ui: ui };
  render();
})();
