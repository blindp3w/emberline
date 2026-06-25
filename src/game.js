// Burn Rate — main game module. Owns the canvas, the rAF loop (delta-time,
// frame-rate independent), input, the state machine, and spawning. All the
// pure rules live in logic.js; drawing lives in render.js; sound in audio.js.

import {
  WORLD,
  CONFIG,
  BARRIER,
  OVERPASS,
  speedAt,
  spawnInterval,
  shouldSpawn,
  advanceDistance,
  scoreFromDistance,
  addEmberlight,
  checkCollision,
  collectsMote,
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
} from './logic.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';

const BEST_KEY = 'burnrate.best';
const DAYLIGHT_KEY = 'burnrate.glare';
const HELP_KEY = 'burnrate.help'; // '1' once the first-launch controls card is dismissed

// --- DOM ---------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const renderer = new Renderer();
const audio = new Audio();

const el = {
  distance: document.getElementById('distance'),
  ember: document.getElementById('ember'),
  runway: document.getElementById('runway'), // burn-meter wrapper (gets .critical)
  runwayFill: document.getElementById('runwayFill'), // depleting bar fill
  exchangeRate: document.getElementById('exchangeRate'), // live tokens-per-wage readout
  mute: document.getElementById('mute'),
  daylight: document.getElementById('daylight'),
  hud: document.getElementById('hud'),
  start: document.getElementById('start'),
  startBtn: document.getElementById('startBtn'),
  help: document.getElementById('help'), // first-launch controls card
  helpBtn: document.getElementById('helpBtn'),
  gameover: document.getElementById('gameover'),
  gameoverTitle: document.getElementById('gameoverTitle'),
  epitaph: document.getElementById('epitaph'), // SIG* flavor line under the title
  invBurned: document.getElementById('invBurned'), // burn-ledger: tokens burned
  invPeak: document.getElementById('invPeak'), // burn-ledger: peak tok/s
  invTheft: document.getElementById('invTheft'), // burn-ledger: theft-funded %
  restartBtn: document.getElementById('restartBtn'),
  finalDistance: document.getElementById('finalDistance'),
  finalEmber: document.getElementById('finalEmber'),
  bestDistance: document.getElementById('bestDistance'),
  newBest: document.getElementById('newBest'),
  rotate: document.getElementById('rotate'),
};

// --- View / canvas sizing ----------------------------------------------------
let view = { w: 1, h: 1, scale: 1 };

function resize() {
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view = { w: cssW, h: cssH, scale: cssH / WORLD.height };
}

// --- Game state --------------------------------------------------------------
const STATE = { READY: 'ready', RUNNING: 'running', OVER: 'over', PAUSED: 'paused' };
let phase = STATE.READY;
let resumePhase = STATE.READY; // what to return to after a portrait pause

let best = Number(localStorage.getItem(BEST_KEY) || 0);

let game = null;

function freshGame() {
  return {
    player: {
      x: CONFIG.playerX,
      width: CONFIG.playerWidth,
      jumpOffset: 0,
      vy: 0,
      onGround: true,
      sitting: false,
      airBoostUsed: false,
      needSitUnderpass: false,
    },
    obstacles: [],
    motes: [],
    particles: [],
    distance: 0,
    ember: 0,
    speed: CONFIG.baseSpeed,
    spawnTimer: 0,
    moteTimer: 1.6, // first token arc spawns on frame 1 so fuel arrives early
    time: 0,
    shake: 0,
    darkness: 0, // normalized speed [0..1] — drives swell + base creeping-dark
    runway: CONFIG.runwayStart, // compute budget; empty => shutdown
    alarm: 0, // runway pressure [0..1] — drives the kill-switch panic FX
    warnTimer: 0, // throttles the low-runway alarm beep
    tokensBurned: 0, // cumulative compute consumed this run (drain) — the burn ledger
    tokensMinted: 0, // cumulative tokens converted from skimmed wages (refill)
    running: false,
    lastObstacleType: null,
    sameTypeRun: 0,
  };
}

// --- Spawning ----------------------------------------------------------------
function visibleWorldWidth() {
  return view.w / view.scale;
}

