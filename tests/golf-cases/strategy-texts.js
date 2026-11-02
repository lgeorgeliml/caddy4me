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
const BOOK = load('fixtures/book-melville-glades.json'), PARSI = load('fixtures/course-par-si.json');
const sets = { none: [], miscore: Object.keys(ROUNDS).filter(k => k.startsWith('miscore')), all: Object.keys(ROUNDS) };

const CONFIGS = [
  { mode: 'bogey', bag: 'default', dailyHcp: 17, rounds: 'all', noElevation: false, thoughts: ['Smooth tempo', 'Hold the finish'] },
  { mode: 'points', bag: 'no-hybrid', dailyHcp: 5, rounds: 'miscore', noElevation: false, thoughts: [] },
  { mode: 'attack', bag: 'long-hitter', dailyHcp: 17, rounds: 'none', noElevation: true, thoughts: ['Commit'] },
  // v0.9 / golf cases 1.2.0: no wedge in the bag, and a bag of 1 club
  { mode: 'bogey', bag: 'no-wedge', dailyHcp: 17, rounds: 'miscore', noElevation: false, thoughts: ['Smooth tempo'] },
  { mode: 'attack', bag: 'one-club', dailyHcp: 5, rounds: 'none', noElevation: false, thoughts: [] }
];

const configs = CONFIGS.filter(c => BAGS[c.bag]).map(input => {
  const p = ST.buildStrategy({ book: BOOK, bag: BAGS[input.bag], mode: input.mode, dailyHcp: input.dailyHcp, pars: PARSI.pars, si: PARSI.si,
    rounds: sets[input.rounds].map(k => ROUNDS[k]), strokesOnHole: E.strokesOnHole, dailyHcpFor: r => r.dailyHcp, thoughts: input.thoughts, noElevation: input.noElevation });
  return { input, modeLabel: p.modeLabel, bagSig: p.bagSig, rounds: p.rounds,
    holes: p.holes.map(h => ({ n: h.n, targetText: h.targetText, strip: h.strip, missText: h.missText, green: h.green, cue: h.cue,
      danger: h.danger, why: h.why, history: h.history, shots: h.shots.map(s => s.text) })) };
});
fs.writeFileSync(OUT, JSON.stringify({ note: 'Plan wording from the prototype strategy.js (v' + VERSION.v + '), for golf_core strategy_test.dart. Regenerate when strategy.js changes.', configs }, null, 1) + '\n');
console.log(configs.length + ' configurations written to ' + OUT);
