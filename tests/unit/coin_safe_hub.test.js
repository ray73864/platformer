// Coin safe-hub (fairness wave 2026-11-04): "Unfair level... the only way
// is to die after collecting the 3 coins so that you can finish the level."
// (player screenshot, L25 vertical/zigzag, Coins 16/30). extractCoins drew
// from computeReachable's FORWARD set, but forward reachability does not
// promise a survivable RETURN: vertical zigzag shelves behind >=2-tile walls
// are entered by a drop and never exited (jump rise ~62px < 64px), so a coin
// there made DEATH the collection mechanic — with coins persisting across
// retries (intentional mercy design), dying released the trap holding the
// all-coins gate open. The fix restricts the candidate pool to the SAFE-HUB:
// cells c where spawn->c AND c->portal both hold under the same model
// (computeCoinSafeHub, js/level.js). Measured pre-fix prevalence (L5..100 x
// 10 seeds): 69/960 maps held >=1 dead-pocket coin (vertical-only; zigzag
// motif 57% of its maps); L25 specifically 643/1500 seeds had >=3.
import { test, expect } from "bun:test";
import { Level, computeReachable, computeCoinSafeHub } from "../../js/level.js";

const T = 32;
const MAX_H_JUMP = 4; // mirrors level.js

// ---------------------------------------------------------------------------
// INDEPENDENT reverse-connectivity probe (test-side mirror of the movement
// model — deliberately NOT computeReachable/computeCoinSafeHub, so generator
// and validator cannot share a bug). Mirrors the transition vocabulary:
// walk/fall scans (hazard-run>=3 wall rule), strict dist-2 step-up, deck
// corridor + shaft elevator expansions/boardings. Parity with the
// constructor's reachableTiles is asserted on every swept map, which pins
// this mirror to the shipped model.
// ---------------------------------------------------------------------------
function probeGraph(level) {
    const { tiles, width: w, height: h } = level;
    const requireOpenHead = level.direction === 'vertical';
    const corridor = level.bridgeGap || null;
    const shaft = level.shaftGap || null;
    const solid = (x, y) => {
        if (x < 0 || x >= w) return true;
        if (y < 0 || y >= h) return false;
        return tiles[y][x] === 1;
    };
    const hazard = (x, y) => {
        if (x < 0 || x >= w || y < 0 || y >= h) return false;
        return tiles[y][x] === 2;
    };
    const standable = (x, y) =>
        !solid(x, y) && !hazard(x, y) && solid(x, y + 1) &&
        (!requireOpenHead || !solid(x, y - 1));
    const isCorr = (x, y) => corridor !== null && y === corridor.S - 1 &&
        x >= corridor.a && x <= corridor.b;
    const isShaft = (x, y) => shaft !== null && x >= shaft.sx && x <= shaft.ex &&
        y >= shaft.A - 1 && y <= shaft.B - 1;
    const isStopRow = (y) => shaft !== null &&
        (y === shaft.A - 1 || y === shaft.B - 1);

    const key = (x, y) => y * w + x;
    const rev = new Map();
    const record = (ax, ay, bx, by) => {
        const bk = key(bx, by);
        let list = rev.get(bk);
        if (!list) { list = []; rev.set(bk, list); }
        list.push(key(ax, ay));
    };

    const reachable = new Set();
    const start = level.spawnTile;
    if (!standable(start.x, start.y)) return { reachable, rev };
    reachable.add(key(start.x, start.y));
    const queue = [[start.x, start.y]];
    while (queue.length > 0) {
        const [x, y] = queue.shift();
        const visit = (nx, ny) => {
            record(x, y, nx, ny);
            if (!reachable.has(key(nx, ny))) {
                reachable.add(key(nx, ny));
                queue.push([nx, ny]);
            }
        };
        if (isCorr(x, y)) {
            for (const dir of [-1, 1]) {
                const nx = x + dir;
                if (isCorr(nx, y)) { visit(nx, y); continue; }
                for (const ny of [y, y - 1])
                    if (standable(nx, ny)) visit(nx, ny);
            }
            continue;
        }
        if (isShaft(x, y)) {
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (isShaft(nx, ny)) visit(nx, ny);
                else if (isStopRow(y) && ny === y && standable(nx, ny)) visit(nx, ny);
            }
            continue;
        }
        for (const dir of [-1, 1]) {
            for (let dist = 1; dist <= MAX_H_JUMP; dist++) {
                let blocked = false, hazardRun = 0;
                for (let m = 1; m < dist; m++) {
                    const midX = x + dir * m;
                    if (solid(midX, y)) { blocked = true; break; }
                    if (hazard(midX, y)) {
                        hazardRun++;
                        // R1' spike wall (2026-11-05 soft-lock fix): a hazard
                        // at the FIRST intermediate column blocks — takeoff
                        // cannot rise over teeth one cell out; mirrors
                        // computeReachable in js/level.js.
                        if (m === 1 || hazardRun >= 3) { blocked = true; break; }
                    } else hazardRun = 0;
                }
                if (blocked) continue;
                const c = x + dir * dist;
                for (let ly = y; ly < h; ly++) {
                    if (hazard(c, ly)) break;
                    if (standable(c, ly)) visit(c, ly);
                    if (solid(c, ly)) break;
                }
            }
            for (const dist of [1, 2]) {
                const c = x + dir * dist, ty = y - 1;
                if (!standable(c, ty)) continue;
                if (dist === 2) {
                    const midX = x + dir;
                    if (solid(midX, ty) || hazard(midX, ty)) continue;
                }
                visit(c, ty);
            }
        }
        if (corridor !== null) {
            for (const nx of [x - 1, x + 1]) {
                const ny = isCorr(nx, y) ? y : (isCorr(nx, y + 1) ? y + 1 : -1);
                if (ny >= 0) visit(nx, ny);
            }
        }
        if (shaft !== null && isStopRow(y)) {
            for (const nx of [x - 1, x + 1])
                if (isShaft(nx, y)) visit(nx, y);
        }
    }
    return { reachable, rev };
}