function spawnObstacle() {
  const spawnX = visibleWorldWidth() + 80;
  // Guarantee spacing so high-speed combos stay clearable (skip this tick if the
  // last obstacle is still too close — density naturally thins as speed rises).
  let rightmost = -Infinity;
  for (const o of game.obstacles) if (o.x > rightmost) rightmost = o.x;
  if (game.obstacles.length &&
      !obstacleSpacingOk(rightmost, spawnX, requiredGap(game.lastObstacleType, CONFIG))) {
    return;
  }
  const type = pickObstacleType(Math.random(), game.lastObstacleType, game.sameTypeRun);
  game.obstacles.push({ type, x: spawnX });
  game.sameTypeRun = type === game.lastObstacleType ? game.sameTypeRun + 1 : 1;
  game.lastObstacleType = type;
}

function spawnMoteArc() {
  // A parabola of motes arcing above the road, peak within jump reach.
  const peak = 90 + Math.random() * 110; // <= ~217 max jump height
  const count = 4 + Math.floor(Math.random() * 3);
  const span = 220 + Math.random() * 120;
  const startX = visibleWorldWidth() + 60;
  const baseY = WORLD.groundY - 46;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const y = baseY - Math.sin(t * Math.PI) * peak;
    game.motes.push({ x: startX + t * span, y, r: CONFIG.moteRadius, collected: false });
  }
}

// --- Update ------------------------------------------------------------------
function update(dt) {
  game.time += dt;

  if (phase !== STATE.RUNNING) {
    // Decay screen shake even while not running (for the death freeze).
    game.shake *= Math.pow(0.001, dt);
    updateParticles(dt);
    return;
  }

  game.running = true;
  game.speed = speedAt(game.distance);
  game.distance = advanceDistance(game.distance, dt, game.speed);

  // Darkness + audio swell track normalized speed.
  const norm = (game.speed - CONFIG.baseSpeed) / (CONFIG.maxSpeed - CONFIG.baseSpeed);
  game.darkness = Math.max(0, Math.min(1, norm));
  audio.setSwell(game.darkness);

  // Burn the runway (faster the harder you run). Refilled by skimming tokens.
  const beforeDrain = game.runway;
  game.runway = drainRunway(game.runway, dt, runwayDrainAt(game.speed));
  game.tokensBurned += beforeDrain - game.runway; // ledger: compute actually consumed
  game.alarm = runwayPressure(game.runway); // separate channel for the panic FX
  // Low-runway warning: a periodic alarm beep while critical.
  if (game.alarm > 0) {
    game.warnTimer -= dt;
    if (game.warnTimer <= 0) {
      audio.warn(game.alarm);
      game.warnTimer = 0.7 - game.alarm * 0.35; // beeps quicken as it empties
    }
  } else {
    game.warnTimer = 0;
  }

  // Player physics.
  const p = game.player;
  if (!p.onGround) {
    p.jumpOffset += p.vy * dt;
    p.vy -= CONFIG.gravity * dt;
    if (p.jumpOffset <= 0) {
      p.jumpOffset = 0;
      p.vy = 0;
      p.onGround = true;
    }
  }
  // Sitting is a held state; it persists until the player stands up.

  // Spawn obstacles on the speed-driven cadence.
  game.spawnTimer += dt;
  const interval = spawnInterval(game.speed);
  if (shouldSpawn(game.spawnTimer, interval)) {
    game.spawnTimer -= interval;
    spawnObstacle();
  }

  // Spawn wage-token arcs on their own slower cadence. Tokens are now survival
  // fuel, so keep them frequent — each arc's low end-tokens are grabbable
  // without jumping, while the high ones reward a jump.
  game.moteTimer += dt;
  if (game.moteTimer >= 1.6) {
    game.moteTimer = 0;
    if (Math.random() < 0.9) spawnMoteArc();
  }

  // Scroll & cull.
  const dx = game.speed * dt;
  for (const o of game.obstacles) o.x -= dx;
  for (const m of game.motes) m.x -= dx;
  game.obstacles = game.obstacles.filter((o) => o.x > -200);
  game.motes = game.motes.filter((m) => m.x > -60 && !m.collected);

  // Auto-stand: while sitting, arm the latch when an overpass is over/approaching,
  // then stand once it has passed (overpass is horizontally clear, so no collision).
  if (p.sitting) {
    if (overpassAhead(p, game.obstacles)) p.needSitUnderpass = true;
    else if (p.needSitUnderpass) standUp();
  }

  // Skim a wage: bump the $ tally AND convert it to tokens at the live exchange
  // rate (lower the faster you run) to refill the runway. Wages -> tokens -> run.
  for (const m of game.motes) {
    if (!m.collected && collectsMote(p, m)) {
      m.collected = true;
      game.ember = addEmberlight(game.ember);
      const beforeRefill = game.runway;
      game.runway = refillRunway(game.runway, exchangeRateAt(game.speed));
      game.tokensMinted += game.runway - beforeRefill; // ledger: tokens actually banked
      audio.pickup();
      spawnPickupSparks(m.x * view.scale, m.y * view.scale);
    }
  }

  // End conditions, evaluated AFTER collection so a token grabbed on the dying
  // frame can still save you. Collision (fault) takes precedence over an
  // empty runway (shutdown).
  if (checkCollision(p, game.obstacles)) {
    endRun('fault');
  } else if (isOutOfRunway(game.runway)) {
    endRun('shutdown');
  }

  game.shake *= Math.pow(0.0015, dt);
  updateParticles(dt);
  syncHud();
}

