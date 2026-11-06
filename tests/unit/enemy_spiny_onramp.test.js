// Spiny debut on-ramp window (difficulty-curve wave 2026-11-06). During
// L10..SPINY_ONRAMP_LAST_LEVEL(18) hostile rolls face an escalated shelf
// bar: support run >= 6 generally, >= 8 when the final span sweeps a MUST-
// PASS cell (js/level.js header at SPINY_ONRAMP_*). Measured before the
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

function solidRunWidth(tiles, width, x, supportY) {
    const row = tiles[supportY];
    if (!row || row[x] !== 1) return 0;
    let left = x;
    while (left > 0 && row[left - 1] === 1) left--;
    let right = x;
    while (right < width - 1 && row[right + 1] === 1) right++;
    return right - left + 1;
}

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
                    const runW = solidRunWidth(level.tiles, level.width,
                        b.col, b.row + 1);
                    expect(runW).toBeGreaterThanOrEqual(MIN_RUN_ONRAMP);
                    if (mp && runW < ROUTE_MIN_RUN_ONRAMP) {
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
        expect(checkedMaps).toBeGreaterThan(40);
    });

test("window stays non-vacuous: spinies and enemy presence survive the ramp",
    { timeout: 180000 }, () => {
        let spinies = 0, maps = 0, enemies = 0;
        for (let lvl = WINDOW_LO; lvl <= WINDOW_HI; lvl++) {
            for (let i = 0; i < 15; i++) {
                const level = new Level(lvl, T, lvl * 40000 + 24601 + i);
                if (level.direction === 'vertical' || !level.portalTile)
                    continue;
                maps++;
                const es = level.getEnemyManager().enemies;
                enemies += es.length;
                spinies += es.filter(e => e.kind === 'spiny').length;
            }
        }
        // Measured @this wave: 12 spinies over 90 routed maps, mean 3.72
        // enemies/map (HEAD baseline 3.9 — inside the ±15% presence floor).
        expect(maps).toBeGreaterThan(60);
        expect(spinies).toBeGreaterThanOrEqual(6);
        expect(enemies / maps).toBeGreaterThanOrEqual(2.5);
        expect(enemies / maps).toBeLessThanOrEqual(5.0);
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
                    const runW = solidRunWidth(level.tiles, level.width,
                        b.col, b.row + 1);
                    if (runW >= 4 && runW < MIN_RUN_ONRAMP)
                        foundNarrowHostile = true;
                }
            }
        }
        expect(foundNarrowHostile).toBe(true);
    });

// Arm-separation pins (review wave 2026-11-06, M1): the two window clauses
// (general run>=6; route-sweeping run>=8) must EACH be independently
// defended — the sampled morphology above is doubly-justified everywhere, so
// deleting either clause alone kept it green. These seeds were found by an
// independent HEAD-vs-tree kind-diff harness as sites whose ONLY in-window
// justification is the named arm; disabling that arm alone redeploys the
// hostile there and this test fails (mutation-checked both ways).
test("arm separation: each on-ramp clause independently holds on its own seeds",
    { timeout: 60000 }, () => {
        // Seeds where a hostile stands (post-demotion walker) with runW < 6
        // — justified ONLY by the general bar (off-route or wide enough to
        // pass the route arm anyway).
        const GENERAL_ONLY = [
            [16, 664611], [10, 513586], [13, 663600], [16, 813618]
        ];
        // Seeds with runW 6..7 sweeping a must-pass cell — justified ONLY by
        // the route clause (they clear the general bar).
        const ROUTE_ONLY = [
            [12, 504636], [14, 584615], [15, 624629], [17, 863586]
        ];
        const scan = (lvl, seed) => {
            const level = new Level(lvl, T, seed);
            const mp = computeMustPassCells(level.tiles, level.width,
                level.height, level.spawnTile, level.portalTile,
                level.bridgeGap);
            return { level, mp };
        };
        let generalHits = 0, routeHits = 0;
        for (const [lvl, seed] of GENERAL_ONLY) {
            const { level } = scan(lvl, seed);
            for (const b of bodiesOf(level)) {
                if (b.kind === 'walker') continue;
                const runW = solidRunWidth(level.tiles, level.width,
                    b.col, b.row + 1);
                // General-bar invariant on this seed: nothing narrower than 6.
                expect(runW).toBeGreaterThanOrEqual(MIN_RUN_ONRAMP);
            }
            // Non-vacuity: the seed really hosts the narrow-run footprint
            // (a walker standing on a sub-6 run — the demoted deployment).
            const narrowWalker = bodiesOf(level).some(b => b.kind === 'walker'
                && solidRunWidth(level.tiles, level.width, b.col, b.row + 1) < MIN_RUN_ONRAMP);
            if (narrowWalker) generalHits++;
        }
        for (const [lvl, seed] of ROUTE_ONLY) {
            const { level, mp } = scan(lvl, seed);
            for (const b of bodiesOf(level)) {
                if (b.kind === 'walker') continue;
                const runW = solidRunWidth(level.tiles, level.width,
                    b.col, b.row + 1);
                if (runW < ROUTE_MIN_RUN_ONRAMP) {
                    let sweeps = false;
                    for (let x = b.left; x <= b.right; x++)
                        if (mp && mp.has(b.row * level.width + x)) {
                            sweeps = true; break;
                        }
                    expect(sweeps).toBe(false);
                }
            }
            // Non-vacuity: a walker on a 6..7-wide run sweeping must-pass —
            // exactly what the route clause demoted.
            const routeWalker = mp && bodiesOf(level).some(b => {
                if (b.kind !== 'walker') return false;
                const runW = solidRunWidth(level.tiles, level.width,
                    b.col, b.row + 1);
                if (runW < 6 || runW >= ROUTE_MIN_RUN_ONRAMP) return false;
                for (let x = b.left; x <= b.right; x++)
                    if (mp.has(b.row * level.width + x)) return true;
                return false;
            });
            if (routeWalker) routeHits++;
        }
        expect(generalHits).toBeGreaterThanOrEqual(3);
        expect(routeHits).toBeGreaterThanOrEqual(3);
    });

// Vertical application (review wave M1): the general bar has NO direction
// exemption (the route arm is inert there — routeMustPass stays null on
// verticals), so in-window vertical hostiles must also stand on runs >= 6.
test("general on-ramp bar applies to vertical maps too",
    { timeout: 180000 }, () => {
        let vMaps = 0, hostileBodies = 0;
        for (let lvl = WINDOW_LO; lvl <= WINDOW_HI; lvl++) {
            for (let i = 0; i < 40; i++) {
                const level = new Level(lvl, T, lvl * 40000 + 24601 + i);
                if (level.direction !== 'vertical') continue;
                vMaps++;
                for (const b of bodiesOf(level)) {
                    if (b.kind === 'walker') continue;
                    hostileBodies++;
                    const runW = solidRunWidth(level.tiles, level.width,
                        b.col, b.row + 1);
                    expect(runW).toBeGreaterThanOrEqual(MIN_RUN_ONRAMP);
                }
            }
        }
        // Measured @this wave: 120 vertical maps, 2 hostile bodies, 0
        // violations — floors keep the sweep real without over-claiming.
        expect(vMaps).toBeGreaterThanOrEqual(60);
        expect(hostileBodies).toBeGreaterThanOrEqual(1);
    });