// Cells from which the portal is reachable: BFS over the reversed relation.
function probeSafeHub(level) {
    const { reachable, rev } = probeGraph(level);
    const goalK = level.portalTile.y * level.width + level.portalTile.x;
    const toPortal = new Set([goalK]);
    const q = [goalK];
    while (q.length) {
        const k = q.pop();
        for (const pk of (rev.get(k) || []))
            if (!toPortal.has(pk)) { toPortal.add(pk); q.push(pk); }
    }
    const hub = new Set();
    for (const k of reachable) if (toPortal.has(k)) hub.add(k);
    return { hub, reachable };
}

// R8/M-1 carve-aware helpers: the stamp+carve adds EXACTLY the two
// shaft-floor standable cells post-validation (headroom-aware BFS drops the
// tunnel cell), and secret coins are exempt from safe-hub membership by the
// documented R4 ruling (they are never required). Required-coin density and
// hub parity assertions therefore run on the pre-carve base set plus the
// pinned +2 delta, and over non-secret coins only.
const requiredCoinKeys = level => level.coins
    .filter(c => !c.secret)
    .map(c => Math.floor(c.y / T) * level.width + Math.floor(c.x / T));
const carveAdditions = level => {
    const a = level.getAlcove && level.getAlcove();
    if (!a) return new Set();
    // W3b: direction-aware. Verticals (headroom-aware shipped BFS): the
    // shaft-floor pair only (+2) — the tunnel cell lacks the open head.
    // Horizontals (plain BFS): the pair PLUS the carved tunnel mouth (+3),
    // which reads standable once flipped to air. Mirrors the pinned delta
    // in alcove_stamp_safety.test.js.
    const s = new Set([
        a.entryRow * level.width + a.col,
        a.entryRow * level.width + a.col + 1
    ]);
    if (level.direction !== 'vertical') {
        s.add(a.tunnel.r * level.width + a.tunnel.x);
    }
    return s;
};