function spawnPickupSparks(sx, sy) {
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 160;
    game.particles.push({
      x: sx,
      y: sy,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 40,
      size: 2 + Math.random() * 3,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9,
      tint: [120, 255, 170], // money-green token spark
    });
  }
}

// A downward puff of sparks under the runner when the mid-air boost fires.
function spawnBoostSparks() {
  const p = game.player;
  const sx = (p.x + p.width / 2) * view.scale;
  const sy = (WORLD.groundY - p.jumpOffset) * view.scale;
  for (let i = 0; i < 12; i++) {
    const a = Math.PI / 2 + (Math.random() - 0.5) * 1.4; // mostly downward
    const speed = 80 + Math.random() * 180;
    game.particles.push({
      x: sx,
      y: sy,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      size: 2 + Math.random() * 2.5,
      life: 0.35 + Math.random() * 0.3,
      maxLife: 0.65,
      tint: [255, 170, 90], // thermal exhaust from the boost
    });
  }
}

function updateParticles(dt) {
  if (!game) return;
  for (const pt of game.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vy += 320 * dt; // gentle gravity on sparks
    pt.life -= dt;
  }
  game.particles = game.particles.filter((pt) => pt.life > 0);
}

// --- Actions -----------------------------------------------------------------
function jump() {
  const p = game.player;
  if (p.onGround && !p.sitting) {
    p.onGround = false;
    p.vy = CONFIG.jumpVelocity;
    p.airBoostUsed = false; // a fresh jump grants a new mid-air boost
    audio.jump();
  }
}

// Sit down: a held crouch on the ground (clears OVERPASS cables). Persists
// until the player stands up.
function sitDown() {
  const p = game.player;
  if (p.onGround && !p.sitting) {
    p.sitting = true;
    p.needSitUnderpass = false; // armed later if an overpass actually approaches
    audio.slide();
  }
}

function standUp() {
  const p = game.player;
  if (p.sitting) {
    p.sitting = false;
    p.needSitUnderpass = false;
  }
}

// Mid-air boost: airborne only, once per jump.
function airBoost() {
  const p = game.player;
  const res = applyAirBoost(p, CONFIG);
  if (!res) return;
  p.vy = res.vy;
  p.airBoostUsed = res.airBoostUsed;
  audio.boost();
  spawnBoostSparks();
}

// Fast-fall: airborne only — drop quickly and land standing.
function fastFall() {
  const p = game.player;
  const res = applyFastFall(p, CONFIG);
  if (!res) return;
  p.vy = res.vy;
  audio.slide();
}

// Tap / swipe up: boost in the air, stand up if sitting, otherwise jump.
function primaryAction() {
  if (phase !== STATE.RUNNING) return;
  const p = game.player;
  if (!p.onGround) airBoost();
  else if (p.sitting) standUp();
  else jump();
}

// Swipe down: fast-fall in the air, otherwise sit down on the ground.
function downAction() {
  if (phase !== STATE.RUNNING) return;
  if (!game.player.onGround) fastFall();
  else sitDown();
}

