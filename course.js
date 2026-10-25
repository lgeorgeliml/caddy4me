/* Caddy4Me course module v0.5
 * Turns OpenStreetMap golf data (Overpass "out geom" JSON) into hole layouts,
 * and works out front / middle / back of the green and bunker reach / carry.
 * Pure functions: browser (window.C4MCourse) and Node (module.exports).
 * Map data © OpenStreetMap contributors (ODbL).
 */
(function (root) {
  'use strict';
  var RAD = Math.PI / 180, R = 6371008.8;

  /* ---------- small geometry (local flat metres around a reference point) ---------- */
  function toXY(ref, p) {
    return { x: (p.lon - ref.lon) * RAD * R * Math.cos(ref.lat * RAD), y: (p.lat - ref.lat) * RAD * R };
  }
  function toLL(ref, q) {
    return { lat: ref.lat + q.y / R / RAD, lon: ref.lon + q.x / (R * Math.cos(ref.lat * RAD)) / RAD };
  }
  function dist(a, b) { var q = toXY(a, b); return Math.sqrt(q.x * q.x + q.y * q.y); }
  function bearing(a, b) {
    var y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
    var x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  function centroid(poly) {
    // area-weighted centroid in local metres; falls back to vertex mean
    var ref = poly[0], a = 0, cx = 0, cy = 0;
    for (var i = 0; i < poly.length; i++) {
      var p = toXY(ref, poly[i]), q = toXY(ref, poly[(i + 1) % poly.length]), f = p.x * q.y - q.x * p.y;
      a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
    }
    if (Math.abs(a) < 1e-6) {
      var s = poly.reduce(function (m, p) { return { lat: m.lat + p.lat / poly.length, lon: m.lon + p.lon / poly.length }; }, { lat: 0, lon: 0 });
      return s;
    }
    return toLL(ref, { x: cx / (3 * a), y: cy / (3 * a) });
  }
  function pointInPoly(pt, poly) {
    var ref = pt, inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = toXY(ref, poly[i]), b = toXY(ref, poly[j]);
      if (((a.y > 0) !== (b.y > 0)) && (0 < (b.x - a.x) * (0 - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    return inside;
  }
  function distToPolyline(pt, line) {
    var best = Infinity;
    for (var i = 0; i < line.length - 1; i++) {
      var a = toXY(pt, line[i]), b = toXY(pt, line[i + 1]);
      var dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
      var t = L ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / L)) : 0;
      var x = a.x + t * dx, y = a.y + t * dy;
      best = Math.min(best, Math.sqrt(x * x + y * y));
    }
    return line.length === 1 ? dist(pt, line[0]) : best;
  }
  function simplify(pts, tolM) {
    // Douglas-Peucker in local metres
    if (pts.length < 3) return pts.slice();
    var ref = pts[0], xy = pts.map(function (p) { return toXY(ref, p); }), keep = new Array(pts.length);
    keep[0] = keep[pts.length - 1] = true;
    (function dp(s, e) {
      var a = xy[s], b = xy[e], dx = b.x - a.x, dy = b.y - a.y, L = Math.sqrt(dx * dx + dy * dy) || 1e-9, md = -1, mi = -1;
      for (var i = s + 1; i < e; i++) {
        var d = Math.abs(dy * xy[i].x - dx * xy[i].y + b.x * a.y - b.y * a.x) / L;
        if (d > md) { md = d; mi = i; }
      }
      if (md > tolM) { keep[mi] = true; dp(s, mi); dp(mi, e); }
    })(0, pts.length - 1);
    return pts.filter(function (_, i) { return keep[i]; });
  }
  function r6(p) { return [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]; }
  function ll(a) { return { lat: a[0], lon: a[1] }; }

  /* ---------- build hole layouts from Overpass JSON ---------- */
  function geomOf(el) {
    if (el.type === 'node') return [{ lat: el.lat, lon: el.lon }];
    if (el.geometry) return el.geometry.map(function (g) { return { lat: g.lat, lon: g.lon }; });
    if (el.members) { // multipolygon: first outer ring
      var outer = el.members.filter(function (m) { return m.role === 'outer' && m.geometry; })[0];
      if (outer) return outer.geometry.map(function (g) { return { lat: g.lat, lon: g.lon }; });
    }
    return null;
  }
  function openRing(pts) {
    if (pts.length > 2 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lon === pts[pts.length - 1].lon) return pts.slice(0, -1);
    return pts;
  }

  function buildCourse(osm, opts) {
    opts = opts || {};
    var els = (osm && osm.elements) || [];
    var feats = { hole: [], green: [], pin: [], tee: [], bunker: [], fairway: [] };
    var course = null;
    els.forEach(function (el) {
      var t = el.tags || {};
      if (t.leisure === 'golf_course' && !course) course = { name: t.name || 'Golf course', id: el.type + '/' + el.id };
      if (!t.golf || !feats[t.golf]) return;
      var g = geomOf(el); if (!g || !g.length) return;
      feats[t.golf].push({ tags: t, pts: t.golf === 'hole' || t.golf === 'pin' ? g : openRing(g) });
    });
    var holes = [];
    feats.hole.forEach(function (h) {
      var n = parseInt(h.tags.ref, 10); if (!(n >= 1 && n <= 36)) return;
      var line = h.pts.slice();
      // make the line run tee -> green: the green end is the one nearer a green or pin
      var ends = [line[0], line[line.length - 1]];
      var near = function (p) {
        var m = Infinity;
        feats.green.forEach(function (gr) { m = Math.min(m, dist(p, centroid(gr.pts))); });
        feats.pin.forEach(function (pn) { m = Math.min(m, dist(p, pn.pts[0])); });
        return m;
      };
      if (near(ends[0]) < near(ends[1])) line.reverse();
      var end = line[line.length - 1], start = line[0];
      // green: contains the line end, else nearest centroid within 60 m
      var green = null, bestG = Infinity;
      feats.green.forEach(function (gr) {
        var d = pointInPoly(end, gr.pts) ? 0 : dist(end, centroid(gr.pts));
        if (d < bestG) { bestG = d; green = gr; }
      });
      if (bestG > 60) green = null;
      var pin = null, bestP = Infinity;
      feats.pin.forEach(function (pn) { var d = dist(end, pn.pts[0]); if (d < bestP) { bestP = d; pin = pn; } });
      if (bestP > 40) pin = null;
      holes.push({ n: n, par: parseInt(h.tags.par, 10) || null, line: line, green: green ? green.pts : null, pin: pin ? pin.pts[0] : null, start: start, end: end,
        tees: [], bunkers: [], fairways: [] });
    });
    holes.sort(function (a, b) { return a.n - b.n; });
    // tees, bunkers and fairways go to the hole whose line of play is nearest
    function assign(list, key, maxM, useStart) {
      list.forEach(function (f) {
        var c = f.pts.length > 2 ? centroid(f.pts) : f.pts[0], best = null, bd = Infinity;
        holes.forEach(function (h) {
          var d = useStart ? dist(c, h.start) : distToPolyline(c, h.line);
          if (d < bd) { bd = d; best = h; }
        });
        if (best && bd <= maxM) best[key].push(f.pts);
      });
    }
    assign(feats.tee, 'tees', 70, true);
    assign(feats.bunker, 'bunkers', 60, false);
    assign(feats.fairway, 'fairways', 60, false);
    var tol = opts.toleranceM != null ? opts.toleranceM : 0.6;
    var out = {
      v: 1, source: 'OpenStreetMap', licence: '© OpenStreetMap contributors (ODbL)', fetched: opts.fetched || null,
      name: course ? course.name : 'Golf course', osmId: course ? course.id : null,
      holes: holes.map(function (h) {
        var o = { n: h.n, par: h.par, line: h.line.map(r6) };
        if (h.green) o.green = simplify(h.green, tol).map(r6);
        if (h.pin) o.pin = r6(h.pin);
        o.tees = h.tees.map(function (p) { return simplify(p, tol).map(r6); });
        o.bunkers = h.bunkers.map(function (p) { return simplify(p, tol).map(r6); });
        o.fairways = h.fairways.map(function (p) { return simplify(p, tol * 1.5).map(r6); });
        return o;
      })
    };
    return out;
  }

  /* ---------- distances on the course ---------- */
  function hole(courseData, n) { return (courseData && courseData.holes || []).filter(function (h) { return h.n === n; })[0] || null; }
  function greenCentre(h) { return h.green && h.green.length > 2 ? centroid(h.green.map(ll)) : (h.pin ? ll(h.pin) : ll(h.line[h.line.length - 1])); }
  function holeBearing(h) { return bearing(ll(h.line[0]), greenCentre(h)); }

  // Front / middle / back along the line from the player through the green centre
  function greenFMB(player, h) {
    var mid = greenCentre(h), M = dist(player, mid);
    if (!h.green || h.green.length < 3) return { front: M, middle: M, back: M, inside: false };
    var poly = h.green.map(ll);
    var P = { x: 0, y: 0 }, C = toXY(player, mid), dx = C.x - P.x, dy = C.y - P.y, L = Math.sqrt(dx * dx + dy * dy) || 1e-9;
    var ux = dx / L, uy = dy / L, ts = [];
    for (var i = 0; i < poly.length; i++) {
      var a = toXY(player, poly[i]), b = toXY(player, poly[(i + 1) % poly.length]);
      var ex = b.x - a.x, ey = b.y - a.y, den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-9) continue;
      var t = (a.x * ey - a.y * ex) / den;           // distance along the ray
      var s = (a.x * uy - a.y * ux) / den;           // position along the edge 0..1
      if (s >= 0 && s <= 1 && t >= 0) ts.push(t);
    }
    var inside = pointInPoly(player, poly);
    if (!ts.length) return { front: M, middle: M, back: M, inside: inside };
    var front = inside ? 0 : Math.min.apply(null, ts), back = Math.max.apply(null, ts);
    return { front: front, middle: M, back: Math.max(back, M), inside: inside };
  }

  // Bunkers ahead of the player on this hole: reach (nearest edge) and carry (farthest edge)
  function bunkersAhead(player, h, max) {
    var gc = greenCentre(h), toGreen = dist(player, gc), out = [];
    (h.bunkers || []).forEach(function (b, i) {
      var pts = b.map(ll), c = centroid(pts);
      if (dist(c, gc) >= toGreen) return;                // behind or beside the player
      var reach = Infinity, carry = 0;
      pts.forEach(function (p) { var d = dist(player, p); reach = Math.min(reach, d); carry = Math.max(carry, d); });
      if (carry < 5) return;
      out.push({ i: i, reach: reach, carry: carry, nearGreen: dist(c, gc) < 35 });
    });
    out.sort(function (a, b) { return a.reach - b.reach; });
    return out.slice(0, max || 3);
  }

  var api = {
    buildCourse: buildCourse, hole: hole, greenCentre: greenCentre, holeBearing: holeBearing,
    greenFMB: greenFMB, bunkersAhead: bunkersAhead,
    dist: dist, bearing: bearing, centroid: centroid, pointInPoly: pointInPoly, simplify: simplify, ll: ll,
    OVERPASS_QUERY: function (name) {
      return '[out:json][timeout:90];(way["leisure"="golf_course"]["name"~"' + name + '",i];relation["leisure"="golf_course"]["name"~"' + name + '",i];)->.c;' +
        '.c out tags;.c map_to_area->.a;(nwr["golf"~"^(hole|green|pin|tee|bunker|fairway)$"](area.a););out geom;';
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C4MCourse = api;
})(this);
