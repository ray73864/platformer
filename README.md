# Procedural Platformer

A procedurally generated 2D platformer game built with vanilla JavaScript.

## Features

- Procedural level generation with BFS-verified portal reachability
- Variable travel direction: levels 1-4 run right, then levels cycle right / left / vertical climb from level 5
- Physics-based player movement
- Level progression with increasing platform difficulty
- Score tracking and level progression
- **Phase 2:** coins, spike hazards, and patrolling enemies
- **Phase 3:** a 60-second run clock from level 5, difficulty tiers, a hidden portal unlocked at 70% of coins, pause via Escape, and a 15-level run ending in a game-complete screen with a saved high score

## Controls

- **Arrow Left / A**: Move left
- **Arrow Right / D**: Move right
- **Space**: Jump
- **Escape**: Pause / resume (on the game-over or game-complete screen, Escape returns to the menu)

## Development

### Prerequisites

- Bun v1.0+

### Installation

```bash
cd game
bun install
```

### Running

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

### Linting and Formatting

```bash
bun run lint
bun run format
```

### Asset Verification

```bash
bun run verify
```

Hard gate driven by [`assets/manifest.json`](assets/manifest.json). Each entry declares `{ "path", "source", "license", "required" }`: an entry with `"required": true` that is missing, not a regular file, or zero-byte fails verification (exit 1); absent optional entries (`"required": false`) only print warnings. The `build` script runs `verify` first, so a required-asset violation blocks the build. An unreadable or malformed manifest is itself a hard failure. Art assets are currently all optional (procedural placeholders remain the source of truth), so `verify` passes with warnings until entries are promoted.

**Licensing rule:** an entry may only be promoted to `"required": true` (and its art committed under `assets/`) when its license permits redistribution — this repository is MIT-licensed. The current CraftPix-sourced entries are explicitly *not* redistributable and must stay optional with no files committed; promotion additionally requires the verified license recorded in the entry itself.

## Project Structure

```
game/
├── index.html              # Entry point
├── bunfig.toml             # Bun test configuration
├── eslint.config.js        # Linting configuration
├── css/
│   └── style.css          # Game styling
├── js/
│   ├── main.js            # Game loop and state management
│   ├── input.js           # Input handling
│   ├── physics.js         # Physics engine
│   ├── player.js          # Player entity
│   ├── level.js           # Level generation
│   ├── entities.js        # Base entity class
│   ├── camera.js          # Camera tracking
│   ├── ui.js              # UI management
│   ├── enemies.js         # Patrolling enemy AI (Phase 2)
│   ├── collectibles.js    # Coin collection and scoring (Phase 2)
│   ├── hazards.js         # Spike hazard detection (Phase 2)
│   ├── timer.js           # Run clock with coin bonus (Phase 3)
│   └── difficulty.js      # Difficulty tiers: size, enemy caps, timer flag (Phase 3)
├── tests/
│   ├── setup/             # Test setup helpers
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── e2e/               # E2E tests
├── assets/                # Game assets (declared in manifest.json)
└── scripts/               # Utility scripts
```

## Phase 2 Features

### Collectibles

- Coins appear on every level (at least 5, scaling with level number)
- Placement is restricted to BFS-reachable tiles, so every coin is collectible
- 10 points per coin; re-collecting an already-taken coin never scores twice

### Hazards

- Spikes kill the player on contact (from level 5 onward)
- Collision uses an inset hitbox, so brushing a spike tile's decorative edge is fair
- Falling off the bottom of the level kills the player

### Enemies

- Simple patrol AI (from level 5 onward; generation caps are 5 per level for levels 5-9 and 8 from level 10, with the actual count ramping with level number inside the cap)
- Each enemy walks back and forth along bounds derived from the solid ground beneath it
- Contact kills the player

### Level sizing and direction

- Horizontal levels are 20x15 tiles for levels 1-4, 24x18 from level 5, and 28x21 from level 10
- Vertical levels are 15x24 climb layouts; the player starts at the bottom and reaches the portal band at the top
- Every generated level — horizontal or vertical — is validated with a BFS reachability check before it ships

### Scoring

- Score accumulates across levels within a run
- Retrying a level restores the score to what it was when that level started, so die-and-retry runs cannot farm coins

## Phase 3 Features

### Run clock

- Levels 1-4 have no time limit; from level 5 a single 60-second clock ticks down
- The clock is run-wide: remaining time carries over between levels
- Each coin collected adds +2 seconds to the run clock — including coins taken before level 5: they are banked on the single run clock and already on it when the timer starts ticking
- Running out of time ends the run; retrying a level resets the clock to 60 seconds

### Difficulty tiers

- Levels 1-4 (basic): 20x15 horizontal tiles, no enemies
- Levels 5-9 (intermediate): 24x18 horizontal tiles, enemies introduced
- Levels 10+ (advanced): 28x21 horizontal tiles, higher enemy cap
- Vertical levels keep the 15x24 climb layout at every tier
- The enemy caps (0 / 5 / 8) are generation ceilings; the actual count ramps with level number inside the cap

### Hidden portal

- The portal stays hidden and inert until at least 70% of the level's coins are collected (the threshold is rounded down, with a minimum of one coin)
- Reaching the unlocked portal completes the level

### Pause

- Escape pauses and resumes; the run clock freezes while paused
- Escape on the game-over or game-complete screen returns to the menu instead of pausing

### Run completion and high score

- A run is 15 levels; finishing level 15 shows the game-complete screen rather than generating another level
- The final score is compared against a high score persisted in `localStorage` (key `platformerHighScore`)

## License

MIT