// The game-over splash appears after a short freeze; until it does, restarts
// are disabled so a tap during the freeze can't skip the score screen or race
// the delayed reveal (which used to pop the splash over a fresh run).
let gameoverTimer = null;
let canRestart = false;

function startGame() {
  if (gameoverTimer) { clearTimeout(gameoverTimer); gameoverTimer = null; }
  canRestart = false;
  audio.init();
  game = freshGame();
  phase = STATE.RUNNING;
  resumePhase = STATE.RUNNING;
  el.start.classList.add('hidden');
  el.gameover.classList.add('hidden');
  el.hud.setAttribute('aria-hidden', 'false');
  audio.startSwell();
  syncHud();
}

// `cause` is 'fault' (crashed into a firewall/cable) or 'shutdown' (runway hit
// zero — the kill-switch caught up). Each gets its own headline + SFX.
function endRun(cause = 'fault') {
  phase = STATE.OVER;
  resumePhase = STATE.OVER;
  game.running = false;
  // Keep game.alarm as-is: on a shutdown it stays at full so syncHud() (which
  // runs once more at the end of this frame) paints the meter empty + red.
  game.shake = cause === 'shutdown' ? 14 : 20;
  canRestart = false;
  if (cause === 'shutdown') audio.shutdown();
  else audio.hit();
  audio.stopSwell();

  el.gameoverTitle.textContent = cause === 'shutdown' ? 'RUNWAY EXHAUSTED' : 'PROCESS FAULTED';

  // Burn ledger / "inference invoice": how much compute this run cost. The
  // epitaph is a dev-flavored signal: a fault is a SIGSEGV, an empty runway is
  // an OOM SIGKILL. Peak burn is the drain at the top speed reached (speed only
  // ever rises, so the final speed is the peak).
  if (el.epitaph) {
    el.epitaph.textContent = cause === 'shutdown'
      ? 'SIGKILL · out of memory'
      : 'SIGSEGV · segmentation fault';
    el.epitaph.classList.toggle('shutdown', cause === 'shutdown');
  }
  if (el.invBurned) el.invBurned.textContent = Math.round(game.tokensBurned).toLocaleString('en-US');
  if (el.invPeak) el.invPeak.textContent = runwayDrainAt(game.speed).toFixed(1);
  if (el.invTheft) el.invTheft.textContent = theftFundedPct(game.tokensMinted, game.tokensBurned) + '%';

  const dist = scoreFromDistance(game.distance);
  const isBest = dist > best;
  if (isBest) {
    best = dist;
    localStorage.setItem(BEST_KEY, String(best));
  }
  el.finalDistance.textContent = dist + ' m';
  el.finalEmber.textContent = '$ ' + game.ember; // match the in-run HUD's "$ N" wage readout
  el.bestDistance.textContent = best + ' m';
  el.newBest.style.display = isBest ? 'block' : 'none';
  // Brief delay so the hit/shake registers before the overlay. Guard the
  // reveal in case a restart already happened during the freeze.
  if (gameoverTimer) clearTimeout(gameoverTimer);
  gameoverTimer = setTimeout(() => {
    gameoverTimer = null;
    if (phase !== STATE.OVER) return;
    el.gameover.classList.remove('hidden');
    canRestart = true;
  }, 420);
}

function syncHud() {
  el.distance.textContent = scoreFromDistance(game.distance) + ' m';
  el.ember.textContent = '$ ' + game.ember;
  // Burn meter: fill width tracks runway; flip to the critical (red) state when
  // the kill-switch panic is on.
  const pct = Math.max(0, Math.round((game.runway / CONFIG.runwayMax) * 100));
  if (el.runwayFill) el.runwayFill.style.width = pct + '%';
  if (el.runway) {
    el.runway.classList.toggle('critical', game.alarm > 0);
    el.runway.setAttribute('aria-valuenow', String(pct));
  }
  // Live exchange rate (tokens minted per wage at the current speed). It slides
  // from exchangeRateBase down to exchangeRateMin; flag the bottom third "lean"
  // so the player sees compute getting pricier as they push.
  if (el.exchangeRate) {
    const rate = exchangeRateAt(game.speed);
    el.exchangeRate.textContent = '⇄ ' + rate.toFixed(1);
    const lean = rate <= CONFIG.exchangeRateMin + (CONFIG.exchangeRateBase - CONFIG.exchangeRateMin) * 0.34;
    el.exchangeRate.classList.toggle('lean', lean);
  }
}

