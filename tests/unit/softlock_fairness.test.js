import { test, expect } from "bun:test";
import { Level, computeReachable } from "../../js/level.js";

// Soft-lock fairness regressions (2026-11-05). Two shipped defects made
// maps winnable-on-paper but unsurvivable in play:
//
// 1. The reachability model claimed crossings over surface-spike columns
//    whose FIRST intermediate cell was a spike (physics kills every such
//    jump: adjacent takeoffs cannot rise the ~28px needed before the inset
//    lethal core engages, and backed arcs head-bonk canopy onto teeth).
//    Fixed by the R1' wall in computeReachable: a hazard at m === 1 blocks
//    (the legacy hazardRun >= 3 arm is retained defensively — with
//    MAX_H_JUMP = 4 it can only trigger when m === 1 already did).
// 2. The acceptance gate replayed grounded frames keyed by bodyRow*width+cx
//    without clamping cx into [0, width), so walking off the left edge
//    aliased to (width-1) of the neighbouring row — a phantom foothold next
//    to the portal that let a soft-locked construction pass (L83 s1514804096).
//    Fixed by the cx clamp in simTransition plus routeFair() now physics-
//    executing EVERY horizontal construction, not just canyon routes.

const T = 32;

// --- Model-level: R1' spike wall ----------------------------------------------

function emptyGrid(w, h) {
    return Array.from({ length: h }, () => new Array(w).fill(0));
}

test("computeReachable blocks jumps whose first intermediate column is a spike", () => {
    // Flat corridor, one tooth directly in front of the takeoff cell.
    const w = 12, h = 8;
    const tiles = emptyGrid(w, h);
    for (let x = 0; x < w; x++) tiles[6][x] = 1; // floor
    tiles[5][4] = 2;                              // tooth at col 4
    const transitions = [];
    computeReachable(tiles, w, h, { x: 3, y: 5 }, false, null, null, transitions);
    // No ADJACENT-takeoff edge may cross the tooth: pre-R1', (3,5)->(5,5)
    // (dist 2, one hazard intermediate) was claimed; physics kills every
    // such jump (inset core engages within ~4px while the arc needs ~28px
    // of rise).
    for (const t of transitions) {
        if (t.ax === 3 && t.ay === 5 && t.bx >= 5) {
            expect.fail(`R1' violation: (${t.ax},${t.ay})->(${t.bx},${t.by})`);
        }
    }
    // Backed crossings keep their old modelling (census: physics lands
    // them): (2,5)->(5,5) with the tooth at intermediate m=2 must exist.
    expect(transitions.some(t => t.ax === 2 && t.ay === 5 && t.bx === 5))
        .toBe(true);
});

test("computeReachable still connects rows without surface spikes", () => {
    const w = 12, h = 8;
    const tiles = emptyGrid(w, h);
    for (let x = 0; x < w; x++) tiles[6][x] = 1;
    const reach = computeReachable(tiles, w, h, { x: 3, y: 5 });
    for (let x = 0; x < w; x++) expect(reach.has(5 * w + x)).toBe(true);
});

test("legacy long-run blocking still holds behind the R1' wall", () => {
    // Three teeth cols 4-6: blocked (both by m === 1 and, redundantly at
    // this MAX_H_JUMP, by the hazardRun >= 3 arm kept for defensive parity).
    const w = 12, h = 8;
    const tiles = emptyGrid(w, h);
    for (let x = 0; x < w; x++) tiles[6][x] = 1;
    for (const x of [4, 5, 6]) tiles[5][x] = 2;
    const reach = computeReachable(tiles, w, h, { x: 3, y: 5 });
    for (let x = 4; x < w; x++) expect(reach.has(5 * w + x)).toBe(false);
});

// --- End-to-end: named soft-lock seeds ship fair maps --------------------------
// Every seed below produced an ACCEPTED, player-permanent soft-lock pre-fix
// (verified frame-by-frame against HEAD; see the attribution table in the
// fix report). Fingerprints pin the exact post-fix constructions so future
// generator drift on these cases trips immediately. routeFair() re-running
// clean here is the shipped physics gate vouching for each map.

const SOFTLOCK_REPROS = [
    { lvl: 83, seed: 1514804096, fp: "05d9df9c" },
    { lvl: 32, seed: 32010, fp: "fee4a0c2" },
    { lvl: 44, seed: 44019, fp: "c68076e3" },
    { lvl: 32, seed: 32313, fp: "868432cd" },
    { lvl: 59, seed: 59309, fp: "b7caa46f" }
];

function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}
function fingerprint(level) {
    return fnv1a(JSON.stringify({
        tiles: level.tiles,
        coins: level.getCoins().map(c => [c.x, c.y]),
        spikes: level.getHazards().getSpikes().map(p => [p.x, p.y]),
        enemies: level.getEnemyManager().enemies.map(e =>
            [e.x, e.y, e.minX, e.maxX, e.kind]),
        portal: level.portal,
        spawn: level.spawnPoint,
        decks: level.getMovingPlatforms()
    }));
}

test("named soft-lock seeds construct, keep a valid path, and pass routeFair", { timeout: 120000 }, () => {
    for (const r of SOFTLOCK_REPROS) {
        const level = new Level(r.lvl, T, r.seed);
        expect(level.hasValidPath(), `L${r.lvl} seed=${r.seed}`).toBe(true);
        expect(level.routeFair(), `L${r.lvl} seed=${r.seed}`).toBe(true);
    }
});

test("named soft-lock seeds are byte-pinned against drift", { timeout: 120000 }, () => {
    for (const r of SOFTLOCK_REPROS) {
        const level = new Level(r.lvl, T, r.seed);
        expect(fingerprint(level), `L${r.lvl} seed=${r.seed}`)
            .toBe(r.fp);
    }
});
