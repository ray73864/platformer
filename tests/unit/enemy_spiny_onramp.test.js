// Spiny debut on-ramp window (difficulty-curve wave 2026-11-06). During
// L10..SPINY_ONRAMP_LAST_LEVEL(18) hostile rolls face an escalated shelf
// bar: FINAL walkable patrol span >= 6 generally, >= 8 when the span sweeps
// a MUST-PASS cell (js/level.js header at SPINY_ONRAMP_*; F1 2026-11-10
// moved the measurement from the old solid-run view to the deployed patrol
// span — the pre-F1 numbers quoted below were taken under that old metric,
// see the correction note at HOSTILE_MIN_RUN). Measured before the
// rule: every spiny deployed in-window stood on the mandatory traverse
// (15/15 over L10..16 x 30 seeds), half on runs < 6, at the exact tier step
// where enemy presence jumps 1.68 -> 2.95 -> 3.38 hostiles/map (L9/L10 ->
// L11 -> L12+); the round-2/round-3 browser
// curve reproduces a decade-2 wall (L11-20 clears 1/10 + 2/10 vs 6/10 in
// decade 1). The rule swaps lethality for spectacle only: terrain byte-
// identical, enemy COUNT per map unchanged, kinds never re-rolled, every
// fairness gate untouched. These tests pin the shipped morphology, its
// non-vacuity floors (the window must still ship spinies and enemies), and
// that the escalation is WINDOW-SCOPED (past L18 the steady-state floor of
// 4 applies again — pinned by finding legal narrow-run hostiles outside).
import { test, expect } from "bun:test";
import { Level, computeMustPassCells } from "../../js/level.js";

const T = 32;
const WINDOW_LO = 10;   // SPINY_FIRST_LEVEL
const WINDOW_HI = 18;   // SPINY_ONRAMP_LAST_LEVEL
const MIN_RUN_ONRAMP = 6;
const ROUTE_MIN_RUN_ONRAMP = 8;

// F1 FIX ROUND 1 (review m2): the old solidRunWidth helper was dropped with
// its last caller — every measurement here now reads the FINAL patrol span
// back from deployed bounds (bodiesOf left/right), matching the gate.
function bodiesOf(level) {
    return level.getEnemyManager().enemies.map(e => ({
        col: Math.floor((e.x + e.width / 2) / T),
        row: Math.floor((e.y + e.height - 0.001) / T),
        left: Math.round(e.minX / T),
        right: Math.ceil(e.maxX / T) - 1,
        kind: e.kind
    }));
}

test("on-ramp morphology holds across the sampled debut window",
    { timeout: 180000 }, () => {
        let checkedMaps = 0;
        for (let lvl = WINDOW_LO; lvl <= WINDOW_HI; lvl++) {
            for (let i = 0; i < 10; i++) {
                const level = new Level(lvl, T, lvl * 40000 + 24601 + i);
                if (level.direction === 'vertical' || !level.portalTile)
                    continue;
                checkedMaps++;
                const mp = computeMustPassCells(level.tiles, level.width,
                    level.height, level.spawnTile, level.portalTile,
                    level.bridgeGap);
                for (const b of bodiesOf(level)) {
                    if (b.kind === 'walker') continue;
                    // F1 FIX ROUND 1 (review m2): measure what the gate
                    // ENFORCES — the FINAL patrol span read back from the
                    // deployed bounds (was solidRunWidth, the pre-F1 metric
                    // this file was written against). Post-F1 the sampled
                    // windows ship walkers only, so this sweep runs
                    // vacuously today; it stays as the universal invariant
                    // guard for whenever wide in-window seats appear.
                    const spanW = b.right - b.left + 1;
                    expect(spanW).toBeGreaterThanOrEqual(MIN_RUN_ONRAMP);
                    if (mp && spanW < ROUTE_MIN_RUN_ONRAMP) {
                        let sweeps = false;
                        for (let x = b.left; x <= b.right; x++)
                            if (mp.has(b.row * level.width + x)) {
                                sweeps = true; break;
                            }
                        expect(sweeps).toBe(false);
                    }
                }
            }
        }
        // W3a: world dirCycles shift how many in-window levels roll
        // horizontal routed maps (measured exactly 40 now); floor relaxed one
        // notch below observation — this guards vacuity, not a level count.
        expect(checkedMaps).toBeGreaterThan(35);
    });

