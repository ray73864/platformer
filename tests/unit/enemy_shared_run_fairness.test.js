// Joint-hostile shelf rule (player reports 2026-11-04, screenshots L34 day
// band + L23 dusk band): at most ONE hostile (spiny|charger) deploys per
// contiguous solid support run. Two stomp-immune patrols sweeping the same
// surface leave no safe tile mid-crossing — HOSTILE_MIN_RUN=4 sizes the
// pass-by arc for exactly ONE body. Attribution @8802355 (L5..100 x 10
// seeds): 216/960 maps shipped >=2 hostiles sharing one run (493 pairs),
// 79 of those runs proven MANDATORY under computeReachable (blocking the
// shared surface disconnects the portal). The leak: placeEnemyMarkers has
// no inter-marker spacing rule (THREAT_SPACING ±4 is spike-vs-spike only)
// and every kind gate is per-site, so each hostile passed individually.
// These tests pin the demotion on hand-built fixtures (undeniable geometry),
// the resolved watermark-prefix repro seeds, rng-stream discipline (one draw
// per deployment, no re-roll), and a bounded structural sweep as the CI pin.
import { test, expect } from "bun:test";
import { Level, walkRunExtent } from "../../js/level.js";

const T = 32;

// Contiguous type-1 tiles on the support row through column x (same
// measurement as level.js's solidRunWidth / solidRunKey).
function runExtent(level, x, y) {
    const row = level.tiles[y + 1];
    if (!row || row[x] !== 1) return null;
    let l = x;
    while (l > 0 && row[l - 1] === 1) l--;
    let r = x;
    while (r < level.width - 1 && row[r + 1] === 1) r++;
    return { left: l, right: r };
}
function runKeyOf(level, x, y) {
    const e = runExtent(level, x, y);
    return e ? `${y + 1}:${e.left}` : null;
}

// Group deployed enemies by support-run key.
function bySupportRun(level) {
    const map = new Map();
    for (const e of level.getEnemyManager().enemies) {
        const cx = Math.round(e.x / T);
        const cy = Math.round(e.y / T);
        const k = runKeyOf(level, cx, cy);
        if (!k) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(e);
    }
    return map;
}
function hostileCountOn(runEnemies) {
    return runEnemies.filter(e => e.kind !== 'walker').length;
}

// Hand-built fixture: one floating pillar of `pillarWidth` tiles (support
// rows 6-7, columns 8..8+pillarWidth-1) carrying TWO markers side by side at
// (10,5) and (11,5). Level 38 sits past both kind gates (spiny 0.25,
// charger 0.20 plateau), so across seeds both hostile kinds fire on each
// marker often. Tiles/reachability are replaced wholesale AFTER construction
// — spawnEnemies derives everything from the current grid and the rng state
// entering the roll loop is identical for every fixture built from a seed.
function twinFixture(seed, pillarWidth) {
    const level = new Level(38, T, seed);
    // W3a fixture hygiene: drop construction-time bridge/shaft descriptors
    // (CANYONS makes them common) and pin the right-facing route these
    // pillars assume — the canyon dirCycle flips L38 left otherwise.
    level.bridgeGap = null;
    level.shaftGap = null;
    level.direction = 'right';
    const W = 20;
    const H = 10;
    level.width = W;
    level.height = H;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (let c = 8; c < 8 + pillarWidth; c++) {
        tiles[6][c] = 1;
        tiles[7][c] = 1;
    }
    tiles[5][10] = 4;
    tiles[5][11] = 4;
    level.tiles = tiles;
    level.reachableTiles = new Set([5 * W + 10, 5 * W + 11]);
    level.spawnEnemies();
    return level;
}

