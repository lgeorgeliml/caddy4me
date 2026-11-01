// Run: node tests/course.test.js
const C = require('../course.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }
function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error((msg || '') + ' expected ~' + b + ' got ' + a); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

// Synthetic hole: green is a 30 m square centred 300 m north of the tee
const base = { lat: -32.0800, lon: 115.8700 };
const mN = 1 / 111195;                         // degrees latitude per metre
const mE = mN / Math.cos(base.lat * Math.PI / 180);
const at = (n, e) => ({ lat: base.lat + n * mN, lon: base.lon + e * mE });
const sq = (cn, ce, h) => [at(cn - h, ce - h), at(cn - h, ce + h), at(cn + h, ce + h), at(cn + h, ce - h), at(cn - h, ce - h)];
const way = (tags, pts) => ({ type: 'way', id: Math.floor(Math.random() * 1e9), tags, geometry: pts });
const osm = { elements: [
  { type: 'way', id: 1, tags: { leisure: 'golf_course', name: 'Test Glades' } },
  way({ golf: 'hole', ref: '1', par: '4' }, [at(300, 0), at(0, 0)]),            // drawn green -> tee on purpose
  way({ golf: 'green' }, sq(300, 0, 15)),
  way({ golf: 'green' }, sq(-80, 60, 10)),                                      // practice green near the tee
  { type: 'node', id: 9, lat: at(305, 3).lat, lon: at(305, 3).lon, tags: { golf: 'pin' } },
  way({ golf: 'tee' }, sq(0, 0, 5)),
  way({ golf: 'bunker' }, sq(200, 20, 8)),                                       // fairway bunker 200 m out
  way({ golf: 'bunker' }, sq(320, 25, 5)),                                       // greenside bunker
  way({ golf: 'bunker' }, sq(-30, 0, 4)),                                        // behind the tee
  way({ golf: 'fairway' }, [at(60, -15), at(60, 15), at(270, 15), at(270, -15), at(60, -15)]),
  way({ golf: 'hole', ref: '2', par: '3' }, [at(0, 400), at(150, 400)]),
  way({ golf: 'green' }, sq(150, 400, 12))
] };
const course = C.buildCourse(osm, { fetched: '2026-10-25' });
const h1 = C.hole(course, 1), h2 = C.hole(course, 2);

t('course name and 2 holes', () => { eq(course.name, 'Test Glades'); eq(course.holes.length, 2); });
t('hole line reversed to run tee -> green', () => { near(C.dist(C.ll(h1.line[0]), at(0, 0)), 0, 1); });
t('green matched to hole 1, practice green ignored', () => { near(C.dist(C.greenCentre(h1), at(300, 0)), 0, 1); });
t('pin matched', () => { near(C.dist(C.ll(h1.pin), at(305, 3)), 0, 1); });
t('tee, 3 bunkers and fairway assigned to hole 1', () => { eq(h1.tees.length, 1); eq(h1.bunkers.length, 3); eq(h1.fairways.length, 1); eq(h2.bunkers.length, 0); });
t('hole bearing ~ north', () => { const b = C.holeBearing(h1); near(b > 180 ? b - 360 : b, 0, 0.5); });
t('hole 2 bearing ~ north', () => { const b = C.holeBearing(h2); near(b > 180 ? b - 360 : b, 0, 0.5); });
t('F/M/B from 150 m short: 135 / 150 / 165', () => {
  const r = C.greenFMB(at(150, 0), h1); near(r.front, 135, 0.6); near(r.middle, 150, 0.6); near(r.back, 165, 0.6);
});
t('F/M/B from the tee: 285 / 300 / 315', () => {
  const r = C.greenFMB(at(0, 0), h1); near(r.front, 285, 0.6); near(r.middle, 300, 0.6); near(r.back, 315, 0.6);
});
t('F/M/B from an angle uses the line through the centre', () => {
  const r = C.greenFMB(at(300, -100), h1); near(r.front, 85, 0.6); near(r.middle, 100, 0.6); near(r.back, 115, 0.6);
});
t('standing on the green: front 0', () => { const r = C.greenFMB(at(295, 0), h1); eq(r.inside, true); eq(r.front, 0); });
t('bunkers ahead from the tee: fairway then greenside, not the one behind', () => {
  const b = C.bunkersAhead(at(0, 0), h1);
  eq(b.length, 2); near(b[0].reach, Math.hypot(192, 12), 1.5); near(b[0].carry, Math.hypot(208, 28), 1.5); eq(b[1].nearGreen, true);
});
t('bunkers ahead after passing the fairway bunker', () => { const b = C.bunkersAhead(at(250, 0), h1); eq(b.length, 1); eq(b[0].nearGreen, true); });
t('coordinates rounded to 6 decimals', () => { eq(String(h1.green[0][0]).split('.')[1].length <= 6, true); });
t('simplify keeps a square at 4-5 points', () => { eq(C.simplify(sq(0, 0, 10), 0.6).length <= 5, true); });
t('licence text present', () => { eq(/OpenStreetMap contributors/.test(course.licence), true); });

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
