// Unit: M4 interestingness metrics + preference score (pure functions over
// finished levels). Graph counterexamples pin routeForks (Menger via node-
// splitting max-flow), distribution cases pin greedGradient's formula, a
// geometry fixture pins enemyAsTool, and the discrete-physics caveat around
// the stomp-tool band gets an empirical tripwire (same measurement family as
// the Task 5 pad-apex pin).
import { test, expect } from "bun:test";
import {
    buildBaseGraph, routeForks, greedGradient, enemyAsTool,
    interestingnessProfile, interestingnessScore,
    FORK_CAP, WEIGHT_SECRET
} from "../../js/metrics.js";
import { Player } from "../../js/player.js";
import { Physics } from "../../js/physics.js";
import { EnemyManager } from "../../js/enemies.js";

const T = 32;

// Minimal Level-shaped graph fixture: cells + directed transitions.
function graphLevel(w, spawnKey, portalKey, edges) {
    const cells = new Set();
    const modelTransitions = [];
    for (const [a, b] of edges) {
        cells.add(a);
        cells.add(b);
        modelTransitions.push({
            ax: a % w, ay: Math.floor(a / w), bx: b % w, by: Math.floor(b / w)
        });
    }
    return {
        width: w, height: 99, tileSize: T,
        reachableTiles: cells, modelTransitions,
        spawnTile: { x: spawnKey % w, y: Math.floor(spawnKey / w) },
        portalTile: { x: portalKey % w, y: Math.floor(portalKey / w) },
        coins: [], tiles: [], enemyManager: { enemies: [] },
        getAlcove: () => null
    };
}

test("routeForks: single corridor counts 1", () => {
    // 0 - 1 - 2 - 3 (row of 4 cells, bidirectional walk edges)
    const w = 4;
    const edges = [[0, 1], [1, 2], [2, 3]];
    const both = [...edges, ...edges.map(([a, b]) => [b, a])];
    expect(routeForks(buildBaseGraph(graphLevel(w, 0, 3, both)))).toBe(1);
});

test("routeForks: two internally disjoint corridors count 2", () => {
    // s -> a -> b -> t  and  s -> c -> d -> t share only endpoints.
    const w = 10;
    const S = 0, A = 1, B = 2, C = 3, D = 4, Pt = 5;
    const e = [[S, A], [A, B], [B, Pt], [S, C], [C, D], [D, Pt]];
    const both = [...e, ...e.map(([a, b]) => [b, a])];
    expect(routeForks(buildBaseGraph(graphLevel(w, S, Pt, both)))).toBe(2);
});

test("routeForks: a shared articulation cell caps the count at 1", () => {
    // Two loops that rejoin through ONE bridge cell before the portal.
    const w = 10;
    const S = 0, A = 1, B = 2, M = 3, Pt = 4; // M = mandatory bridge
    const e = [[S, A], [A, M], [S, B], [B, M], [M, Pt]];
    const both = [...e, ...e.map(([a, b]) => [b, a])];
    expect(routeForks(buildBaseGraph(graphLevel(w, S, Pt, both)))).toBe(1);
});

test("routeForks: three disjoint lanes count 3 (and normalize at FORK_CAP)", () => {
    const w = 20;
    const S = 0, Pt = 1;
    const e = [];
    for (let lane = 0; lane < 3; lane++) {
        const a = 2 + lane * 2, b = 3 + lane * 2;
        e.push([S, a], [a, b], [b, Pt]);
    }
    const both = [...e, ...e.map(([a, b]) => [b, a])];
    expect(routeForks(buildBaseGraph(graphLevel(w, S, Pt, both)))).toBe(3);
    expect(FORK_CAP).toBe(3);
});

