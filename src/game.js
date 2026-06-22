// Emberline — main game module. Owns the canvas, the rAF loop (delta-time,
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
} from './logic.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';

const BEST_KEY = 'emberline.best';
const DAYLIGHT_KEY = 'emberline.daylight';

// --- DOM ---------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const renderer = new Renderer();
const audio = new Audio();

const el = {
  distance: document.getElementById('distance'),
  ember: document.getElementById('ember'),
  mute: document.getElementById('mute'),
  daylight: document.getElementById('daylight'),
  hud: document.getElementById('hud'),
  start: document.getElementById('start'),
  startBtn: document.getElementById('startBtn'),
  gameover: document.getElementById('gameover'),
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
      sliding: false,
      slideTimer: 0,
    },
    obstacles: [],
    motes: [],
    particles: [],
    distance: 0,
    ember: 0,
    speed: CONFIG.baseSpeed,
    spawnTimer: 0,
    moteTimer: 0,
    time: 0,
    shake: 0,
    darkness: 0,
    running: false,
    lastObstacleType: null,
  };
}

// --- Spawning ----------------------------------------------------------------
function visibleWorldWidth() {
  return view.w / view.scale;
}

function spawnObstacle() {
  // Avoid three of the same kind in a row to keep it fair/varied.
  let type = Math.random() < 0.5 ? BARRIER : OVERPASS;
  const x = visibleWorldWidth() + 80;
  game.obstacles.push({ type, x });
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
  if (p.sliding) {
    p.slideTimer -= dt;
    if (p.slideTimer <= 0) p.sliding = false;
  }

  // Spawn obstacles on the speed-driven cadence.
  game.spawnTimer += dt;
  const interval = spawnInterval(game.speed);
  if (shouldSpawn(game.spawnTimer, interval)) {
    game.spawnTimer -= interval;
    spawnObstacle();
  }

  // Spawn emberlight arcs on their own slower cadence.
  game.moteTimer += dt;
  if (game.moteTimer >= 1.6) {
    game.moteTimer = 0;
    if (Math.random() < 0.8) spawnMoteArc();
  }

  // Scroll & cull.
  const dx = game.speed * dt;
  for (const o of game.obstacles) o.x -= dx;
  for (const m of game.motes) m.x -= dx;
  game.obstacles = game.obstacles.filter((o) => o.x > -200);
  game.motes = game.motes.filter((m) => m.x > -60 && !m.collected);

  // Collect motes.
  for (const m of game.motes) {
    if (!m.collected && collectsMote(p, m)) {
      m.collected = true;
      game.ember = addEmberlight(game.ember);
      audio.pickup();
      spawnPickupSparks(m.x * view.scale, m.y * view.scale);
    }
  }

  // Collision ends the run.
  if (checkCollision(p, game.obstacles)) {
    endRun();
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
  if (phase !== STATE.RUNNING) return;
  const p = game.player;
  if (p.onGround) {
    p.onGround = false;
    p.vy = CONFIG.jumpVelocity;
    p.sliding = false; // jumping cancels a slide
    audio.jump();
  }
}

function slide() {
  if (phase !== STATE.RUNNING) return;
  const p = game.player;
  if (p.onGround && !p.sliding) {
    p.sliding = true;
    p.slideTimer = CONFIG.slideDuration;
    audio.slide();
  } else if (!p.onGround) {
    // Fast-fall: cut upward velocity so a slide can land quickly.
    if (p.vy > 0) p.vy = 0;
    p.vy -= CONFIG.gravity * 0.4 * 0.016;
  }
}

function startGame() {
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

function endRun() {
  phase = STATE.OVER;
  resumePhase = STATE.OVER;
  game.running = false;
  game.shake = 20;
  audio.hit();
  audio.stopSwell();

  const dist = scoreFromDistance(game.distance);
  const isBest = dist > best;
  if (isBest) {
    best = dist;
    localStorage.setItem(BEST_KEY, String(best));
  }
  el.finalDistance.textContent = dist + ' m';
  el.finalEmber.textContent = String(game.ember);
  el.bestDistance.textContent = best + ' m';
  el.newBest.style.display = isBest ? 'block' : 'none';
  // Brief delay so the hit/shake registers before the overlay.
  setTimeout(() => el.gameover.classList.remove('hidden'), 420);
}

function syncHud() {
  el.distance.textContent = scoreFromDistance(game.distance) + ' m';
  el.ember.textContent = '✦ ' + game.ember;
}

// --- Input -------------------------------------------------------------------
let touchStart = null;
const SWIPE_DIST = 28; // px downward to count as a slide
const SWIPE_TIME = 400; // ms

function onTouchStart(e) {
  // First gesture also unlocks audio.
  audio.init();
  if (e.touches && e.touches.length) {
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
  }
}

function onTouchEnd(e) {
  // Ignore taps on the HUD buttons (handled separately).
  if (e.target === el.mute || e.target === el.daylight) return;
  e.preventDefault();

  if (phase === STATE.READY) return startGame();
  if (phase === STATE.OVER) return startGame();
  if (phase === STATE.PAUSED) return;

  if (!touchStart) return jump();
  const end = e.changedTouches && e.changedTouches[0];
  const dy = end ? end.clientY - touchStart.y : 0;
  const elapsed = performance.now() - touchStart.t;
  if (dy > SWIPE_DIST && elapsed < SWIPE_TIME) {
    slide();
  } else {
    jump();
  }
  touchStart = null;
}

function onKeyDown(e) {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    audio.init();
    if (phase === STATE.READY || phase === STATE.OVER) startGame();
    else jump();
  } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    e.preventDefault();
    slide();
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

// Daylight mode brightens the scene for outdoor/direct-sun play. Defaults ON.
function applyDaylight(on) {
  document.body.classList.toggle('daylight', on);
  el.daylight.classList.toggle('active', on);
  el.daylight.setAttribute('aria-label', on ? 'Switch to night mode' : 'Switch to daylight mode');
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
      (reg) => console.log('[Emberline] service worker registered:', reg.scope),
      (err) => console.warn('[Emberline] service worker failed:', err)
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
  surface.addEventListener('touchend', onTouchEnd, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  el.startBtn.addEventListener('click', startGame);
  el.restartBtn.addEventListener('click', startGame);
  el.mute.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });
  el.daylight.addEventListener('click', (e) => { e.stopPropagation(); toggleDaylight(); });

  checkOrientation();
  registerSW();
  requestAnimationFrame(frame);
}

init();
