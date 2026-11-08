// Integration: R7 LAZY-SCAN preference semantics in Game.seedFor.
// Data-driven pins on REAL scoring (seeds located by /tmp/opencode sweeps);
// config under test: INTERESTING_OK = 0.49, LAZY_SCAN_EXTRA = 2 (once a
// guard-passer exists at index f, at most indices < f + EXTRA get built).
//   runSeed 2, L9 : candidate 0 scores 0.805 >= bar -> ships immediately
//                   (ONE construction, BASE-equivalent cost).
//   runSeed 3, L9 : [0.470, 0.804] -> sub-bar start, bar-met candidate 1
//                   ships from within the cap window (TWO constructions).
//   runSeed 5, L9 : [0.469, 0.478, ...] -> no bar-hit inside the cap; the
//                   highest-scoring passer so far (candidate 1) ships when
//                   the cap stops the scan (TWO constructions).
// Plus determinism: the selection sequence is a pure function of runSeed.
// Fallback paths (all-throw handback, IoU-cap least-similar accept) are
// untouched by R7 and stay pinned by game_loop_elements / seed_randomness.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game, seedCandidate, INTERESTING_OK } from "../../js/main.js";
import { Level } from "../../js/level.js";

// One construction = one Level instance; internal generation retries reuse
// the instance, so count DISTINCT instances, not raw pickPortalTile calls.
function countingConstructions(fn) {
    const seen = new Set();
    const original = Level.prototype.pickPortalTile;
    Level.prototype.pickPortalTile = function (...a) {
        seen.add(this);
        return original.apply(this, a);
    };
    try {
        fn();
    } finally {
        Level.prototype.pickPortalTile = original;
    }
    return seen.size;
}

test("R7 pin: a bar-met first candidate ships immediately (one build)", () => {
    mountFixture();
    const game = new Game();
    expect(INTERESTING_OK).toBeGreaterThan(0);
    let chosen = null;
    const builds = countingConstructions(() => {
        game.runSeed = 2;
        chosen = game.seedFor(9);
    });
    expect(builds).toBe(1); // lazy stop: candidates 1..5 never constructed
    expect(chosen).toBe(seedCandidate(2, 9, 0));
    expect(game.levelSeeds.get(9)).toBe(chosen); // stored: retry-exact-map
});

test("R7 pin: sub-bar start, bar-met second candidate ships (two builds)", () => {
    mountFixture();
    const game = new Game();
    let chosen = null;
    const builds = countingConstructions(() => {
        game.runSeed = 3;
        chosen = game.seedFor(9);
    });
    expect(builds).toBe(2);
    expect(chosen).toBe(seedCandidate(3, 9, 1));
});

test("R7 pin: no bar inside the cap -> best-so-far ships when the cap stops", () => {
    mountFixture();
    const game = new Game();
    let chosen = null;
    const builds = countingConstructions(() => {
        game.runSeed = 5;
        chosen = game.seedFor(9);
    });
    // c0 0.469 < bar keeps the scan alive; c1 0.478 is the best BUILT
    // (c2 would exceed the f+EXTRA window) and wins on strict >.
    expect(builds).toBe(2);
    expect(chosen).toBe(seedCandidate(5, 9, 1));
});

test("R7 pin: selection is a pure function of runSeed (determinism)", () => {
    mountFixture();
    const g1 = new Game();
    const g2 = new Game();
    g1.runSeed = 777;
    g2.runSeed = 777;
    for (const lvl of [1, 3, 5, 7, 9]) {
        expect(g1.seedFor(lvl)).toBe(g2.seedFor(lvl));
    }
    // A third game walking the SAME sequence reproduces the same table
    // (all inputs are pure functions of runSeed + prior accepted layouts).
    const g3 = new Game();
    g3.runSeed = 777;
    for (const lvl of [1, 3, 5, 7, 9]) {
        expect(g3.seedFor(lvl)).toBe(g1.levelSeeds.get(lvl));
    }
});
