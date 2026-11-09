// Unit: B1 pad purposefulness (owner directive 2026-11-09 — "jump pads in
// places where it makes zero sense"). Two families of pins:
//
// 1) The HARD EQUIVALENCE PIN for the jump-envelope extraction: replaying
//    the exported jumpEnvelopeTargets over every reachable non-conveyance
//    standable cell reproduces level.modelTransitions byte-for-byte across
//    519 mixed-tier maps (L1..60, deterministic formula seeds). This is the
//    proof the sacred reachability core survived the refactor untouched.
//
// 2) The synthetic accept/reject fixtures for the pad VALUE test, per lane:
//    a constructed post-flag dead-end pad REJECTED; a constructed ROUTE
//    shortcut ACCEPTED with asserted hop numbers; a constructed coin-EXPRESS
//    pad ACCEPTED; and the MIN-gain boundary on ONE map — the same grid
//    yields gain 1 (rejected) below the plateau and gain 2 (accepted) at
//    the foot column, straddling PAD_MIN_HOP_GAIN = 2 exactly.
//
// 3) The B2 dead-edge pin (B1 review Minor 2): a constructed grid where the
//    ONLY source of accepted value was the physically-unreachable exact-r-4
//    flush landing (rise 128 px vs the integrator's measured 123.86) — the
//    pad must now be REJECTED (see PAD_FLUSH_APEX_ROWS in level.js).
import { test, expect } from "bun:test";
import {
    Level, computeReachable, jumpEnvelopeTargets
} from "../../js/level.js";
import { buildBaseGraph, hopDistances } from "../../js/metrics.js";
import { PAD_APEX_CELLS } from "../../js/pads.js";

const T = 32;
const MIN_GAIN = 2; // mirrors the exported PAD_MIN_HOP_GAIN (asserted equal)

test("PAD_MIN_HOP_GAIN is the shipped constant", async () => {
    const { PAD_MIN_HOP_GAIN } = await import("../../js/level.js");
    expect(PAD_MIN_HOP_GAIN).toBe(MIN_GAIN);
});

// ── 1) envelope equivalence pin ---------------------------------------------
const SEED_SET = [];
for (let lvl = 10; lvl <= 60; lvl++) {
    for (let s = 0; s < 10; s++) {
        SEED_SET.push([lvl, (lvl * 7919 + s * 104729 + 12345) >>> 0]);
    }
}
for (let lvl = 1; lvl <= 9; lvl++) SEED_SET.push([lvl, (lvl * 7919 + 999) >>> 0]);