// --- Input -------------------------------------------------------------------
let touchStart = null;
const SWIPE_DIST = 28; // px downward to count as a slide
const SWIPE_TIME = 400; // ms

// First-launch controls card. While it's up, the first tap/key dismisses it
// (instead of starting the run) so a new player actually reads it once.
let helpVisible = false;
function dismissHelp() {
  if (!helpVisible) return;
  el.help.classList.add('hidden');
  el.start.setAttribute('aria-hidden', 'false'); // re-expose the start screen to AT
  helpVisible = false;
  touchStart = null; // drop the dismissing gesture so it can't leak into the run
  localStorage.setItem(HELP_KEY, '1');
  el.startBtn.focus?.(); // move focus onward to "Spin up"
}

function onTouchStart(e) {
  // First gesture also unlocks audio.
  audio.init();
  // Leave the HUD buttons to their own click handlers (mirror onTouchEnd).
  if (e.target === el.mute || e.target === el.daylight) return;
  // Suppress edge-swipe nav / scroll-initiation at touch-down (touch-action:none
  // covers most; this also blocks the in-Safari back-swipe). Listener is passive:false.
  e.preventDefault();
  if (e.touches && e.touches.length) {
    const t = e.touches[0];
    // `fired` marks that this gesture already triggered a duck on touchmove, so
    // touchend doesn't double-fire it.
    touchStart = { x: t.clientX, y: t.clientY, t: performance.now(), fired: false };
  }
}

// Down-swipe detected mid-drag: fire the slide/fast-fall the instant the thumb
// crosses the threshold instead of waiting for finger-lift (lower latency).
function onTouchMove(e) {
  // Same HUD guard as touchstart/end: a drag begun on a button isn't gameplay.
  if (e.target === el.mute || e.target === el.daylight) return;
  if (phase !== STATE.RUNNING || !touchStart || !(e.touches && e.touches.length)) return;
  e.preventDefault(); // no rubber-band during a gameplay drag
  if (touchStart.fired) return;
  const t = e.touches[0];
  const dy = t.clientY - touchStart.y;
  const dx = t.clientX - touchStart.x;
  const elapsed = performance.now() - touchStart.t;
  // Vertical-dominant, past the distance floor, within the swipe window.
  if (elapsed < SWIPE_TIME && dy > SWIPE_DIST && dy > Math.abs(dx)) {
    downAction();
    touchStart.fired = true;
  }
}

function onTouchEnd(e) {
  // Ignore taps on the HUD buttons (handled separately).
  if (e.target === el.mute || e.target === el.daylight) return;
  e.preventDefault();

  // First tap dismisses the controls card rather than starting the run.
  if (helpVisible) { dismissHelp(); return; }

  if (phase === STATE.READY) return startGame();
  if (phase === STATE.OVER) return canRestart ? startGame() : undefined;
  if (phase === STATE.PAUSED) return;

  // Duck already fired on touchmove — don't double-fire on release.
  if (touchStart && touchStart.fired) { touchStart = null; return; }
  if (!touchStart) return primaryAction();
  // Fallback for fast flicks that emitted no qualifying touchmove.
  const end = e.changedTouches && e.changedTouches[0];
  const dy = end ? end.clientY - touchStart.y : 0;
  const dx = end ? end.clientX - touchStart.x : 0;
  const elapsed = performance.now() - touchStart.t;
  if (elapsed < SWIPE_TIME && dy > SWIPE_DIST && dy > Math.abs(dx)) {
    // Swipe down: sit on the ground, fast-fall in the air.
    downAction();
  } else {
    // Tap or swipe up: jump / boost / stand up.
    primaryAction();
  }
  touchStart = null;
}

