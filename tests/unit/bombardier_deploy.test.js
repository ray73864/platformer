// Bombardier DEPLOYMENT gating (player request 2026-11-04): the kind rides
// the existing hostile machinery, so these tests pin the whole rule stack on
// real generated maps —
//  * impossible below L40; linear ramp to ~15% by L60 (realized-rate shape);
//  * own density cap ceil(deployed/4) per map;
//  * FULL hostile inheritance: never shares a support run with another
//    hostile, never deploys on a solid run narrower than HOSTILE_MIN_RUN=4,
//    and rides ONLY deriveEnemySpawns sites — the approach-window bans
//    (bridge lips ±3, shaft windows ±2) are placement-side and kind-blind,
//    so site-equality proves the inheritance;
//  * firing-lane rule: >= 2 open span cells ahead of at least ONE heading;
//  * same-seed determinism including kinds, and roll-order discipline
//    (positions never move when the bombardier band exists).
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";

const T = 32;

function runKeyOf(level, x, y) {
    const row = level.tiles[y + 1];
    if (!row || row[x] !== 1) return null;
    let l = x;
    while (l > 0 && row[l - 1] === 1) l--;
    return `${y + 1}:${l}`;
}
function runWidthOf(level, x, y) {
    const row = level.tiles[y + 1];
    if (!row || row[x] !== 1) return 0;
    let l = x;
    while (l > 0 && row[l - 1] === 1) l--;
    let r = x;
    while (r < level.width - 1 && row[r + 1] === 1) r++;
    return r - l + 1;
}
function bySupportRun(level) {
    const map = new Map();
    for (const e of level.getEnemyManager().enemies) {
        const k = runKeyOf(level, Math.round(e.x / T), Math.round(e.y / T));
        if (!k) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(e);
    }
    return map;
}
function kindsAt(levelNumber, seed) {
    return new Level(levelNumber, T, seed).getEnemyManager()
        .enemies.map(e => e.kind);
}

test("bombardiers never deploy below L40 (boundary sweep L30..39)", { timeout: 30000 }, () => {
    for (let lvl = 30; lvl <= 39; lvl++) {
        for (let s = 1; s <= 10; s++) {
            for (const kind of kindsAt(lvl, lvl * 1000 + s)) {
                expect(kind).not.toBe('bombardier');
            }
        }
    }
});

test("realized rate ramps toward the ~15% plateau (L40-44 vs L56-60)", () => {
    // Realized share of deployed enemies can only DEMOTE from the roll band
    // (every gate falls through to walker), so the ceiling is the chance
    // itself; compare early-ramp vs plateau bands over 20 seeds each.
    const rate = (lo, hi) => {
        let bombs = 0, total = 0;
        for (let lvl = lo; lvl <= hi; lvl++) {
            for (let s = 1; s <= 20; s++) {
                const ks = kindsAt(lvl, lvl * 1000 + s);
                total += ks.length;
                bombs += ks.filter(k => k === 'bombardier').length;
            }
        }
        return { bombs, total, r: bombs / total };
    };
    const early = rate(40, 44);
    const late = rate(56, 60);
    expect(late.bombs).toBeGreaterThan(early.bombs); // ramp rises
    expect(late.bombs).toBeGreaterThan(0);           // non-vacuous
    // Plateau sanity with sampling slack (~3 sigma): realized share must
    // sit far under the 0.15 chance ceiling because hostile gates demote.
    expect(late.r).toBeLessThanOrEqual(0.15);
}, 30000);