test(
    "jumpEnvelopeTargets replays modelTransitions byte-for-byte over every " +
    "standable cell across 519 mixed-tier maps",
    { timeout: 300000 },
    () => {
        let maps = 0, corrMaps = 0, shaftMaps = 0, cells = 0, edges = 0;
        let carvedMaps = 0;
        const failures = [];
        for (const [lvl, seed] of SEED_SET) {
            let L; try { L = new Level(lvl, T, seed); } catch { continue; }
            maps++;
            const w = L.width, h = L.height;
            const reqHead = L.direction === "vertical";
            const corr = L.bridgeGap || null;
            const shaft = L.shaftGap || null;
            if (corr) corrMaps++;
            if (shaft) shaftMaps++;
            // The M4 alcove carve flips tiles AFTER validation, so the
            // shipped modelTransitions belong to the PRE-CARVE grid. The
            // carve records every flipped cell — unflip them onto a copy
            // and replay there (the shipped tiles themselves are never
            // touched). Uncarved maps replay on the live grid byte-direct.
            const alcove = L.getAlcove ? L.getAlcove() : null;
            let tiles = L.tiles;
            if (alcove && alcove.flipped && alcove.flipped.length) {
                carvedMaps++;
                tiles = L.tiles.map((row) => row.slice());
                for (const f of alcove.flipped) {
                    tiles[f.r][f.x] = tiles[f.r][f.x] === 1 ? 0 : 1;
                }
            }
            const isCorr = (x, y) => corr !== null && y === corr.S - 1 &&
                x >= corr.a && x <= corr.b;
            const isShaft = (x, y) => shaft !== null && x >= shaft.sx &&
                x <= shaft.ex && y >= shaft.A - 1 && y <= shaft.B - 1;
            // Recorded transitions grouped by source, in recorded order.
            const bySource = new Map();
            for (const t of L.modelTransitions) {
                const k = t.ay * w + t.ax;
                let list = bySource.get(k);
                if (!list) { list = []; bySource.set(k, list); }
                list.push(`${t.bx},${t.by}`);
            }
            for (const key of L.reachableTiles) {
                const x = key % w, y = (key - x) / w;
                // Conveyance dwell cells expand through the zero-launch-
                // authority branches inside computeReachable, NOT the
                // envelope — they are excluded from the replay contract by
                // design (branch order: corridor first, then shaft).
                if (isCorr(x, y) || isShaft(x, y)) continue;
                const replayed = jumpEnvelopeTargets(
                    tiles, w, h, x, y, reqHead, corr, shaft
                ).map(([bx, by]) => `${bx},${by}`);
                const recorded = bySource.get(key) || [];
                cells++; edges += recorded.length;
                if (replayed.join(";") !== recorded.join(";")) {
                    failures.push(`L${lvl}s${seed} cell(${x},${y}) ` +
                        `replayed=[${replayted_or_recorded(replayed)}] ` +
                        `recorded=[${replayted_or_recorded(recorded)}]`);
                }
                bySource.delete(key);
            }
            // Anything left recorded must belong to conveyance dwell cells.
            for (const k of bySource.keys()) {
                const x = k % w, y = (k - x) / w;
                if (!isCorr(x, y) && !isShaft(x, y)) {
                    failures.push(`L${lvl}s${seed} orphan source (${x},${y})`);
                }
            }
        }
        expect(failures.slice(0, 5), `mismatches: ${failures.length}`).toEqual([]);
        expect(maps).toBeGreaterThanOrEqual(500);
        expect(carvedMaps).toBeGreaterThan(0);         // unflip path exercised
        expect(edges).toBeGreaterThan(10000);          // real coverage
        expect(corrMaps).toBeGreaterThan(0);           // deck corridors seen
        expect(shaftMaps).toBeGreaterThan(0);          // elevator shafts seen
        expect(cells).toBeGreaterThan(10000);
    }
);
function replayted_or_recorded(list) {
    return list.length > 8 ? `${list.slice(0, 8).join(" ")} …(${list.length})`
        : list.join(" ");
}

// ── 1b) BASE golden hashes: the transitions/reachability the ACCEPTED grid
// records must match the values captured from pristine BASE 87de0f7 BEFORE
// the extraction landed. Where the replay-vs-recorded pin proves internal
// consistency of the extracted generator, these goldens pin its ABSOLUTE
// semantics against the pre-refactor engine (mutation of the envelope scans
// turns this red even though both sides would move together).
test("modelTransitions + reachable set match BASE 87de0f7 goldens", {
    timeout: 120000
}, () => {
    const GOLDENS = baseGoldens();
    for (const [lvl, seed, want] of GOLDENS) {
        const L = new Level(lvl, T, seed);
        const s = L.modelTransitions
            .map((t) => `${t.ax},${t.ay}->${t.bx},${t.by}`).join(";") +
            "|" + [...L.reachableTiles].sort((a, b) => a - b).join(",");
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        expect(h.toString(16), `L${lvl}s${seed} transitions hash`)
            .toBe(want);
    }
});
function baseGoldens() {
    // BASE-era hashes captured from 87de0f7 before the extraction landed.
    return [
    [10, 405722, "1b906df5"],
    [11, 413641, "ab4320d3"],
    [12, 421560, "5d4d0d6b"],
    [13, 429479, "a953ceef"],
    [14, 437398, "ff71c0a3"],
    [15, 445317, "7801aef2"],
    [16, 453236, "cd911a92"],
    [17, 461155, "1b5dd63b"],
    [18, 469074, "ea75e82e"],
    [19, 476993, "8061e8ff"],
    [20, 484912, "d911253a"],
    [21, 492831, "63c1e5a4"],
    [22, 500750, "d6cd140c"],
    [23, 508669, "63aae927"],
    [24, 516588, "ccdeb283"],
    [25, 524507, "390d192e"],
    [26, 532426, "f6414983"],
    [27, 540345, "12c1e0e3"],
    [28, 548264, "590b171f"],
    [29, 556183, "970d2660"],
    [30, 564102, "86d873e6"],
    [31, 572021, "5641600f"],
    [32, 579940, "da3039b9"],
    [33, 587859, "4da825f"],
    [34, 595778, "19e873c6"],
    [35, 603697, "bb2e137e"],
    [36, 611616, "742f5e8e"],
    [37, 619535, "2d708efd"],
    [38, 627454, "8c64a290"],
    [39, 635373, "5b2080d2"],
    ];
}

