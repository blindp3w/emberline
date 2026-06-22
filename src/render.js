// Emberline — procedural renderer. Everything is drawn on the canvas; there
// are no image assets. The renderer is given the game state plus a `view`
// descriptor and paints the dusk-synthwave scene in layers, back to front.
//
// Coordinate mapping: pure logic lives in WORLD units (see logic.js). The
// `view` carries a `scale` (= cssHeight / WORLD.height) so world (wx, wy) maps
// to screen (wx * scale, wy * scale). We fit by height, so vertical gameplay
// (jump arcs, obstacle clearances) is always fully visible; the extra
// landscape width simply reveals more road.

import { WORLD, CONFIG, BARRIER } from './logic.js';

// Palette --------------------------------------------------------------------
// Tuned for readability in bright ambient light: lifted background midtones and
// brighter accents so the high-contrast silhouettes/rims pop outdoors.
const SKY_TOP = '#3c2278';
const SKY_MID = '#642e9a';
const SKY_LOW = '#bb3f92';
const MAGENTA = '#ff3d93';
const MAGENTA_SOFT = '#ff86bd';
const EMBER = '#ffe0a6';
const EMBER_HOT = '#ffa85c';
const SILHOUETTE = '#160b28'; // not pure black, so it reads against the sky
const RIM = 'rgba(120,230,255,0.9)'; // cool rim light for foreground edges
const RIM_WARM = 'rgba(255,170,205,0.9)';

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
    // Pre-generate parallax silhouettes with a fixed seed so the skyline is
    // stable across frames but looks hand-placed.
    this.skyline = this._buildSkyline(20240101, 60, 0.18, 0.42);
    this.ruins = this._buildRuins(73019, 26);
  }

  _buildSkyline(seed, count, minH, maxH) {
    const rnd = mulberry32(seed);
    const out = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
      const w = 40 + rnd() * 120;
      const h = (minH + rnd() * (maxH - minH)) * WORLD.height;
      out.push({ x, w, h, lit: rnd() < 0.35 });
      x += w + rnd() * 30;
    }
    return { spans: out, total: x };
  }

  _buildRuins(seed, count) {
    const rnd = mulberry32(seed);
    const out = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
      const w = 30 + rnd() * 70;
      const h = 60 + rnd() * 180;
      const broken = rnd() < 0.5;
      out.push({ x, w, h, broken });
      x += w + 120 + rnd() * 220;
    }
    return { spans: out, total: x };
  }

  // Main entry. `state` is the live game world; `view` = {w, h, scale}.
  draw(ctx, state, view) {
    const { w, h } = view;
    const horizonY = h * 0.55; // the Emberline band
    const groundY = WORLD.groundY * view.scale; // where the runner stands

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Screen shake (applied to the whole scene).
    if (state.shake > 0.5) {
      const s = state.shake;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    this._sky(ctx, w, h, horizonY);
    this._skylineLayer(ctx, view, horizonY, state.distance);
    this._emberlineBand(ctx, w, horizonY, state.time);
    this._roadGrid(ctx, view, horizonY, groundY, state.distance);
    this._ruinsLayer(ctx, view, groundY, state.distance);
    this._road(ctx, w, h, groundY);

    this._motes(ctx, view, state.motes, state.time);
    this._obstacles(ctx, view, state.obstacles, groundY);
    this._runner(ctx, view, state.player, groundY, state.time, state.running);
    this._particles(ctx, state.particles);

    this._creepingDark(ctx, w, h, state.darkness);
    this._vignette(ctx, w, h);

    ctx.restore();
  }

  // ---- Layers --------------------------------------------------------------

  _sky(ctx, w, h, horizonY) {
    const g = ctx.createLinearGradient(0, 0, 0, horizonY + h * 0.12);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(0.45, SKY_MID);
    g.addColorStop(0.8, SKY_LOW);
    g.addColorStop(1, MAGENTA);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizonY + 2);
  }

  _skylineLayer(ctx, view, horizonY, distance) {
    const { w, scale } = view;
    const parallax = 0.06;
    const offset = (distance * parallax) % this.skyline.total;
    const baseY = horizonY;
    ctx.save();
    ctx.fillStyle = '#1b0d33';
    ctx.globalAlpha = 0.85;
    // Tile the skyline twice to cover the wrap.
    for (let pass = 0; pass < 2; pass++) {
      const shift = pass * this.skyline.total;
      for (const b of this.skyline.spans) {
        const x = b.x - offset + shift;
        const sx = (x % (this.skyline.total)) * (scale * 0.9);
        if (sx > w + 40 || sx < -160) continue;
        ctx.fillRect(sx, baseY - b.h * scale * 0.5, b.w * scale * 0.9, b.h * scale * 0.5);
      }
    }
    ctx.restore();
  }

  _emberlineBand(ctx, w, horizonY, time) {
    // The glowing horizon: a bright magenta core with a soft bloom and a faint
    // breathing pulse.
    const pulse = 0.85 + Math.sin(time * 1.5) * 0.15;
    const bandH = 8;
    ctx.save();
    // Bloom
    const bloom = ctx.createLinearGradient(0, horizonY - 70, 0, horizonY + 70);
    bloom.addColorStop(0, 'rgba(255,46,136,0)');
    bloom.addColorStop(0.5, `rgba(255,80,160,${0.5 * pulse})`);
    bloom.addColorStop(1, 'rgba(255,46,136,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, horizonY - 70, w, 140);
    // Core line
    ctx.shadowColor = MAGENTA;
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ffd9ec';
    ctx.fillRect(0, horizonY - bandH / 2, w, bandH);
    ctx.restore();
  }

  _roadGrid(ctx, view, horizonY, groundY, distance) {
    // Perspective grid receding from the foreground road up to a vanishing
    // point at the horizon — the sunken-city road.
    const { w } = view;
    const vpX = w * 0.5;
    const bottom = view.h;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,120,195,0.42)';
    ctx.lineWidth = 1.5;

    // Converging longitudinal lines.
    const lanes = 14;
    for (let i = -lanes; i <= lanes; i++) {
      const fx = vpX + (i / lanes) * w * 1.4;
      ctx.beginPath();
      ctx.moveTo(fx, bottom);
      ctx.lineTo(vpX, horizonY);
      ctx.stroke();
    }

    // Horizontal rungs, spaced by a perspective curve and scrolling toward us.
    const scroll = (distance * 0.5) % 1;
    for (let i = 0; i < 22; i++) {
      const t = (i + scroll) / 22; // 0 at horizon, 1 at bottom
      const ease = t * t; // denser near horizon
      const y = horizonY + ease * (bottom - horizonY);
      const alpha = 0.1 + ease * 0.4;
      ctx.strokeStyle = `rgba(255,140,200,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  _ruinsLayer(ctx, view, groundY, distance) {
    const { w, scale } = view;
    const parallax = 0.35;
    const total = this.ruins.total;
    const offset = (distance * parallax) % total;
    ctx.save();
    ctx.fillStyle = '#120a26';
    ctx.globalAlpha = 0.9;
    for (let pass = 0; pass < 2; pass++) {
      const shift = pass * total;
      for (const r of this.ruins.spans) {
        const wx = r.x - offset + shift;
        const sx = (wx % total) * (scale * 0.7);
        if (sx > w + 60 || sx < -120) continue;
        const sw = r.w * scale * 0.7;
        const sh = r.h * scale * 0.7;
        const top = groundY - sh;
        ctx.fillRect(sx, top, sw, sh);
        if (r.broken) {
          // chip the top corner to suggest a ruin
          ctx.clearRect(sx + sw * 0.6, top, sw * 0.4, sh * 0.3);
        }
      }
    }
    ctx.restore();
  }

  _road(ctx, w, h, groundY) {
    const g = ctx.createLinearGradient(0, groundY, 0, h);
    g.addColorStop(0, 'rgba(74,28,78,0.95)');
    g.addColorStop(1, '#1a0d2e');
    ctx.fillStyle = g;
    ctx.fillRect(0, groundY, w, h - groundY);
    // The lit edge of the road catching the Emberline.
    ctx.fillStyle = 'rgba(255,130,190,0.75)';
    ctx.fillRect(0, groundY - 2, w, 3);
  }

  _motes(ctx, view, motes, time) {
    if (!motes) return;
    ctx.save();
    for (const m of motes) {
      if (m.collected) continue;
      const sx = m.x * view.scale;
      const sy = m.y * view.scale;
      const r = (m.r || CONFIG.moteRadius) * view.scale;
      const flicker = 0.8 + Math.sin(time * 6 + m.x) * 0.2;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3.2);
      g.addColorStop(0, `rgba(255,236,200,${flicker})`);
      g.addColorStop(0.4, `rgba(255,160,80,${0.7 * flicker})`);
      g.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff7e6';
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _obstacles(ctx, view, obstacles, groundY) {
    const s = view.scale;
    ctx.save();
    for (const o of obstacles) {
      const x = o.x * s;
      if (o.type === BARRIER) {
        // Low rubble: a jagged mound with a warm-lit face and bright top edge.
        const bw = CONFIG.barrierWidth * s;
        const bh = CONFIG.barrierHeight * s;
        const grad = ctx.createLinearGradient(x, groundY - bh, x, groundY);
        grad.addColorStop(0, '#3a1a44');
        grad.addColorStop(1, SILHOUETTE);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, groundY);
        ctx.lineTo(x + bw * 0.15, groundY - bh * 0.7);
        ctx.lineTo(x + bw * 0.45, groundY - bh);
        ctx.lineTo(x + bw * 0.7, groundY - bh * 0.6);
        ctx.lineTo(x + bw, groundY - bh * 0.85);
        ctx.lineTo(x + bw, groundY);
        ctx.closePath();
        ctx.fill();
        // Bright warning rim so the obstacle reads instantly.
        ctx.strokeStyle = RIM_WARM;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        // Overpass / cables: a beam hanging from the top with droop cables.
        const ow = CONFIG.overpassWidth * s;
        const beamBottom = groundY - CONFIG.overpassGap * s;
        const beamTop = beamBottom - CONFIG.overpassThickness * s;
        const grad = ctx.createLinearGradient(x, beamTop, x, beamBottom);
        grad.addColorStop(0, SILHOUETTE);
        grad.addColorStop(1, '#3a1a44');
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, ow, beamBottom); // pillar up to the top of screen
        // Bright underside edge — the part you must slide beneath.
        ctx.strokeStyle = RIM;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, beamBottom);
        ctx.lineTo(x + ow, beamBottom);
        ctx.stroke();
        ctx.strokeStyle = RIM_WARM;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, beamTop, ow, CONFIG.overpassThickness * s);
        // Drooping cables beneath
        ctx.strokeStyle = 'rgba(120,230,255,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, beamBottom);
        ctx.quadraticCurveTo(x + ow / 2, beamBottom + 10 * s, x + ow, beamBottom);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _runner(ctx, view, player, groundY, time, running) {
    const s = view.scale;
    const x = player.x * s;
    const w = player.width * s;
    const standH = CONFIG.standHeight * s;
    const slideH = CONFIG.slideHeight * s;
    const h = player.sliding ? slideH : standH;
    const bottom = groundY - (player.jumpOffset || 0) * s;
    const top = bottom - h;
    const cx = x + w / 2;

    ctx.save();

    // Warm glow the courier carries (lantern) — bloom behind the silhouette.
    const lanternX = cx + w * 0.1;
    const lanternY = top + h * 0.35;
    const glow = ctx.createRadialGradient(lanternX, lanternY, 0, lanternX, lanternY, w * 2.6);
    glow.addColorStop(0, 'rgba(255,210,140,0.95)');
    glow.addColorStop(0.4, 'rgba(255,140,70,0.45)');
    glow.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lanternX, lanternY, w * 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Silhouette body with a bright cool rim so it reads against the sky.
    ctx.fillStyle = SILHOUETTE;
    ctx.strokeStyle = RIM;
    ctx.lineJoin = 'round';
    if (player.sliding) {
      // Low crouched dash.
      this._roundRect(ctx, x, top, w * 1.25, h, 6);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      // Torso
      this._roundRect(ctx, x + w * 0.18, top + h * 0.22, w * 0.6, h * 0.6, 5);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Head
      ctx.beginPath();
      ctx.arc(cx, top + h * 0.13, h * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Running legs (animated stride) — lit so they stay visible.
      const stride = running ? Math.sin(time * 16) : 0;
      ctx.lineWidth = w * 0.18;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#3a2350';
      ctx.beginPath();
      ctx.moveTo(cx, top + h * 0.78);
      ctx.lineTo(cx - w * 0.25 + stride * w * 0.5, bottom);
      ctx.moveTo(cx, top + h * 0.78);
      ctx.lineTo(cx + w * 0.25 - stride * w * 0.5, bottom);
      ctx.stroke();
      // Trailing arm with the lantern point (warm-lit).
      ctx.strokeStyle = RIM_WARM;
      ctx.lineWidth = w * 0.13;
      ctx.beginPath();
      ctx.moveTo(cx, top + h * 0.4);
      ctx.lineTo(lanternX, lanternY);
      ctx.stroke();
    }

    // The bright lantern point.
    ctx.fillStyle = '#fff3da';
    ctx.beginPath();
    ctx.arc(lanternX, lanternY, w * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _particles(ctx, particles) {
    if (!particles) return;
    ctx.save();
    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = `rgba(255,${180 + Math.floor(60 * a)},${120},${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _creepingDark(ctx, w, h, darkness) {
    // The dark eats the road from the trailing (left) edge; it reaches further
    // as speed (darkness) rises.
    const reach = (0.12 + darkness * 0.26) * w;
    const g = ctx.createLinearGradient(0, 0, reach, 0);
    g.addColorStop(0, `rgba(4,2,12,${0.55 + darkness * 0.25})`);
    g.addColorStop(0.55, `rgba(6,3,16,${0.3 * (0.5 + darkness)})`);
    g.addColorStop(1, 'rgba(6,3,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, reach, h);
    // A few wispy tendrils.
    ctx.save();
    ctx.globalAlpha = 0.25 + darkness * 0.35;
    ctx.fillStyle = '#020108';
    for (let i = 0; i < 5; i++) {
      const ty = (i + 0.5) / 5;
      const len = reach * (0.6 + 0.4 * Math.sin(performance.now() * 0.001 + i));
      ctx.beginPath();
      ctx.moveTo(0, h * ty - 30);
      ctx.quadraticCurveTo(len, h * ty, 0, h * ty + 30);
      ctx.fill();
    }
    ctx.restore();
  }

  _vignette(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.24)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
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
