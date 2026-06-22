# Emberline

> The sun has set for the last time and frozen at the horizon — a glowing magenta band called
> the **Emberline**. You're a Courier running east toward it, gathering emberlight to keep the
> sunken city's lamps burning while the dark eats the road behind you. You never beat the dark;
> you just stay ahead.

A polished, installable, **offline-capable** endless runner PWA. Built for landscape play on
iPhone Safari — vanilla JavaScript, HTML5 Canvas, and the Web Audio API, with **no framework,
no build step, and no runtime dependencies**.

## Play

- **Tap** anywhere to **jump** over low rubble barriers.
- **Swipe down** to **slide** under head-height overpasses and cables.
- Collect glowing **emberlight** motes for a separate counter.
- Speed ramps up the longer you survive; distance is your score. Best distance is saved locally.
- Desktop testing: **Space / ↑** jump, **↓** slide, **M** mute.

## Tech stack & why

Researched against current (2026) best practice for lightweight browser games and PWAs:

- **Vanilla JS + Canvas, no framework, no bundler.** A game this size gains nothing from a
  framework — they add weight and an offline-hostile build step. Everything ships as plain
  ES modules the browser loads directly.
- **Web Audio API** for *all* sound — synthesized oscillators/filters/envelopes, zero audio files
  (jump pulse, pickup chime, rising speed swell, collision hit, plus a mute toggle).
- **PWA shell**: `manifest.json` + a **versioned, cache-first** service worker that precaches the
  full app shell — the recommended strategy for a fully static, fully offline game.
- **ES modules + a dependency-free `package.json`** (`{"type":"module"}`) so the pure game logic
  is importable by both the browser and Node — that's what makes `node test.js` work with no
  framework.
- **Icons are generated procedurally at build time** by `scripts/generate-icons.mjs`, which
  hand-rolls a minimal PNG encoder on Node's built-in `zlib` — **no `canvas`/`sharp` native
  dependency** just to draw a few gradients.

No third-party dependencies are used anywhere.

## Project layout

```
index.html                  PWA entry: viewport-fit=cover, Apple meta, overlays, canvas
styles.css                  HUD, overlays, rotate prompt, safe-area insets, gesture lockdown
manifest.json               name/colors/landscape/standalone + icons (relative paths)
sw.js                       versioned cache-first service worker (full offline)
src/logic.js                PURE, DOM-free rules: collision, speed curve, spawn timing, scoring
src/audio.js                Web Audio synth voices + mute
src/render.js               procedural art: gradient sky, Emberline grid, parallax, glow, particles
src/game.js                 rAF delta-time loop, input, state machine, DPR scaling, orientation
scripts/generate-icons.mjs  zlib PNG encoder → icons/*.png (192, 512, maskable, apple-touch, favicon)
test.js                     node test.js — no framework
.github/workflows/pages.yml builds icons + tests, deploys to GitHub Pages
```

## Architecture note

All gameplay rules live in `src/logic.js` as pure functions with **no DOM, canvas, or timer
references** — collision detection, the speed-ramp curve, spawn intervals, distance/scoring, and
emberlight collection. That keeps them unit-testable under Node and reusable unchanged in the
browser. `game.js` maps the abstract WORLD coordinates onto the canvas; `render.js` paints; the
loop is delta-time based so it behaves identically regardless of frame rate.

## Develop & test

```bash
node test.js                      # run the unit tests (collision, speed ramp, spawn, scoring)
node scripts/generate-icons.mjs   # (re)generate the icon PNGs
npm run serve                     # serve at http://localhost:8080 (python3 http.server)
```

Open the served URL in a browser (use landscape / responsive landscape on mobile emulation).
The service worker registers over `localhost` or HTTPS; check **DevTools → Application → Service
Workers** and toggle **Offline** to confirm full offline play.

## Deploy (GitHub Pages)

Deployment is automated via `.github/workflows/pages.yml` (generates icons, runs tests, deploys).
**One-time setup:** in repo **Settings → Pages**, set **Source = "GitHub Actions"**, then merge to
`main`. Every push to `main` thereafter redeploys.

GitHub Pages serves over HTTPS, which the service worker requires, so the SW registers correctly
on the Pages domain. All asset paths are relative, so it works at the project subpath.

**Live URL:** https://blindp3w.github.io/emberline/
