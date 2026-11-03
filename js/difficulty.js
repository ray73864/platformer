// Thin descriptor of per-tier level parameters, selected by level number.
// Generation internals (gap widths, platform heights, enemy placement
// geometry) are deliberately not wired here; only size, enemy caps, the timer
// flag and the tier boundary itself are a contract. Moving platforms are
// deferred to a later phase.

// The first level with Phase 2 content (enemies, spikes) and the run clock:
// the single source of truth for the basic/intermediate tier boundary. Level
// generation gates derive from this (Difficulty.hasPhase2Content) instead of
// restating the constant, so retuning the tiers cannot silently desync the
// generator from sizes/caps/timer.
export const PHASE2_FIRST_LEVEL = 5;

const LEVEL_CONFIGS = {
    basic: {         // Levels 1-4: no enemies (generation gates markers at the tier boundary)
        width: 20,
        height: 15,
        maxEnemies: 0,
        hasTimer: false
    },
    intermediate: {  // Levels 5-9
        width: 24,
        height: 18,
        maxEnemies: 5,
        hasTimer: true
    },
    advanced: {      // Levels 10-24
        width: 28,
        height: 21,
        maxEnemies: 8,
        hasTimer: true
    },
    // Phase 3 tiers (levels 25-100): sizes step up one notch per band so
    // late levels grant the generator more placement room while staying
    // readable. Measured on the 10-seed x 100-level sweep: zero throws, avg
    // generation attempts <= 6.7 per decade (budget 200), L100 construction
    // p95 ~10 ms. These start values needed no step-down once the density
    // ramps were plateaued in level.js (GAP_CHANCE_CAP / SPIKE_TARGET_CAP /
    // COIN_TARGET_CAP — gap and coin flatten at their L25 curve values, the
    // spike cap sits higher at its ~L42 value) — without those caps every
    // construction from level 44
    // up threw, so the caps, not smaller grids, carry the late-game fairness.
    expert: {        // Levels 25-49
        width: 32,
        height: 24,
        maxEnemies: 10,
        hasTimer: true
    },
    master: {        // Levels 50-74
        width: 36,
        height: 27,
        maxEnemies: 12,
        hasTimer: true
    },
    legend: {        // Levels 75-100 (FINAL_LEVEL)
        width: 40,
        height: 30,
        maxEnemies: 14,
        hasTimer: true
    }
};

// Lower bounds of every tier above basic, ascending: [intermediate, advanced,
// expert, master, legend]. Exported so score-economy tier scaling (clearBonusFor
// in main.js) counts the SAME boundaries the tiers themselves use — retuning a
// boundary here moves both, and a silent desync is impossible.
export const TIER_BOUNDARIES = [PHASE2_FIRST_LEVEL, 10, 25, 50, 75];

const TIER_ORDER = ['basic', 'intermediate', 'advanced', 'expert', 'master', 'legend'];

// Silent tier index: 0 (basic) .. 5 (legend) = how many TIER_BOUNDARIES the
// level has crossed. Invalid input reads as basic WITHOUT warning — the
// warn-once contract belongs to configFor (the generator's entry); per-frame
// economy callers must not flood the console the way the R26 lesson warns.
export function tierIndexFor(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) return 0;
    let index = 0;
    for (const boundary of TIER_BOUNDARIES) {
        if (levelNumber >= boundary) index++;
    }
    return index;
}

// Tier lookup is internal: consumers ask for the specific parameter they need.
// Spec §Error Handling (Difficulty Scaling): level number must be a positive
// integer; anything else warns and falls back to the basic tier instead of
// silently landing on a tier through comparison fall-through (NaN reaches
// basic only by accident, and 5.7 would reach intermediate).
function configFor(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
        console.warn('Invalid level number for difficulty scaling:',
            levelNumber, '- defaulting to basic tier');
        return LEVEL_CONFIGS.basic;
    }
    return LEVEL_CONFIGS[TIER_ORDER[tierIndexFor(levelNumber)]];
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

    hasPhase2Content(levelNumber) {
        // Same validity contract as configFor: an invalid level number must
        // read as basic tier here too, or the generator would gate Phase 2
        // content on a tier the size/clock lookups refused to select.
        return Number.isInteger(levelNumber) && levelNumber >= PHASE2_FIRST_LEVEL;
    }
}