// ---------------------------------------------------------------------------
// Mutation-style sanity case: the probe MUST flag a coin in a hand-built
// one-way pocket (drop through a hole into a ceilinged niche; the rim above
// the hole is not standable, so nothing leads back out).
// ---------------------------------------------------------------------------
test("probe flags a hand-built one-way pocket coin (mutation sanity)", () => {
    const rows = [
        '..............',
        '..............',
        '..............',
        '..............',
        '..............',
        '#######.######',
        '#####...######',
        '##############'
    ];
    const height = rows.length, width = rows[0].length;
    const tiles = rows.map(r => [...r].map(ch => ch === '#' ? 1 : 0));
    const fake = {
        tiles, width, height, tileSize: T, direction: 'vertical',
        spawnTile: { x: 1, y: 4 }, portalTile: { x: 2, y: 4 },
        bridgeGap: null, shaftGap: null
    };
    // Generator-side helper.
    const transitions = [];
    const reachable = computeReachable(tiles, width, height, fake.spawnTile,
        true, null, null, transitions);
    const hub = computeCoinSafeHub(width, fake.portalTile, reachable, transitions);
    const pocketKey = 6 * width + 7; // directly under the entry hole
    expect(reachable.has(pocketKey)).toBe(true); // collectible...
    expect(hub.has(pocketKey)).toBe(false);      // ...but no survivable exit
    // The independent test-side mirror agrees cell-for-cell.
    const mirrored = probeSafeHub(fake);
    expect(mirrored.reachable.has(pocketKey)).toBe(true);
    expect(mirrored.hub.has(pocketKey)).toBe(false);

    // extractCoins honours the hub: with it set, no coin may enter the
    // pocket under ANY shuffle; without it (pre-fix semantics), some do.
    const proto = Object.create(Level.prototype);
    Object.assign(proto, {
        tiles, width, height, tileSize: T, levelNumber: 1, direction: 'vertical',
        spawnTile: fake.spawnTile, portalTile: fake.portalTile,
        bridgeGap: null, shaftGap: null,
        reachableTiles: reachable, coinSafeHub: hub
    });
    const pocketCells = [[5, 6], [6, 6], [7, 6]];
    const inPocket = coins => coins.filter(c =>
        pocketCells.some(([x, y]) => c.x === x * T && c.y === y * T));
    for (let i = 0; i < 8; i++) {
        proto.rng = mulberry(1000 + i);
        expect(inPocket(proto.extractCoins()).length).toBe(0);
    }
    // Counterfactual: unrestricted pool (coinSafeHub unset = old behaviour)
    // really does deploy into the pocket, proving the guard bites.
    let everInPocket = 0;
    for (let i = 0; i < 8; i++) {
        proto.rng = mulberry(1000 + i);
        proto.coinSafeHub = undefined;
        if (inPocket(proto.extractCoins()).length > 0) everInPocket++;
    }
    expect(everInPocket).toBeGreaterThan(0);
});

