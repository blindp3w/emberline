// Burn Rate — unit tests. No framework. Run with: node test.js
//
// Covers the pure logic in src/logic.js: collision detection, the speed-ramp
// curve, spawn timing, distance/score, and emberlight collection & scoring.

import {
  WORLD,
  CONFIG,
  BARRIER,
  OVERPASS,
  aabbOverlap,
  playerHitbox,
  obstacleBox,
  checkCollision,
  speedAt,
  spawnInterval,
  shouldSpawn,
  advanceDistance,
  scoreFromDistance,
  addEmberlight,
  collectsMote,
  canAirBoost,
  applyAirBoost,
  applyFastFall,
  overpassAhead,
  obstacleSpacingOk,
  requiredGap,
  pickObstacleType,
  runwayDrainAt,
  drainRunway,
  refillRunway,
  exchangeRateAt,
  isOutOfRunway,
  runwayPressure,
  theftFundedPct,
  pointerZone,
} from './src/logic.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error('  ✗ ' + name);
  }
}

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

const G = WORLD.groundY;

// --- aabbOverlap ------------------------------------------------------------
check('aabb: clear overlap', aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
check('aabb: disjoint on x', !aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }));
check('aabb: disjoint on y', !aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 20, w: 10, h: 10 }));
check('aabb: touching edges is not overlap', !aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }));

// --- playerHitbox -----------------------------------------------------------
const standing = playerHitbox({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sitting: false }, G);
const sittingBox = playerHitbox({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sitting: true }, G);
check('hitbox: standing uses standHeight', standing.h === CONFIG.standHeight);
check('hitbox: sitting uses slideHeight', sittingBox.h === CONFIG.slideHeight);
check('hitbox: standing rests on ground', approx(standing.y + standing.h, G));
check('hitbox: sitting rests on ground', approx(sittingBox.y + sittingBox.h, G));
check('hitbox: sitting body is shorter than stand', sittingBox.h < standing.h);

// --- collision: BARRIER (must jump over) ------------------------------------
// Place a barrier directly under the player's x.
const barrier = { type: BARRIER, x: CONFIG.playerX + 2 };
check(
  'collision: standing player hits barrier',
  checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sitting: false }, [barrier], G)
);
// A jump higher than the barrier should clear it.
check(
  'collision: high jump clears barrier',
  !checkCollision(
    { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: CONFIG.barrierHeight + 10, sitting: false },
    [barrier],
    G
  )
);
// A tiny hop that does not exceed the barrier height should still collide.
check(
  'collision: tiny hop still hits barrier',
  checkCollision(
    { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: CONFIG.barrierHeight - 20, sitting: false },
    [barrier],
    G
  )
);

// --- collision: OVERPASS (must slide under) ---------------------------------
const overpass = { type: OVERPASS, x: CONFIG.playerX + 2 };
check(
  'collision: standing player hits overpass',
  checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sitting: false }, [overpass], G)
);
check(
  'collision: sitting player clears overpass',
  !checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sitting: true }, [overpass], G)
);
// Jumping into an overpass is fatal (you rise into the cables).
check(
  'collision: jumping into overpass collides',
  checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 40, sitting: false }, [overpass], G)
);

// --- collision: x separation ------------------------------------------------
check(
  'collision: obstacle far ahead does not collide',
  !checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sitting: false }, [{ type: BARRIER, x: CONFIG.playerX + 600 }], G)
);

// Sanity on obstacleBox geometry: overpass leaves exactly overpassGap of clearance.
const opBox = obstacleBox(overpass, G);
check('obstacleBox: overpass clearance equals overpassGap', approx(G - (opBox.y + opBox.h), CONFIG.overpassGap));
const barBox = obstacleBox(barrier, G);
check('obstacleBox: barrier sits on ground', approx(barBox.y + barBox.h, G));