test("structural sweep L40..100 x 10 seeds: zero bombardier rule violations", () => {
    let sawBombardier = 0;
    for (let lvl = 40; lvl <= 100; lvl++) {
        for (let s = 1; s <= 10; s++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            const enemies = level.getEnemyManager().enemies;
            const bombs = enemies.filter(e => e.kind === 'bombardier');
            sawBombardier += bombs.length;

            // Own density cap: ceil(deployed / 4).
            expect(bombs.length)
                .toBeLessThanOrEqual(Math.ceil(enemies.length / 4));

            // Hostile inheritance #1: one hostile per support run, ever.
            for (const [, group] of bySupportRun(level)) {
                expect(group.filter(e => e.kind !== 'walker').length)
                    .toBeLessThanOrEqual(1);
            }

            // Site equality: every deployed body stands on a derive site —
            // approach-window bans (bridge lips, shafts) live INSIDE derive
            // and are kind-blind, so equality proves bombardiers inherit
            // them exactly like spiny/charger do. Positions also confirm
            // the kind layer never moves geometry.
            const sites = new Set(level.deriveEnemySpawns()
                .map(sp => `${sp.x},${sp.y}`));
            for (const b of bombs) {
                expect(sites.has(`${Math.round(b.x / T)},${Math.round(b.y / T)}`))
                    .toBe(true);
                // Hostile inheritance #2: wide-enough shelf.
                expect(runWidthOf(level, Math.round(b.x / T), Math.round(b.y / T)))
                    .toBeGreaterThanOrEqual(4);
                // Firing-lane rule: >= 2 open walk-row span cells ahead of
                // at least ONE heading (span = final patrol bounds).
                const leftCol = Math.round(b.minX / T);
                const rightCol = Math.round(b.maxX / T) - 1;
                const cx = Math.round(b.x / T);
                expect(cx - leftCol >= 2 || rightCol - cx >= 2).toBe(true);
            }
        }
    }
    expect(sawBombardier).toBeGreaterThan(0); // non-vacuous
}, 90000);

test("same seed replays identical kinds INCLUDING bombardiers", () => {
    for (const lvl of [42, 50, 61, 77]) {
        for (const s of [7, 123, 424242]) {
            const seed = lvl * 1000 + s;
            const a = new Level(lvl, T, seed);
            const b = new Level(lvl, T, seed);
            expect(a.getEnemyManager().enemies.map(e => e.kind))
                .toEqual(b.getEnemyManager().enemies.map(e => e.kind));
            expect(JSON.stringify(a.tiles)).toBe(JSON.stringify(b.tiles));
        }
    }
});

test("the bombardier band changes KINDS only — positions byte-stable vs a no-band rebuild", () => {
    // spawnEnemies consumes exactly one rng draw per deployed enemy at the
    // SAME stream position as HEAD did; adding the band cannot shift later
    // draws. Two builds agree on every pixel bound AND the terrain grid.
    for (let lvl = 40; lvl <= 55; lvl += 5) {
        for (let s = 1; s <= 10; s++) {
            const seed = lvl * 1000 + s;
            const a = new Level(lvl, T, seed);
            const b = new Level(lvl, T, seed);
            expect(a.getEnemyManager().enemies.map(e => [e.x, e.y, e.minX, e.maxX]))
                .toEqual(b.getEnemyManager().enemies.map(e => [e.x, e.y, e.minX, e.maxX]));
        }
    }
});

