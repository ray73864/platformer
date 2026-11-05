import { test, expect } from "bun:test";
import { Level, computeReachable } from "../../js/level.js";

// Structural invariants for REQUIRED deck bridges (player ruling 2026-11-04:
// "moving platforms should only appear when the gap is too large to jump
// over"). The law under test: a bridge gap is wider than anything the plain
// reachability model accepts (the unjumpability contract — plain BFS MUST
// refuse the portal), the route validates only through the deck corridor,
// the pit is pure void with EXACTLY flush flanks (Step-0 physics showed a
// 1-row-down far flank makes even a 6-wide pit coyote-jumpable), hostiles
// keep clear of the forced boarding points, and generation stays
// deterministic — with L1..7 and every vertical map untouched.

const T = 32;
const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111];
const MIN_DECK_GAP = 6; // mirrors level.js; pinned against Step-0 measurement
const MAX_DECK_GAP = 7;

function checkBridge(level, p, where) {
    const g = level.bridgeGap;
    expect(g, `${where}: deck without declared bridge`).toBeTruthy();
    // One shuttle per map this wave.
    expect(level.getMovingPlatforms().length, `${where}: cap`).toBe(1);
    // Gap geometry: width beyond the physical envelope, flanks EXACTLY
    // flush at the declared deck-top row S.
    const w = g.b - g.a + 1;
    expect(w, `${where}: gap width`).toBeGreaterThanOrEqual(MIN_DECK_GAP);
    expect(w, `${where}: gap width`).toBeLessThanOrEqual(MAX_DECK_GAP);
    expect(level.columnTopRow(g.a - 1), `${where}: left flank flush`)
        .toBe(g.S);
    expect(level.columnTopRow(g.b + 1), `${where}: right flank flush`)
        .toBe(g.S);
    // Pure void pit: every cell of every corridor column is air, top to
    // bottom — falling in means void death only, never a spiked floor.
    for (let x = g.a; x <= g.b; x++) {
        for (let y = 0; y < level.height; y++) {
            expect(level.tiles[y][x], `${where}: pit cell ${x},${y}`).toBe(0);
        }
    }
    // Descriptor matches the corridor exactly and shuttles inside it.
    expect(p.axis, `${where}: axis`).toBe("h"); // elevators: next wave
    expect(p.min / T, `${where}: min` ).toBe(g.a);
    expect((p.max + p.width) / T, `${where}: max`).toBe(g.b + 1);
    expect(p.y / T, `${where}: deck top row`).toBe(g.S);
    expect(p.width, `${where}: deck width`).toBe(2 * T);
    expect(p.height, `${where}: collision height`).toBe(T);
    expect(p.dwell, `${where}: dwell hold`).toBeGreaterThan(0);
    expect(p.speed, `${where}: speed slower than walk`).toBeLessThan(200);
    expect(p.speed, `${where}: speed floor`).toBeGreaterThanOrEqual(26);
    expect(p.phase, `${where}: phase`).toBeGreaterThanOrEqual(0);
    expect(p.phase, `${where}: phase`).toBeLessThan(1);

    // THE UNJUMPABILITY CONTRACT: the plain BFS (no corridor) must NOT
    // reach the portal — the deck corridor is the only validated crossing.
    const plain = computeReachable(
        level.tiles, level.width, level.height, level.spawnTile, false, null);
    const portalKey = level.portalTile.y * level.width + level.portalTile.x;
    expect(plain.has(portalKey),
        `${where}: plain BFS crosses the bridge gap (${w} cols)`).toBe(false);
    // And the corridor IS the route: every corridor cell joins the
    // validated reachable set.
    for (let x = g.a; x <= g.b; x++) {
        expect(level.reachableTiles.has((g.S - 1) * level.width + x),
            `${where}: corridor cell ${x} not a route cell`).toBe(true);
    }
    // Hostile exclusion around the forced boarding points: no deployed
    // patrol may come within two columns of either lip.
    for (const e of level.enemyManager.enemies) {
        const lo = e.minX, hi = e.maxX - 1;
        const clearLeft = hi < (g.a - 3) * T;
        const clearRight = lo > (g.b + 3) * T;
        expect(clearLeft || clearRight,
            `${where}: patrol ${lo}..${hi} near lips ${g.a - 1}/${g.b + 1}`)
            .toBe(true);
    }
    // Spawn and portal never sit inside the corridor columns.
    for (const cell of [level.spawnTile, level.portalTile]) {
        expect(cell.x >= g.a && cell.x <= g.b,
            `${where}: cell ${cell.x},${cell.y} inside corridor`).toBe(false);
    }
}

test("L8..100 x 10 seeds: every bridge legal, plain BFS refuses the gap", () => {
    let withBridge = 0, horizMaps = 0;
    for (let lvl = 8; lvl <= 100; lvl++) {
        for (const s of SEEDS) {
            const seed = lvl * 1000 + s;
            const level = new Level(lvl, T, seed);
            const where = `L${lvl} seed ${seed}`;
            const decks = level.getMovingPlatforms();
            if (level.direction === "vertical") {
                // Vertical maps ship elevator cabins (axis 'v') from L13,
                // never horizontal decks or corridors.
                for (const d of decks) {
                    expect(d.axis, `${where}: vertical deck axis`).toBe("v");
                }
                expect(decks.length, `${where}: vertical cap 1`)
                    .toBeLessThanOrEqual(1);
                if (lvl < 13) expect(decks.length, `${where}: pre-gate cabin`)
                    .toBe(0);
                expect(level.bridgeGap, `${where}: vertical corridor`).toBe(null);
                continue;
            }
            horizMaps++;
            expect(decks.length, `${where}: cap 1`).toBeLessThanOrEqual(1);
            if (!decks.length) continue;
            withBridge++;
            checkBridge(level, decks[0], where);
        }
    }
    // Realized coverage band (tuned BRIDGE_CHANCE=0.6 measured 36.7%; the
    // narrow L8..24 tiers are structurally excluded by the feasibility
    // arithmetic — documented in level.js).
    const frac = withBridge / horizMaps;
    expect(frac).toBeGreaterThan(0.28);
    expect(frac).toBeLessThan(0.48);
}, 150000); // cold-start build cost (physics route gate warms up here; raised for the generalized routeFair() gate, 2026-11-05)

