import { test, expect } from "bun:test";
import { Enemy, EnemyManager } from "../../js/enemies.js";
import { Level, computeReachable } from "../../js/level.js";

// Enemies are 32x32 and patrol [minX, maxX] in pixel space, reversing (and
// clamping, never overshooting) when a body edge touches a bound. Speed is
// 50 px/s. Contact uses strict </> so touching edges do not count.

function mockCtx() {
    const ctx = { fillStyle: null, strokeStyle: null, lineWidth: null };
    ctx.fillRectCalls = 0;
    ctx.fillRect = () => {
        ctx.fillRectCalls++;
    };
    return ctx;
}

test("Enemy patrols between boundaries", () => {
    const enemy = new Enemy(100, 100, 50, 200);

    enemy.update(0.016); // ~60 FPS

    // Moves right initially at 50 px/s, staying inside the patrol range.
    expect(enemy.x).toBeGreaterThan(100);
    expect(enemy.x).toBeLessThanOrEqual(200 - enemy.width);
});

test("Enemy reverses at right boundary without overshooting", () => {
    const enemy = new Enemy(180, 100, 50, 200);

    enemy.update(0.016);

    // Clamped flush against the right bound and heading left.
    expect(enemy.x).toBe(200 - enemy.width);
    expect(enemy.vx).toBeLessThan(0);
});

test("Enemy reverses at left boundary without overshooting", () => {
    const enemy = new Enemy(50, 100, 50, 200);
    enemy.vx = -enemy.speed; // Start moving left

    enemy.update(0.016);

    // Clamped flush against the left bound and heading right.
    expect(enemy.x).toBe(50);
    expect(enemy.vx).toBeGreaterThan(0);
});

test("Enemy stays within patrol bounds across many updates", () => {
    const enemy = new Enemy(100, 100, 50, 200);

    let observedMin = Infinity;
    let observedMax = -Infinity;
    // 20 simulated seconds: several full traversals of the 150px-wide range.
    for (let i = 0; i < 1200; i++) {
        enemy.update(1 / 60);
        observedMin = Math.min(observedMin, enemy.x);
        observedMax = Math.max(observedMax, enemy.x + enemy.width);
    }

    expect(observedMin).toBeGreaterThanOrEqual(50);
    expect(observedMax).toBeLessThanOrEqual(200);
    // It really did patrol both ends, not sit still.
    expect(observedMin).toBe(50);
    expect(observedMax).toBe(200);
});

test("Enemy detects player collision", () => {
    const enemy = new Enemy(100, 100, 50, 200);
    const player = { x: 110, y: 100, width: 32, height: 32 };

    expect(enemy.checkCollision(player)).toBe(true);
});

test("Enemy contact treats touching edges as no collision", () => {
    const enemy = new Enemy(100, 100, 50, 200);

    // Player right edge sits exactly on the art-matched lethal box's left
    // edge (body x + 4px inset = 104).
    const touching = { x: 72, y: 104, width: 32, height: 28 };
    expect(enemy.checkCollision(touching)).toBe(false);

    // One pixel deeper overlaps: strict </> boundary sensitivity.
    const overlapping = { x: 73, y: 104, width: 32, height: 28 };
    expect(enemy.checkCollision(overlapping)).toBe(true);
});

test("Enemy has kill behavior", () => {
    const enemy = new Enemy(100, 100, 50, 200);

    expect(enemy.isDead()).toBe(false);

    enemy.die();

    expect(enemy.isDead()).toBe(true);
});

test("Dead enemy does not move", () => {
    const enemy = new Enemy(100, 100, 50, 200);
    enemy.die();

    enemy.update(0.016);

    expect(enemy.x).toBe(100);
});

test("Dead enemy does not draw", () => {
    const enemy = new Enemy(100, 100, 50, 200);
    enemy.die();
    const ctx = mockCtx();

    enemy.draw(ctx);

    expect(ctx.fillRectCalls).toBe(0);
});

test("EnemyManager addEnemy stores enemies and getActiveEnemies filters dead", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 100, 50, 200);
    manager.addEnemy(300, 100, 250, 400);

    expect(manager.enemies.length).toBe(2);
    expect(manager.getActiveEnemies().length).toBe(2);

    manager.enemies[0].die();

    expect(manager.getActiveEnemies().length).toBe(1);
    expect(manager.getActiveEnemies()[0]).toBe(manager.enemies[1]);
});

