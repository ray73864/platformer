// Elevator shafts: BFS contract + generator invariants (vertical REQUIRED
// climbs, gate L13+). The synthetic fixture pins computeReachable's shaft
// rules in isolation; the seeded sweep pins what the generator guarantees
// about real maps (see level.js ELEVATOR_* for the design record).
import { test, expect } from "bun:test";
import { Level, computeReachable } from "../../js/level.js";

const T = 32;

// --- Synthetic shaft fixture --------------------------------------------------
// 7x10 grid: bottom shelf flank at row 8 (stand row 7) on the right, barrier
// slab at row 4 (stand row 3) with the 2-column chimney as its only breach,
// and an isolated island pillar at column 0 whose stand cell (6,0) sits on a
// MID-shaft row five columns away — beyond any legal launch from the lower
// region, but one flat scan from a mid-shaft cell IF those had authority.
function shaftFixture() {
    const width = 7, height = 10;
    const tiles = Array.from({ length: height }, () => new Array(width).fill(0));
    tiles[8][5] = 1;                                        // bottom shelf
    for (const cx of [0, 1, 2, 5, 6]) tiles[4][cx] = 1;     // barrier slab
    tiles[7][0] = 1;                                        // island pillar
    return {
        tiles, width, height,
        shaft: { sx: 3, ex: 4, A: 4, B: 8 },
        spawn: { x: 5, y: 7 },
        portal: { x: 2, y: 3 },   // slab-top egress stand neighbour
        island: { x: 0, y: 6 }
    };
}
const keyOf = (w, x, y) => y * w + x;

test("shaft fixture: plain BFS refuses the slab, cabin corridor carries the route", () => {
    const f = shaftFixture();
    const plain = computeReachable(f.tiles, f.width, f.height, f.spawn, true, null, null);
    expect(plain.has(keyOf(f.width, f.portal.x, f.portal.y)),
        "slab bypasses without the cabin").toBe(false);
    const withShaft = computeReachable(f.tiles, f.width, f.height, f.spawn, true, null, f.shaft);
    expect(withShaft.has(keyOf(f.width, f.portal.x, f.portal.y)),
        "route through the cabin").toBe(true);
    // Cabin virtual cells: every rider row across both columns joins the set.
    for (let y = f.shaft.A - 1; y <= f.shaft.B - 1; y++) {
        for (const x of [f.shaft.sx, f.shaft.ex]) {
            expect(withShaft.has(keyOf(f.width, x, y)),
                `cabin cell ${x},${y} not a route cell`).toBe(true);
        }
    }
});

test("shaft cells have zero launch authority (mid-shaft rows connect nothing)", () => {
    const f = shaftFixture();
    const withShaft = computeReachable(f.tiles, f.width, f.height, f.spawn, true, null, f.shaft);
    // (0,6) is one flat-scan away from mid-shaft cell (3,6): only standard
    // scans from a cabin cell could ever land there.
    expect(withShaft.has(keyOf(f.width, f.island.x, f.island.y)),
        "mid-shaft cell launched a jump").toBe(false);
});

test("boarding is flush-only at the two stop rows", () => {
    const f = shaftFixture();
    // Move the flank shelf one row UP (stand cell leaves the bottom stop
    // row): the flush boarding edge disappears and the cabin is unreachable.
    f.tiles[8][5] = 0;
    f.tiles[7][5] = 1;
    const spawn = { x: 5, y: 6 };
    const withShaft = computeReachable(f.tiles, f.width, f.height, spawn, true, null, f.shaft);
    expect(withShaft.has(keyOf(f.width, f.portal.x, f.portal.y)),
        "non-flank ledge boarded the cabin").toBe(false);
});

test("shaft=null leaves the horizontal/vertical BFS byte-identical", () => {
    for (let lvl = 1; lvl <= 40; lvl++) {
        const level = new Level(lvl, T, lvl * 977);
        const base = computeReachable(level.tiles, level.width, level.height,
            level.spawnTile, level.direction === "vertical", level.bridgeGap);
        const explicit = computeReachable(level.tiles, level.width, level.height,
            level.spawnTile, level.direction === "vertical", level.bridgeGap, null);
        expect([...explicit].sort((a, b) => a - b))
            .toEqual([...base].sort((a, b) => a - b));
    }
});

// --- Generator invariants over a seeded sweep ---------------------------------