test("two markers on one run: at most one hostile deploys, ever", () => {
    // Roll-independent: whatever the rolls land on, the second hostile on
    // the shared run demotes to walker.
    let sawAnyHostile = false;
    for (let s = 1; s <= 25; s++) {
        const level = twinFixture(s * 7, 6);
        const runs = [...bySupportRun(level).values()];
        expect(runs.length).toBe(1);          // one contiguous shelf
        expect(runs[0].length).toBe(2);       // both bodies deployed
        expect(hostileCountOn(runs[0])).toBeLessThanOrEqual(1);
        if (hostileCountOn(runs[0]) === 1) sawAnyHostile = true;
    }
    // Non-vacuous: the rule is a cap, not a ban — plenty of maps still get
    // their one legal hostile.
    expect(sawAnyHostile).toBe(true);
});

test("walkers may still share a run (stompable/dodgeable)", () => {
    // Both bodies plain walkers on one pillar must survive untouched: the
    // rule targets lethality carpets, not density.
    let sawPair = false;
    for (let s = 1; s <= 25; s++) {
        const level = twinFixture(s * 13, 6);
        const es = level.getEnemyManager().enemies;
        if (es.length === 2 && es.every(e => e.kind === 'walker')) {
            sawPair = true;
        }
        expect(es.length).toBe(2);
    }
    expect(sawPair).toBe(true);
});

test("demotion preserves the kind stream: same seed replays identically", () => {
    // One consumed draw per enemy, no re-roll on joint-rule demotion: two
    // builds of one seed agree on kinds AND pixel placements.
    for (const seed of [7, 999, 424242]) {
        for (const width of [4, 6, 9]) {
            const a = twinFixture(seed, width).getEnemyManager().enemies;
            const b = twinFixture(seed, width).getEnemyManager().enemies;
            expect(a.map(e => e.kind)).toEqual(b.map(e => e.kind));
            expect(a.map(e => [e.x, e.y, e.minX, e.maxX]))
                .toEqual(b.map(e => [e.x, e.y, e.minX, e.maxX]));
        }
    }
});

test("placements come from geometry alone: the rule changes kind, never position", () => {
    // On runs whose density capacity fits BOTH bodies (walkable width >= 6),
    // the joint-hostile rule still swaps kinds only — every derived site
    // deploys at its exact pixel box. (Sub-6-wide runs are the domain of the
    // 2026-11-08 bodies-per-run cap, which skips the EXCESS placement
    // outright — pinned separately below.)
    for (let s = 1; s <= 15; s++) {
        for (const width of [6, 9]) {
            const level = twinFixture(s * 11, width);
            const expected = level.deriveEnemySpawns().map(sp => [
                sp.x * T, sp.y * T, sp.left * T, (sp.right + 1) * T]);
            const actual = level.getEnemyManager().enemies
                .map(e => [e.x, e.y, e.minX, e.maxX]);
            expect(actual).toEqual(expected);
        }
    }
});

test("bodies-per-run cap on the same fixture: a 4-wide pillar keeps ONE body", () => {
    // Owner ruling 2026-11-08 supersedes the blanket walker exemption on
    // narrow runs (max(1, floor(runTiles/3)) bodies per shared walkable run;
    // see BODIES_PER_RUN_DIVISOR in js/level.js). The first site in derive
    // order keeps its exact box; the excess placement is skipped without an
    // extra draw.
    for (let s = 1; s <= 15; s++) {
        const level = twinFixture(s * 11, 4);
        const es = level.getEnemyManager().enemies;
        expect(es.length).toBe(1);
        expect(Math.round(es[0].x / T)).toBe(10); // first marker column
    }
});

