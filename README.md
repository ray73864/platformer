# Procedural Platformer

A procedurally generated 2D platformer game built with vanilla JavaScript.

## Features

- Procedural level generation with pathfinding-verified portal reachability
- Physics-based player movement
- Level progression with increasing platform difficulty
- Score tracking and level progression

## Controls

- **Arrow Left / A**: Move left
- **Arrow Right / D**: Move right
- **Space**: Jump

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
bun test
bun test --watch
bun test --coverage
```

The E2E suite requires the [agent-browser](https://www.npmjs.com/package/agent-browser) CLI to be installed; it drives a real browser against a self-hosted server.

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
bun run verify-assets
```

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
│   └── ui.js              # UI management
├── tests/
│   ├── setup/             # Test setup helpers
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── e2e/               # E2E tests
└── scripts/               # Utility scripts
```

## License

MIT
