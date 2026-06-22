// Emberline — pure game logic.
//
// This module is intentionally DOM-free: no `window`, `document`, `canvas`, or
// timers. Everything here is a pure function of its inputs so it can be unit
// tested under Node (see ../test.js) and reused unchanged in the browser.
//
// Coordinate convention: a fixed virtual play-field. The y axis grows
// DOWNWARD (screen style); `GROUND_Y` is the road surface. Obstacles and the
// player are axis-aligned rectangles {x, y, w, h} where (x, y) is the top-left
// corner. The renderer maps this virtual field onto the real canvas.

// --- Virtual world dimensions ----------------------------------------------
export const WORLD = {
  width: 1280,
  height: 720,
  groundY: 560, // y of the road surface; things rest with their bottom here
};

// --- Obstacle kinds ---------------------------------------------------------
export const BARRIER = 'barrier'; // low rubble — jump OVER it
export const OVERPASS = 'overpass'; // head-height cables — slide UNDER it

// --- Tunable gameplay constants --------------------------------------------
export const CONFIG = {
  // Speed ramp (virtual units per second).
  baseSpeed: 360,
  maxSpeed: 1120,
  speedScale: 2600, // larger => slower approach to maxSpeed (in distance units)

  // Spawn timing (seconds between obstacle spawns).
  baseInterval: 1.45, // gap at base speed
  minInterval: 0.62, // hard floor so the course stays passable

  // Player body.
  playerX: 220,
  playerWidth: 46,
  standHeight: 96,
  slideHeight: 46,

  // Jump arc.
  jumpVelocity: 1180, // initial upward speed (units/s)
  gravity: 3200, // downward acceleration (units/s^2)
  slideDuration: 0.62, // seconds a slide lasts

  // Obstacle geometry.
  barrierHeight: 58,
  barrierWidth: 52,
  overpassGap: 52, // open height under the overpass (must slide to fit)
  overpassThickness: 70,
  overpassWidth: 70,

  // Emberlight motes.
  moteRadius: 14,
  moteValue: 1,
};

// --- Geometry ---------------------------------------------------------------

// Axis-aligned bounding-box overlap. Touching edges do NOT count as overlap.
export function aabbOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// Compute the player's current collision rectangle.
// `player` carries: x, width, jumpOffset (>=0, height above ground), sliding.
// While sliding the body is shorter, letting it clear an OVERPASS.
export function playerHitbox(player, groundY = WORLD.groundY) {
  const h = player.sliding ? CONFIG.slideHeight : CONFIG.standHeight;
  const bottom = groundY - (player.jumpOffset || 0);
  return {
    x: player.x,
    y: bottom - h,
    w: player.width,
    h,
  };
}

// Build the rectangle for an obstacle anchored at world x.
export function obstacleBox(obstacle, groundY = WORLD.groundY) {
  if (obstacle.type === BARRIER) {
    return {
      x: obstacle.x,
      y: groundY - CONFIG.barrierHeight,
      w: CONFIG.barrierWidth,
      h: CONFIG.barrierHeight,
    };
  }
  // OVERPASS hangs from the top of the field down to leave `overpassGap`
  // of clearance above the road.
  const bottom = groundY - CONFIG.overpassGap;
  return {
    x: obstacle.x,
    y: bottom - CONFIG.overpassThickness,
    w: CONFIG.overpassWidth,
    h: CONFIG.overpassThickness,
  };
}

// True if the player intersects ANY obstacle. Clearing emerges from geometry:
// a high enough jump lifts the box above a BARRIER; a slide shrinks it under
// an OVERPASS.
export function checkCollision(player, obstacles, groundY = WORLD.groundY) {
  const box = playerHitbox(player, groundY);
  for (const o of obstacles) {
    if (aabbOverlap(box, obstacleBox(o, groundY))) return true;
  }
  return false;
}

// --- Speed & spawn curves ---------------------------------------------------

// Smooth, monotonic non-decreasing ramp from baseSpeed toward maxSpeed.
// speedAt(0) === baseSpeed and the value asymptotically approaches (but never
// reaches or exceeds) maxSpeed.
export function speedAt(distance, cfg = CONFIG) {
  const d = Math.max(0, distance);
  const t = 1 - Math.exp(-d / cfg.speedScale);
  return cfg.baseSpeed + (cfg.maxSpeed - cfg.baseSpeed) * t;
}

// Seconds between spawns. Equals baseInterval at baseSpeed, shrinks as speed
// rises, and is clamped at minInterval so the level is always survivable.
export function spawnInterval(speed, cfg = CONFIG) {
  const ratio = cfg.baseSpeed / Math.max(speed, cfg.baseSpeed);
  return Math.max(cfg.minInterval, cfg.baseInterval * ratio);
}

// Has enough time accumulated to spawn the next obstacle?
export function shouldSpawn(timer, interval) {
  return timer >= interval;
}

// --- Scoring ----------------------------------------------------------------

// Advance travelled distance by one frame. Frame-rate independent.
export function advanceDistance(distance, dt, speed) {
  return distance + speed * dt;
}

// Distance shown to the player (whole "metres").
export function scoreFromDistance(distance) {
  return Math.max(0, Math.floor(distance / 10));
}

// Add collected emberlight to the running counter. Pure: returns the new total.
export function addEmberlight(current, amount = CONFIG.moteValue) {
  return current + amount;
}

// Did the player collect this mote? Circle (mote) vs player rectangle test.
export function collectsMote(player, mote, groundY = WORLD.groundY) {
  const box = playerHitbox(player, groundY);
  const nearestX = Math.max(box.x, Math.min(mote.x, box.x + box.w));
  const nearestY = Math.max(box.y, Math.min(mote.y, box.y + box.h));
  const dx = mote.x - nearestX;
  const dy = mote.y - nearestY;
  const r = mote.r || CONFIG.moteRadius;
  return dx * dx + dy * dy <= r * r;
}
