// Coin/patrol coexistence (player ruling 2026-11-04): "Enemies can't walk
// through coins, I think they should be able to, it's only me that collides
// with them to pick them up." The runtime was always true to that — enemies
// have ZERO interaction with coins: Collectibles.checkCollection tests the
// PLAYER AABB only (collectibles.js checkCollection), Enemy/EnemyManager
// never reference coins at all, and main.js calls checkCollection(this.player)
// exactly once per frame (main.js update loop). What lied was GENERATION:
// extractCoins excluded every patrol-covered tile from its candidate pool.
// That exclusion is removed; these tests pin the runtime truth (an enemy
// sweeping through a coin leaves it uncollected, the player collects it),
// and the placement consequence (coins really do land inside patrol spans
// now — pre-fix structurally 0%, post-fix ~100% of enemy-bearing maps).
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";
import { Collectibles } from "../../js/collectibles.js";
import { EnemyManager } from "../../js/enemies.js";

const T = 32;
const DT = 1 / 60;

test("runtime: an enemy patrolling THROUGH a coin never collects it", () => {
    // 4 tiles of open patrol with a coin dead-centre in the sweep lane.
    const manager = new EnemyManager();
    manager.addEnemy(0, 0, 0, 4 * T);
    const collectibles = new Collectibles();
    collectibles.addCoin(2 * T + 8, 8); // squarely inside the patrol lane
    const farPlayer = { x: 100 * T, y: 0, width: 28, height: 32 };

    let overlapFrames = 0;
    for (let i = 0; i < 600; i++) { // 10 s: several full round trips
        manager.updateAll(DT);
        const e = manager.enemies[0];
        const coin = collectibles.getCoins()[0];
        if (e.x < coin.x + coin.width && e.x + e.width > coin.x) {
            overlapFrames++;
        }
        expect(collectibles.checkCollection(farPlayer)).toBe(0);
    }
    // The sweep really did pass through the coin, many times over...
    expect(overlapFrames).toBeGreaterThan(30);
    // ...and the coin survived every pass.
    expect(collectibles.getCoins()[0].collected).toBe(false);
    expect(collectibles.getScore()).toBe(0);

    // Only the player collects it.
    const coin = collectibles.getCoins()[0];
    expect(collectibles.checkCollection(
        { x: coin.x, y: coin.y, width: 28, height: 32 })).toBe(1);
    expect(collectibles.getCoins()[0].collected).toBe(true);
});

test("generation: coins really place inside patrol spans (exclusion removed)", { timeout: 60000 }, () => {
    let enemyMaps = 0, mapsWithCoinOnPatrol = 0, coinsOnPatrol = 0;
    for (let lvl = 5; lvl <= 40; lvl++) {
        for (let s = 1; s <= 8; s++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            const enemies = level.getEnemyManager().enemies;
            if (enemies.length === 0) continue;
            enemyMaps++;
            const covered = new Set();
            for (const e of enemies) {
                const y = e.y / T;
                for (let c = e.minX / T; c <= (e.maxX - T) / T; c++) {
                    covered.add(`${c},${y}`);
                }
            }
            let hits = 0;
            for (const coin of level.getCoins()) {
                if (covered.has(`${coin.x / T},${coin.y / T}`)) hits++;
            }
            coinsOnPatrol += hits;
            if (hits > 0) mapsWithCoinOnPatrol++;
        }
    }
    // Pre-fix this was structurally zero (candidate exclusion); it must now
    // be visibly nonzero on essentially every enemy-bearing map.
    expect(enemyMaps).toBeGreaterThan(50);
    expect(mapsWithCoinOnPatrol).toBeGreaterThan(0);
    expect(coinsOnPatrol).toBeGreaterThan(0);
    expect(mapsWithCoinOnPatrol / enemyMaps).toBeGreaterThan(0.5);
});

test("a generated coin sitting on a patrol tile is collectable by the player", () => {
    // End-to-end shape of the ruling on a REAL seeded map: find a coin
    // inside a live patrol, drop the player's AABB onto it, collect.
    for (let lvl = 5; lvl <= 40; lvl++) {
        for (let seed = 1; seed <= 8; seed++) {
            const level = new Level(lvl, T, lvl * 1000 + seed);
            const enemies = level.getEnemyManager().enemies;
            if (enemies.length === 0) continue;
            const covered = new Set();
            for (const e of enemies) {
                const y = e.y / T;
                for (let c = e.minX / T; c <= (e.maxX - T) / T; c++) {
                    covered.add(`${c},${y}`);
                }
            }
            const coin = level.getCoins()
                .find(c => covered.has(`${c.x / T},${c.y / T}`));
            if (!coin) continue;
            expect(level.getCollectibles().checkCollection(
                { x: coin.x, y: coin.y, width: 28, height: 32 })).toBe(1);
            return; // first hit proves it
        }
    }
    expect.unreachable('no seeded L5..40 map placed a coin on a patrol span');
});

test("draw order: coins render IN FRONT of patrolling enemies", () => {
    // Ruling 2026-11-04 z-order half: a sweeping body must never occlude
    // the pickup it walks through (legibility + all-coins findability).
    // Vector-fallback renderer: enemy bodies are exact 32x32 fillRects at
    // the enemy origin, coin fallbacks are arcs at the coin centre — the
    // recorded op stream pins every coin arc after every enemy body rect.
    const level = new Level(9, T, 9001);
    expect(level.getEnemyManager().enemies.length).toBeGreaterThan(0);
    const ops = [];
    const ctx = {
        fillStyle: '', strokeStyle: '', lineWidth: 0,
        fillRect: (x, y, w, h) => ops.push(['rect', x, y, w, h]),
        strokeRect: () => {},
        beginPath: () => {},
        arc: (x, y, r) => ops.push(['arc', x, y, r]),
        fill: () => {},
        moveTo: () => {}, lineTo: () => {}
    };
    level.draw(ctx); // no sprite layer -> deterministic vector fallbacks
    const enemyBodies = level.getEnemyManager().enemies
        .map(e => ops.findIndex(o =>
            o[0] === 'rect' && o[1] === e.x && o[2] === e.y &&
            o[3] === 32 && o[4] === 32));
    expect(enemyBodies.every(i => i >= 0)).toBe(true);
    const lastEnemy = Math.max(...enemyBodies);
    for (const coin of level.getCoins()) {
        if (coin.collected) continue;
        const arcIdx = ops.findIndex(o =>
            o[0] === 'arc' && o[1] === coin.x + coin.width / 2 &&
            o[2] === coin.y + coin.height / 2);
        expect(arcIdx, `coin at ${coin.x},${coin.y} not drawn`).toBeGreaterThan(-1);
        expect(arcIdx, `coin at ${coin.x},${coin.y} drawn under enemies`)
            .toBeGreaterThan(lastEnemy);
    }
});