test("EnemyManager updateAll moves every live enemy", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 100, 50, 200);
    manager.addEnemy(300, 100, 250, 400);
    const second = manager.enemies[1];
    second.die();

    manager.updateAll(0.016);

    expect(manager.enemies[0].x).toBeGreaterThan(100);
    expect(second.x).toBe(300); // Dead: untouched
});

test("EnemyManager checkPlayerCollisions aggregates contacts", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 100, 50, 200);
    manager.addEnemy(300, 100, 250, 400);

    // Overlaps only the second enemy.
    const nearSecond = { x: 310, y: 100, width: 32, height: 32 };
    expect(manager.checkPlayerCollisions(nearSecond)).toBe(true);

    // Overlaps neither.
    const farAway = { x: 0, y: 0, width: 32, height: 32 };
    expect(manager.checkPlayerCollisions(farAway)).toBe(false);
});

test("EnemyManager ignores dead enemies for collisions and drawing", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 100, 50, 200);
    const player = { x: 110, y: 100, width: 32, height: 32 };

    manager.enemies[0].die();

    expect(manager.checkPlayerCollisions(player)).toBe(false);

    const ctx = mockCtx();
    manager.drawAll(ctx);
    expect(ctx.fillRectCalls).toBe(0);
});

// --- Level integration -------------------------------------------------------

// Synthetic 20x15 grid: solid floor row y=12 over columns 0-9 and 12-19, with
// a bottomless pit at columns 10-11 (jumpable: 3-column gap). Standing row is
// y=11 on both shelves.
function twoShelfGrid() {
    const tiles = Array(15).fill(null).map(() => Array(20).fill(0));
    for (let x = 0; x < 20; x++) {
        if (x === 10 || x === 11) continue;
        tiles[12][x] = 1;
    }
    return tiles;
}

function levelWithGrid(tiles) {
    const level = new Level(1, 32);
    level.tiles = tiles;
    level.reachableTiles = computeReachable(
        tiles,
        level.width,
        level.height,
        level.spawnTile
    );
    return level;
}

test("Level wires an EnemyManager instance and exposes it via getEnemyManager", () => {
    const level = new Level(1, 32);
    const manager = level.getEnemyManager();

    expect(manager).toBeInstanceOf(EnemyManager);
    // The generator only emits type-4 enemy tiles from level 5 on, so an
    // early level spawns none; the wiring itself must still hold.
    expect(manager.enemies).toEqual([]);
});

test("spawnEnemies places enemies on standable reachable tiles with geometry-derived bounds", () => {
    const tiles = twoShelfGrid();
    // Markers sit inside the patrol band (x ∈ [6, w-6] for 'right'):
    // deriveEnemySpawns skips markers outside it, matching what the
    // generator can actually emit.
    tiles[11][7] = 4; // Left shelf
    tiles[11][13] = 4; // Right shelf, across the pit
    const level = levelWithGrid(tiles);

    level.spawnEnemies();

    const enemies = level.getEnemyManager().enemies;
    expect(enemies.length).toBe(2);

    // Body rests inside the standable air tile (same convention as the
    // player spawn): bottom edge sits on the solid tile below.
    const left = enemies[0];
    expect(left.x).toBe(7 * 32);
    expect(left.y).toBe(11 * 32);
    // Patrol spans the walkable run under the walk row (columns 0-9 stop
    // at the pit) clamped to the band: columns 6..9, so 192..320 px. The
    // clamp keeps patrols out of the spawn zone and portal band (I3).
    expect(left.minX).toBe(6 * 32);
    expect(left.maxX).toBe(10 * 32);

    const right = enemies[1];
    expect(right.x).toBe(13 * 32);
    expect(right.y).toBe(11 * 32);
    // Columns 12-19 clamped to band max w-6=14: 384..480 px.
    expect(right.minX).toBe(12 * 32);
    expect(right.maxX).toBe(15 * 32);
});

