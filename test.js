// Emberline — unit tests. No framework. Run with: node test.js
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
const standing = playerHitbox({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sliding: false }, G);
const sliding = playerHitbox({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sliding: true }, G);
check('hitbox: standing uses standHeight', standing.h === CONFIG.standHeight);
check('hitbox: sliding uses slideHeight', sliding.h === CONFIG.slideHeight);
check('hitbox: standing rests on ground', approx(standing.y + standing.h, G));
check('hitbox: sliding rests on ground', approx(sliding.y + sliding.h, G));
check('hitbox: slide body is shorter than stand', sliding.h < standing.h);

// --- collision: BARRIER (must jump over) ------------------------------------
// Place a barrier directly under the player's x.
const barrier = { type: BARRIER, x: CONFIG.playerX + 2 };
check(
  'collision: standing player hits barrier',
  checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sliding: false }, [barrier], G)
);
// A jump higher than the barrier should clear it.
check(
  'collision: high jump clears barrier',
  !checkCollision(
    { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: CONFIG.barrierHeight + 10, sliding: false },
    [barrier],
    G
  )
);
// A tiny hop that does not exceed the barrier height should still collide.
check(
  'collision: tiny hop still hits barrier',
  checkCollision(
    { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: CONFIG.barrierHeight - 20, sliding: false },
    [barrier],
    G
  )
);

// --- collision: OVERPASS (must slide under) ---------------------------------
const overpass = { type: OVERPASS, x: CONFIG.playerX + 2 };
check(
  'collision: standing player hits overpass',
  checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sliding: false }, [overpass], G)
);
check(
  'collision: sliding player clears overpass',
  !checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sliding: true }, [overpass], G)
);
// Jumping into an overpass is fatal (you rise into the cables).
check(
  'collision: jumping into overpass collides',
  checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 40, sliding: false }, [overpass], G)
);

// --- collision: x separation ------------------------------------------------
check(
  'collision: obstacle far ahead does not collide',
  !checkCollision({ x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sliding: false }, [{ type: BARRIER, x: CONFIG.playerX + 600 }], G)
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
  { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sliding: false },
  { x: CONFIG.playerX + CONFIG.playerWidth / 2, y: G - CONFIG.standHeight / 2, r: CONFIG.moteRadius },
  G
));
check('ember: collectsMote false when far away', !collectsMote(
  { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sliding: false },
  { x: CONFIG.playerX + 800, y: G - 200, r: CONFIG.moteRadius },
  G
));
check('ember: collectsMote true when mote just touches edge within radius', collectsMote(
  { x: CONFIG.playerX, width: CONFIG.playerWidth, jumpOffset: 0, sliding: false },
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

// --- report -----------------------------------------------------------------
console.log('');
console.log(`Emberline tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log('Failed: ' + failures.join(', '));
  process.exit(1);
}