test("window stays non-vacuous: spinies and enemy presence survive the ramp",
    { timeout: 180000 }, () => {
        let maps = 0, enemies = 0;
        for (let lvl = WINDOW_LO; lvl <= WINDOW_HI; lvl++) {
            for (let i = 0; i < 15; i++) {
                const level = new Level(lvl, T, lvl * 40000 + 24601 + i);
                if (level.direction === 'vertical' || !level.portalTile)
                    continue;
                maps++;
                const es = level.getEnemyManager().enemies;
                enemies += es.length;
            }
        }
        // Measured @this wave: 12 spinies over 90 routed maps, mean 3.72
        // enemies/map (HEAD baseline 3.9 — inside the ±15% presence floor).
        // RE-BASELINED 2026-11-08 for the owner density ruling (bodies-per-
        // run cap + portal-shelf protection): mean is now 1.60 enemies/map
        // over the same band (spinies 8) because shared-run clustering WAS
        // the bulk of teen-tier enemy count — pre-rule, 54% of maps stacked
        // more bodies on one walkable run than max(1, floor(runTiles/3))
        // allows. This floor tracks non-vacuity (the window must still ship
        // patrols), not the old density level; the fairness ruling INTEN-
        // TIONALLY trades raw presence for per-run readability (see
        // BODIES_PER_RUN_DIVISOR in js/level.js and task-2-report.md for the
        // measured cost/bot A/B). Floor set well under observation.
        // W3a: same dirCycle effect as above — exactly 60 routed maps now.
        // F1 RE-PINNED 2026-11-10: the shelf gate now measures the body's
        // FINAL WALKABLE span (solidRunWidth overcounted mesa ledges — see
        // the correction note at HOSTILE_MIN_RUN). Every sampled in-window
        // hostile stood on a sub-6 walkable ledge and stands down: measured
        // spinies 0 over these 60 routed maps (was 8 under the old metric —
        // exactly the illegal class the owner reported from live play,
        // L15 s4233801065). Enemy PRESENCE floors stay exactly where the
        // density ruling put them (mean 2.55 here); only the debut-window
        // kind mix changed. Kind non-vacuity moves just past the window
        // below, where legal wide-run spinies keep deploying. Graduating
        // in-window debuts back up is an upstream marker-economy wave (wide
        // standable seating at marker time), NOT a loosening of these bars.
        expect(maps).toBeGreaterThan(55);
        expect(enemies / maps).toBeGreaterThanOrEqual(1.2);
        expect(enemies / maps).toBeLessThanOrEqual(5.0);
    });

test("hostile kinds stay non-vacuous just past the window",
    { timeout: 180000 }, () => {
        // F1 companion pin 2026-11-10: with the corrected width source the
        // debut window ships zero spinies (no legal seats at today's marker
        // economy) — the KIND must still exist right after the ramp, or the
        // gate has silently become a ban. Measured: 5 spinies over 60
        // routed L19..26 maps (floor set well under observation).
        let spinies = 0, maps = 0;
        for (let lvl = 19; lvl <= 26; lvl++) {
            for (let i = 0; i < 15; i++) {
                const level = new Level(lvl, T, lvl * 40000 + 24601 + i);
                if (level.direction === 'vertical' || !level.portalTile)
                    continue;
                maps++;
                spinies += level.getEnemyManager().enemies
                    .filter(e => e.kind === 'spiny').length;
            }
        }
        expect(maps).toBeGreaterThan(55);
        expect(spinies).toBeGreaterThanOrEqual(3);
    });

test("escalation is window-scoped: past L18 hostiles deploy on 4-wide runs",
    { timeout: 180000 }, () => {
        let foundNarrowHostile = false;
        for (let lvl = 19; lvl <= 26 && !foundNarrowHostile; lvl++) {
            for (let i = 0; i < 20 && !foundNarrowHostile; i++) {
                const level = new Level(lvl, T, lvl * 40000 + 24601 + i);
                if (level.direction === 'vertical') continue;
                for (const b of bodiesOf(level)) {
                    if (b.kind === 'walker') continue;
                    // F1 FIX ROUND 1 (review m2): FINAL span now (was
                    // solidRunWidth) — a past-L18 hostile standing on a
                    // 4..5-wide span proves the escalated bar 6 is NOT
                    // applied outside the window (measured post-fix:
                    // L23 s944604 spiny on span 4).
                    const spanW = b.right - b.left + 1;
                    if (spanW >= 4 && spanW < MIN_RUN_ONRAMP)
                        foundNarrowHostile = true;
                }
            }
        }
        expect(foundNarrowHostile).toBe(true);
    });

// Arm-separation pins (review wave 2026-11-06 M1; converted to fixtures in
// F1 FIX ROUND 1, review m2): the two window clauses (general span >= 6;
// route-sweeping span >= 8) must EACH be independently defended. The old
// seed-list version attributed arms via solidRunWidth footprints on natural
// maps; post-F1 the gate reads the FINAL clamped span and every sampled
// in-window site is sub-6 walkable (windows ship walkers only), so the
// reviewer mutation-proved both old lists vacuous (route bar->0 passed;
// general bar 6->4 passed). Fixtures below force a hostile roll (rng
// scripted into the spiny band) on hand-built in-window states where
// exactly ONE clause can block, making each arm's demotion directly
// attributable AND mutation-visible: disabling the general bar turns the
// pillar-5 body spiny (RED); zeroing the route bar turns the corridor body
// spiny (RED).
function armPillarFixture(pillarWidth) {
    // Disconnected single shelf: spawn/portal point off-grid, so
    // computeMustPassCells returns null and the route clause is provably
    // inert — only the general bar can bite. Band [9,14] clamps a pillar
    // starting at col 9 to span width min(pillarWidth, 6).
    const level = new Level(15, T, 12345);
    const W = 20, H = 10;
    level.width = W; level.height = H;
    level.direction = 'right';
    level.bridgeGap = null; level.shaftGap = null; level.pathCells = null;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (let c = 9; c < 9 + pillarWidth; c++) {
        tiles[6][c] = 1;
        tiles[7][c] = 1;
    }
    tiles[5][11] = 4;
    level.tiles = tiles;
    level.reachableTiles = new Set([5 * W + 11]);
    level.rng = () => 0.0;   // scripted: the roll lands in the spiny band
    level.spawnEnemies();
    return level;
}