// ── 2) synthetic value fixtures ---------------------------------------------
// Minimal Level surface for the placement-pass methods (same house pattern
// as the corridorSelf helper in level_capability_objects.test.js): the graph
// inputs are produced by the REAL computeReachable on the crafted grid.
function mkSelf(w, h, rows, spawn, portal, coinsCells = []) {
    const tiles = rows.map((s) => [...s].map((ch) => ch === "#" ? 1 : 0));
    const self = Object.assign(Object.create(Level.prototype), {
        width: w, height: h, tiles, tileSize: T, direction: "right",
        spawnTile: { x: spawn[0], y: spawn[1] },
        portalTile: { x: portal[0], y: portal[1] },
        coins: coinsCells.map(([cx, cy]) => ({
            x: cx * T + 8, y: cy * T + 8, width: 16, height: 16, secret: false
        }))
    });
    const trans = [];
    self.modelTransitions = trans;
    self.reachableTiles = computeReachable(
        tiles, w, h, self.spawnTile, false, null, null, trans);
    return self;
}

// Numeric mirror of _padPassesValue for ASSERTING the hop numbers, built
// only from the shipped public pieces (buildBaseGraph, hopDistances,
// jumpEnvelopeTargets, PAD_APEX_CELLS) — deliberately not calling the
// private method, so agreement with its verdict is evidence, not tautology.
function laneGains(self, cell) {
    const graph = buildBaseGraph(self);
    const { cells, adj, spawnKey, portalKey } = graph;
    const dB = hopDistances([spawnKey], adj);
    const w = self.width;
    const dp = dB.get(cell.row * w + cell.col);
    const aRow = cell.row - PAD_APEX_CELLS;
    const env = jumpEnvelopeTargets(self.tiles, w, self.height,
        cell.col, aRow, self.direction === "vertical");
    const delivery = [];
    for (const [bx, by] of env) {
        if (by <= aRow) continue;
        const k = by * w + bx;
        if (cells.has(k)) delivery.push(k);
    }
    // B2 dead-edge fix mirrored: flush standable delivery sits at r-3
    // (PAD_FLUSH_APEX_ROWS), not the unreachable exact-r-4 apex row.
    const fKey = (cell.row - 3) * w + cell.col;
    if (cells.has(fKey)) delivery.push(fKey);
    const da = hopDistances(delivery, adj);
    const dPad = (k) => {
        const via = da.get(k);
        return via === undefined ? dB.get(k)
            : Math.min(dB.get(k), dp + 1 + via);
    };
    return {
        route: dB.get(portalKey) - dPad(portalKey),
        express: Math.max(...self.coins.map((c) => {
            const k = Math.floor((c.y + c.height / 2) / T) * w +
                Math.floor((c.x + c.width / 2) / T);
            return dB.get(k) - dPad(k);
        }))
    };
}
const verdict = (self, cell) =>
    Level.prototype._padPassesValue.call(
        self, cell, Level.prototype._padValueContext.call(self));

