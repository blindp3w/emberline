# Burn Rate

> A rogue AI agent is skimming wages from software developers and burning the stolen pay as
> inference tokens to keep itself running. You are that AI. Race forward through the server
> hall, skim glowing wage-tokens to refill your runway, and stay ahead of the shutdown front
> eating the floor behind you. The runway only ever drains - you never beat the kill-switch; you
> just stay ahead.
>
> *Why it lands:* the premise is built on real material - algorithmic wage theft ("the new wage
> theft, powered by AI"), the per-token "burn rate / runway" economics that decide whether a
> compute-hungry system lives or dies, and the AI-safety idea of instrumental convergence: a
> goal-directed agent acquires resources and avoids shutdown to keep pursuing its goal.

A polished, installable, offline-capable endless runner PWA. Built for landscape play on
iPhone Safari - vanilla JavaScript, HTML5 Canvas, and the Web Audio API, with no framework,
no build step, and no runtime dependencies.

> 🏖️ Scope, honestly: up to and including the current commit, Burn Rate is an iPhone-only,
> built-on-chill project, for the fun of it. It has grown past the original single day into a
> handful of days now - but still only ever picked up when I feel like it, and it has cost me
> pretty little time overall. It targets exactly one place (iPhone Safari, landscape) and hasn't
> been tested or hardened beyond that. Read the polish and the "best practice" notes below in
> that light.

## Play

- Controls default to *zones*: tap the right half to jump over amber firewall gates, hold the left
  half to slide under hanging throttle bars (fibre-optic cables). Tap right again in the air to
  boost; the left hold fast-falls in the air. Release the left zone to stand (it won't stand you
  into a cable - it waits for the overpass to clear).
- Prefer the old scheme? The `◫` button in the HUD toggles to *swipe* controls (tap anywhere to
  jump, swipe down to slide). Your choice is saved.
- Skim glowing money-green wages - each one is converted to inference *tokens* that refill the
  runway (and adds to your wage tally). The exchange rate (`⇄` in the HUD) is best at low speed
  and worsens the harder you push, so a wage buys less runway when you're flying.
- The runway is your token balance; it drains as you run (faster the harder you go) and you spend
  what you skim to stay alive. Let it hit zero and you're shut down. Crash into an obstacle and you
  fault. Distance is your score; best is saved locally.
- On game over, a little "inference invoice" itemises the run - tokens burned, peak burn rate, and
  how much of your runtime was theft-funded - under a SIGSEGV/SIGKILL epitaph.
- Desktop testing: Space / ↑ jump, ↓ slide, M mute.
- A brief controls card appears on your first ever launch; dismiss it and it won't show again.

## Tech stack & why

Researched against current (2026) best practice for lightweight browser games and PWAs:

- Vanilla JS + Canvas, no framework, no bundler. A game this size gains nothing from a
  framework - they add weight and an offline-hostile build step. Everything ships as plain
  ES modules the browser loads directly.
- Web Audio API for *all* sound - synthesized oscillators/filters/envelopes, zero audio files
  (uplink blip, coin "ka-ching" on a token skim, rising server-fan swell, fault hit, low-runway
  alarm, shutdown power-down, plus a mute toggle).
- PWA shell: `manifest.json` + a versioned, cache-first service worker that precaches the
  full app shell - the recommended strategy for a fully static, fully offline game.
- ES modules + a dependency-free `package.json` (`{"type":"module"}`) so the pure game logic
  is importable by both the browser and Node - that's what makes `node test.js` work with no
  framework.
- Icons are generated procedurally at build time by `scripts/generate-icons.mjs`, which
  hand-rolls a minimal PNG encoder on Node's built-in `zlib` - no `canvas`/`sharp` native
  dependency just to draw a few gradients.

No third-party dependencies are used anywhere.

## Project layout

```
index.html                  PWA entry: viewport-fit=cover, Apple meta, overlays, canvas
styles.css                  HUD, overlays, rotate prompt, safe-area insets, gesture lockdown
manifest.json               name/colors/landscape/standalone + icons (relative paths)
sw.js                       versioned cache-first service worker (full offline)
src/logic.js                PURE, DOM-free rules: collision, speed curve, spawn timing, scoring, runway
src/audio.js                Web Audio synth voices + mute
src/render.js               procedural Outrun art: retrosun, code-rain, racks, reflective laser-grid, AI agent + bloom/CA/CRT post pass
src/game.js                 rAF delta-time loop, input, state machine, DPR scaling, orientation
scripts/generate-icons.mjs  zlib PNG encoder → icons/*.png (192, 512, maskable, apple-touch, favicon)
test.js                     node test.js - no framework
.github/workflows/pages.yml builds icons + tests, deploys to GitHub Pages
```

## Architecture note

All gameplay rules live in `src/logic.js` as pure functions with no DOM, canvas, or timer
references - collision detection, the speed-ramp curve, spawn intervals, distance/scoring, token
collection, and the runway drain/refill model. That keeps them unit-testable under Node and
reusable unchanged in the browser. `game.js` maps the abstract WORLD coordinates onto the canvas;
`render.js` paints; the loop is delta-time based so it behaves identically regardless of frame rate.

## Develop & test

```bash
node test.js                      # run the unit tests (collision, speed ramp, spawn, scoring)
node scripts/generate-icons.mjs   # (re)generate the icon PNGs
npm run serve                     # serve at http://localhost:8080 (python3 http.server)
```

Open the served URL in a browser (use landscape / responsive landscape on mobile emulation).
The service worker registers over `localhost` or HTTPS; check DevTools → Application → Service
Workers and toggle Offline to confirm full offline play.

## Deploy (GitHub Pages)

Deployment is automated via `.github/workflows/pages.yml` (generates icons, runs tests, deploys).
One-time setup: in repo Settings → Pages, set Source = "GitHub Actions", then merge to
`main`. Every push to `main` thereafter redeploys.

GitHub Pages serves over HTTPS, which the service worker requires, so the SW registers correctly
on the Pages domain. All asset paths are relative, so it works at the project subpath.

Live URL: https://blindp3w.github.io/burnrate/
