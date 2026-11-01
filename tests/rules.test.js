// Run: node tests/rules.test.js
const R = require('../rules.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

const COMP_ON = ['distance', 'greenNumbers', 'bunkerNumbers', 'forecastWind', 'plan'];
t('13 features', () => eq(R.FEATURES.length, 13));
t('social allows every feature', () => R.FEATURES.forEach(f => eq(R.allows('social', f), true, f)));
t('competition allows only distance-type features and the plan', () => R.FEATURES.forEach(f => eq(R.allows('competition', f), COMP_ON.includes(f), f)));
t('competition blocks plays-like inside the plan (Rule 4.3)', () => eq(R.allows('competition', 'planPlaysLike'), false));
t('competition blocks the AI caddie', () => eq(R.allows('competition', 'aiCaddie'), false));
t('unknown rule set is treated as competition', () => R.FEATURES.forEach(f => eq(R.allows('pro-am-2030', f), COMP_ON.includes(f), f)));
t('missing rule set is treated as competition', () => { eq(R.allows(undefined, 'clubAdvice'), false); eq(R.allows(null, 'distance'), true); });
t('unknown feature is never allowed', () => { eq(R.allows('social', 'teleport'), false); eq(R.allows('competition', 'teleport'), false); eq(R.allows('social', undefined), false); });
t('inherited object keys are not features', () => { eq(R.allows('social', 'toString'), false); eq(R.allows('toString', 'distance'), true); });
t('ruleSetFor maps Tournament Mode', () => { eq(R.ruleSetFor(true), 'competition'); eq(R.ruleSetFor(false), 'social'); eq(R.ruleSetFor(undefined), 'social'); });

console.log('rules: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
