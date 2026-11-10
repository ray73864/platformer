// Hostile-shelf fairness rule (screenshot ruling 2026-11-03): stomp-immune
// spinies and dashing chargers must never deploy on shelves whose solid run
// beneath the spawn is narrower than HOSTILE_MIN_RUN (4) tiles. The playtest
// evidence was a staircase of narrow pillars whose ONE mandatory landing
// pillar carried a spiny patrolling its tiny top — landing onto/next to a
// lethal moving body or dying on the takeoff lip below is unwinnable, not
// hard. These tests pin the demotion rule on hand-built fixtures (so the
// geometry is undeniable), determinism of the kind stream (one rng draw per
// deployment, no re-roll on demotion), geometry-only enemy placement, and a
// bounded structural sweep as the regression pin for the ruling.
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";

const T = 32;

// Hand-built single-marker fixture on a floating pillar of `pillarWidth`
// tiles: marker at (11, 5), pillar top support row 6 spanning columns
// 10..10+pillarWidth-1. Level 38 is right-facing with plateaued kind
// chances (spiny 0.25, charger ~0.18), so a hostile roll fires often; the
// band [9, 14] contains the marker column. Tiles/reachability are replaced
// wholesale AFTER construction — spawnEnemies derives everything from the
// current grid, and the rng state entering the roll loop is identical for
// every fixture built from the same seed.
function fixture(seed, pillarWidth) {
    const level = new Level(38, T, seed);
    // W3a: level 38 now lives in CANYONS (bridgeChance ~1) — a real bridge/
    // shaft descriptor from construction would veto marker sites near its
    // lip. This fixture owns its geometry wholesale, so drop them. The
    // canyon dirCycle also flips L38 left-facing; the fixture's pillar sits
    // on a right-facing route, so pin the direction the spawn-scan needs.
    level.bridgeGap = null;
    level.shaftGap = null;
    level.direction = "right";
    const W = 20;
    const H = 10;
    level.width = W;
    level.height = H;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (let c = 10; c < 10 + pillarWidth; c++) {
        tiles[6][c] = 1;
        tiles[7][c] = 1;
    }
    tiles[5][11] = 4;
    level.tiles = tiles;
    level.reachableTiles = new Set([5 * W + 11]);
    level.spawnEnemies();
    return level;
}

// Same measurement as the fairness probe: contiguous type-1 tiles on the
// support row (y + 1) through column x.
function runW(level, x, y) {
    const row = level.tiles[y + 1];
    if (!row || row[x] !== 1) return 0;
    let l = x;
    while (l > 0 && row[l - 1] === 1) l--;
    let r = x;
    while (r < level.width - 1 && row[r + 1] === 1) r++;
    return r - l + 1;
}

test("hostile rolls on narrow shelves (runW <= 3) demote to walker", () => {
    // Every seed must yield a plain walker on 2- and 3-wide pillars, no
    // matter how the roll lands (the demotion is roll-independent).
    for (let s = 1; s <= 15; s++) {
        for (const width of [2, 3]) {
            const kinds = fixture(s * 7, width)
                .getEnemyManager().enemies.map(e => e.kind);
            expect(kinds).toEqual(['walker']);
        }
    }
});

test("wide shelves (runW >= 4) still carry hostile kinds", () => {
    // Same seeds/fixtures as above, just a legal shelf: the rolls that fire
    // hostile kinds must survive untouched (the rule is a fairness gate,
    // not a kind ban).
    let sawSpiny = false;
    let sawCharger = false;
    for (let s = 1; s <= 15; s++) {
        const kinds = fixture(s * 7, 4)
            .getEnemyManager().enemies.map(e => e.kind);
        expect(kinds.length).toBe(1);
        if (kinds[0] === 'spiny') sawSpiny = true;
        if (kinds[0] === 'charger') sawCharger = true;
    }
    expect(sawSpiny || sawCharger).toBe(true);
});

test("demotion preserves the kind stream: same seed replays identically", () => {
    // One consumed draw per enemy, no re-roll on demotion: two builds of
    // the same seed agree on kinds AND pixel placements on both narrow and
    // wide fixtures.
    for (const seed of [7, 999, 424242]) {
        for (const width of [2, 4]) {
            const a = fixture(seed, width).getEnemyManager().enemies;
            const b = fixture(seed, width).getEnemyManager().enemies;
            expect(a.map(e => e.kind)).toEqual(b.map(e => e.kind));
            expect(a.map(e => [e.x, e.y, e.minX, e.maxX]))
                .toEqual(b.map(e => [e.x, e.y, e.minX, e.maxX]));
        }
    }
});

test("placements come from geometry alone: the rule changes kind, never position", () => {
    // Enemy pixel rect must equal the deriveEnemySpawns mapping exactly
    // (spawn cell + clamped patrol span), independent of which kind rolled
    // or whether a hostile was demoted — geometry stays untouched.
    for (let s = 1; s <= 15; s++) {
        for (const width of [2, 3, 4, 5]) {
            const level = fixture(s * 13, width);
            const expected = level.deriveEnemySpawns().map(sp => [
                sp.x * T, sp.y * T, sp.left * T, (sp.right + 1) * T]);
            const actual = level.getEnemyManager().enemies
                .map(e => [e.x, e.y, e.minX, e.maxX]);
            expect(actual).toEqual(expected);
        }
    }
}, 30_000); // suite-timeout hygiene 2026-11-06: ~3.2s solo brushes bun's 5s default under parallel load

test("named repros (2026-11-03 screenshot ruling): narrow shelves hold no hostiles", () => {
    // The three pinned maps: Level(15,32,15007) spiny on a runW=2 shelf,
    // Level(13,32,13010), Level(17,32,17003). Whatever stands on a run
    // <= 3 now stands down as a walker.
    for (const [lvl, seed] of [[15, 15007], [13, 13010], [17, 17003]]) {
        const level = new Level(lvl, T, seed);
        for (const e of level.getEnemyManager().enemies) {
            const w = runW(level, Math.round(e.x / T), Math.round(e.y / T));
            if (w <= 3) expect(e.kind).toBe('walker');
        }
    }
});

test("structural sweep L10..L40 x 10 seeds: ZERO hostiles on runW <= 3 shelves", { timeout: 60000 }, () => {
    // Regression pin for the ruling (baseline measured 73/255 = 29% hostile
    // deployments on runs <= 3 tiles across L10-30 x 20 seeds).
    let checked = 0;
    for (let lvl = 10; lvl <= 40; lvl++) {
        for (let s = 1; s <= 10; s++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            for (const e of level.getEnemyManager().enemies) {
                if (e.kind === 'walker') continue;
                expect(runW(level, Math.round(e.x / T), Math.round(e.y / T)))
                    .toBeGreaterThanOrEqual(4);
                checked++;
            }
        }
    }
    // The rule must be exercised, not vacuous: past both gates plenty of
    // legal hostiles still deploy.
    expect(checked).toBeGreaterThan(0);
});