function armCorridorFixture(withPortal) {
    // Flat full-width floor walked end-to-end spawn(2,5)->portal(17,5): the
    // movement model marks articulation cells along the traverse (measured
    // cols 5/9/13), so a patroller on the band-clamped span [9,14] sweeps
    // MUST-PASS cells and faces the route clause's bar 8 while clearing the
    // general bar 6. Identical geometry and roll with portalTile nulled:
    // routeMustPass stays null (protectPortalShelf passes everything
    // through — single body, unaffected), so survival vs stand-down
    // isolates the route arm alone.
    const level = new Level(15, T, 12345);
    const W = 20, H = 10;
    level.width = W; level.height = H;
    level.direction = 'right';
    level.bridgeGap = null; level.shaftGap = null; level.pathCells = null;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (let c = 0; c < W; c++) {
        tiles[6][c] = 1;
        tiles[7][c] = 1;
    }
    tiles[5][10] = 4;
    level.tiles = tiles;
    level.spawnTile = { x: 2, y: 5 };
    level.portalTile = withPortal ? { x: 17, y: 5 } : null;
    level.reachableTiles = new Set();
    for (let c = 0; c < W; c++) level.reachableTiles.add(5 * W + c);
    level.rng = () => 0.0;
    level.spawnEnemies();
    return level;
}

test("arm separation: each on-ramp clause independently holds (fixtures)", () => {
    // GENERAL arm: span 5 fails bar 6 while the route clause is inert...
    expect(armPillarFixture(5).getEnemyManager().enemies.map(e => e.kind))
        .toEqual(['walker']);
    // ...and span 6 passes it (gate, not ban).
    expect(armPillarFixture(6).getEnemyManager().enemies.map(e => e.kind))
        .toEqual(['spiny']);
    // ROUTE arm precondition: the corridor's must-pass set really crosses
    // the patroller's span, which clears the general bar.
    const pre = armCorridorFixture(true);
    const b = bodiesOf(pre)[0];
    expect([b.left, b.right]).toEqual([9, 14]);
    const mp = computeMustPassCells(pre.tiles, pre.width, pre.height,
        pre.spawnTile, pre.portalTile, pre.bridgeGap);
    let sweeps = false;
    for (let x = b.left; x <= b.right; x++)
        if (mp && mp.has(b.row * pre.width + x)) { sweeps = true; break; }
    expect(sweeps).toBe(true);
    // A 6-wide span CLEARS the general bar, so its stand-down is the route
    // clause alone...
    expect(b.kind).toBe('walker');
    // ...and the identical state without the route computation deploys the
    // very same scripted roll as a spiny.
    expect(armCorridorFixture(false).getEnemyManager().enemies
        .map(e => e.kind)).toEqual(['spiny']);
});

// Vertical application (review wave M1): the general bar has NO direction
// exemption (the route arm is inert there — routeMustPass stays null on
// verticals), so in-window vertical hostiles must also stand on runs >= 6.
test("general on-ramp bar applies to vertical maps too",
    { timeout: 180000 }, () => {
        let vMaps = 0;
        for (let lvl = WINDOW_LO; lvl <= WINDOW_HI; lvl++) {
            for (let i = 0; i < 40; i++) {
                const level = new Level(lvl, T, lvl * 40000 + 24601 + i);
                if (level.direction !== 'vertical') continue;
                vMaps++;
                for (const b of bodiesOf(level)) {
                    if (b.kind === 'walker') continue;
                    // F1 2026-11-10: measure what the gate ENFORCES — the
                    // final walkable span (was solidRunWidth, which
                    // overcounts wherever rock/spikes block the walk row).
                    const spanW = b.right - b.left + 1;
                    expect(spanW).toBeGreaterThanOrEqual(MIN_RUN_ONRAMP);
                }
            }
        }
        // Measured @this wave: 120 vertical maps, 2 hostile bodies, 0
        // violations — floors keep the sweep real without over-claiming.
        // F1 RE-PINNED 2026-11-10: under the corrected width source every
        // sampled in-window vertical ledge is sub-6 walkable, so measured
        // hostile bodies are now 0 over 200 vertical maps (the old 2 sat on
        // solid masses whose walk row was blocked — the illegal class). The
        // >= 6 invariant above stays universal and simply runs vacuously
        // until marker seating offers wide vertical ledges in-window.
        expect(vMaps).toBeGreaterThanOrEqual(60);
    });
