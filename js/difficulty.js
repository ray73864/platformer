// Thin descriptor of per-tier level parameters, selected by level number.
// Generation internals (gap widths, platform heights, enemy placement
// geometry) are deliberately not wired here; only size, enemy caps, and the
// timer flag are a contract. Moving platforms are deferred to a later phase.
const LEVEL_CONFIGS = {
    basic: {         // Levels 1-4
        width: 20,
        height: 15,
        maxEnemies: 2,
        hasTimer: false
    },
    intermediate: {  // Levels 5-9
        width: 24,
        height: 18,
        maxEnemies: 5,
        hasTimer: true
    },
    advanced: {      // Levels 10+
        width: 28,
        height: 21,
        maxEnemies: 8,
        hasTimer: true
    }
};

// Tier lookup is internal: consumers ask for the specific parameter they need.
function configFor(levelNumber) {
    if (levelNumber >= 10) return LEVEL_CONFIGS.advanced;
    if (levelNumber >= 5) return LEVEL_CONFIGS.intermediate;
    return LEVEL_CONFIGS.basic;
}

export class Difficulty {
    getLevelSize(levelNumber) {
        const config = configFor(levelNumber);
        return { width: config.width, height: config.height };
    }

    getMaxEnemies(levelNumber) {
        return configFor(levelNumber).maxEnemies;
    }

    isTimerEnabled(levelNumber) {
        return configFor(levelNumber).hasTimer;
    }
}
