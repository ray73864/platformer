// Hostile shelf-width gate measures the WRONG run (owner report 2026-11-10,
// live play, screenshots confirmed): L15 seed 4233801065 deployed a stomp-
// immune SPINY on a 2-tile ledge that is the ONLY traverse (its sweep covers
// mandatory cell col 18), with a required coin floating directly in its kill
// shadow — "I have no way at all to get that coin without dying". Root cause:
// the gate sized the shelf with solidRunWidth() — contiguous SOLID tiles on
// the support row BELOW the spawn — while every other fairness consumer
// (patrolSpan, density caps, portal-shelf rule) sizes the maximal WALKABLE
// run the player perceives (walkRunExtent: blocks on rock/spikes above the
// surface). On mesa staircases (CANYON grammar) the solid mass below reads
// ~10 wide while the standable ledge is 2 cols, silently bypassing both
// HOSTILE_MIN_RUN and the debut-window bars. These pins measure with
// walkRunExtent exactly like the controller's prevalence probe
// (/tmp/opencode/fairness-l15/prevalence.mjs): a deployed non-walker must
// never stand where the WALKABLE run is below the applicable bar (steady 4;
// <=L18 general 6, route-sweeping 8). Pre-fix baseline over this exact
// family: 73/594 maps hosted >=1 sub-bar hostile (83 bodies) — stable-red.
import { test, expect } from "bun:test";
import { Level, walkRunExtent, computeMustPassCells } from "../../js/level.js";

const T = 32;

// Deterministic family (fixed formula, fixed counts): L11..40 x 15 seeds +
// L45..100 step 5 x 12 seeds = 594 tier>=2 maps (tierIndexFor boundaries
// [5,10,25,50,75]), covering the L11..40 owner band and the debut window.
function* family() {
    for (let lvl = 11; lvl <= 40; lvl++)
        for (let i = 0; i < 15; i++)
            yield [lvl, (lvl * 1000003 + i * 7919 + 12345) >>> 0];
    for (let lvl = 45; lvl <= 100; lvl += 5)
        for (let i = 0; i < 12; i++)
            yield [lvl, (lvl * 1000003 + i * 7919 + 12345) >>> 0];
}

test("no deployed hostile stands on a walkable run below its bar (L11..100 family)", { timeout: 120_000 }, () => {
    // Mirror of prevalence.mjs' violation logic (plus the m3 bridgeGap
    // seam-fix above): measure the run with
    // walkRunExtent (blocked=null view — the player-perceived ledge), bar 4
    // steady; inside the debut window (<=SPINY_ONRAMP_LAST_LEVEL=18) 6
    // general and 8 when the patrol span sweeps a computeMustPassCells cell.
    let maps = 0, hostiles = 0;
    const violations = [];
    for (const [lvl, seed] of family()) {
        let level;
        try { level = new Level(lvl, T, seed); } catch { continue; }
        maps++;
        const spawn = level.getSpawnTile();
        const portal = level.getPortal();
        const pt = portal && {
            x: Math.floor((portal.x + portal.width / 2) / T),
            y: Math.floor((portal.y + portal.height / 2) / T)
        };
        let mustPass = new Set();
        try {
            // F1 FIX ROUND 1 (review m3): bridgeGap passed through, matching
            // the shipped gate's call — the controller probe omitted it,
            // which OVERCOUNTS must-pass cells (a live bridge corridor adds
            // connectivity, removing articulations). Stricter-mirror was
            // fine while green; passing it keeps the pin faithful to what
            // the route clause actually sees. Moot in-window today
            // (survivors ~nil), material for future bands.
            mustPass = computeMustPassCells(
                level.tiles, level.width, level.height, spawn, pt,
                level.bridgeGap) || new Set();
        } catch { /* mirror the probe's tolerance */ }
        const inWindow = lvl <= 18;
        for (const e of level.enemyManager.enemies) {
            if (e.kind === 'walker') continue;
            hostiles++;
            const feetRow = Math.round((e.y + e.height) / T);
            const colL = Math.floor(e.x / T);
            const run = walkRunExtent(level.tiles, level.width,
                level.height, colL, feetRow - 1);
            const w = run ? run.right - run.left + 1 : 0;
            let sweepsRoute = false;
            for (const k of mustPass) {
                const my = Math.floor(k / level.width), mx = k % level.width;
                if (run && my === feetRow - 1 &&
                    mx >= run.left && mx <= run.right) {
                    sweepsRoute = true; break;
                }
            }
            const bar = inWindow ? (sweepsRoute ? 8 : 6) : 4;
            if (w < bar) violations.push(`L${lvl} s${seed} ${e.kind} ` +
                `walkRun=${w} bar=${bar} route=${sweepsRoute}`);
        }
    }
    expect(maps).toBeGreaterThan(500);
    // Non-vacuous: legal hostiles keep deploying (this is a gate, not a ban).
    expect(hostiles).toBeGreaterThan(50);
    expect(violations).toEqual([]);
});

