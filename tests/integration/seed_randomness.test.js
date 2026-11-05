// Integration: per-run seed derivation + in-run anti-repeat guard
// (randomness wave 2026-11-05, player report "This level has also been
// partially repeated before"). Contracts pinned here:
//   * seedCandidate(runSeed, level, index) is pure and fully avalanching —
//     every input bit reaches every output bit (the old additive mix flipped
//     bit 31 of runSeed into ONLY bit 31 of the seed, and any mixing constant
//     near a small multiple of mulberry32's step would have made adjacent
//     levels literal shifted copies).
//   * The guard picks the first candidate whose terrain silhouette overlaps
//     nothing accepted earlier in the run by >= 0.5 surface IoU, and a 100-
//     level-scale run contains NO comparable pair at >= 0.7.
//   * Selection happens ONCE per level: retries (both screens), loop
//     recovery and stored pins read the STORED seed without re-selecting or
//     touching the recent-layout history — the retry contract replays the
//     exact died-on map. Same runSeed replays the identical sequence
//     INCLUDING every guard decision.
//   * An all-throwing candidate chain hands back the primary seed UNSTORED
//     so startLevel's documented throw-through behaviour is preserved.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game, seedCandidate, layoutSignature, layoutSimilarity } from "../../js/main.js";
import { Level } from "../../js/level.js";

const T = 32;

function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}
const tilesHash = (level) => fnv1a(JSON.stringify(level.tiles));

// Fixed-seed mulberry32 so avalanche sampling is deterministic.
function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const hamming = (a, b) => {
    let x = (a ^ b) >>> 0, c = 0;
    while (x) { c += x & 1; x >>>= 1; }
    return c;
};

// --- seedCandidate: purity + avalanche ----------------------------------------

test("seedCandidate is pure, distinct per index, distinct per level", () => {
    for (const run of [0, 1, 0xDEADBEEF, 0xFFFFFFFF]) {
        for (let L = 1; L <= 12; L++) {
            expect(seedCandidate(run, L, 0)).toBe(seedCandidate(run, L, 0));
            const seen = new Set();
            for (let i = 0; i < 6; i++) seen.add(seedCandidate(run, L, i));
            expect(seen.size, `run ${run} L${L}: candidate chain`).toBe(6);
        }
    }
});

test("seedCandidate avalanches every runSeed bit; the old additive mix did not", () => {
    const oldMix = (run, L) => (run + Math.imul(L, 0x9E3779B1)) >>> 0;
    const rng = makeRng(0xA11CE);
    for (let bit = 0; bit < 32; bit++) {
        let sumNew = 0, sumOld = 0;
        for (let n = 0; n < 400; n++) {
            const run = Math.floor(rng() * 0x100000000) >>> 0;
            const L = 1 + (n % 100);
            sumNew += hamming(seedCandidate(run, L, 0),
                seedCandidate(run ^ (1 << bit), L, 0));
            sumOld += hamming(oldMix(run, L), oldMix(run ^ (1 << bit), L));
        }
        const meanNew = sumNew / 400;
        // Ideal avalanche: half the 32 output bits change per flipped input
        // bit. Band [13, 19] keeps >13 sigma of margin on the sample mean
        // while catching any structurally biased mix.
        expect(meanNew, `bit ${bit}: mean changed bits ${meanNew.toFixed(2)}`)
            .toBeGreaterThanOrEqual(13);
        expect(meanNew, `bit ${bit}`).toBeLessThanOrEqual(19);
        // Documented WHY: the shipped-until-now additive mix leaks the TOP
        // runSeed bit straight through (flipping bit 31 flips exactly bit 31).
        if (bit === 31) expect(sumOld / 400).toBe(1);
    }
});

test("adjacent level numbers produce decorrelated seeds", () => {
    const rng = makeRng(0xBEEF01);
    let sum = 0, equal = 0;
    for (let n = 0; n < 2000; n++) {
        const run = Math.floor(rng() * 0x100000000) >>> 0;
        const a = seedCandidate(run, 1 + (n % 99), 0);
        const b = seedCandidate(run, 2 + (n % 99), 0);
        if (a === b) equal++;
        sum += hamming(a, b);
    }
    expect(sum / 2000).toBeGreaterThanOrEqual(13);
    expect(sum / 2000).toBeLessThanOrEqual(19);
    expect(equal).toBe(0);
});

// --- layoutSignature / layoutSimilarity primitives -----------------------------

