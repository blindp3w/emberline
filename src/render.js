// Burn Rate — procedural renderer. Everything is drawn on the canvas; there are
// no image assets. The renderer is given the game state plus a `view` descriptor
// and paints the compute-burn datacenter scene in layers, back to front.
//
// Theme: you are a rogue AI fleeing forward through a server hall. Falling code
// rain and server racks recede behind a molten thermal CORE on the horizon; the
// road is a circuit-board data-bus; wage tokens glow money-green; a hazard-red
// shutdown front eats the floor behind you and flares as your runway empties.
//
// Coordinate mapping: pure logic lives in WORLD units (see logic.js). The
// `view` carries a `scale` (= cssHeight / WORLD.height) so world (wx, wy) maps
// to screen (wx * scale, wy * scale). We fit by height, so vertical gameplay
// (jump arcs, obstacle clearances) is always fully visible; the extra landscape
// width simply reveals more floor.

import { WORLD, CONFIG, BARRIER } from './logic.js';

// Palette — compute-burn datacenter --------------------------------------------
const SKY_TOP = '#05070f'; // near-black server-hall ceiling
const SKY_MID = '#0a1320'; // deep teal-indigo
const SKY_LOW = '#10242f'; // teal haze rising toward the core
const CORE = '#ff7a2c'; // molten thermal compute (the AI core on the horizon)
const CORE_HOT = '#ffe1ad'; // hottest center of the core
const CODE_GREEN = '57,255,158'; // terminal code-rain (rgb triplet)
const CIRCUIT = '91,232,255'; // cyan circuit traces (rgb triplet)
const TOKEN = '93,255,138'; // money-green wage tokens (rgb triplet)
const AMBER = '255,176,32'; // firewall gate — amber "jump over" hazard (rgb triplet)
const HAZARD = '255,45,79'; // shutdown front / danger red (rgb triplet)
const SILHOUETTE = '#04070e'; // racks / towers — near-black, cool
const RIM = 'rgba(120,230,255,0.9)'; // cyan rim (the slide-under affordance)
const RIM_WARM = 'rgba(255,150,90,0.95)'; // thermal rim

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Renderer {
  constructor() {
    // Pre-generate parallax structures with fixed seeds so the scene is stable
    // across frames but looks hand-placed. (Kept static for performance — see
    // the per-frame budget note in CLAUDE.md.)
    this.racks = this._buildRacks(20240101, 60, 0.18, 0.42);
    this.towers = this._buildTowers(73019, 26);
    this.code = this._buildCode(0xc0de, 26);
  }

  _buildRacks(seed, count, minH, maxH) {
    const rnd = mulberry32(seed);
    const out = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
      const w = 40 + rnd() * 120;
      const h = (minH + rnd() * (maxH - minH)) * WORLD.height;
      out.push({ x, w, h, lit: rnd() < 0.45, seed: rnd() * 100, hue: rnd() });
      x += w + rnd() * 30;
    }
    return { spans: out, total: x };
  }

  _buildTowers(seed, count) {
    const rnd = mulberry32(seed);
    const out = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
      const w = 30 + rnd() * 70;
      const h = 60 + rnd() * 180;
      const vents = rnd() < 0.5; // GPU/cooling tower with a hot vent
      out.push({ x, w, h, vents, seed: rnd() * 100 });
      x += w + 120 + rnd() * 220;
    }
    return { spans: out, total: x };
  }

  _buildCode(seed, count) {
    const rnd = mulberry32(seed);
    const cols = [];
    for (let i = 0; i < count; i++) {
      cols.push({
        xf: (i + rnd() * 0.6) / count, // fractional x across the width
        speed: 0.18 + rnd() * 0.5, // fall speed
        phase: rnd(), // initial offset along the column
        len: 6 + Math.floor(rnd() * 10), // trailing glyph cells
        bright: 0.22 + rnd() * 0.5,
      });
    }
    return cols;
  }

  // Main entry. `state` is the live game world; `view` = {w, h, scale}.
  draw(ctx, state, view) {
    const { w, h } = view;
    const horizonY = h * 0.55; // the core band
    const groundY = WORLD.groundY * view.scale; // where the agent runs
    const alarm = state.alarm || 0; // runway pressure [0..1]
    const time = state.time || 0;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Screen shake (applied to the whole scene).
    if (state.shake > 0.5) {
      const s = state.shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    this._sky(ctx, w, h, horizonY);
    this._codeRain(ctx, w, horizonY, time);
    this._racks(ctx, view, horizonY, state.distance, time);
    this._coreBand(ctx, w, horizonY, time, alarm);
    this._dataGrid(ctx, view, horizonY, state.distance, time);
    this._towers(ctx, view, groundY, state.distance);
    this._floor(ctx, w, h, groundY);

    this._tokens(ctx, view, state.motes, time);
    this._obstacles(ctx, view, state.obstacles, groundY, time);
    this._agent(ctx, view, state.player, groundY, time, state.running, alarm);
    this._particles(ctx, state.particles);

    this._shutdownFront(ctx, w, h, state.darkness, alarm, time);
    this._scanlines(ctx, w, h, alarm, state.shake || 0, time);

    ctx.restore();
  }

  // ---- Layers --------------------------------------------------------------

  _sky(ctx, w, h, horizonY) {
    const g = ctx.createLinearGradient(0, 0, 0, horizonY + h * 0.12);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(0.5, SKY_MID);
    g.addColorStop(0.85, SKY_LOW);
    g.addColorStop(1, '#3a2a1f'); // warm haze just under the core
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizonY + 2);
  }

  // Falling terminal code in the upper hall — additive green glyph cascades.
  _codeRain(ctx, w, region, time) {
    const cell = Math.max(9, region * 0.04);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glyphW = Math.max(2, cell * 0.42);
    for (const c of this.code) {
      const x = c.xf * w;
      const span = region + cell * c.len;
      const headY = ((time * c.speed + c.phase) % 1) * span;
      for (let k = 0; k < c.len; k++) {
        const y = headY - k * cell;
        if (y < -cell || y > region) continue;
        const a = (1 - k / c.len) * c.bright;
        if (k === 0) {
          ctx.fillStyle = `rgba(200,255,220,${Math.min(0.85, a + 0.3)})`; // bright head
        } else {
          ctx.fillStyle = `rgba(${CODE_GREEN},${a * 0.5})`;
        }
        ctx.fillRect(x, y, glyphW, cell * 0.66);
      }
    }
    ctx.restore();
  }

  // Background server racks — dark towers with a cool edge and blinking LEDs.
  _racks(ctx, view, horizonY, distance, time) {
    const { w, scale } = view;
    const parallax = 0.06;
    const offset = (distance * parallax) % this.racks.total;
    const baseY = horizonY;
    ctx.save();
    for (let pass = 0; pass < 2; pass++) {
      const shift = pass * this.racks.total;
      for (const b of this.racks.spans) {
        const x = b.x - offset + shift;
        const sx = (x % this.racks.total) * (scale * 0.9);
        if (sx > w + 40 || sx < -160) continue;
        const rw = b.w * scale * 0.9;
        const rh = b.h * scale * 0.5;
        const top = baseY - rh;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#070d18';
        ctx.fillRect(sx, top, rw, rh);
        // Cool sliver along the top, catching the hall light.
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = `rgba(${CIRCUIT},0.3)`;
        ctx.fillRect(sx, top, rw, 1.5);
        // Blinking indicator LEDs down one edge.
        if (b.lit) {
          const leds = Math.max(3, Math.floor(rh / 16));
          const lx = sx + rw - 4;
          for (let j = 0; j < leds; j++) {
            const tw = Math.sin(time * (1.5 + b.hue) + j * 1.3 + b.seed);
            if (tw < 0.1) continue;
            ctx.globalAlpha = 0.5 + tw * 0.4;
            ctx.fillStyle = b.hue < 0.5 ? `rgb(${TOKEN})` : `rgb(${CIRCUIT})`;
            ctx.fillRect(lx, top + 6 + j * 16, 2.5, 2.5);
          }
        }
      }
    }
    ctx.restore();
  }

  // The AI core on the horizon — a molten thermal band with a breathing bloom.
  // It shifts hotter/redder as the runway empties (alarm).
  _coreBand(ctx, w, horizonY, time, alarm) {
    const pulse = 0.85 + Math.sin(time * 1.5) * 0.15;
    const bandH = 8;
    const redshift = alarm; // 0 = thermal orange, 1 = hazard red
    ctx.save();
    // Bloom
    const bloom = ctx.createLinearGradient(0, horizonY - 80, 0, horizonY + 80);
    const midR = Math.round(255);
    const midG = Math.round(122 - 60 * redshift);
    const midB = Math.round(44 + 10 * redshift);
    bloom.addColorStop(0, 'rgba(255,122,44,0)');
    bloom.addColorStop(0.5, `rgba(${midR},${midG},${midB},${0.5 * pulse})`);
    bloom.addColorStop(1, 'rgba(255,122,44,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, horizonY - 80, w, 160);
    // Core line (single shadowBlur use — cheap enough for one band).
    ctx.shadowColor = redshift > 0.5 ? `rgb(${HAZARD})` : CORE;
    ctx.shadowBlur = 30;
    ctx.fillStyle = CORE_HOT;
    ctx.fillRect(0, horizonY - bandH / 2, w, bandH);
    ctx.restore();
  }

  // The data-bus: a perspective circuit grid receding to a vanishing point at
  // the core, with bright pulses streaming down a subset of the traces.
  _dataGrid(ctx, view, horizonY, distance, time) {
    const { w } = view;
    const vpX = w * 0.5;
    const bottom = view.h;
    ctx.save();
    ctx.strokeStyle = `rgba(${CIRCUIT},0.28)`;
    ctx.lineWidth = 1.5;

    // Converging longitudinal traces.
    const lanes = 14;
    const feet = [];
    for (let i = -lanes; i <= lanes; i++) {
      const fx = vpX + (i / lanes) * w * 1.4;
      feet.push(fx);
      ctx.beginPath();
      ctx.moveTo(fx, bottom);
      ctx.lineTo(vpX, horizonY);
      ctx.stroke();
    }

    // Horizontal rungs, perspective-spaced and scrolling toward us.
    const scroll = (distance * 0.5) % 1;
    for (let i = 0; i < 22; i++) {
      const t = (i + scroll) / 22; // 0 at horizon, 1 at bottom
      const ease = t * t; // denser near horizon
      const y = horizonY + ease * (bottom - horizonY);
      const alpha = 0.08 + ease * 0.3;
      ctx.strokeStyle = `rgba(${CIRCUIT},${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Data pulses streaming down every 4th longitudinal trace.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < feet.length; i += 4) {
      const fx = feet[i];
      const p = (time * 0.6 + i * 0.13) % 1;
      const ease = p * p;
      const px = vpX + (fx - vpX) * ease;
      const py = horizonY + (bottom - horizonY) * ease;
      const r = 1.5 + ease * 3.5;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r * 3);
      g.addColorStop(0, `rgba(200,255,220,${0.5 + ease * 0.4})`);
      g.addColorStop(1, `rgba(${TOKEN},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Foreground GPU / cooling towers with hot vents and LED glints.
  _towers(ctx, view, groundY, distance) {
    const { w, scale } = view;
    const parallax = 0.35;
    const total = this.towers.total;
    const offset = (distance * parallax) % total;
    ctx.save();
    for (let pass = 0; pass < 2; pass++) {
      const shift = pass * total;
      for (const r of this.towers.spans) {
        const wx = r.x - offset + shift;
        const sx = (wx % total) * (scale * 0.7);
        if (sx > w + 60 || sx < -120) continue;
        const sw = r.w * scale * 0.7;
        const sh = r.h * scale * 0.7;
        const top = groundY - sh;
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = SILHOUETTE;
        ctx.fillRect(sx, top, sw, sh);
        // Cyan edge highlight.
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = `rgba(${CIRCUIT},0.35)`;
        ctx.fillRect(sx, top, sw, 2);
        if (r.vents) {
          // A hot exhaust vent glowing warm near the base.
          ctx.globalAlpha = 0.8;
          const vy = top + sh * 0.55;
          const grd = ctx.createLinearGradient(sx, vy, sx, vy + sh * 0.4);
          grd.addColorStop(0, `rgba(${HAZARD},0.0)`);
          grd.addColorStop(1, 'rgba(255,140,70,0.45)');
          ctx.fillStyle = grd;
          ctx.fillRect(sx + 2, vy, sw - 4, sh * 0.4);
        } else {
          // A small green status LED.
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = `rgb(${TOKEN})`;
          ctx.fillRect(sx + sw * 0.5, top + 6, 3, 3);
        }
      }
    }
    ctx.restore();
  }

  _floor(ctx, w, h, groundY) {
    const g = ctx.createLinearGradient(0, groundY, 0, h);
    g.addColorStop(0, 'rgba(12,26,34,0.96)');
    g.addColorStop(1, '#04080f');
    ctx.fillStyle = g;
    ctx.fillRect(0, groundY, w, h - groundY);
    // Lit circuit edge of the data-floor.
    ctx.fillStyle = `rgba(${CIRCUIT},0.8)`;
    ctx.fillRect(0, groundY - 2, w, 2.5);
  }

  // Wage tokens — money-green coins that spin as they scroll.
  _tokens(ctx, view, motes, time) {
    if (!motes) return;
    ctx.save();
    for (const m of motes) {
      if (m.collected) continue;
      const sx = m.x * view.scale;
      const sy = m.y * view.scale;
      const r = (m.r || CONFIG.moteRadius) * view.scale;
      const flicker = 0.8 + Math.sin(time * 6 + m.x) * 0.2;
      // Soft green glow.
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3);
      g.addColorStop(0, `rgba(${TOKEN},${0.9 * flicker})`);
      g.addColorStop(0.4, `rgba(${TOKEN},${0.4 * flicker})`);
      g.addColorStop(1, `rgba(${TOKEN},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 3, 0, Math.PI * 2);
      ctx.fill();
      // Spinning coin body — width oscillates to fake rotation.
      const spin = Math.abs(Math.cos(time * 4 + m.x * 0.05));
      const rx = Math.max(1.2, r * (0.35 + 0.65 * spin));
      ctx.fillStyle = '#0a2a16';
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${TOKEN},0.95)`;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Bright glint when the coin faces us.
      if (spin > 0.5) {
        ctx.fillStyle = `rgba(220,255,230,${(spin - 0.5) * 1.6})`;
        ctx.fillRect(sx - 1, sy - r * 0.5, 2, r);
      }
    }
    ctx.restore();
  }

  _obstacles(ctx, view, obstacles, groundY, time) {
    const s = view.scale;
    ctx.save();
    for (const o of obstacles) {
      const x = o.x * s;
      if (o.type === BARRIER) {
        // FIREWALL — an amber energy slab you must jump. Amber (not red) keeps it
        // distinct from the red shutdown front chasing from behind. Animated
        // scanlines read instantly as "danger, go over".
        const bw = CONFIG.barrierWidth * s;
        const bh = CONFIG.barrierHeight * s;
        const top = groundY - bh;
        const grad = ctx.createLinearGradient(x, top, x, groundY);
        grad.addColorStop(0, `rgba(${AMBER},0.9)`);
        grad.addColorStop(1, `rgba(${AMBER},0.4)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, top, bw, bh);
        // Horizontal energy scanlines scrolling up.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, top, bw, bh);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,238,200,0.6)';
        ctx.lineWidth = 1;
        const off = (time * 60) % 10;
        for (let yy = top - off; yy < groundY; yy += 10) {
          ctx.beginPath();
          ctx.moveTo(x, yy);
          ctx.lineTo(x + bw, yy);
          ctx.stroke();
        }
        ctx.restore();
        // Bright amber rim.
        ctx.strokeStyle = `rgba(${AMBER},1)`;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x, top, bw, bh);
      } else {
        // THROTTLE BAR — fibre-optic bundle hanging from the ceiling; slide
        // under the bright cyan underside.
        const ow = CONFIG.overpassWidth * s;
        const beamBottom = groundY - CONFIG.overpassGap * s;
        const beamTop = beamBottom - CONFIG.overpassThickness * s;
        const grad = ctx.createLinearGradient(x, beamTop, x, beamBottom);
        grad.addColorStop(0, SILHOUETTE);
        grad.addColorStop(1, '#0a1622');
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, ow, beamBottom); // pillar up to the ceiling
        // Bright cyan underside — the part you slide beneath.
        ctx.strokeStyle = RIM;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, beamBottom);
        ctx.lineTo(x + ow, beamBottom);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${CIRCUIT},0.6)`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, beamTop, ow, CONFIG.overpassThickness * s);
        // Glowing fibre strands drooping beneath, pulsing with data.
        for (let k = 0; k < 3; k++) {
          const fy = beamBottom + (4 + k * 4) * s;
          const phase = Math.sin(time * 3 + k + x * 0.01);
          ctx.strokeStyle = k % 2 === 0
            ? `rgba(${TOKEN},${0.4 + phase * 0.2})`
            : `rgba(${CIRCUIT},${0.4 + phase * 0.2})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, beamBottom);
          ctx.quadraticCurveTo(x + ow / 2, fy + 6 * s, x + ow, beamBottom);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // The rogue AI agent — an angular daemon with a bright pulsing core. The core
  // dims and flickers red as the runway empties (alarm); when sitting it folds
  // into a low dash. No legs; it hovers, trailing data-wisps.
  _agent(ctx, view, player, groundY, time, running, alarm) {
    const s = view.scale;
    const x = player.x * s;
    const w = player.width * s;
    const standH = CONFIG.standHeight * s;
    const slideH = CONFIG.slideHeight * s;
    const h = player.sitting ? slideH : standH;
    const bottom = groundY - (player.jumpOffset || 0) * s;
    const top = bottom - h;
    const cx = x + w / 2;
    const coreY = top + h * 0.42;
    const bob = running && player.onGround ? Math.sin(time * 18) * h * 0.03 : 0;

    ctx.save();

    // Outer aura — cyan/green normally, redshifting under alarm. A low-runway
    // flicker makes it gutter like a dying process.
    const flick = alarm > 0 ? 0.65 + Math.sin(time * 24) * 0.35 * alarm : 1;
    const auraR = w * 2.4;
    const ar = Math.round(93 + (255 - 93) * alarm);
    const ag = Math.round(255 - 210 * alarm);
    const ab = Math.round(138 - 59 * alarm);
    const aura = ctx.createRadialGradient(cx, coreY + bob, 0, cx, coreY + bob, auraR);
    aura.addColorStop(0, `rgba(${ar},${ag},${ab},${0.7 * flick})`);
    aura.addColorStop(0.4, `rgba(${ar},${ag},${ab},${0.25 * flick})`);
    aura.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(cx, coreY + bob, auraR, 0, Math.PI * 2);
    ctx.fill();

    // Trailing data-wisps streaming off the back (left).
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const wy = top + h * (0.3 + k * 0.18) + bob;
      const len = (10 + k * 6 + (running ? Math.sin(time * 10 + k) * 6 : 0)) * 1;
      ctx.strokeStyle = `rgba(${TOKEN},${0.18 - k * 0.03})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, wy);
      ctx.lineTo(x - len, wy + (k - 1.5) * 3);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Body — an angular dark shell with a cyan rim.
    ctx.fillStyle = SILHOUETTE;
    ctx.strokeStyle = alarm > 0.5 ? `rgba(${HAZARD},0.9)` : RIM;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    if (player.sitting) {
      this._roundRect(ctx, x - w * 0.1, top + bob, w * 1.3, h, 5);
      ctx.fill();
      ctx.stroke();
    } else {
      // A hexagonal "process" shell.
      const left = x + w * 0.12;
      const right = x + w * 0.88;
      const t2 = top + h * 0.16 + bob;
      const b2 = top + h * 0.86 + bob;
      ctx.beginPath();
      ctx.moveTo(cx, top + bob);
      ctx.lineTo(right, t2);
      ctx.lineTo(right, b2);
      ctx.lineTo(cx, bottom);
      ctx.lineTo(left, b2);
      ctx.lineTo(left, t2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // A scanning "eye" slit.
      ctx.strokeStyle = `rgba(${CIRCUIT},0.7)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(left + 3, top + h * 0.3 + bob);
      ctx.lineTo(right - 3, top + h * 0.3 + bob);
      ctx.stroke();
    }

    // The bright reactor core — pulses; guts out when the runway is low.
    const pulse = 0.7 + Math.sin(time * 8) * 0.3;
    const coreR = w * 0.22 * (player.sitting ? 0.8 : 1) * pulse * flick;
    const cr = Math.round(234 + (255 - 234) * alarm);
    const cg = Math.round(255 - 200 * alarm);
    const cb = Math.round(224 - 150 * alarm);
    const cg2 = ctx.createRadialGradient(cx, coreY + bob, 0, cx, coreY + bob, coreR * 2.2);
    cg2.addColorStop(0, `rgba(255,255,255,${flick})`);
    cg2.addColorStop(0.4, `rgba(${cr},${cg},${cb},${flick})`);
    cg2.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = cg2;
    ctx.beginPath();
    ctx.arc(cx, coreY + bob, coreR * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _particles(ctx, particles) {
    if (!particles) return;
    ctx.save();
    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      const tint = p.tint || [255, 200, 120];
      ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // The shutdown front — the kill-switch eating the floor from the trailing
  // (left) edge. Reaches further with speed (darkness) AND runway pressure
  // (alarm), and tears into red glitch static as it closes in.
  _shutdownFront(ctx, w, h, darkness, alarm, time) {
    const intensity = Math.max(0, Math.min(1, darkness * 0.7 + alarm * 0.6));
    const reach = (0.12 + intensity * 0.32) * w;
    const g = ctx.createLinearGradient(0, 0, reach, 0);
    g.addColorStop(0, `rgba(${HAZARD},${0.35 + alarm * 0.4})`);
    g.addColorStop(0.4, `rgba(20,2,8,${0.45 + intensity * 0.3})`);
    g.addColorStop(1, 'rgba(8,2,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, reach, h);
    // Glitch static slices tearing at the leading edge.
    ctx.save();
    ctx.globalAlpha = 0.2 + intensity * 0.4;
    for (let i = 0; i < 6; i++) {
      const ty = (i + 0.5) / 6;
      const len = reach * (0.55 + 0.45 * Math.sin(time * 2 + i));
      ctx.fillStyle = i % 2 === 0 ? `rgba(${HAZARD},0.5)` : 'rgba(5,1,6,0.7)';
      ctx.fillRect(0, h * ty - 6, len, 3 + (i % 3));
    }
    ctx.restore();
  }

  // CRT scanlines + vignette, with RGB-split glitch bars when the system is
  // failing (high alarm or a fresh hit). Kept cheap per the perf budget.
  _scanlines(ctx, w, h, alarm, shake, time) {
    // Vignette.
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    // Scanlines — a cached repeating pattern (one fill) instead of hundreds of
    // per-frame line fills, to stay within the mobile frame budget.
    const pattern = this._scanPattern(ctx);
    ctx.save();
    ctx.globalAlpha = 0.06;
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#000';
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
    // Glitch bars when failing.
    const fail = Math.max(alarm, shake > 4 ? 0.6 : 0);
    if (fail > 0.35 && Math.sin(time * 40) > 0.7) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const y = (Math.sin(time * 13 + i * 2.1) * 0.5 + 0.5) * h;
        const bh = 2 + (i % 3) * 2;
        ctx.fillStyle = i % 2 ? `rgba(${HAZARD},0.25)` : `rgba(${CIRCUIT},0.25)`;
        ctx.fillRect(0, y, w, bh);
      }
      ctx.restore();
    }
  }

  // Build the scanline tile once (a 3px-tall stripe with one dark row) and cache
  // the repeating CanvasPattern. Returns null where no canvas is available (e.g.
  // the Node smoke harness), so callers fall back to a direct fill.
  _scanPattern(ctx) {
    if (this._scan !== undefined) return this._scan;
    try {
      if (typeof document === 'undefined' || !document.createElement) { this._scan = null; return null; }
      const tile = document.createElement('canvas');
      tile.width = 1;
      tile.height = 3;
      const tctx = tile.getContext('2d');
      tctx.fillStyle = '#000';
      tctx.fillRect(0, 0, 1, 1); // one dark row in three
      this._scan = ctx.createPattern(tile, 'repeat');
    } catch (e) {
      this._scan = null;
    }
    return this._scan;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