// --- speedAt: ramp curve ----------------------------------------------------
check('speed: speedAt(0) equals baseSpeed', approx(speedAt(0), CONFIG.baseSpeed));
check('speed: never below base', speedAt(-100) >= CONFIG.baseSpeed - 1e-9);
check('speed: strictly increasing across distance', speedAt(100) < speedAt(1000) && speedAt(1000) < speedAt(10000));
check('speed: monotonic non-decreasing sampled', (() => {
  let prev = -Infinity;
  for (let d = 0; d <= 50000; d += 500) {
    const s = speedAt(d);
    if (s < prev - 1e-9) return false;
    prev = s;
  }
  return true;
})());
check('speed: never exceeds maxSpeed', speedAt(1e9) <= CONFIG.maxSpeed);
check('speed: stays below maxSpeed at playable distances', speedAt(20000) < CONFIG.maxSpeed);
check('speed: approaches maxSpeed at large distance', speedAt(1e6) > CONFIG.maxSpeed - 1);

// --- spawnInterval ----------------------------------------------------------
check('spawn: interval at base speed equals baseInterval', approx(spawnInterval(CONFIG.baseSpeed), CONFIG.baseInterval));
check('spawn: interval shrinks as speed rises', spawnInterval(CONFIG.baseSpeed * 2) < spawnInterval(CONFIG.baseSpeed));
check('spawn: interval clamped at minInterval', approx(spawnInterval(CONFIG.maxSpeed * 100), CONFIG.minInterval));
check('spawn: interval never below minInterval', (() => {
  for (let s = CONFIG.baseSpeed; s <= CONFIG.maxSpeed * 10; s += 50) {
    if (spawnInterval(s) < CONFIG.minInterval - 1e-9) return false;
  }
  return true;
})());

// --- shouldSpawn ------------------------------------------------------------
check('shouldSpawn: true when timer reaches interval', shouldSpawn(1.5, 1.45));
check('shouldSpawn: false when timer below interval', !shouldSpawn(1.0, 1.45));

// --- advanceDistance & scoring ----------------------------------------------
check('distance: advances by speed*dt', approx(advanceDistance(0, 0.5, 360), 180));
check('distance: frame-rate independent (two halves == one whole)', approx(
  advanceDistance(advanceDistance(0, 0.25, 400), 0.25, 400),
  advanceDistance(0, 0.5, 400)
));
check('score: scaled distance floors correctly', scoreFromDistance(1234) === 123);
check('score: never negative', scoreFromDistance(-50) === 0);

// --- emberlight -------------------------------------------------------------
check('ember: addEmberlight default increment', addEmberlight(0) === CONFIG.moteValue);
check('ember: addEmberlight accumulates', addEmberlight(addEmberlight(5, 2), 3) === 10);
check('ember: collectsMote true when overlapping body', collectsMote(
  { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sitting: false },
  { x: CONFIG.playerX + CONFIG.playerWidth / 2, y: G - CONFIG.standHeight / 2, r: CONFIG.moteRadius },
  G
));
check('ember: collectsMote false when far away', !collectsMote(
  { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sitting: false },
  { x: CONFIG.playerX + 800, y: G - 200, r: CONFIG.moteRadius },
  G
));
check('ember: collectsMote true when mote just touches edge within radius', collectsMote(
  { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sitting: false },
  { x: CONFIG.playerX + CONFIG.playerWidth + 10, y: G - CONFIG.standHeight / 2, r: CONFIG.moteRadius },
  G
));

// --- air control: boost & fast-fall -----------------------------------------
const onGroundPlayer = { onGround: true, vy: 0, airBoostUsed: false };
const risingPlayer = { onGround: false, vy: 200, airBoostUsed: false };
const usedPlayer = { onGround: false, vy: 200, airBoostUsed: true };
const fastPlayer = { onGround: false, vy: CONFIG.maxJumpVelocity, airBoostUsed: false };

check('air: canAirBoost false on ground', !canAirBoost(onGroundPlayer));
check('air: canAirBoost true in air & unused', canAirBoost(risingPlayer));
check('air: canAirBoost false once used', !canAirBoost(usedPlayer));