test("layoutSimilarity: identity, disjointness, dims, mirroring", () => {
    const sig = (w, h, cells, dir = 'right') => {
        const surface = new Uint8Array(w * h);
        for (const [x, y] of cells) surface[y * w + x] = 1;
        return { w, h, surface, dir };
    };
    const a = sig(4, 2, [[0, 0], [1, 0]]);
    expect(layoutSimilarity(a, a)).toBe(1);
    expect(layoutSimilarity(a, sig(4, 2, [[2, 1]]))).toBe(0);
    // Different dims read as dissimilar regardless of content.
    expect(layoutSimilarity(a, sig(3, 2, [[0, 0], [1, 0]]))).toBe(0);
    // A left-facing mirror twin scores HIGH against its right-facing source
    // (and higher than a direct compare of an asymmetric pattern would).
    const mirrored = sig(4, 2, [[2, 0], [3, 0]], 'left');
    expect(layoutSimilarity(a, mirrored)).toBe(1);
    // Same direction never mirrors.
    expect(layoutSimilarity(a, sig(4, 2, [[2, 0], [3, 0]], 'right'))).toBe(0);
    // Real levels: same seed -> identical signature.
    const l1 = new Level(1, T, 4242);
    const l2 = new Level(1, T, 4242);
    expect(layoutSimilarity(layoutSignature(l1), layoutSignature(l2))).toBe(1);
});

// --- the guard itself -----------------------------------------------------------

function guardedSequence(runSeed, levels) {
    mountFixture();
    const game = new Game();
    game.runSeed = runSeed;
    const seeds = [];
    for (let L = 1; L <= levels; L++) seeds.push(game.seedFor(L));
    return { game, seeds };
}

test("same runSeed replays the identical guarded seed sequence", () => {
    const A = guardedSequence(0x1234ABCD, 20);
    const B = guardedSequence(0x1234ABCD, 20);
    expect(B.seeds).toEqual(A.seeds);
    // Different runSeed, different sequence (guards included).
    const C = guardedSequence(0x9999BE00, 20);
    expect(C.seeds).not.toEqual(A.seeds);
});

test("in-run layouts stay dissimilar: no comparable pair reaches 0.7 IoU", { timeout: 60000 }, () => {
    // Three fixed runs x 40 levels. Baseline (unguarded, scratch sweep):
    // worst pair per 100-level run averaged 0.815 surface IoU and 85% of
    // runs held some pair >= 0.7. Post-guard the whole population sits
    // below 0.6 (fallback rate 0.25%, and fallbacks still landed < 0.6).
    for (const run of [0xC0FFEE42, 0x0BADCAFE, 0x5EED1234]) {
        const { seeds } = guardedSequence(run, 40);
        const fps = seeds.map((s, i) =>
            layoutSignature(new Level(i + 1, T, s)));
        let worst = 0;
        for (let i = 0; i < fps.length; i++)
            for (let j = i + 1; j < fps.length; j++)
                worst = Math.max(worst, layoutSimilarity(fps[i], fps[j]));
        expect(worst, `run 0x${run.toString(16)}: worst pair`)
            .toBeLessThan(0.7);
    }
});

test("stored seeds bypass the guard and never touch history", () => {
    mountFixture();
    const game = new Game();
    game.runSeed = 0xFEEDFACE;
    const before = game.recentLayouts.length;
    game.levelSeeds.set(50, 12345);
    expect(game.seedFor(50)).toBe(12345);
    expect(game.recentLayouts.length).toBe(before);
});

test("retry (both screens) replays the exact died-on map, history frozen", () => {
    mountFixture();
    const game = new Game();
    expect(game.startGame()).toBe(true);
    const seed = game.level.seed;
    const hash = tilesHash(game.level);
    const historyLen = game.recentLayouts.length;

    // GAME_OVER screen Retry and the pause-menu Restart share this path.
    game.restartCurrentLevel('game-over-screen');
    expect(game.level.seed).toBe(seed);
    expect(tilesHash(game.level)).toBe(hash);
    game.restartCurrentLevel('pause-screen');
    expect(game.level.seed).toBe(seed);
    expect(tilesHash(game.level)).toBe(hash);
    // Replays selected nothing: exactly one record for the level stands.
    expect(game.recentLayouts.length).toBe(historyLen);
    expect(game.levelSeeds.get(1)).toBe(seed);
});

test("startGame clears the previous run's anti-repeat memory", () => {
    mountFixture();
    const game = new Game();
    expect(game.startGame()).toBe(true);
    game.levelSeeds.set(42, 1);
    game.recentLayouts.push(layoutSignature(game.level));
    expect(game.startGame()).toBe(true); // Play Again
    expect(game.levelSeeds.size).toBe(1); // only the fresh L1 choice
    expect(game.recentLayouts.length).toBe(1);
});

test("an all-throwing chain stores nothing and reproduces the throw", () => {
    mountFixture();
    const game = new Game();
    game.runSeed = 0x13572468;
    const original = Level.prototype.generateLevel;
    Level.prototype.generateLevel = function () {
        throw new Error('stubbed exhaustion');
    };
    try {
        // seedFor walked all six candidates (all threw), handed back the
        // primary UNSTORED, and the caller's construction replays the throw
        // exactly — startLevel's throw-through contract (game_loop_elements)
        // is preserved.
        expect(() => game.startLevel()).toThrow('stubbed exhaustion');
        expect(game.levelSeeds.size).toBe(0);
        expect(game.recentLayouts.length).toBe(0);
        expect(game.seedFor(1)).toBe(seedCandidate(game.runSeed, 1, 0));
    } finally {
        Level.prototype.generateLevel = original;
    }
});