// --- In-window GENERAL bar fixture (mutation coverage for the debut ramp) --
// The family pin above cannot isolate the general onramp bar (in-window
// hostiles overwhelmingly sit on route-sweeping spans, so the route clause
// masks the general one). This hand-built pillar measures the FINAL span
// directly: band [9,14] clamps the right edge, so a pillar starting at col 9
// gives span width = min(pillarWidth, 6). Inside the debut window a width-5
// span must stand down even though the steady bar is 4; width 6 must still
// carry hostiles (gate, not ban). Route clause stays inert here: the swapped
// grid disconnects spawn->portal, so computeMustPassCells returns null.
function windowFixture(lvl, seed, pillarWidth) {
    const level = new Level(lvl, T, seed);
    // The fixture owns its geometry wholesale (same discipline as the
    // shelf-fairness fixtures): drop construction descriptors and pin the
    // direction the spawn-scan needs.
    level.bridgeGap = null;
    level.shaftGap = null;
    level.direction = "right";
    const W = 20;
    const H = 10;
    level.width = W;
    level.height = H;
    const tiles = Array.from({ length: H }, () => Array(W).fill(0));
    for (let c = 9; c < 9 + pillarWidth; c++) {
        tiles[6][c] = 1;
        tiles[7][c] = 1;
    }
    tiles[5][11] = 4;
    level.tiles = tiles;
    level.reachableTiles = new Set([5 * W + 11]);
    level.spawnEnemies();
    return level;
}

test("debut-window general bar: 5-wide span stands down, 6-wide still bites", () => {
    for (const lvl of [15, 18]) {
        for (let s = 1; s <= 30; s++) {
            for (const width of [4, 5]) {
                const kinds = windowFixture(lvl, s * 7, width)
                    .getEnemyManager().enemies.map(e => e.kind);
                expect(kinds).toEqual(['walker']);
            }
        }
        // Non-vacuous: with the bar met (span 6) hostile rolls fire and
        // survive on some seeds — the rule sizes shelves, it does not ban.
        let sawHostile = false;
        for (let s = 1; s <= 30; s++) {
            for (const k of windowFixture(lvl, s * 7, 6)
                .getEnemyManager().enemies.map(e => e.kind)) {
                if (k !== 'walker') sawHostile = true;
            }
        }
        expect(sawHostile).toBe(true);
    }
}, 60_000); // suite-timeout hygiene: ~3s solo brushes bun's 5s default under parallel load

// --- Concrete regression pin: the owner's exact map ------------------------
// BASE expectations recorded pre-fix at HEAD 0f2965e from
// LEVELJS=<base-tree>/level.js bun record-base.mjs (t-f1 scratch). The fix
// may swap KINDS downward only (spiny/charger/bombardier -> walker); terrain,
// coins, enemy COUNT and every patrol bound stay byte-stable because the
// demotion rides the existing no-re-roll discipline.
const BASE_L15 = {
    tilesHash: 2819211669,
    coinsHash: 3102443955,
    enemies: [
        { kind: 'spiny', x: 576, y: 480, minX: 576, maxX: 640 },
        { kind: 'walker', x: 480, y: 512, minX: 480, maxX: 576 }
    ]
};

function fnv(str, h = 0x811c9dc5) {
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

test("owner repro L15 s4233801065: the terrace body at col 18 stands down to walker", () => {
    const level = new Level(15, T, 4233801065);
    const enemies = level.enemyManager.enemies;

    // Terrain + coins byte-identical to BASE (the gate changes kind, never a
    // grid cell; kind rolls happen after extractCoins).
    expect(level.tiles.reduce((h, row) => fnv(row.join(''), h), 0x811c9dc5))
        .toBe(BASE_L15.tilesHash);
    expect(level.getCoins().reduce((h, c) => fnv(`${c.x},${c.y};`, h),
        0x811c9dc5)).toBe(BASE_L15.coinsHash);

    // Enemy COUNT byte-stable (demotion keeps the body, never drops it).
    expect(enemies.length).toBe(BASE_L15.enemies.length);
    for (let i = 0; i < BASE_L15.enemies.length; i++) {
        const base = BASE_L15.enemies[i];
        const e = enemies[i];
        // Patrol bounds byte-stable.
        expect([e.x, e.y, e.minX, e.maxX]).toEqual([base.x, base.y,
            base.minX, base.maxX]);
        // Kinds may swap ONLY hostile -> walker.
        expect(base.kind === e.kind ? true : e.kind === 'walker').toBe(true);
    }

    // THE fix assertion: the body on tile col 18 row 15 (the sole-traverse
    // 2-col terrace whose sweep covers mandatory cell col 18) is stompable.
    const terrace = enemies.find(e => e.x === 18 * T && e.y === 15 * T);
    expect(terrace).toBeDefined();
    expect(terrace.kind).toBe('walker');
});