test("spawnEnemies skips markers outside the patrol band", () => {
    const tiles = twoShelfGrid();
    tiles[11][2] = 4; // Spawn-zone column (x < 6)
    tiles[11][17] = 4; // Beyond band max (w-6 = 14)
    const level = levelWithGrid(tiles);

    level.spawnEnemies();

    expect(level.getEnemyManager().enemies).toEqual([]);
});

test("spawnEnemies skips non-standable tiles", () => {
    const tiles = twoShelfGrid();
    tiles[13][4] = 4; // Buried inside the solid mass
    tiles[9][7] = 4; // Floating: air below, nothing to stand on
    const level = levelWithGrid(tiles);

    level.spawnEnemies();

    expect(level.getEnemyManager().enemies).toEqual([]);
});

test("spawnEnemies skips unreachable tiles", () => {
    const tiles = twoShelfGrid();
    // Isolated high shelf at row 5-6: standable but nothing leads up to it
    // (max climb is one tile per jump and the floor is six rows below).
    tiles[6][15] = 1;
    tiles[6][16] = 1;
    tiles[5][15] = 4;
    const level = levelWithGrid(tiles);

    level.spawnEnemies();

    expect(level.getEnemyManager().enemies).toEqual([]);
});

test("spawnEnemies is idempotent across repeated calls", () => {
    const tiles = twoShelfGrid();
    tiles[11][7] = 4;
    const level = levelWithGrid(tiles);

    level.spawnEnemies();
    level.spawnEnemies();

    expect(level.getEnemyManager().enemies.length).toBe(1);
});

test("patrol bounds are clamped to the band within level bounds", () => {
    const tiles = twoShelfGrid();
    tiles[11][6] = 4; // Run extends into the excluded spawn zone columns
    tiles[11][14] = 4; // Run extends into the excluded portal columns
    const level = levelWithGrid(tiles);

    level.spawnEnemies();

    const enemies = level.getEnemyManager().enemies;
    expect(enemies.length).toBe(2);
    for (const enemy of enemies) {
        expect(enemy.minX).toBeGreaterThanOrEqual(0);
        expect(enemy.maxX).toBeLessThanOrEqual(level.width * level.tileSize);
    }
    // The band clamp, not the wall, decides the bounds now: never sweep
    // spawn zone columns 0-5 or portal-band columns 16-19.
    expect(enemies[0].minX).toBe(6 * 32);
    expect(enemies[1].maxX).toBe(15 * 32);
});

test("hitbox is inset from the body: edge-adjacent player is safe", () => {
    const enemy = new Enemy(100, 200, 100, 200);

    // Player right edge flush with the BODY rect right edge (x=132): still
    // outside the art-matched lethal box (inset 4px per side).
    const brushing = { x: 100 - 32 + 2, y: 204, width: 32, height: 28 };
    expect(enemy.checkCollision(brushing)).toBe(false);

    // Deep into visible flesh: collision.
    const touching = { x: 106, y: 204, width: 32, height: 28 };
    expect(enemy.checkCollision(touching)).toBe(true);
});

test("resolvePlayerContact: falling feet-first stomps instead of dying", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 200, 60, 200);

    // Falling onto the enemy: prev feet above its top, current overlap.
    const player = { x: 104, y: 178, width: 32, height: 32, vy: 200, prevY: 172 };

    const result = manager.resolvePlayerContact(player);

    expect(result.stomped).toBe(1);
    expect(result.deadly).toBe(false);
    expect(manager.getActiveEnemies().length).toBe(0);
});

test("resolvePlayerContact: side contact stays deadly, rising does not stomp", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 200, 60, 200);

    // Walking into the enemy's side on the ground (vy 0, feet level).
    const walker = { x: 96, y: 200, width: 32, height: 32, vy: 0, prevY: 200 };
    let result = manager.resolvePlayerContact(walker);
    expect(result.deadly).toBe(true);
    expect(result.stomped).toBe(0);

    // Rising through the enemy (jumping up beside it) must not stomp.
    const manager2 = new EnemyManager();
    manager2.addEnemy(100, 200, 60, 200);
    const riser = { x: 104, y: 190, width: 32, height: 32, vy: -100, prevY: 196 };
    result = manager2.resolvePlayerContact(riser);
    expect(result.deadly).toBe(true);
    expect(result.stomped).toBe(0);
});