check('air: applyAirBoost null on ground', applyAirBoost(onGroundPlayer) === null);
check('air: applyAirBoost null on second attempt', applyAirBoost(usedPlayer) === null);
const boosted = applyAirBoost(risingPlayer);
check('air: applyAirBoost marks attempt used', boosted && boosted.airBoostUsed === true);
check('air: applyAirBoost raises upward velocity', boosted && boosted.vy > risingPlayer.vy);
check('air: applyAirBoost clamps to maxJumpVelocity', (() => {
  const r = applyAirBoost(fastPlayer);
  return r && r.vy === CONFIG.maxJumpVelocity;
})());
check('air: applyAirBoost does not mutate the player', risingPlayer.vy === 200 && risingPlayer.airBoostUsed === false);

check('air: applyFastFall null on ground', applyFastFall(onGroundPlayer) === null);
check('air: applyFastFall returns strong downward velocity', (() => {
  const r = applyFastFall(risingPlayer);
  return r && r.vy === -CONFIG.fastFallVelocity && r.vy < 0;
})());

// --- auto-stand: overpassAhead ----------------------------------------------
const sitter = { x: CONFIG.playerX, width: CONFIG.playerWidth };
const opOver = { type: OVERPASS, x: CONFIG.playerX }; // directly over the player
const opAheadNear = { type: OVERPASS, x: CONFIG.playerX + CONFIG.playerWidth + 20 }; // within lookahead
const opAheadFar = { type: OVERPASS, x: CONFIG.playerX + 400 }; // far ahead
const opPassed = { type: OVERPASS, x: CONFIG.playerX - CONFIG.overpassWidth - 30 }; // fully behind

check('autostand: overpass over the player counts', overpassAhead(sitter, [opOver]));
check('autostand: overpass just ahead counts', overpassAhead(sitter, [opAheadNear]));
check('autostand: overpass far ahead does not count', !overpassAhead(sitter, [opAheadFar]));
check('autostand: passed overpass does not count', !overpassAhead(sitter, [opPassed]));
check('autostand: barriers never count', !overpassAhead(sitter, [{ type: BARRIER, x: CONFIG.playerX }]));
check('autostand: no obstacles -> false', !overpassAhead(sitter, []));

// --- spawn placement --------------------------------------------------------
check('spawn: spacing not ok when too close', !obstacleSpacingOk(1000, 1100, 480));
check('spawn: spacing ok when far enough', obstacleSpacingOk(1000, 1500, 480));
check('spawn: spacing ok with no obstacles (-Infinity)', obstacleSpacingOk(-Infinity, 1200, 900));
check('spawn: requiredGap after barrier is afterJumpGap', requiredGap(BARRIER) === CONFIG.afterJumpGap);
check('spawn: requiredGap after overpass is baseObstacleGap', requiredGap(OVERPASS) === CONFIG.baseObstacleGap);
check('spawn: requiredGap with no prior type is baseObstacleGap', requiredGap(null) === CONFIG.baseObstacleGap);
check('spawn: pickObstacleType honors rand (barrier)', pickObstacleType(0.2, null, 0) === BARRIER);
check('spawn: pickObstacleType honors rand (overpass)', pickObstacleType(0.8, null, 0) === OVERPASS);
check('spawn: pickObstacleType forces switch after 2 barriers', pickObstacleType(0.1, BARRIER, 2) === OVERPASS);
check('spawn: pickObstacleType forces switch after 2 overpasses', pickObstacleType(0.9, OVERPASS, 2) === BARRIER);

// --- runway / burn meter ----------------------------------------------------
check('runway: drainAt equals base at baseSpeed', approx(runwayDrainAt(CONFIG.baseSpeed), CONFIG.runwayDrainBase));
check('runway: drainAt equals base+factor at maxSpeed', approx(runwayDrainAt(CONFIG.maxSpeed), CONFIG.runwayDrainBase + CONFIG.runwayDrainSpeedFactor));
check('runway: drainAt never below base', runwayDrainAt(-1000) >= CONFIG.runwayDrainBase - 1e-9);
check('runway: drainAt clamps above maxSpeed', approx(runwayDrainAt(CONFIG.maxSpeed * 10), CONFIG.runwayDrainBase + CONFIG.runwayDrainSpeedFactor));
check('runway: drainAt increases with speed', (() => {
  let prev = -Infinity;
  for (let s = CONFIG.baseSpeed; s <= CONFIG.maxSpeed; s += 40) {
    const d = runwayDrainAt(s);
    if (d < prev - 1e-9) return false;
    prev = d;
  }
  return true;
})());