test("L13..97 vertical sweep: shaft invariants hold on every hosted map", () => {
    let maps = 0, shafts = 0;
    for (let lvl = 13; lvl <= 97; lvl += 3) {
        for (const s of [11, 22, 33, 44]) {
            const seed = lvl * 1000 + s;
            const level = new Level(lvl, T, seed);
            const where = `L${lvl} seed ${seed}`;
            if (level.direction !== "vertical") {
                // W3a: horizontal maps legitimately carry BRIDGE decks now
                // (world bridgeChances), so a blanket zero-deck check is
                // wrong; the invariant that matters is no SHAFT leak — an
                // elevator cabin only exists when shaftGap geometry does.
                expect(level.shaftGap, `${where}: horiz shaft`).toBe(null);
                continue;
            }
            maps++;
            const g = level.shaftGap;
            if (!g) continue;
            shafts++;
            const W = level.width;
            // One shaft per map; lift inside modeled-impossible bounds.
            const decks = level.getMovingPlatforms();
            expect(decks.length, `${where}: deck cap 1`).toBe(1);
            expect(g.B - g.A >= 4 && g.B - g.A <= 6, `${where}: lift ${g.B - g.A}`)
                .toBe(true);
            // Chimney purity rows 0..B+1 (nothing to climb instead of riding).
            for (let y = 0; y <= g.B + 1; y++) {
                for (const cx of [g.sx, g.ex]) {
                    expect(level.tiles[y][cx], `${where}: purity ${cx},${y}`).toBe(0);
                }
            }
            // Barrier slab continuous at row A except the chimney; bottom
            // shelf full both flanks at row B.
            for (let cx = 0; cx < W; cx++) {
                if (cx >= g.sx && cx <= g.ex) continue;
                expect(level.tiles[g.A][cx], `${where}: slab ${cx}`).toBe(1);
            }
            for (const lx of [g.sx - 2, g.sx - 1, g.ex + 1, g.ex + 2]) {
                expect(level.tiles[g.B][lx], `${where}: shelf ${lx}`).toBe(1);
            }
            // Pixel-exact flush stops + fair ride parameters.
            const d = decks[0];
            expect(d.axis, `${where}: axis`).toBe("v");
            expect(d.min, `${where}: min flush`).toBe(g.A * T);
            expect(d.max, `${where}: max flush`).toBe(g.B * T);
            expect(d.dwell).toBeGreaterThanOrEqual(0.8);
            expect(d.speed).toBeLessThan(26); // strictly slower than h-decks
            // LOAD-BEARING: the shaft carries the route.
            const pk = level.portalTile.y * W + level.portalTile.x;
            const plain = computeReachable(level.tiles, W, level.height,
                level.spawnTile, true, null, null);
            expect(plain.has(pk), `${where}: terrain bypasses the shaft`).toBe(false);
            const withS = computeReachable(level.tiles, W, level.height,
                level.spawnTile, true, null, g);
            expect(withS.has(pk), `${where}: route dies at the shaft`).toBe(true);
            // Approach windows free of spikes/rocks; spawn/portal outside.
            for (let y = 0; y < level.height; y++) {
                for (let x = 0; x < W; x++) {
                    const t = level.tiles[y][x];
                    if (t === 2 || t === 4) {
                        expect(level.inShaftWindow(x, y),
                            `${where}: hazard ${t} at ${x},${y} in window`).toBe(false);
                    }
                }
            }
            for (const cell of [level.spawnTile, level.portalTile]) {
                expect(cell.x >= g.sx && cell.x <= g.ex,
                    `${where}: cell ${cell.x},${cell.y} in chimney`).toBe(false);
            }
            // Deployed patrols never sweep the window rows near the shaft.
            for (const e of level.enemyManager.enemies) {
                const lo = Math.floor(e.minX / T), hi = Math.ceil(e.maxX / T) - 1;
                for (const r of [g.A - 1, g.A - 2, g.B - 1, g.B - 2]) {
                    const rowY = Math.round(e.y / T);
                    const overlaps = lo <= g.ex + 4 && hi >= g.sx - 4;
                    expect(rowY === r && overlaps,
                        `${where}: patrol row ${rowY} cols ${lo}..${hi} vs window`).toBe(false);
                }
            }
        }
    }
    // Realized coverage band (raw SHAFT_CHANCE=0.7 minus burned attempts).
    // W3a RE-PINNED ceiling: this sweep's vertical stream now includes
    // CAVERNS (profile shaftChance 1.0) — measured 0.72 realized. Floor
    // unchanged keeps the collapse tripwire honest.
    const frac = shafts / maps;
    expect(frac).toBeGreaterThan(0.35);
    expect(frac).toBeLessThan(0.85);
});

test("no cabins below the gate and none on horizontal maps (L1..97)", { timeout: 60000 }, () => {
    for (let lvl = 1; lvl <= 97; lvl++) {
        for (const s of [7, 13]) {
            const level = new Level(lvl, T, lvl * 313 + s);
            const decks = level.getMovingPlatforms();
            if (lvl < 13) expect(decks.filter(d => d.axis === "v").length,
                `L${lvl} seed ${lvl * 313 + s}: pre-gate cabin`).toBe(0);
            if (level.direction !== "vertical") {
                expect(decks.filter(d => d.axis === "v").length,
                    `L${lvl} seed ${lvl * 313 + s}: off-axis cabin`).toBe(0);
            }
        }
    }
});

test("shaft maps replay identically on retry (deterministic schedule)", () => {
    let checked = 0;
    for (let lvl = 13; lvl <= 61; lvl += 3) {
        for (const s of [5, 6, 7]) {
            const seed = lvl * 1000 + s;
            const a = new Level(lvl, T, seed);
            if (!a.shaftGap) continue;
            const b = new Level(lvl, T, seed);
            expect(b.shaftGap).toEqual(a.shaftGap);
            expect(JSON.stringify(b.getMovingPlatforms()),
                `L${lvl} seed ${seed}: schedule drift`).toBe(
                JSON.stringify(a.getMovingPlatforms()));
            checked++;
        }
    }
    expect(checked).toBeGreaterThan(10);
});
