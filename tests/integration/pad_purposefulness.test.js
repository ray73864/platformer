// Integration: B1 pad purposefulness pinned on REAL generator seeds (the
// full Level pipeline, deterministic per seed). Pins the owner-reported
// failure shapes end-to-end: a seed whose BASE-era pad sat past the flag
// shipping NOTHING today, the owner's literal complaint seed from the
// directive, and one useful-pad seed with its concrete asserted hop values.
// Hop math uses only the shipped public pieces (buildBaseGraph,
// hopDistances, jumpEnvelopeTargets) — same helpers as the unit fixtures.
import { test, expect } from "bun:test";
import { Level, jumpEnvelopeTargets } from "../../js/level.js";
import { buildBaseGraph, hopDistances } from "../../js/metrics.js";
import { PAD_APEX_CELLS } from "../../js/pads.js";

const T = 32;

// One bounce = one hop to any strictly-below apex-envelope delivery (or a
// standable apex), then base hops; gains vs the base BFS from spawn.
function laneGains(L, cell) {
    const graph = buildBaseGraph(L);
    const { cells, adj, spawnKey, portalKey } = graph;
    if (!cells.has(spawnKey) || !cells.has(portalKey)) return null;
    const dB = hopDistances([spawnKey], adj);
    const w = L.width;
    const dp = dB.get(cell.row * w + cell.col);
    if (dp === undefined) return null;
    const aRow = cell.row - PAD_APEX_CELLS;
    const env = jumpEnvelopeTargets(L.tiles, w, L.height, cell.col, aRow,
        L.direction === "vertical");
    const delivery = [];
    for (const [bx, by] of env) {
        if (by <= aRow) continue;
        const k = by * w + bx;
        if (cells.has(k)) delivery.push(k);
    }
    const aKey = aRow * w + cell.col;
    if (cells.has(aKey)) delivery.push(aKey);
    const da = hopDistances(delivery, adj);
    const dPad = (k) => {
        const via = da.get(k);
        return via === undefined ? dB.get(k)
            : Math.min(dB.get(k), dp + 1 + via);
    };
    let express = -99;
    for (const c of L.coins) {
        if (c.secret) continue;
        const k = Math.floor((c.y + c.height / 2) / T) * w +
            Math.floor((c.x + c.width / 2) / T);
        if (!dB.has(k)) continue;
        express = Math.max(express, dB.get(k) - dPad(k));
    }
    return { route: dB.get(portalKey) - dPad(portalKey), express };
}

test("L11 s20261108: BASE-era post-flag pad ships NOTHING (gains were 0/0)", () => {
    // BASE 87de0f7 shipped a pad at (7,16) on this map — past-adjacent to
    // nothing, with the portal far right at (25,16). Measured model value
    // of that exact cell: zero improvement on BOTH lanes. Today the map
    // ships no pad at all.
    const L = new Level(11, T, 20261108);
    expect(L.pads.length).toBe(0);
    const g = laneGains(L, { col: 7, row: 16 });
    expect(g.route).toBe(0);
    expect(g.express).toBe(0);
});

test("L12 s1154663 (owner's cited example): walk-past-the-flag pad is gone", () => {
    // Directive text: "jump pads in places where it makes zero sense …
    // after the flag once you have collected all the coins." Controller
    // recon pinned this seed: dir=left, pad=(1,14) BEHIND the portal at
    // (4,15). Value of that cell: 0 route / 0 express. Now: no pad.
    const L = new Level(12, T, 1154663);
    expect(L.direction).toBe("left");
    expect([L.portalTile.x, L.portalTile.y]).toEqual([4, 15]);
    expect(L.pads.length).toBe(0);
    const g = laneGains(L, { col: 1, row: 14 });
    expect(g.route).toBe(0);
    expect(g.express).toBe(0);
});

test("L10 s719909: the shipped pad demonstrably shortens route AND express", () => {
    const L = new Level(10, T, 719909);
    expect(L.pads.length).toBe(1);
    const pad = L.pads[0];
    expect([pad.col, pad.row]).toEqual([7, 11]);
    const g = laneGains(L, { col: pad.col, row: pad.row });
    expect(g.route).toBe(2);      // spawn->portal 2 hops shorter via the bounce
    expect(g.express).toBe(2);    // some non-secret coin likewise
});

test("pad choice is deterministic across rebuilds (same seed twice)", () => {
    for (const [lvl, seed] of [[10, 719909], [11, 20261108], [12, 1154663]]) {
        const a = new Level(lvl, T, seed);
        const b = new Level(lvl, T, seed);
        expect(b.getPads(), `L${lvl}s${seed}`).toEqual(a.getPads());
    }
});