test("named repros (2026-11-04 L23 watermark prefix): shared-run hostiles gone", () => {
    // Resolved from the player's L23 screenshot watermark prefix "958304"
    // (exact screenshot maps came from a superseded mid-day bundle whose rng
    // stream no longer exists; these prefix candidates reproduce the SAME
    // violation shape on 8802355 pre-fix and are fixed in-tree):
    //   95830402: chargers at (15,11)+(16,11) on one run
    //   95830448: twin spinies evenly spaced (10,14)+(17,14) on one wide
    //             shelf (the L34 report morphology)
    //   95830457: adjacent spinies (21,16)+(22,16)
    //   95830476: adjacent spinies (20,15)+(21,15)
    //   95830499: adjacent spinies (11,15)+(12,15)
    // INVARIANT (unchanged): no support run ever carries two hostiles. The
    // earlier "the offending cell stands on the shelf as a walker" clause
    // documented the kind-swap replacement; the 2026-11-08 bodies-per-run
    // cap supersedes it on narrow runs — the excess body is now a SKIPPED
    // placement, so the named cell hosts NO hostile (absent or walker), and
    // every run additionally respects max(1, floor(walkRun/3)) bodies.
    const cases = [
        [95830402, [16, 11]],
        [95830448, [17, 14]],
        [95830457, [22, 16]],
        [95830476, [21, 15]],
        [95830499, [12, 15]]
    ];
    let deployedTotal = 0;
    for (const [seed, [dx, dy]] of cases) {
        const level = new Level(23, T, seed);
        for (const [, group] of bySupportRun(level)) {
            expect(hostileCountOn(group)).toBeLessThanOrEqual(1);
        }
        // Density cap mirror: bodies per walkable run <= capacity.
        const counts = new Map();
        const widths = new Map();
        for (const e of level.getEnemyManager().enemies) {
            const cx = Math.round(e.x / T), cy = Math.round(e.y / T);
            const ext = walkRunExtent(level.tiles, level.width, level.height,
                cx, cy, level.pathCells);
            if (!ext) continue;
            const k = `${cy}:${ext.left}`;
            counts.set(k, (counts.get(k) || 0) + 1);
            widths.set(k, ext.right - ext.left + 1);
        }
        for (const [k, n] of counts) {
            expect(n).toBeLessThanOrEqual(
                Math.max(1, Math.floor(widths.get(k) / 3)));
        }
        // The formerly-offending cell hosts no hostile: absent (cap-skipped)
        // or standing as a plain walker (kind-demoted).
        const at = level.getEnemyManager().enemies.find(
            e => Math.round(e.x / T) === dx && Math.round(e.y / T) === dy);
        if (at) expect(at.kind).toBe('walker');
        deployedTotal += level.getEnemyManager().enemies.length;
    }
    // Non-vacuous: the maps still ship their patrols (this is fairness, not
    // an enemy ban).
    expect(deployedTotal).toBeGreaterThanOrEqual(5);
});

test("L34-class vertical maps ship no shared-run hostiles either", () => {
    // The L34 screenshot twin-spiny shelf predates today's deploy-filter
    // wave; verticals measure CLEAN on current code across levels AND the
    // watermark-prefix space. Forensics correction (review): the readable
    // L34 watermark seed 92326931 IS recoverable and pinned below — it
    // rendered its spiny on the ~13:00 f18725e-era bundle; on current code
    // the same seed ships no enemies at all. Pin the property on the
    // vertical level band around L34 so a future vertical threat layer
    // cannot regress it.
    for (const lvl of [31, 34, 37]) {
        for (const seed of [lvl * 1000 + 1, lvl * 1000 + 2, lvl * 1000 + 3,
            92326931, 2158680, 2158760]) {
            const level = new Level(lvl, T, seed);
            for (const [, group] of bySupportRun(level)) {
                expect(hostileCountOn(group)).toBeLessThanOrEqual(1);
            }
        }
    }
});

test("structural sweep L5..L60 x 10 seeds: ZERO shared-run hostile pairs", () => {
    // CI regression pin for the ruling (pre-fix baseline measured 216/960
    // violating maps across L5..100 x 10 seeds, 493 hostile pairs).
    let checkedHostiles = 0;
    for (let lvl = 5; lvl <= 60; lvl++) {
        for (let s = 1; s <= 10; s++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            for (const [, group] of bySupportRun(level)) {
                const n = hostileCountOn(group);
                expect(n).toBeLessThanOrEqual(1);
                checkedHostiles += n;
            }
        }
    }
    // Non-vacuous: legal single hostiles still deploy widely.
    expect(checkedHostiles).toBeGreaterThan(50);
}, 120000); // raised from 30000: routeFair() gate build cost (2026-11-05 soft-lock fix)