function onKeyDown(e) {
  // Ignore auto-repeat so holding a key can't spam actions or eat the air boost.
  if (e.repeat) return;
  // While the controls card is up, a move/start key dismisses it first.
  if (helpVisible && ['Space', 'ArrowUp', 'KeyW', 'ArrowDown', 'KeyS'].includes(e.code)) {
    e.preventDefault();
    dismissHelp();
    return;
  }
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    audio.init();
    if (phase === STATE.READY) startGame();
    else if (phase === STATE.OVER) { if (canRestart) startGame(); }
    else primaryAction();
  } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    e.preventDefault();
    downAction();
  } else if (e.code === 'KeyM') {
    toggleMute();
  }
}

function toggleMute() {
  audio.init();
  const muted = audio.toggleMute();
  el.mute.classList.toggle('muted', muted);
  el.mute.textContent = muted ? '♪̸' : '♪';
  el.mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}

// Glare mode lifts the scene for outdoor/direct-sun play. Defaults ON.
function applyDaylight(on) {
  document.body.classList.toggle('daylight', on);
  el.daylight.classList.toggle('active', on);
  el.daylight.setAttribute('aria-label', on ? 'Switch to dark mode' : 'Switch to glare mode');
  localStorage.setItem(DAYLIGHT_KEY, on ? '1' : '0');
}

function toggleDaylight() {
  const on = !document.body.classList.contains('daylight');
  applyDaylight(on);
}

// --- Orientation -------------------------------------------------------------
function checkOrientation() {
  const portrait = window.matchMedia('(orientation: portrait)').matches
    || window.innerHeight > window.innerWidth;
  if (portrait) {
    el.rotate.classList.remove('hidden');
    if (phase === STATE.RUNNING) {
      resumePhase = STATE.RUNNING;
      phase = STATE.PAUSED;
      audio.setSwell(0);
    }
  } else {
    el.rotate.classList.add('hidden');
    if (phase === STATE.PAUSED) {
      phase = resumePhase;
      if (phase === STATE.RUNNING) audio.setSwell(game.darkness);
    }
  }
}

// --- Main loop ---------------------------------------------------------------
let lastTime = performance.now();
function frame(now) {
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  // Clamp dt so tab-switches / hitches don't teleport the world.
  if (dt > 0.05) dt = 0.05;
  if (game) update(dt);
  if (game) renderer.draw(ctx, game, view);
  requestAnimationFrame(frame);
}

// --- Service worker ----------------------------------------------------------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(
      (reg) => console.log('[Burn Rate] service worker registered:', reg.scope),
      (err) => console.warn('[Burn Rate] service worker failed:', err)
    );
  });
}

// --- Boot --------------------------------------------------------------------
function init() {
  resize();
  game = freshGame(); // so the scene renders behind the start overlay
  el.bestDistance.textContent = best + ' m';

  // Restore mute visual state.
  el.mute.classList.toggle('muted', audio.isMuted);
  el.mute.textContent = audio.isMuted ? '♪̸' : '♪';

  // Daylight mode defaults ON (best for outdoor play); honor a saved choice.
  applyDaylight(localStorage.getItem(DAYLIGHT_KEY) !== '0');

  window.addEventListener('resize', () => { resize(); checkOrientation(); });
  window.addEventListener('orientationchange', () => { resize(); checkOrientation(); });
  window.matchMedia('(orientation: portrait)').addEventListener('change', checkOrientation);

  // Touch input (not mouse) on the canvas + overlays.
  const surface = document.body;
  surface.addEventListener('touchstart', onTouchStart, { passive: false });
  surface.addEventListener('touchmove', onTouchMove, { passive: false });
  surface.addEventListener('touchend', onTouchEnd, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  el.startBtn.addEventListener('click', startGame);
  el.restartBtn.addEventListener('click', startGame);
  el.helpBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissHelp(); });
  el.mute.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });
  el.daylight.addEventListener('click', (e) => { e.stopPropagation(); toggleDaylight(); });

  // First ever load: reveal the controls card on top of the start screen. Done
  // before checkOrientation() so a portrait first-load still paints #rotate above it.
  if (localStorage.getItem(HELP_KEY) !== '1') {
    el.help.classList.remove('hidden');
    helpVisible = true;
    el.start.setAttribute('aria-hidden', 'true'); // hide the screen behind the modal from AT
    el.helpBtn.focus?.(); // land focus on the dialog's action (guarded for the Node harness)
  }

  checkOrientation();
  registerSW();
  requestAnimationFrame(frame);
}

init();
