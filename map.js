/* Caddy4Me - satellite map (no libraries) v0.5
 * Web-Mercator tiles, rotation (hole runs up the screen), one-finger pan, pinch zoom,
 * tap-to-target, draggable pin flag, hole outlines, "me" dot with accuracy ring.
 */
(function (root) {
  'use strict';
  var TILE = 256;
  var IMAGERY = {
    standard: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    clarity: 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  };
  var STYLE = {
    fairway: 'fill="rgba(166,243,106,0.10)" stroke="rgba(166,243,106,0.55)" stroke-width="1.5"',
    tee: 'fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"',
    bunker: 'fill="rgba(255,236,190,0.22)" stroke="#FFE7B0" stroke-width="1.5"',
    green: 'fill="rgba(166,243,106,0.18)" stroke="#A6F36A" stroke-width="2.5"',
    line: 'fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.5" stroke-dasharray="6 6"'
  };

  function rot(x, y, deg) { var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return { x: x * c - y * s, y: x * s + y * c }; }

  function SatMap(el, opts) {
    opts = opts || {};
    this.el = el;
    this.minZoom = 13; this.maxZoom = 20.5; this.maxNative = 19;
    this.center = opts.center || { lat: -32.077, lon: 115.8718 };
    this.zoom = opts.zoom || 17;
    this.bearing = 0;                                   // map bearing shown "up" (degrees)
    this.imagery = IMAGERY[opts.imagery] ? opts.imagery : 'standard';
    this.onTap = opts.onTap || function () {};
    this.onMove = opts.onMove || function () {};
    this.onPinDrag = opts.onPinDrag || function () {};
    this.me = null; this.acc = 0; this.target = null; this.pin = null; this.shapes = [];
    this.tiles = {};
    this.pointers = {};
    el.classList.add('satmap');
    el.innerHTML = '<div class="sm-tiles"></div><svg class="sm-over" xmlns="http://www.w3.org/2000/svg"></svg>' +
      '<div class="sm-attr">Imagery © Esri · Map data © OpenStreetMap contributors</div>';
    this.tileLayer = el.querySelector('.sm-tiles');
    this.svg = el.querySelector('.sm-over');
    this._bind();
    var self = this;
    if (root.ResizeObserver) new ResizeObserver(function () { self.render(); }).observe(el);
    this.render();
  }

  SatMap.prototype.project = function (ll, z) {
    var s = TILE * Math.pow(2, z);
    var lat = Math.max(-85, Math.min(85, ll.lat)) * Math.PI / 180;
    return { x: (ll.lon + 180) / 360 * s, y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * s };
  };
  SatMap.prototype.unproject = function (p, z) {
    var s = TILE * Math.pow(2, z);
    var n = Math.PI - 2 * Math.PI * p.y / s;
    return { lat: 180 / Math.PI * Math.atan(Math.sinh(n)), lon: p.x / s * 360 - 180 };
  };
  SatMap.prototype.size = function () { return { w: this.el.clientWidth, h: this.el.clientHeight }; };
  SatMap.prototype.toScreen = function (ll) {
    var sz = this.size(), c = this.project(this.center, this.zoom), p = this.project(ll, this.zoom);
    var s = rot(p.x - c.x, p.y - c.y, -this.bearing);
    return { x: s.x + sz.w / 2, y: s.y + sz.h / 2 };
  };
  SatMap.prototype.toLatLng = function (x, y) {
    var sz = this.size(), c = this.project(this.center, this.zoom), v = rot(x - sz.w / 2, y - sz.h / 2, this.bearing);
    return this.unproject({ x: c.x + v.x, y: c.y + v.y }, this.zoom);
  };
  SatMap.prototype.metersPerPixel = function (lat) {
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, this.zoom);
  };
  // keep world point `ll` under screen point (sx, sy)
  SatMap.prototype._anchor = function (ll, sx, sy) {
    var sz = this.size(), a = this.project(ll, this.zoom), v = rot(sx - sz.w / 2, sy - sz.h / 2, this.bearing);
    this.center = this.unproject({ x: a.x - v.x, y: a.y - v.y }, this.zoom);
  };

  SatMap.prototype.setView = function (ll, z) {
    this.center = { lat: ll.lat, lon: ll.lon };
    if (z != null) this.zoom = this._clampZ(z);
    this.render();
  };
  SatMap.prototype.setBearing = function (b) { this.bearing = ((b % 360) + 360) % 360; this.render(); };
  // fit points into the screen with the given bearing up
  SatMap.prototype.fit = function (pts, bearing, pad) {
    if (!pts || !pts.length) return;
    pad = pad || 36; this.bearing = ((bearing % 360) + 360) % 360;
    var sz = this.size(); if (!sz.w || !sz.h) return;
    var z0 = 20, P = pts.map(function (p) { return this.project(p, z0); }, this);
    var rp = P.map(function (p) { return rot(p.x, p.y, -this.bearing); }, this);
    var minX = Math.min.apply(null, rp.map(function (p) { return p.x; })), maxX = Math.max.apply(null, rp.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, rp.map(function (p) { return p.y; })), maxY = Math.max.apply(null, rp.map(function (p) { return p.y; }));
    var scale = Math.min((sz.w - 2 * pad) / Math.max(1, maxX - minX), (sz.h - 2 * pad) / Math.max(1, maxY - minY));
    this.zoom = this._clampZ(z0 + Math.log(scale) / Math.LN2);
    var mid = rot((minX + maxX) / 2, (minY + maxY) / 2, this.bearing);
    this.center = this.unproject(mid, z0);
    this.render();
  };
  SatMap.prototype.setImagery = function (name) {
    if (!IMAGERY[name] || name === this.imagery) return;
    this.imagery = name; var self = this;
    Object.keys(this.tiles).forEach(function (k) { self.tileLayer.removeChild(self.tiles[k]); });
    this.tiles = {}; this.render();
  };
  SatMap.prototype.setMe = function (ll, accM) { this.me = ll; this.acc = accM || 0; this._overlay(); };
  SatMap.prototype.setTarget = function (ll) { this.target = ll; this._overlay(); };
  SatMap.prototype.setPin = function (ll) { this.pin = ll; this._overlay(); };
  SatMap.prototype.setShapes = function (shapes) { this.shapes = shapes || []; this._overlay(); };
  SatMap.prototype.zoomBy = function (d) { this.zoom = this._clampZ(this.zoom + d); this.render(); };
  SatMap.prototype._clampZ = function (z) { return Math.max(this.minZoom, Math.min(this.maxZoom, z)); };

  SatMap.prototype.render = function () {
    var self = this, sz = this.size();
    if (!sz.w || !sz.h) return;
    var tz = Math.min(Math.floor(this.zoom), this.maxNative);
    var k = Math.pow(2, this.zoom - tz);
    var c = this.project(this.center, tz);
    var rr = Math.sqrt(sz.w * sz.w + sz.h * sz.h) / 2 / k;          // covers the screen at any rotation
    var x0 = Math.floor((c.x - rr) / TILE), x1 = Math.floor((c.x + rr) / TILE);
    var y0 = Math.floor((c.y - rr) / TILE), y1 = Math.floor((c.y + rr) / TILE);
    var used = {}, n = Math.pow(2, tz), tmpl = IMAGERY[this.imagery];
    for (var x = x0; x <= x1; x++) {
      for (var y = y0; y <= y1; y++) {
        if (y < 0 || y >= n) continue;
        var key = this.imagery + '/' + tz + '/' + x + '/' + y;
        used[key] = 1;
        var img = this.tiles[key];
        if (!img) {
          img = document.createElement('img');
          img.className = 'sm-tile'; img.alt = ''; img.draggable = false;
          img.onerror = function () { this.style.visibility = 'hidden'; };
          var xx = ((x % n) + n) % n;
          img.src = tmpl.replace('{z}', tz).replace('{y}', y).replace('{x}', xx);
          this.tiles[key] = img;
          this.tileLayer.appendChild(img);
        }
        var size = TILE * k, s = rot((x * TILE - c.x) * k, (y * TILE - c.y) * k, -this.bearing);
        img.style.width = img.style.height = Math.ceil(size + 1) + 'px';
        img.style.transform = 'translate(' + (s.x + sz.w / 2) + 'px,' + (s.y + sz.h / 2) + 'px) rotate(' + (-this.bearing) + 'deg)';
      }
    }
    Object.keys(this.tiles).forEach(function (key) {
      if (!used[key]) { self.tileLayer.removeChild(self.tiles[key]); delete self.tiles[key]; }
    });
    this._overlay();
  };

  SatMap.prototype._overlay = function () {
    var self = this, sz = this.size(), h = '';
    this.svg.setAttribute('viewBox', '0 0 ' + sz.w + ' ' + sz.h);
    var order = { fairway: 0, tee: 1, line: 2, bunker: 3, green: 4 };
    this.shapes.slice().sort(function (a, b) { return (order[a.kind] || 0) - (order[b.kind] || 0); }).forEach(function (sh) {
      var pts = sh.pts.map(function (p) { var q = self.toScreen(p); return q.x.toFixed(1) + ',' + q.y.toFixed(1); }).join(' ');
      h += sh.kind === 'line' ? '<polyline points="' + pts + '" ' + STYLE.line + '/>' : '<polygon points="' + pts + '" ' + (STYLE[sh.kind] || STYLE.tee) + '/>';
    });
    var me = this.me ? this.toScreen(this.me) : null, tg = this.target ? this.toScreen(this.target) : null, pn = this.pin ? this.toScreen(this.pin) : null;
    var lineTo = tg || pn;
    if (me && lineTo) h += '<line x1="' + me.x + '" y1="' + me.y + '" x2="' + lineTo.x + '" y2="' + lineTo.y + '" stroke="#000" stroke-width="6" stroke-linecap="round"/>' +
      '<line x1="' + me.x + '" y1="' + me.y + '" x2="' + lineTo.x + '" y2="' + lineTo.y + '" stroke="#A6F36A" stroke-width="3" stroke-linecap="round"/>';
    if (pn) h += '<g class="sm-pin" transform="translate(' + pn.x + ',' + pn.y + ')"><circle r="16" fill="rgba(10,11,10,0.35)" stroke="#FFFFFF" stroke-width="1.5" stroke-dasharray="3 3"/>' +
      '<line x1="0" y1="0" x2="0" y2="-26" stroke="#FFFFFF" stroke-width="2.5"/><path d="M0 -26 L16 -20 L0 -14 Z" fill="#FF5A4E"/><circle r="3.5" fill="#FFFFFF"/></g>';
    if (me) {
      var r = this.acc / this.metersPerPixel(this.me.lat);
      if (r > 8) h += '<circle cx="' + me.x + '" cy="' + me.y + '" r="' + r + '" fill="rgba(30,136,229,0.18)" stroke="#1E88E5" stroke-width="1.5"/>';
      h += '<circle cx="' + me.x + '" cy="' + me.y + '" r="9" fill="#1E88E5" stroke="#fff" stroke-width="3"/>';
    }
    if (tg) h += '<g transform="translate(' + tg.x + ',' + tg.y + ')"><circle r="13" fill="#A6F36A" stroke="#0A0B0A" stroke-width="2.5"/><circle r="3.5" fill="#000"/></g>';
    this.svg.innerHTML = h;
  };

  SatMap.prototype._bind = function () {
    var self = this, el = this.el;
    el.style.touchAction = 'none';
    function pt(e) { var r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function ids() { return Object.keys(self.pointers); }
    function startGesture() {
      var p = ids().map(function (i) { return self.pointers[i]; });
      self.g = { zoom: self.zoom, center: self.center };
      if (p.length === 1) { self.g.p0 = { x: p[0].x, y: p[0].y }; }
      else if (p.length >= 2) {
        self.g.d0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
        var mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        self.g.anchor = self.toLatLng(mid.x, mid.y);
        self.moved = true; self.pinDrag = false; // a pinch is never a tap or a pin drag
      }
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      var q = pt(e);
      self.pointers[e.pointerId] = q;
      if (ids().length === 1) {
        self.moved = false; self.downAt = Date.now(); self.downPt = q;
        var pn = self.pin ? self.toScreen(self.pin) : null;
        // the flag is drawn above its base: accept touches on the base or the flag
        self.pinDrag = !!(pn && (Math.hypot(pn.x - q.x, pn.y - q.y) < 34 || Math.hypot(pn.x + 6 - q.x, pn.y - 22 - q.y) < 26));
      }
      startGesture();
    });
    el.addEventListener('pointermove', function (e) {
      if (!self.pointers[e.pointerId]) return;
      self.pointers[e.pointerId] = pt(e);
      var p = ids().map(function (i) { return self.pointers[i]; });
      if (p.length === 1 && self.pinDrag) {
        if (!self.moved && Math.hypot(p[0].x - self.downPt.x, p[0].y - self.downPt.y) < 4) return;
        self.moved = true;
        self.pin = self.toLatLng(p[0].x, p[0].y); self._overlay(); self.onPinDrag(self.pin, false);
      } else if (p.length === 1 && self.g && self.g.p0) {
        var dx = p[0].x - self.g.p0.x, dy = p[0].y - self.g.p0.y;
        if (!self.moved && Math.hypot(dx, dy) < 8) return;
        self.moved = true;
        var c = self.project(self.g.center, self.zoom), v = rot(dx, dy, self.bearing);
        self.center = self.unproject({ x: c.x - v.x, y: c.y - v.y }, self.zoom);
        self.render(); self.onMove();
      } else if (p.length >= 2 && self.g && self.g.d0) {
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        self.zoom = self._clampZ(self.g.zoom + Math.log(d / self.g.d0) / Math.LN2);
        self._anchor(self.g.anchor, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
        self.render(); self.onMove();
      }
    });
    function end(e) {
      if (!self.pointers[e.pointerId]) return;
      var wasSingle = ids().length === 1;
      delete self.pointers[e.pointerId];
      if (wasSingle && self.pinDrag && self.moved) { self.onPinDrag(self.pin, true); }
      else if (wasSingle && !self.moved && e.type === 'pointerup' && Date.now() - self.downAt < 600) {
        self.onTap(self.toLatLng(self.downPt.x, self.downPt.y));
      }
      self.pinDrag = false;
      if (ids().length) startGesture(); else self.g = null;
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = pt(e), a = self.toLatLng(p.x, p.y);
      self.zoom = self._clampZ(self.zoom - e.deltaY / 300);
      self._anchor(a, p.x, p.y);
      self.render();
    }, { passive: false });
  };

  SatMap.IMAGERY = IMAGERY;
  root.SatMap = SatMap;
})(this);