// Greed fixtures: a straight corridor map with coins placed to shape the
// distance-from-route distribution, plus one deep dead-end branch supplying
// far-outlier distances. Corridor row 9 cols 0..9; branch up col 4 to row 0.
function corridorLevel(coinCells) {
    const w = 12, h = 12;
    const key = (x, y) => y * w + x;
    const cells = new Set();
    const edges = [];
    for (let x = 0; x <= 9; x++) cells.add(key(x, 9));
    for (let x = 0; x < 9; x++) edges.push([key(x, 9), key(x + 1, 9)], [key(x + 1, 9), key(x, 9)]);
    for (let y = 8; y >= 0; y--) {
        cells.add(key(4, y));
        const from = y === 8 ? key(4, 9) : key(4, y + 1);
        edges.push([from, key(4, y)], [key(4, y), from]);
    }
    const modelTransitions = edges.map(([a, b]) => ({
        ax: a % w, ay: Math.floor(a / w), bx: b % w, by: Math.floor(b / w)
    }));
    return {
        width: w, height: h, tileSize: T,
        reachableTiles: cells, modelTransitions,
        spawnTile: { x: 0, y: 9 }, portalTile: { x: 9, y: 9 },
        tiles: [], enemyManager: { enemies: [] },
        coins: coinCells.map(([x, y]) => ({
            x: x * T, y: y * T, width: 16, height: 16, collected: false
        })),
        getAlcove: () => null
    };
}

test("greedGradient: uniform ring scores below near-cluster + far-outlier", () => {
    // Uniform: evenly spread along the route (all D=0) -> sigma 0, no far flag.
    const uniform = corridorLevel([[2, 9], [4, 9], [6, 9], [8, 9]]);
    // Bimodal: free route-side coins PLUS outliers deep in the branch.
    const bimodal = corridorLevel([[2, 9], [3, 9], [4, 2], [4, 1], [4, 8]]);
    const gu = greedGradient(uniform);
    const gb = greedGradient(bimodal);
    expect(gu.score).toBeLessThan(gb.score);
    expect(gb.near).toBe(true);
    expect(gb.far).toBe(true);
    expect(gb.score).toBeGreaterThan(0);
    expect(gb.score).toBeLessThanOrEqual(1);
});

test("greedGradient: empty coin set degrades to zero, never NaN", () => {
    const g = greedGradient(corridorLevel([]));
    expect(g.score).toBe(0);
    expect(Number.isNaN(g.sigma)).toBe(false);
});

// ── ENEMY-AS-TOOL geometry fixture ─────────────────────────────────────────

function toolLevel(shelfCol, patrolCols, withWalker = true) {
    // Canonical setup: walker body row 8 on floor row 9; slab row 6+... per
    // the metric's geometry — shelf standable cell at row 6 (free), slab
    // solid at row 7, walker lane row 8 open under the slab, lane floor row 9
    // solid. Shelf floor line sits exactly two body rows above the patrol
    // floor: plain jump (<= ~60 px discrete) fails it, stomp apex from the
    // 32 px head is the intended key.
    const w = 16, h = 10;
    const tiles = Array.from({ length: h }, () => Array(w).fill(0));
    for (let x = 0; x < w; x++) tiles[9][x] = 1;
    if (shelfCol >= 0) {
        tiles[7][shelfCol] = 1; // slab under the shelf cell
    }
    const enemies = withWalker ? [{
        kind: 'walker',
        y: 8 * T,
        minX: patrolCols[0] * T,
        maxX: (patrolCols[1] + 1) * T
    }] : [];
    return {
        width: w, height: h, tileSize: T, tiles,
        reachableTiles: new Set(), modelTransitions: [],
        spawnTile: { x: 0, y: 8 }, portalTile: { x: 15, y: 8 },
        coins: [], enemyManager: { enemies },
        getAlcove: () => null
    };
}

test("enemyAsTool fires on the canonical shelf-over-patrol geometry", () => {
    const r = enemyAsTool(toolLevel(8, [7, 9]));
    expect(r.count).toBeGreaterThanOrEqual(1);
    expect(r.shelves.some((s) => s.row === 6 && s.col === 8)).toBe(true);
});

test("enemyAsTool rejects: no walker, walker out of reach, or easy way up", () => {
    expect(enemyAsTool(toolLevel(8, [7, 9], false)).count).toBe(0);
    expect(enemyAsTool(toolLevel(8, [0, 1])).count).toBe(0); // patrol too far
    // A ledge one row ABOVE the shelf gives plain access -> isolation broken.
    const lvl = toolLevel(8, [7, 9]);
    lvl.tiles[6][9] = 1; // (5,9) becomes standable one row above the shelf
    expect(enemyAsTool(lvl).count).toBe(0);
});

