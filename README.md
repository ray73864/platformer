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
  in the bottom-right corner so a layout can be reproduced exactly
- **Retry replays the exact map you died on** (stored-seed ledger), and
  coins you collected stay collected — dying never refunds or re-collects,
  so progress converges across attempts
- **In-run anti-repetition guard**: candidate seeds whose exposed terrain is
  too similar to earlier levels in the same run are rejected, so a 100-level
  run doesn't feel like the same level twice
- Three travel modes: right-bound, left-bound, and vertical climbs
  (cycling from level 5), plus **deck bridges** over too-wide pits (level 8+)
  and **elevator shafts** on most vertical climbs
- Four enemy kinds with escalating threat grammar:
  | Kind | From | Behavior |
  |---|---|---|
  | Walker | L5 | Patrols its shelf; stompable, dodgeable |
  | Spiny | L10 | Stomp-immune shell — jump over it, never land on it |
  | Charger | L20 | Wind-up then dash — read the tell, leave the lane |
  | Bombardier | L40 | Patrolled gun — drops projectiles along its lane |
- Coins unlock the portal (all of them), spikes kill (inset hitboxes keep
  edge brushes fair), a run-wide 60-second clock (from level 5) carries over
  between levels and gains +2 s per coin
- Variable jump height, coyote time, jump buffering, stomps, deck riding,
  particle feedback, chiptune-style adaptive audio, pause menu

## Controls

| Key | Action |
|---|---|
| ← / → (or A / D) | Move |
| Space | Jump (hold higher, tap shorter) |
| Shift | Walk (caps ground speed — useful at edges) |
| Esc | Pause / resume (on game-over or completion screens: back to menu) |
| Arrows + Enter/Space while paused | Navigate the pause menu |

## Fairness

The generator treats unfairness as a defect class with regression tests.
Shipped guarantees, each pinned by structural sweeps over thousands of
fresh-seed maps:

- Every level's route is validated by executing real physics against it —
  claimed fall-edges around spike shelves that a player could not survive
  reject the construction
- Coins only spawn where a survivable return path exists (safe-hub model)
- No stacked-patrol gauntlets: hostiles may not wall a mandatory crossing
  with zero safe pockets
- One hostile kind per support run; stomp-immune kinds debut on graduated,
  wider shelves
- Soft-lockable maps cannot ship; if generation somehow produces a broken
  state mid-run, the game rebuilds the level rather than trapping you

## Development

### Prerequisites

- Bun v1.0+

### Installation

```bash
cd game
bun install
```

### Running

**Double-click `index.html`** — the game runs straight from the filesystem
(no server, no install). This works because `index.html` loads
`dist/bundle.js`, a classic IIFE bundle committed alongside the source.
Browsers CORS-check `<script type="module">` even from `file://` (the page
origin is `null`), so the ES-module sources under `js/` cannot be the entry.
After editing anything in `js/`, rebuild with `bun run build` — the E2E
suite (`test:e2e` / `test:all`) rebuilds automatically, so a stale bundle
only affects direct file:// play.

Or serve it locally:

```bash
bun run start
```

Then open `http://localhost:3000` in your browser.

### Testing

```bash
bun run test        # unit + integration (no external tools needed)
bun run test:e2e    # browser E2E suite only
bun run test:all    # everything in one process
bun run test:watch
bun run test:coverage
```

The E2E suite requires the [agent-browser](https://www.npmjs.com/package/agent-browser) CLI to be installed; it drives a real browser against a self-hosted loopback server. `bun run test` deliberately excludes it so a fresh clone passes without that external dependency.

### Building

```bash
bun run build
```

Bundles the `js/` ES modules into `dist/bundle.js` as a classic IIFE
(`--format=iife`) — that format is what makes file:// double-click play
possible (see Running above) — after verifying asset manifest entries.

### Linting and Formatting

```bash
bun run lint
bun run format
```

### Asset Verification

```bash
bun run verify
```

Hard gate driven by [`assets/manifest.json`](assets/manifest.json). Each entry declares `{ "path", "source", "license", "required" }`: an entry with `"required": true` that is missing, not a regular file, or zero-byte fails verification (exit 1); absent optional entries (`"required": false`) only print warnings. The `build` script runs `verify` first, so a required-asset violation blocks the build. An unreadable or malformed manifest is itself a hard failure. The shipped Kenney sheets and the pixel font are required entries; the renderer still degrades to flat shapes at runtime if an image cannot load, so a corrupted checkout shows a playable (plain) game rather than a blank one.

**Licensing rule (owner ruling 2026-11-03):** committed art must carry a license that permits redistribution into this MIT tree — currently Kenney "Pixel Platformer" (CC0) and Press Start 2P (OFL 1.1); attribution lives next to each asset (`LICENSE.txt` / `OFL.txt`). Non-redistributable packs (e.g. CraftPix freebies, which also require an account download) are never committed: they stay optional manifest entries and can be dropped into `assets/dropin/` locally (gitignored) for personal overrides.

## Project Structure

```
game/
├── index.html              # Entry point (loads dist/bundle.js)
├── bunfig.toml             # Bun test configuration
├── eslint.config.js        # Linting configuration
├── css/
│   └── style.css           # Game styling
├── js/
│   ├── main.js             # Game loop, states, seeds, run flow
│   ├── input.js            # Input handling
│   ├── physics.js          # Physics engine
│   ├── player.js           # Player entity (coyote, buffer, variable jump)
│   ├── level.js            # Generator + fairness gates (reachability, routes)
│   ├── entities.js         # Base entity class
│   ├── camera.js           # Camera tracking
│   ├── ui.js               # UI management
│   ├── enemies.js          # Walker/spiny/charger/bombardier AI
│   ├── projectiles.js      # Bombardier shells
│   ├── movingplatforms.js  # Deck bridges and elevator shafts
│   ├── collectibles.js     # Coins and scoring
│   ├── hazards.js          # Spike hazard detection
│   ├── timer.js            # Run clock with coin bonus
│   ├── difficulty.js       # Difficulty tiers: size, caps, timer flag
│   ├── sprites.js          # Kenney sheet sprite layer (fallback-safe)
│   ├── particles.js        # Coin/death particle bursts (game feel)
│   └── audio.js            # Adaptive chiptune audio (WebAudio)
├── tests/
│   ├── setup/              # Test setup helpers
│   ├── unit/               # Unit tests (incl. generator fairness sweeps)
│   ├── integration/        # Integration tests
│   └── e2e/                # Browser E2E tests
├── assets/                 # Game assets (declared in manifest.json)
│   ├── kenney_pixel-platformer/  # Shipped CC0 sheets + LICENSE.txt
│   ├── fonts/              # Press Start 2P (OFL 1.1) + OFL.txt
│   └── dropin/             # Optional local overrides (gitignored)
└── scripts/                # Utility scripts
```

## Scoring

- Coins: 10 points each; stomping a walker scores 25 (a charger or
  bombardier, where legal, 40); dodging a hostile's threat pays a small
  bonus; clearing a level pays 100 plus 10 per difficulty tier crossed —
  any death on the attempt series cuts that clear bonus to 40%
- Score accumulates across levels within a run; the final score competes
  with a high score persisted in `localStorage` (key `platformerHighScore`)
- Retrying keeps the coins you banked on that level (they neither refund nor
  re-collect on the replayed identical map)

## License

MIT
