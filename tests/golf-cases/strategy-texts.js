#!/usr/bin/env node
/* Plan wording fixture for the Android app's golf_core wording test (strategy_rules_test.dart).
 * The shared cases compare decisions only, so this file lets the product check the plan text too.
 *
 *   node tests/golf-cases/strategy-texts.js <golf-cases checkout> <output strategy_texts.json>
 *
 * Bags and rounds come from the golf-cases fixtures, exactly as the Dart test loads them.
 * Regenerate (and copy into caddy4me-android/packages/golf_core/test/fixtures/) when strategy.js changes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const E = require(path.join(ROOT, 'engine.js'));
const ST = require(path.join(ROOT, 'strategy.js'));
const VERSION = (require(path.join(ROOT, 'version.js')) || {}).C4M_VERSION || {};

const DIR = path.resolve(process.argv[2] || path.join(ROOT, 'golf-cases'));
const OUT = path.resolve(process.argv[3] || 'strategy_texts.json');
const load = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const BAGS = load('fixtures/bags.json'), ROUNDS = load('fixtures/rounds.json');
const BOOKS = { 'melville-glades': load('fixtures/book-melville-glades.json') }, PARSI = load('fixtures/course-par-si.json');
// golf cases 1.4.0: the map-built book (no aim line, slope, wind, extra hazards, tips or green notes)
if (fs.existsSync(path.join(DIR, 'fixtures', 'book-melville-glades-map.json'))) BOOKS['melville-glades-map'] = load('fixtures/book-melville-glades-map.json');
// golf cases 1.5.0: the Perth course books (fixtures/course-books.json)
if (fs.existsSync(path.join(DIR, 'fixtures', 'course-books.json'))) load('fixtures/course-books.json').books.forEach(cb => { BOOKS[cb.book] = load('fixtures/book-' + cb.book + '.json'); });
const sets = { none: [], miscore: Object.keys(ROUNDS).filter(k => k.startsWith('miscore')), all: Object.keys(ROUNDS) };

const CONFIGS = [
  { mode: 'bogey', bag: 'default', dailyHcp: 17, rounds: 'all', noElevation: false, thoughts: ['Smooth tempo', 'Hold the finish'] },
  { mode: 'points', bag: 'no-hybrid', dailyHcp: 5, rounds: 'miscore', noElevation: false, thoughts: [] },
  { mode: 'attack', bag: 'long-hitter', dailyHcp: 17, rounds: 'none', noElevation: true, thoughts: ['Commit'] },
  // v0.9 / golf cases 1.2.0: no wedge in the bag, and a bag of 1 club
  { mode: 'bogey', bag: 'no-wedge', dailyHcp: 17, rounds: 'miscore', noElevation: false, thoughts: ['Smooth tempo'] },
  { mode: 'attack', bag: 'one-club', dailyHcp: 5, rounds: 'none', noElevation: false, thoughts: [] },
  // v0.10 / golf cases 1.4.0: a course with only a map-built book (no `book` = melville-glades)
  { book: 'melville-glades-map', mode: 'points', bag: 'default', dailyHcp: 17, rounds: 'none', noElevation: false, thoughts: [] },
  { book: 'melville-glades-map', mode: 'attack', bag: 'long-hitter', dailyHcp: 5, rounds: 'all', noElevation: false, thoughts: ['Commit'] },
  { book: 'melville-glades-map', mode: 'bogey', bag: 'no-hybrid', dailyHcp: 17, rounds: 'none', noElevation: false, thoughts: [] },
  // golf cases 1.5.0: two Perth course books, with their own pars and stroke indexes (parsSi: 'book')
  { book: 'point-walter', parsSi: 'book', mode: 'points', bag: 'default', dailyHcp: 14, rounds: 'none', noElevation: false, thoughts: [] },
  { book: 'collier-park-pines-island', parsSi: 'book', mode: 'attack', bag: 'long-hitter', dailyHcp: 17, rounds: 'none', noElevation: false, thoughts: ['Commit'] },
  // v0.11 / golf cases 1.7.0: plans on a nine (input nine; dailyHcp is the 9-hole daily handicap; 9 holes, numbered as on the card)
  { nine: 'back', mode: 'points', bag: 'default', dailyHcp: 8, rounds: 'all', noElevation: false, thoughts: ['Smooth tempo'] },
  { book: 'point-walter', parsSi: 'book', nine: 'front', mode: 'bogey', bag: 'default', dailyHcp: 6, rounds: 'none', noElevation: false, thoughts: [] }
];

const configs = CONFIGS.filter(c => BAGS[c.bag] && BOOKS[c.book || 'melville-glades']).map(input => {
  const ownCard = input.parsSi === 'book';
  const p = ST.buildStrategy({ book: BOOKS[input.book || 'melville-glades'], bag: BAGS[input.bag], mode: input.mode, dailyHcp: input.dailyHcp, pars: ownCard ? [] : PARSI.pars, si: ownCard ? [] : PARSI.si,
    rounds: sets[input.rounds].map(k => ROUNDS[k]), strokesOnHole: E.strokesOnHole, dailyHcpFor: r => r.dailyHcp, thoughts: input.thoughts, noElevation: input.noElevation,
    nine: input.nine, strokesOnNine: E.strokesOnNine });
  return { input, modeLabel: p.modeLabel, bagSig: p.bagSig, rounds: p.rounds,
    holes: p.holes.map(h => ({ n: h.n, targetText: h.targetText, strip: h.strip, missText: h.missText, green: h.green, cue: h.cue,
      danger: h.danger, why: h.why, history: h.history, shots: h.shots.map(s => s.text) })) };
});
fs.writeFileSync(OUT, JSON.stringify({ note: 'Plan wording from the prototype strategy.js (v' + VERSION.v + '), for golf_core strategy_test.dart. Regenerate when strategy.js changes.', configs }, null, 1) + '\n');
console.log(configs.length + ' configurations written to ' + OUT);