test("empirical tripwire: the DISCRETE stomp band is currently empty", () => {
    // The predicate speaks SPEC continuous math (plain rise 62.5 px fails a
    // 64 px shelf; bounce apex 32+34.5 clears it). The shipped fixed-dt
    // integrator tells a tighter story: measure both rises for real and pin
    // that NO grid-aligned shelf currently lands inside (plain, stomp]. If
    // this flips, the metric lights up for real — revisit weights then.
    const plats = [];
    for (let x = 0; x < 20; x++) plats.push({ x: x * T, y: 10 * T, width: T, height: T });
    const terrain = {
        tileSize: T, width: 20, height: 12,
        isSolidPx: (px, py) => {
            const c = Math.floor(px / T), r = Math.floor(py / T);
            if (c < 0 || c >= 20) return true;
            if (r < 0 || r >= 12) return false;
            return r === 10;
        }
    };
    const DT = 1 / 60;
    // Plain jump rise.
    const p = new Player(5 * T, 9 * T, 200, 350);
    const ph = new Physics(980, 600);
    p.pressJump();
    let minY = p.y + p.height;
    for (let f = 0; f < 90; f++) {
        p.update(DT, false, false, {});
        ph.applyGravity(p, DT);
        ph.resolveCollisions(p, ph.checkCollisions(p, plats));
        minY = Math.min(minY, p.y + p.height);
        if (p.grounded && f > 5) break;
    }
    const plainRise = 10 * T - minY;
    expect(plainRise).toBeGreaterThan(55);
    expect(plainRise).toBeLessThan(64); // fails the 2-row shelf line
    // Best-case stomp apex above the patrol FLOOR LINE (bounce point is the
    // 32 px head top): brute-force approach timing like the scratch probe.
    let bestApex = 0;
    for (let startX = 3; startX <= 7; startX += 0.25) {
        for (let delay = 0; delay <= 40; delay++) {
            const pm = { updateAll: () => ({ hitPlayer: false }), terrain };
            const em = new EnemyManager();
            em.addEnemy(8 * T, 9 * T, 6 * T, 12 * T, 'walker', { projectiles: pm, terrain });
            const q = new Player(startX * T, 9 * T, 200, 350);
            const qh = new Physics(980, 600);
            let stomped = false, lo = Infinity;
            for (let f = 0; f < 240; f++) {
                q.prevX = q.x; q.prevY = q.y;
                if (f === delay) q.pressJump();
                q.update(DT, false, true, {});
                qh.applyGravity(q, DT);
                qh.resolveCollisions(q, qh.checkCollisions(q, plats));
                em.updateAll(DT, q);
                const c = em.resolvePlayerContact(q);
                if (c.stomped > 0 && !stomped) {
                    stomped = true;
                    q.vy = -260; // main.js STOMP_BOUNCE
                    q.coyoteTimer = 0;
                    q.jumpCutAvailable = false;
                }
                if (stomped) lo = Math.min(lo, q.y + q.height);
                if (stomped && q.vy >= 0 && q.grounded) break;
            }
            if (stomped && Number.isFinite(lo)) bestApex = Math.max(bestApex, 10 * T - lo);
        }
    }
    expect(bestApex).toBeGreaterThan(40);
    expect(bestApex).toBeLessThan(64); // band (plain, stomp] stays empty today
});

// ── Preference profile wiring ──────────────────────────────────────────────

test("interestingnessProfile: secret flag adds exactly WEIGHT_SECRET, ties are deterministic", () => {
    const base = corridorLevel([[2, 9], [4, 2]]);
    const p0 = interestingnessProfile(base);
    const withSecret = { ...base, getAlcove: () => ({ col: 1 }) };
    const p1 = interestingnessProfile(withSecret);
    expect(p1.secret).toBe(true);
    expect(p1.score - p0.score).toBeCloseTo(WEIGHT_SECRET, 10);
    // Determinism: identical inputs -> byte-identical profiles.
    expect(JSON.stringify(interestingnessProfile(base)))
        .toBe(JSON.stringify(interestingnessProfile(corridorLevel([[2, 9], [4, 2]]))));
    // Score helper agrees.
    expect(interestingnessScore(withSecret)).toBe(p1.score);
});
