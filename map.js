/* Caddy4Me - minimal satellite map (no libraries).
 * Web-Mercator tiles, one-finger pan, pinch zoom, tap-to-target,
 * "me" dot with accuracy ring, target pin and line.
 */
(function (root) {
  'use strict';
  var TILE = 256;
  var URL_TMPL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  function SatMap(el, opts) {
    opts = opts || {};
    this.el = el;
    this.minZoom = 13; this.maxZoom = 20.5; this.maxNative = 19;
    this.center = opts.center || { lat: -32.07, lon: 115.86 };
    this.zoom = opts.zoom || 17;
    this.onTap = opts.onTap || function () {};
    this.onMove = opts.onMove || function () {};
    this.me = null; this.acc = 0; this.target = null;
    this.tiles = {};
    this.pointers = {};
    el.classList.add('satmap');
    el.innerHTML = '<div class="sm-tiles"></div><svg class="sm-over" xmlns="http://www.w3.org/2000/svg"></svg>' +
      '<div class="sm-attr">Imagery © Esri, Maxar, Earthstar Geographics</div>';
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
    return { x: p.x - c.x + sz.w / 2, y: p.y - c.y + sz.h / 2 };
  };
  SatMap.prototype.toLatLng = function (x, y) {
    var sz = this.size(), c = this.project(this.center, this.zoom);
    return this.unproject({ x: c.x + x - sz.w / 2, y: c.y + y - sz.h / 2 }, this.zoom);
  };
  SatMap.prototype.metersPerPixel = function (lat) {
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, this.zoom);
  };

  SatMap.prototype.setView = function (ll, z) {
    this.center = { lat: ll.lat, lon: ll.lon };
    if (z != null) this.zoom = this._clampZ(z);
    this.render();
  };
  SatMap.prototype.setMe = function (ll, accM) { this.me = ll; this.acc = accM || 0; this._overlay(); };
  SatMap.prototype.setTarget = function (ll) { this.target = ll; this._overlay(); };
  SatMap.prototype.zoomBy = function (d) { this.zoom = this._clampZ(this.zoom + d); this.render(); };
  SatMap.prototype._clampZ = function (z) { return Math.max(this.minZoom, Math.min(this.maxZoom, z)); };

  SatMap.prototype.render = function () {
    var self = this, sz = this.size();
    if (!sz.w || !sz.h) return;
    var tz = Math.min(Math.floor(this.zoom), this.maxNative);
    var k = Math.pow(2, this.zoom - tz);
    var c = this.project(this.center, tz);
    var x0 = Math.floor((c.x - sz.w / 2 / k) / TILE), x1 = Math.floor((c.x + sz.w / 2 / k) / TILE);
    var y0 = Math.floor((c.y - sz.h / 2 / k) / TILE), y1 = Math.floor((c.y + sz.h / 2 / k) / TILE);
    var used = {}, n = Math.pow(2, tz);
    for (var x = x0; x <= x1; x++) {
      for (var y = y0; y <= y1; y++) {
        if (y < 0 || y >= n) continue;
        var key = tz + '/' + x + '/' + y;
        used[key] = 1;
        var img = this.tiles[key];
        if (!img) {
          img = document.createElement('img');
          img.className = 'sm-tile'; img.alt = ''; img.draggable = false;
          img.onerror = function () { this.style.visibility = 'hidden'; };
          var xx = ((x % n) + n) % n;
          img.src = URL_TMPL.replace('{z}', tz).replace('{y}', y).replace('{x}', xx);
          this.tiles[key] = img;
          this.tileLayer.appendChild(img);
        }
        var size = TILE * k;
        img.style.width = img.style.height = Math.ceil(size + 0.5) + 'px';
        img.style.transform = 'translate(' + ((x * TILE - c.x) * k + sz.w / 2) + 'px,' + ((y * TILE - c.y) * k + sz.h / 2) + 'px)';
      }
    }
    Object.keys(this.tiles).forEach(function (key) {
      if (!used[key]) { self.tileLayer.removeChild(self.tiles[key]); delete self.tiles[key]; }
    });
    this._overlay();
  };

  SatMap.prototype._overlay = function () {
    var sz = this.size(), h = '';
    this.svg.setAttribute('viewBox', '0 0 ' + sz.w + ' ' + sz.h);
    var me = this.me ? this.toScreen(this.me) : null, tg = this.target ? this.toScreen(this.target) : null;
    if (me && tg) h += '<line x1="' + me.x + '" y1="' + me.y + '" x2="' + tg.x + '" y2="' + tg.y + '" stroke="#000" stroke-width="6" stroke-linecap="round"/>' +
      '<line x1="' + me.x + '" y1="' + me.y + '" x2="' + tg.x + '" y2="' + tg.y + '" stroke="#A6F36A" stroke-width="3" stroke-linecap="round"/>';
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
        self.g.mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        self.g.anchor = self.toLatLng(self.g.mid.x, self.g.mid.y);
        self.moved = true; // a pinch is never a tap
      }
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      self.pointers[e.pointerId] = pt(e);
      if (ids().length === 1) { self.moved = false; self.downAt = Date.now(); self.downPt = pt(e); }
      startGesture();
    });
    el.addEventListener('pointermove', function (e) {
      if (!self.pointers[e.pointerId]) return;
      self.pointers[e.pointerId] = pt(e);
      var p = ids().map(function (i) { return self.pointers[i]; });
      if (p.length === 1 && self.g && self.g.p0) {
        var dx = p[0].x - self.g.p0.x, dy = p[0].y - self.g.p0.y;
        if (!self.moved && Math.hypot(dx, dy) < 8) return;
        self.moved = true;
        var c = self.project(self.g.center, self.zoom);
        self.center = self.unproject({ x: c.x - dx, y: c.y - dy }, self.zoom);
        self.render(); self.onMove();
      } else if (p.length >= 2 && self.g && self.g.d0) {
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        self.zoom = self._clampZ(self.g.zoom + Math.log(d / self.g.d0) / Math.LN2);
        var mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        var sz = self.size(), a = self.project(self.g.anchor, self.zoom);
        self.center = self.unproject({ x: a.x - (mid.x - sz.w / 2), y: a.y - (mid.y - sz.h / 2) }, self.zoom);
        self.render(); self.onMove();
      }
    });
    function end(e) {
      if (!self.pointers[e.pointerId]) return;
      var wasSingle = ids().length === 1;
      delete self.pointers[e.pointerId];
      if (wasSingle && !self.moved && e.type === 'pointerup' && Date.now() - self.downAt < 600) {
        self.onTap(self.toLatLng(self.downPt.x, self.downPt.y));
      }
      if (ids().length) startGesture(); else self.g = null;
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = pt(e), a = self.toLatLng(p.x, p.y);
      self.zoom = self._clampZ(self.zoom - e.deltaY / 300);
      var sz = self.size(), q = self.project(a, self.zoom);
      self.center = self.unproject({ x: q.x - (p.x - sz.w / 2), y: q.y - (p.y - sz.h / 2) }, self.zoom);
      self.render();
    }, { passive: false });
  };

  root.SatMap = SatMap;
})(this);
