// Thin descriptor of per-tier level parameters, selected by level number.
// Generation internals (gap widths, platform heights, enemy placement
// geometry) are deliberately not wired here; only size, enemy caps, and the
// timer flag are a contract. Moving platforms are deferred to a later phase.
export class Difficulty {
    constructor() {
        this.levelConfigs = {
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
    }

    getConfig(levelNumber) {
        if (levelNumber >= 10) return this.levelConfigs.advanced;
        if (levelNumber >= 5) return this.levelConfigs.intermediate;
        return this.levelConfigs.basic;
    }

    getLevelSize(levelNumber) {
        const config = this.getConfig(levelNumber);
        return { width: config.width, height: config.height };
    }

    getMaxEnemies(levelNumber) {
        return this.getConfig(levelNumber).maxEnemies;
    }

    isTimerEnabled(levelNumber) {
        return this.getConfig(levelNumber).hasTimer;
    }
}