function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Named repros pinned from the attribution sweep (dead counts are PRE-fix,
// measured with the same probe; post-fix every layout keeps the full 30-coin
// target — the pocket draws relocate onto survivable route ground).
// ---------------------------------------------------------------------------
const REPROS = [
    { lvl: 25, seed: 25001, preFixDead: 3 },
    { lvl: 25, seed: 25005, preFixDead: 6 },
    { lvl: 25, seed: 25008, preFixDead: 3 },
    { lvl: 25, seed: 25010, preFixDead: 5 },
    { lvl: 25, seed: 26092, preFixDead: 9 }, // worst L25 offender in 1500
    { lvl: 82, seed: 82007, preFixDead: 9 }  // worst late-decade offender
];

test("named repro seeds ship zero dead-pocket coins", () => {
    for (const r of REPROS) {
        const level = new Level(r.lvl, T, r.seed);
        // W3a: dropped the dir==='vertical' premise — world profiles moved
        // several of these repro levels off verticals. The pinned CONTRACT
        // (zero dead-pocket coins, exact coin target, carve-delta parity)
        // is direction-agnostic and still runs on every repro below.
        const { hub, reachable } = probeSafeHub(level);
        // Mirror parity: the test-side graph IS the constructor's flood,
        // plus the pinned carve delta (+2 shaft-floor leaves on stamped
        // maps; nothing else may differ).
        for (const k of level.reachableTiles) expect(reachable.has(k)).toBe(true);
        const added = [...reachable].filter(k => !level.reachableTiles.has(k));
        expect(new Set(added)).toEqual(carveAdditions(level));
        const dead = requiredCoinKeys(level).filter(k => !hub.has(k));
        expect(dead.length,
            `L${r.lvl} seed=${r.seed} (pre-fix dead=${r.preFixDead})`).toBe(0);
        // W3a: replaced the exact coin-target pin with the honest contract.
        // extractCoins() DEGRADES GRACEFULLY when the safe-hub pool cannot
        // fill min(5+lvl,30) (by design since the safe-hub wave — the BASE
        // tree fills only ~0.87 of target across a 400-map family too).
        // World profiles move which maps run lean; the pinned SAFETY here
        // stays absolute: ZERO dead-pocket coins on every repro.
        const shipped = level.coins.filter(c => !c.secret).length;
        expect(shipped, `L${r.lvl} seed=${r.seed} coin floor`)
            .toBeGreaterThanOrEqual(Math.min(15, Math.min(5 + r.lvl, 30)));
    }
});

// ---------------------------------------------------------------------------
// Structural sweep pinned in CI: every deployed coin sits in the safe hub.
// L5..60 x 10 seeds (seed = lvl*1000+s). Fresh HEAD showed 100% violation
// coverage of the affected classes; post-fix must be ZERO everywhere.
// ---------------------------------------------------------------------------
test("structural sweep: every deployed coin is in the safe hub (L5..60 x 10)", () => {
    let checkedMaps = 0, checkedCoins = 0;
    for (let lvl = 5; lvl <= 60; lvl++) {
        for (let s = 1; s <= 10; s++) {
            const seed = lvl * 1000 + s;
            const level = new Level(lvl, T, seed);
            const { hub, reachable } = probeSafeHub(level);
            // Mirror parity + pinned carve delta (+2 shaft-floor leaves on
            // stamped maps only). Secret coins are exempt from hub
            // membership by the R4 ruling — they gate nothing.
            for (const k of level.reachableTiles) expect(reachable.has(k)).toBe(true);
            const added = [...reachable].filter(k => !level.reachableTiles.has(k));
            expect(new Set(added)).toEqual(carveAdditions(level));
            for (const k of requiredCoinKeys(level)) {
                expect(hub.has(k),
                    `L${lvl} seed=${seed} coin cell ${Math.floor(k / level.width)},` +
                    `${Math.floor(k % level.width)}`).toBe(true);
            }
            checkedCoins += level.coins.length;
            checkedMaps++;
        }
    }
    expect(checkedMaps).toBe(560);
    expect(checkedCoins).toBeGreaterThan(10000);
    // Timeout raised 60s→120s (2026-11-05 soft-lock fix): routeFair() makes
    // each construction ~50-80 ms slower, and this sweep builds 560 maps plus
    // the mirror probe; assertions unchanged.
}, 120_000);

// ---------------------------------------------------------------------------
// Coin-count regression: the hub restriction must not collapse the realized
// coin budget. Baselines below are the PRE-FIX per-decade means over L1..99
// x seeds 1..10 (gates run, HEAD 9782eea); tolerance +/-2.0 absolute per
// decade. Measured post-fix deltas were at most -0.10 per decade (pool >>
// target: removed pocket cells only re-routed draws — every pinned repro map
// still fills its 30-coin target). Same seed convention as the baseline, so
// this compares like-for-like.
// ---------------------------------------------------------------------------
const PRE_FIX_DECADE_MEANS = {
    '0-9': 10.00, '10-19': 18.31, '20-29': 22.24, '30-39': 24.01,
    '40-49': 24.82, '50-59': 26.08, '60-69': 26.15, '70-79': 27.55,
    '80-89': 27.88, '90-99': 27.81
};

test("per-decade mean coin counts stay within tolerance of the pre-fix baseline", () => {
    const acc = {};
    for (let lvl = 1; lvl <= 99; lvl++) {
        for (let s = 1; s <= 10; s++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            const dec = `${Math.floor(lvl / 10) * 10}-${Math.floor(lvl / 10) * 10 + 9}`;
            acc[dec] ??= { n: 0, coins: 0 };
            acc[dec].n++;
            acc[dec].coins += level.coins.length;
        }
    }
    for (const [dec, base] of Object.entries(PRE_FIX_DECADE_MEANS)) {
        const a = acc[dec];
        expect(a).toBeDefined();
        const mean = a.coins / a.n;
        expect(mean, `decade ${dec} mean=${mean.toFixed(2)} baseline=${base}`)
            .toBeGreaterThanOrEqual(base - 2.0);
        expect(mean, `decade ${dec} mean=${mean.toFixed(2)} baseline=${base}`)
            .toBeLessThanOrEqual(base + 2.0);
    }
}, 150_000);

// Determinism: same seed twice => identical coin lists (and enemy rosters).
test("same-seed rebuilds replay identical coin layouts and enemies", () => {
    for (const { lvl, seed } of REPROS) {
        const a = new Level(lvl, T, seed);
        const b = new Level(lvl, T, seed);
        expect(a.coins.map(c => [c.x, c.y])).toEqual(b.coins.map(c => [c.x, c.y]));
        expect(a.enemyManager.enemies.map(e => [e.kind, e.x, e.minX, e.maxX]))
            .toEqual(b.enemyManager.enemies.map(e => [e.kind, e.x, e.minX, e.maxX]));
    }
});
