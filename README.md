# Procedural Platformer

A procedurally generated 2D platformer built with pure vanilla JavaScript —
no frameworks, no runtime dependencies, no build required to play.

**Play it:** double-click `index.html`. That's it. The game runs straight
from the filesystem.

## Features

- **100-level runs** with a saved high score (`localStorage`)
- **Procedural generation with a fairness contract** — every shipped level
  passes BFS reachability *and* physics-executed route validation before it
  can spawn you (see [Fairness](#fairness))
- **Seeded runs**: each run rolls a seed; the current level's seed is shown
  in the bottom-right corner for exact reproduction
- **Retry replays the exact map you died on** (stored-seed ledger); coins
  you collected stay collected — dying never refunds or re-collects
- **In-run anti-repetition guard**: candidate seeds whose exposed terrain is
  too similar to earlier levels in the run are rejected
- Three travel modes: right-bound, left-bound, and vertical climbs
  (cycling from level 5), plus **deck bridges** over too-wide pits (level 8+)
  and **elevator shafts** on roughly half of vertical climbs from level 13
- Four enemy kinds with escalating threat grammar:
  | Kind | From | Behavior |
  |---|---|---|
  | Walker | L5 | Patrols its shelf; stompable, dodgeable |
  | Spiny | L10 | Stomp-immune shell — jump over it, never land on it |
  | Charger | L20 | Wind-up then dash — read the tell, leave the lane |
  | Bombardier | L40 | Patrolled gun — drops projectiles along its lane |
- **Movement toolkit**: variable jump height, coyote time, jump buffering,
  stomps, deck riding, **wall slides + kicks** (press into a wall while
  falling, jump off it), and a once-per-jump **air dash** (X or C) with no
  invincibility frames
- **Assist objects** (level 10+): launch pads bounce to a fixed apex and a
  pushable crate may seat in a natural pocket — neither ever appears in a
  validated route requirement
- **Secret alcoves**: ~3% of level-10+ maps hide a carved shaft behind a
  tunnel mouth holding a 25-point secret coin — always optional, never
  counted by the portal gate
- **Juice system** with persisted settings: squash & stretch, impact punch,
  screen shake, score popups, dust and hazard telegraphs; toggles for sound,
  screen shake and reduced motion (follows the OS `prefers-reduced-motion`,
  overridable both ways); HUD chips for score, level, coins and timer
- **Parallax world**: themed sky/hill/cloud layers scroll behind every
  level, and the title screen runs a live demo of them
- **Fully synthesized audio**: procedural SFX and generative ambient music
  from WebAudio oscillators — zero audio files
- **Touch controls**: on coarse-pointer devices, left/right/jump/dash pads
  appear automatically and drive the same input paths as the keyboard
- Coins unlock the portal (all of them), spikes kill (inset hitboxes keep
  edge brushes fair), a run-wide 60-second clock (from level 5) gains +2 s
  per coin and carries over between levels
- Every game-over screen names the cause of death and adds a teachable tip

## Controls

| Key | Action |
|---|---|
| ← / → (or A / D) | Move |
| Space | Jump (hold higher, tap shorter) |
| Shift | Walk (caps ground speed — useful at edges) |
| X or C | Dash — one air burst per jump (no i-frames) |
| Hold toward a wall while falling | Wall slide (caps fall speed) |
| Space while sliding | Wall kick away from the wall |
| Esc | Pause / resume (on game-over or completion screens: back to menu) |
| Arrows + Enter/Space while paused | Navigate the pause menu |

Touch devices get the pads automatically; multi-touch works (hold a
direction while jumping).

## Scoring

Exact payouts (constants live in `js/main.js` and `js/collectibles.js`):

| Event | Points |
|---|---|
| Coin | +10 |
| Secret coin (alcoves — optional) | +25 |
| Stomp a walker | +25 |
| Stomp a charger or bombardier | +40 |
| Dodge past a live enemy (once per enemy per attempt) | +5 |
| Stomp chain: 2+ stomps without touching ground (once per chain) | +30 |
| Clear a level, flawless | 100 + 10 per difficulty tier crossed |
| Clear after any death on that level's attempts | 40% of the clear bonus (floored) |
| Clear with zero deaths on that level's attempts | +50 |

Each death additionally floors away 25% of the running score total, charged
exactly once per death. Score accumulates across levels within a run and
competes with a high score in `localStorage` (key `platformerHighScore`).
Retrying keeps the coins you banked on that level.

## Fairness

The generator treats unfairness as a defect class with regression tests.
Shipped guarantees, each pinned by sweeps over thousands of fresh-seed maps:

- **Solvability validation**: every level's route is validated by executing
  real physics against it — unsurvivable fall-edges reject the construction
- Coins only spawn where a survivable return path exists (safe-hub model)
- No stacked-patrol gauntlets: hostiles may not wall a mandatory crossing
  with zero safe pockets
- **Bodies-per-run cap**: at most `max(1, floor(runTiles / 3))` hostiles per
  shared patrol run — a 3-wide ledge never holds two patrollers
- **Portal-shelf protection**: the run holding the portal hosts at most one
  patroller, whose sweep leaves the portal-adjacent cell clear
- **Secrets never gate**: the portal requirement counts non-secret coins
  only; secret coins are pure upside
- One hostile kind per support run; stomp-immune kinds debut on graduated,
  wider shelves
- Soft-lockable maps cannot ship; if generation somehow produces a broken
  state mid-run, the game rebuilds the level rather than trapping you

## Development

### Running

**Double-click `index.html`** (after `bun install` for dev tooling; the
game itself has zero runtime dependencies) — it runs straight from the
filesystem, no server needed. This works because `index.html` loads
`dist/bundle.js`, a classic IIFE bundle committed alongside the source.
Browsers CORS-check `<script type="module">` even from `file://` (the page
origin is `null`), so the ES-module sources under `js/` cannot be the entry.
After editing anything in `js/`, rebuild with `bun run build`; the E2E
suite rebuilds automatically, so a stale bundle only affects file:// play.

Or serve it locally: `bun run start`, then open `http://localhost:3000`.

### Testing

```bash
bun run test        # unit + integration (no external tools needed)
bun run test:e2e    # browser E2E suite only
bun run test:all    # everything in one process
bun run test:watch
bun run test:coverage
```

The E2E suite requires the [agent-browser](https://www.npmjs.com/package/agent-browser) CLI to be installed; it drives a real browser against a self-hosted loopback server. `bun run test` deliberately excludes it so a fresh clone passes without that external dependency.

### Monotonicity guard (`bun run mono`)

```bash
bun run mono        # replay the recorded winning witnesses (tests/reports/monotonicity-corpus.json)
```

Replays every corpus witness through the CURRENT engine headlessly (happy-dom + the shipped `Game` loop, fixed-dt, synthetic key events from a staged standing cell) and checks each recorded per-frame trajectory hash plus the portal-touch win. It is the MONOTONIC ADDITION guard: a validated route must keep playing exactly as recorded. Run it after **any** change touching physics, player feel, enemies/projectiles, pads/crates/decks, or level generation. Exit code is non-zero with a per-witness table on divergence.

Deliberately **not** wired into `test:all`: future waves may intentionally evolve maps, which would make a CI-embedded replay gate flaky by design — this is an owner-visible command instead. If it goes red on purpose (an intentional trajectory change), regenerate the corpus out-of-band via the search scratch and commit the new snapshot; corpus corruption (rather than drift) is caught in CI by `tests/unit/monotonicity_corpus.test.js`.

### Building, linting, assets

```bash
bun run build       # verify assets, then bundle js/ into dist/bundle.js (IIFE)
bun run lint
bun run format
bun run verify      # asset manifest gate (build runs it first)
```

Asset verification is driven by [`assets/manifest.json`](assets/manifest.json): a missing, non-file, or zero-byte required entry fails the build (exit 1), absent optional entries only warn, and an unreadable manifest is itself a hard failure. The renderer degrades to flat shapes at runtime if an image cannot load, so a corrupted checkout stays playable.

**Licensing rule (owner ruling 2026-11-03):** committed art must permit redistribution into this MIT tree — currently Kenney "Pixel Platformer" (CC0) and Press Start 2P (OFL 1.1), attributed next to each asset. Non-redistributable packs are never committed: they stay optional manifest entries and can be dropped into `assets/dropin/` locally (gitignored).

## Project Structure

```
game/
├── index.html              # Entry point (loads dist/bundle.js)
├── css/
│   └── style.css           # Game styling
├── js/
│   ├── main.js             # Game loop, states, seeds, run flow, scoring
│   ├── input.js            # Keyboard + touch input handling
│   ├── physics.js          # Physics engine
│   ├── player.js           # Player (coyote, buffer, dash, wall slide/kick)
│   ├── level.js            # Generator + fairness gates (reachability, routes)
│   ├── entities.js         # Base entity class
│   ├── camera.js           # Camera tracking
│   ├── ui.js               # UI management (HUD chips, cause-of-death tips)
│   ├── enemies.js          # Walker/spiny/charger/bombardier AI
│   ├── projectiles.js      # Bombardier shells
│   ├── movingplatforms.js  # Deck bridges and elevator shafts
│   ├── collectibles.js     # Coins (incl. secrets) and scoring
│   ├── pads.js             # Launch pads (assist-only mobility objects)
│   ├── crates.js           # Pushable assist crates
│   ├── hazards.js          # Spike hazard detection
│   ├── timer.js            # Run clock with coin bonus
│   ├── difficulty.js       # Difficulty tiers: size, caps, timer flag
│   ├── metrics.js          # Interestingness metrics (forks, greed, secrets)
│   ├── sprites.js          # Kenney sheet sprite layer (fallback-safe)
│   ├── particles.js        # Particle bursts and parallax motes
│   ├── fx.js               # Juice config + reduced-motion profile
│   ├── settings.js         # Persisted toggles (sound/shake/reduced motion)
│   └── audio.js            # Synthesized SFX + generative music (WebAudio)
├── tests/
│   ├── setup/              # Test setup helpers
│   ├── unit/               # Unit tests (incl. generator fairness sweeps)
│   ├── integration/        # Integration tests
│   └── e2e/                # Browser E2E tests
├── assets/                 # Game assets (declared in manifest.json)
│   ├── kenney_pixel-platformer/  # Shipped CC0 sheets + LICENSE.txt
│   ├── fonts/              # Press Start 2P (OFL 1.1) + OFL.txt
│   └── dropin/             # Optional local overrides (gitignored)
└── scripts/                # Utility scripts (verify-assets, trend, mono)
```

## License

MIT