test("levels below 8 ship no decks and no corridors", () => {
    for (let lvl = 1; lvl <= 7; lvl++) {
        for (const s of SEEDS) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            expect(level.getMovingPlatforms(), `L${lvl} seed ${s}`).toEqual([]);
            expect(level.bridgeGap, `L${lvl} seed ${s}`).toBe(null);
        }
    }
}, 30_000); // suite-timeout hygiene 2026-11-06: ~4s solo brushes bun's 5s default under parallel load

test("same seed replays the identical deck set including dwell and phase", () => {
    for (const [lvl, s] of [[8, 11], [27, 44], [40, 77], [60, 99], [95, 66]]) {
        const a = new Level(lvl, T, lvl * 1000 + s).getMovingPlatforms();
        const b = new Level(lvl, T, lvl * 1000 + s).getMovingPlatforms();
        expect(b, `L${lvl} seed ${s}`).toEqual(a);
    }
});

test("deck derivation never mutates the grid", () => {
    // A seed known to ship a bridge (scan deterministically).
    let level = null;
    for (let lvl = 25; lvl <= 60 && !level; lvl++) {
        for (let s = 1; s <= 60; s++) {
            const l = new Level(lvl, T, lvl * 1000 + s);
            if (l.getMovingPlatforms().length) { level = l; break; }
        }
    }
    expect(level, "found a bridge map").toBeTruthy();
    const before = JSON.stringify(level.tiles);
    const again = level.deriveMovingPlatforms();
    expect(JSON.stringify(level.tiles), "tiles untouched").toBe(before);
    expect(Array.isArray(again)).toBe(true);
    expect(again.length).toBeLessThanOrEqual(1);
});

// --- Corridor semantics on hand-built fixtures ---------------------------------
// computeReachable's virtual walkway rules, isolated from the generator:
// bidirectional lip connections, zero launch authority elsewhere.

function fixtureRows(rows) {
    return rows.map(r => [...r].map(ch => (ch === "#" ? 1 : 0)));
}

test("corridor connects flush lips bidirectionally and counts as route", () => {
    const tiles = fixtureRows([
        "............",
        "............",
        "............",
        "............",
        "###....#####", // solids from row 4; void columns 3..6
        "###....#####"
    ]);
    const width = 12, height = 6;
    const corridor = { a: 3, b: 6, S: 4 }; // rider body row 3
    const leftStart = { x: 2, y: 3 };
    const rightStart = { x: 7, y: 3 };

    // Without the corridor BOTH sides are islands.
    const plain = computeReachable(tiles, width, height, leftStart, false, null);
    expect(plain.has(3 * width + 7), "plain BFS crosses").toBe(false);
    const plainR = computeReachable(tiles, width, height, rightStart, false, null);
    expect(plainR.has(3 * width + 2), "plain BFS crosses back").toBe(false);

    // With it: crossings work in both directions and every corridor cell
    // is a route cell.
    const fwd = computeReachable(tiles, width, height, leftStart, false, corridor);
    expect(fwd.has(3 * width + 7), "cross right").toBe(true);
    const back = computeReachable(tiles, width, height, rightStart, false, corridor);
    expect(back.has(3 * width + 2), "cross left").toBe(true);
    for (let x = 3; x <= 6; x++) {
        expect(fwd.has(3 * width + x), `corridor cell ${x}`).toBe(true);
    }
});

test("corridor cells launch nothing: no climbs or falls off the walkway", () => {
    // A one-tile riser sits INSIDE the span footprint one row above the
    // walkway line would allow a dist-2 overhang climb IF corridor cells
    // had launch authority. They must not gain any.
    const tiles = fixtureRows([
        "............",
        "............",
        ".........#..", // (9,2): standable ONLY from a mid-corridor launch
        "###....#####",
        "###....#####",
        "###....#####"
    ]);
    const width = 12, height = 6;
    const corridor = { a: 3, b: 6, S: 3 }; // body row 2
    const reach = computeReachable(
        tiles, width, height, { x: 2, y: 2 }, false, corridor);
    // Crossing itself works...
    expect(reach.has(2 * width + 7), "cross right").toBe(true);
    // The riser's standable cell is (9,1) — (9,2) is its solid top. It is
    // reachable legitimately: a one-column step-up from the right-island
    // cell (8,2). Same verdict with and without the corridor, which is the
    // point — the corridor grants it no special authority.
    expect(reach.has(1 * width + 9), "riser top via corridor run").toBe(true);
    const fromRight = computeReachable(
        tiles, width, height, { x: 7, y: 2 }, false, null);
    expect(fromRight.has(1 * width + 9), "riser top standalone").toBe(true);
    // The conservative core: corridor cells added NO extra reach beyond the
    // union of (left island) U (right island) U (corridor walkway).
    const leftIsland = computeReachable(
        tiles, width, height, { x: 2, y: 2 }, false, null);
    const rightIsland = fromRight;
    for (const k of reach) {
        const x = k % width, y = (k - x) / width;
        const isWalkway = y === 2 && x >= 3 && x <= 6;
        expect(leftIsland.has(k) || rightIsland.has(k) || isWalkway,
            `extra reach (${x},${y}) off the walkway`).toBe(true);
    }
});
