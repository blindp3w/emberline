// Emberline — procedural icon generator.
//
// Generates the PWA icon set as PNG files with ZERO dependencies: we hand-roll
// a minimal truecolour+alpha PNG encoder on top of Node's built-in `zlib`.
// This avoids pulling in `canvas`/`sharp` (native deps) just to draw a few
// gradients. Run with:  node scripts/generate-icons.mjs   (or: npm run icons)
//
// The art matches the in-game palette: a dusk vertical gradient (deep indigo →
// magenta horizon) with the glowing Emberline band and a warm courier-spark.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'icons');

// --- tiny math helpers ------------------------------------------------------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
function lerpColor(c0, c1, t) {
  return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
}

// --- PNG encoding -----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// rgba: Uint8Array of length w*h*4. Returns a PNG file Buffer.
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data: each scanline prefixed with filter byte 0.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy
      ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- the artwork ------------------------------------------------------------
// Palette (matches the game).
const SKY_TOP = [22, 11, 46]; // deep indigo
const SKY_MID = [60, 20, 80]; // violet
const HORIZON = [255, 46, 136]; // magenta Emberline
const EMBER_WARM = [255, 214, 140]; // courier glow core
const EMBER_HOT = [255, 138, 70]; // glow mid

// Renders one icon into an RGBA Buffer.
function renderIcon(size, { padding = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size * 0.5;
  // Horizon sits a bit below centre; spark rides just above the horizon.
  const horizonY = size * 0.66;
  const sparkY = size * 0.52;

  for (let y = 0; y < size; y++) {
    const ty = y / size;
    // Vertical sky gradient: indigo -> violet -> magenta toward the horizon.
    let col;
    if (ty < 0.66) {
      col = lerpColor(SKY_TOP, SKY_MID, smoothstep(0, 0.66, ty));
      col = lerpColor(col, HORIZON, Math.pow(smoothstep(0.2, 0.66, ty), 1.4) * 0.55);
    } else {
      // Below the horizon: darker road fading down.
      const k = smoothstep(0.66, 1, ty);
      col = lerpColor([90, 24, 70], [14, 8, 26], k);
    }

    for (let x = 0; x < size; x++) {
      let r = col[0];
      let g = col[1];
      let b = col[2];

      // Emberline horizon band glow (additive, magenta).
      const distH = Math.abs(y - horizonY) / (size * 0.10);
      const band = Math.exp(-distH * distH) * 0.9;
      r += HORIZON[0] * band * 0.6;
      g += HORIZON[1] * band * 0.6;
      b += HORIZON[2] * band * 0.6;

      // Warm courier-spark: radial bloom centred on (cx, sparkY).
      const dx = (x - cx) / size;
      const dy = (y - sparkY) / size;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const core = Math.exp(-(dist * dist) / (2 * 0.020 * 0.020));
      const halo = Math.exp(-(dist * dist) / (2 * 0.075 * 0.075));
      const warm = lerpColor(EMBER_HOT, EMBER_WARM, clamp(core, 0, 1));
      const glow = clamp(core * 1.2 + halo * 0.5, 0, 1.4);
      r += warm[0] * glow;
      g += warm[1] * glow;
      b += warm[2] * glow;

      // A slim vertical ember streak descending from the spark toward horizon.
      const streak = Math.exp(-(dx * dx) / (2 * 0.012 * 0.012)) *
        smoothstep(0.0, 0.08, ty - 0.5) * (ty < 0.66 ? 1 : smoothstep(1, 0.66, ty)) * 0.5;
      r += EMBER_WARM[0] * streak;
      g += EMBER_WARM[1] * streak;
      b += EMBER_WARM[2] * streak;

      const i = (y * size + x) * 4;
      rgba[i] = clamp(Math.round(r), 0, 255);
      rgba[i + 1] = clamp(Math.round(g), 0, 255);
      rgba[i + 2] = clamp(Math.round(b), 0, 255);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// --- emit -------------------------------------------------------------------
function write(name, size) {
  const rgba = renderIcon(size);
  const png = encodePNG(size, size, rgba);
  const path = join(OUT_DIR, name);
  writeFileSync(path, png);
  console.log(`  wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log('Generating Emberline icons →', OUT_DIR);
write('icon-192.png', 192);
write('icon-512.png', 512);
write('icon-maskable-512.png', 512); // full-bleed gradient => safe as maskable
write('apple-touch-icon-180.png', 180);
write('favicon-32.png', 32);
console.log('Done.');