check('runway: drainRunway reduces by drain*dt', approx(drainRunway(50, 0.5, 10), 45));
check('runway: drainRunway clamps at zero', drainRunway(3, 1, 10) === 0);
check('runway: drainRunway frame-rate independent', approx(
  drainRunway(drainRunway(50, 0.25, 12), 0.25, 12),
  drainRunway(50, 0.5, 12)
));

check('runway: refillRunway adds the default (base exchange rate)', refillRunway(40) === 40 + CONFIG.exchangeRateBase);
check('runway: refillRunway adds a custom amount', refillRunway(40, 8) === 48);
check('runway: refillRunway clamps at max', refillRunway(CONFIG.runwayMax - 2, 10) === CONFIG.runwayMax);

// Exchange rate: tokens per wage, decaying with speed (wages -> tokens -> run).
check('exchange: rate equals base at baseSpeed', approx(exchangeRateAt(CONFIG.baseSpeed), CONFIG.exchangeRateBase));
check('exchange: rate equals min at maxSpeed', approx(exchangeRateAt(CONFIG.maxSpeed), CONFIG.exchangeRateMin));
check('exchange: rate clamps to base below baseSpeed', approx(exchangeRateAt(-1000), CONFIG.exchangeRateBase));
check('exchange: rate clamps to min above maxSpeed', approx(exchangeRateAt(CONFIG.maxSpeed * 10), CONFIG.exchangeRateMin));
check('exchange: rate decreases with speed', (() => {
  let prev = Infinity;
  for (let s = CONFIG.baseSpeed; s <= CONFIG.maxSpeed; s += (CONFIG.maxSpeed - CONFIG.baseSpeed) / 8) {
    const r = exchangeRateAt(s);
    if (r > prev + 1e-9) return false;
    prev = r;
  }
  return true;
})());
check('exchange: a high-speed skim refills less than a base-speed skim',
  refillRunway(0, exchangeRateAt(CONFIG.maxSpeed)) < refillRunway(0, exchangeRateAt(CONFIG.baseSpeed)));

check('runway: isOutOfRunway true at zero', isOutOfRunway(0));
check('runway: isOutOfRunway true below zero', isOutOfRunway(-0.01));
check('runway: isOutOfRunway false when fuel remains', !isOutOfRunway(0.5));

check('runway: pressure is 0 at/above critical', runwayPressure(CONFIG.runwayCritical) === 0 && runwayPressure(CONFIG.runwayMax) === 0);
check('runway: pressure is 1 when empty', runwayPressure(0) === 1);
check('runway: pressure half-way through critical band', approx(runwayPressure(CONFIG.runwayCritical / 2), 0.5));
check('runway: pressure rises as runway falls', runwayPressure(CONFIG.runwayCritical * 0.25) > runwayPressure(CONFIG.runwayCritical * 0.75));

// Burn ledger: theft-funded share (minted wages / compute burned).
check('ledger: theftFundedPct is 0 when nothing burned', theftFundedPct(0, 0) === 0 && theftFundedPct(50, 0) === 0);
check('ledger: theftFundedPct half', theftFundedPct(30, 60) === 50);
check('ledger: theftFundedPct rounds to a whole percent', theftFundedPct(1, 3) === 33);
check('ledger: theftFundedPct clamps at 100', theftFundedPct(200, 100) === 100);
check('ledger: theftFundedPct never negative', theftFundedPct(-5, 100) === 0);

// Touch zones: right half jumps, left half ducks (split at the midpoint).
check('zone: left edge ducks', pointerZone(0, 800) === 'duck');
check('zone: just left of center ducks', pointerZone(399, 800) === 'duck');
check('zone: exact center jumps', pointerZone(400, 800) === 'jump');
check('zone: right edge jumps', pointerZone(800, 800) === 'jump');

// --- report -----------------------------------------------------------------
console.log('');
console.log(`Burn Rate tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log('Failed: ' + failures.join(', '));
  process.exit(1);
}