// Flat floor row 7 (solid row 8); spawn col 1; portal col 8 — PAST THE FLAG
// a mesa rises (cols 14..17 solid rows 5..8): its top is off-graph (a 3-row
// face no step-up climbs) and carries nothing. The pad candidate at (13,7)
// is exactly the owner's complaint shape: bounce after the flag at nothing.
function mesaSelf() {
    const w = 20, h = 10;
    const rows = [];
    for (let r = 0; r < h; r++) {
        let line = "";
        for (let c = 0; c < w; c++) {
            line += (r === 8 || (c >= 14 && r >= 5)) ? "#" : ".";
        }
        rows.push(line);
    }
    return mkSelf(w, h, rows, [1, 7], [8, 7], [[3, 7], [5, 7]]);
}

test("post-flag dead-end pad is REJECTED (zero gain on both lanes)", () => {
    const self = mesaSelf();
    // Sanity: the mesa top really is unreachable dead-end scenery.
    expect(self.reachableTiles.has(4 * 20 + 15)).toBe(false);
    const g = laneGains(self, { col: 13, row: 7 });
    expect(g.route).toBe(0);
    expect(g.express).toBe(0);
    expect(verdict(self, { col: 13, row: 7 })).toBe(false);
});

// Floor row 7 cols 0..8; ascending steps col 9(top 6), col 10(top 5),
// col 11(top 4); plateau cols 12..19 (top standable row 3). Portal (14,3),
// coin (17,3). Base route walks up the stair (7 hops); a pad at the
// plateau foot bounces straight onto the plateau edge.
function plateauSelf() {
    const w = 20, h = 10;
    const rows = [];
    for (let r = 0; r < h; r++) {
        let line = "";
        for (let c = 0; c < w; c++) {
            let ch = ".";
            if (r === 8) ch = "#";
            if (c === 9 && r >= 7) ch = "#";
            if (c === 10 && r >= 6) ch = "#";
            if (c === 11 && r >= 5) ch = "#";
            if (c >= 12 && r >= 4) ch = "#";
            line += ch;
        }
        rows.push(line);
    }
    return mkSelf(w, h, rows, [1, 7], [14, 3], [[17, 3]]);
}

test("constructed ROUTE-shortcut pad ACCEPTED with asserted hop numbers", () => {
    const self = plateauSelf();
    const base = buildBaseGraph(self);
    const dB = hopDistances([base.spawnKey], base.adj);
    expect(dB.get(3 * 20 + 14)).toBe(7);      // base route: 7 hops to portal
    const g = laneGains(self, { col: 8, row: 7 });
    expect(g.route).toBe(2);                  // bounce cuts it to 5
    expect(g.express).toBe(2);
    expect(verdict(self, { col: 8, row: 7 })).toBe(true);
});

test("constructed coin-EXPRESS pad ACCEPTED on the express lane alone", () => {
    // Same terrain, portal moved next to spawn: the ROUTE lane cannot move
    // (1 hop base), only the far plateau coin improves.
    const w = 20, h = 10;
    const rows = [];
    for (let r = 0; r < h; r++) {
        let line = "";
        for (let c = 0; c < w; c++) {
            let ch = ".";
            if (r === 8) ch = "#";
            if (c === 9 && r >= 7) ch = "#";
            if (c === 10 && r >= 6) ch = "#";
            if (c === 11 && r >= 5) ch = "#";
            if (c >= 12 && r >= 4) ch = "#";
            line += ch;
        }
        rows.push(line);
    }
    const self = mkSelf(w, h, rows, [1, 7], [3, 7], [[17, 3]]);
    const g = laneGains(self, { col: 8, row: 7 });
    expect(g.route).toBe(0);
    expect(g.express).toBe(2);
    expect(verdict(self, { col: 8, row: 7 })).toBe(true);
});