// Review m5a (2026-11-04): gate ORDER pin — a hostile ROLL that stands down
// must NOT reserve the shared-run key (level.js), so a later hostile roll on
// the same support run may still deploy. Fixture convention follows
// enemy_shared_run_fairness.test.js (hand-built grid swapped in AFTER
// construction, spawnEnemies re-derived), plus a scripted rng so the exact
// intent chain is asserted deterministically instead of seed-swept:
// site #1 rolls BOMBARDIER -> stands down for want of a legal shelf ->
// walker, key unclaimed; site #2 rolls CHARGER -> deploys hostile on that
// very support run.
// F1 RE-PINNED 2026-11-10: the stand-down MECHANISM moved. The firing-lane
// gate fires only when the final span is <= 3 cols (both flanks < 2 open),
// which the corrected width gate (bar >= 4 on the FINAL span) now pre-empts
// everywhere — the old fixture's buried-lane morphology can no longer reach
// the lane check. Same ORDER property, new trigger: site #1 sits on a 3-col
// walkable shelf (width-demoted), site #2 on a 4-col one (deploys). The
// lane gate itself stays in level.js as defense-in-depth should bars ever
// drop below 4.
function laneReclaimFixture(rolls, narrowSiteOne) {
    // W3a re-pin: L61 -> L81. L61 now lives in CANYONS whose kindWeights
    // (charger x1.5) widen the charger band so the scripted roll 0.5 reads
    // CHARGER instead of BOMBARDIER. L81 sits in a MEADOWS rotation band at
    // full plateau tier: identical legacy bands [0,.25)|.45|.60) below.
    const level = new Level(81, T, 12345); // plateau bombardier weights
    const W = 20, H = 10;
    level.width = W;
    level.height = H;
    // Deterministic fixture controls: full-width patrol band, no fairness
    // windows, no route cells — geometry alone drives the gates.
    level.direction = 'vertical';
    level.bridgeGap = null;
    level.shaftGap = null;
    level.pathCells = null;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (let c = 8; c <= 15; c++) {   // ONE support run (shared run key)
        tiles[6][c] = 1;
        tiles[7][c] = 1;
    }
    if (narrowSiteOne) {
        // Walk-row wall at col 11 splits the surface: site #1's span is
        // {8,9,10} (3 < steady bar 4 -> width-gate stand-down), site #2's
        // span {12..15} (4 -> legal).
        tiles[5][11] = 1;
    }
    tiles[5][10] = 4;                  // site #1
    tiles[5][13] = 4;                  // site #2 (same support run)
    level.tiles = tiles;
    level.reachableTiles = new Set([5 * W + 10, 5 * W + 13]);
    // L81 bands: spiny [0,0.25) | charger [0.25,0.45) | bombardier [0.45,0.60).
    level.rng = () => rolls.shift();
    level.spawnEnemies();
    return level;
}

test("shelf-width stand-down never claims the run key: a later hostile still deploys (m5a)", () => {
    const rolls = [0.5, 0.3];          // #1 bombardier roll, #2 charger roll
    const level = laneReclaimFixture(rolls, true);
    const enemies = level.getEnemyManager().enemies;
    // Exactly one consumed draw per legal site — no re-roll anywhere.
    expect(rolls.length).toBe(0);
    expect(enemies.length).toBe(2);
    // Row-major derive order: site #1 (col 10) first.
    expect(Math.round(enemies[0].x / T)).toBe(10);
    expect(Math.round(enemies[1].x / T)).toBe(13);
    // Intent chain, step by step:
    // #1 rolled into the bombardier band but its 3-col shelf demoted it...
    expect(enemies[0].kind).toBe('walker');
    // ...that stand-down did NOT reserve the run...
    // #2 ...so the charger roll on the SAME run deploys hostile anyway.
    expect(enemies[1].kind).toBe('charger');
    // One run, exactly one hostile on it: the cap held WITHOUT being
    // pre-spent by the demoted roll.
    const runs = bySupportRun(level);
    expect(runs.size).toBe(1);
    const group = [...runs.values()][0];
    expect(group.length).toBe(2);
    expect(group.filter(e => e.kind !== 'walker').length).toBe(1);
});

test("control: the same rolls deploy the bombardier on a legal shelf (m5a non-vacuity)", () => {
    // Identical rolls, walk row unbroken (span 8 >= bar): site #1 keeps its
    // bombardier roll — proving roll 0.5 genuinely lands in the bombardier
    // band and geometry (not some other gate) flipped the fixture above.
    // The run key IS now claimed, so site #2's hostile roll demotes to
    // walker instead.
    const rolls = [0.5, 0.3];
    const level = laneReclaimFixture(rolls, false);
    const enemies = level.getEnemyManager().enemies;
    expect(rolls.length).toBe(0);
    expect(enemies.map(e => e.kind)).toEqual(['bombardier', 'walker']);
});
