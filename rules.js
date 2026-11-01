/* Caddy4Me rules compliance v0.8
 * Which features a rule set allows. Screens ask allows(ruleSet, feature) instead of checking
 * "is Tournament Mode on", so a rule change is a new or updated table here plus its shared cases.
 * Same table and answers as golf_core/lib/src/rules.dart (shared cases suite "rules").
 * Pure functions: browser (window.C4MRules) and Node (module.exports).
 */
(function (root) {
  'use strict';
  var FEATURES = [
    'distance',       // GPS distance to a point
    'greenNumbers',   // front / middle / back / pin
    'bunkerNumbers',  // reach and carry for bunkers ahead
    'forecastWind',   // the forecast wind, shown as weather information only
    'plan',           // the course plan prepared before the round
    'planPlaysLike',  // plays-like (elevation) adjustments inside the plan
    'playsLike',      // live plays-like distance
    'elevation',      // live elevation change
    'clubAdvice',     // club recommendation for this shot
    'windCalc',       // wind effect worked into the distance
    'lieCalc',        // lie effect worked into the distance
    'roundAnalysis',  // past-round analysis and suggestions during a round
    'aiCaddie'        // AI caddie advice
  ];
  function only(list) { var o = {}; FEATURES.forEach(function (f) { o[f] = list.indexOf(f) >= 0; }); return o; }

  var RULE_SETS = {
    social: { label: 'Social (no restrictions)', allows: only(FEATURES) },
    // Rules of Golf Rule 4.3 with the distance-measuring-device Local Rule (Model Local Rule G-5)
    competition: { label: 'Competition – Rule 4.3 with the distance-measuring-device Local Rule',
      allows: only(['distance', 'greenNumbers', 'bunkerNumbers', 'forecastWind', 'plan']) }
    // Future AI rule: a placeholder until the governing bodies publish one. Add it here with its shared cases.
  };
  var DEFAULT_STRICT = 'competition';   // an unknown rule set is treated as the strictest one

  function allows(ruleSet, feature) {
    var own = Object.prototype.hasOwnProperty;
    var rs = own.call(RULE_SETS, ruleSet) ? RULE_SETS[ruleSet] : RULE_SETS[DEFAULT_STRICT];
    return own.call(rs.allows, feature) && rs.allows[feature] === true;   // an unknown feature is never allowed
  }
  function ruleSetFor(tournament) { return tournament ? 'competition' : 'social'; }

  var API = { FEATURES: FEATURES, RULE_SETS: RULE_SETS, allows: allows, ruleSetFor: ruleSetFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.C4MRules = API;
})(this);