test("MIN-gain boundary on ONE map: gain 1 rejected, gain 2 accepted", () => {
    const self = plateauSelf();
    // One column further back the bounce lands one ring lower: every lane
    // improves by exactly 1 — below PAD_MIN_HOP_GAIN, rejected.
    const near = laneGains(self, { col: 6, row: 7 });
    expect(near.route).toBe(1);
    expect(near.express).toBe(1);
    expect(verdict(self, { col: 6, row: 7 })).toBe(false);
    // At the foot column the improvement crosses the threshold: accepted.
    const foot = laneGains(self, { col: 7, row: 7 });
    expect(foot.route).toBe(2);
    expect(verdict(self, { col: 7, row: 7 })).toBe(true);
});

// ── 3) B2 dead-edge pin (B1 review Minor 2) ---------------------------------
// The p->apex FLUSH delivery used to sit at exactly r-PAD_APEX_CELLS (=4):
// a 128 px feet-line rise against the shipped integrator's MEASURED 123.86
// px (pads.js header) — physically unreachable, so an acceptance resting on
// it would be an uncollectable promise. (Fix-round note: the edge DOES fire
// as graph adjacency on vertical-shaft maps, whose reachableTiles carry
// shaft-model nodes with open below-tiles — but replaying both rules over
// 1350 generated maps flips zero acceptances, so it never carries value
// there. This synthetic grid is how the deadness gets demonstrated at all.)
// Constructed grid where ONLY that dead edge grants value: a long floating
// deck (floor row 4, cols 0..16) carries the portal at (2,3) directly above
// the pad pocket at (2,7); the spawn sits BETWEEN pad and stair at (10,7),
// so the only base route walks east, up the stair (cols 15..17) and back
// west along the deck — 9 hops vs the dead edge's 3 (hop edges compress
// flat walks). Every PHYSICALLY-reachable strictly-below delivery is dead:
// the deck floor catches all in-board falls, off-stair ground is a walled
// pocket outside the graph, and the honest r-3 flush probe hits deck rock
// ((2,4) is solid). Reject.
function deckPocketSelf() {
    const w = 20, h = 10;
    const rows = [];
    for (let r = 0; r < h; r++) {
        let line = "";
        for (let c = 0; c < w; c++) {
            let ch = ".";
            if (r === 8) ch = "#";                    // ground
            if (r === 4 && c <= 16) ch = "#";         // floating deck floor
            if (c === 15 && r >= 7) ch = "#";         // east stair
            if (c === 16 && r >= 6) ch = "#";
            if (c === 17 && r >= 5) ch = "#";
            line += ch;
        }
        rows.push(line);
    }
    return mkSelf(w, h, rows, [10, 7], [2, 3]);
}

test("dead exact-r-4 flush edge alone no longer buys a pad (B2)", () => {
    const self = deckPocketSelf();
    const w = 20;
    const apexKey = 3 * w + 2;
    // The dead edge WAS live on this grid: the apex cell is standable and
    // graph-reachable (via the long loop), exactly the trap.
    expect(self.reachableTiles.has(apexKey)).toBe(true);
    // Emulate the OLD r-4 edge numerically (house pattern: agreement with
    // the shipped verdict is evidence, not tautology): it accepted hard.
    const graph = buildBaseGraph(self);
    const dB = hopDistances([graph.spawnKey], graph.adj);
    const dp = dB.get(7 * w + 2);
    const dPortal = dB.get(3 * w + 2);
    expect(dp).toBe(2);                               // pocket behind spawn
    expect(dPortal).toBe(9);                          // the long loop
    expect(dp + 1).toBeLessThanOrEqual(dPortal - 2);  // OLD edge: accepted
    // Shipped (fixed) model: REJECTED — no strictly-below delivery clears
    // the gain bar and the r-3 flush probe finds only rock.
    expect(laneGains(self, { col: 2, row: 7 }).route).toBe(0);
    expect(verdict(self, { col: 2, row: 7 })).toBe(false);
});
