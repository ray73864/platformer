// Integration seam: Level -> EnemyManager -> Player.
//
// Unit tests already pin Enemy patrol math, AABB conventions, manager
// aggregation, and spawnEnemies validation on hand-built grids. These tests
// exercise the wiring instead: type-4 tiles injected into a REAL generated
// Level at band-legal standable reachable tiles (the same constraints the
// generator's own marker placement obeys), spawned through the Level's own
// EnemyManager instance, and collided against real Player entities. They
// fail if Level stops delegating spawning to its exposed manager, if spawn
// validation misreads the real grid, or if the manager's aggregation stops
// seeing Level-spawned enemies.
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";
import { EnemyManager } from "../../js/enemies.js";
import { Player } from "../../js/player.js";

const TILE = 32;
const PLAYER_SPEED = 200; // Mirrors main.js constants used by startLevel()
const JUMP_FORCE = 350;

// Inject a type-4 marker at the first reachable tile inside the patrol band
// (x ∈ [6, w-6] for 'right') that yields a spawned enemy, and return it with
// its bounds. With wide=true require at least two tiles of patrol so tests
// that watch movement are not at the mercy of a one-tile span. The level's
// own reachability set guarantees validity on any generated terrain.
function spawnBandEnemy(level, { wide = false } = {}) {
    for (const key of level.reachableTiles) {
        const x = key % level.width;
        const y = Math.floor(key / level.width);
        if (x < 6 || x > level.width - 6) continue;
        level.tiles[y][x] = 4;
        level.spawnEnemies();
        const enemies = level.getEnemyManager().getActiveEnemies();
        if (enemies.length === 1 &&
            (!wide || enemies[0].maxX - enemies[0].minX >= 2 * TILE)) {
            return { enemy: enemies[0], x, y };
        }
        level.tiles[y][x] = 0;
    }
    throw new Error("no band-legal reachable tile yielded a spawnable enemy");
}

test("Level spawns injected enemy tiles into its exposed manager, and a real Player on the enemy dies", () => {
    const level = new Level(1, TILE);
    const { x, y } = spawnBandEnemy(level);

    // Delegation seam: getEnemyManager() must be the very instance
    // spawnEnemies() populated, holding the enemy at the tile's pixel space.
    const manager = level.getEnemyManager();
    expect(manager).toBeInstanceOf(EnemyManager);
    const spawned = manager.getActiveEnemies();
    expect(spawned.length).toBe(1);
    expect(spawned[0].x).toBe(x * TILE);
    expect(spawned[0].y).toBe(y * TILE);

    // Patrol bounds come from the walkable run under the walk row, clamped
    // to the patrol band: inside [6, w-5] tiles and within the level.
    expect(spawned[0].minX).toBeGreaterThanOrEqual(6 * TILE);
    expect(spawned[0].maxX).toBeLessThanOrEqual((level.width - 5) * TILE);
    expect(spawned[0].minX).toBeGreaterThanOrEqual(0);
    expect(spawned[0].maxX).toBeLessThanOrEqual(level.width * TILE);

    // A real Player dropped onto the spawned body registers as contact
    // through the manager's aggregation.
    const player = new Player(spawned[0].x, spawned[0].y, PLAYER_SPEED, JUMP_FORCE);
    expect(manager.checkPlayerCollisions(player)).toBe(true);
});

test("spawnEnemies validates against the real grid: floating type-4 tiles are ignored", () => {
    const level = new Level(1, TILE);
    // Row 0 is always open sky (terrain tops out at row 3), so this tile has
    // no solid below and must be skipped entirely.
    level.tiles[0][10] = 4;

    const { enemy, x } = spawnBandEnemy(level);

    const spawned = level.getEnemyManager().getActiveEnemies();
    expect(spawned.length).toBe(1);
    expect(spawned[0].x).toBe(x * TILE);
    expect(enemy).toBe(spawned[0]);
});

test("a patrolling Level-spawned enemy eventually reaches a player standing at its geometry-derived bound", () => {
    const level = new Level(1, TILE);
    const { enemy } = spawnBandEnemy(level, { wide: true });
    const manager = level.getEnemyManager();

    // Player stands on the far patrol bound from where the enemy starts
    // (enemies begin moving right), so tick 0 cannot trivially collide.
    const targetX = enemy.x - enemy.minX >= enemy.maxX - enemy.width - enemy.x
        ? enemy.minX
        : enemy.maxX - enemy.width;
    expect(targetX).not.toBe(enemy.x);
    const player = new Player(targetX, enemy.y, PLAYER_SPEED, JUMP_FORCE);
    expect(manager.checkPlayerCollisions(player)).toBe(false);

    // The enemy must sweep the full patrol span to reach the stationary
    // player. Worst case ~2 spans of travel at 50 px/s; cap generously and
    // fail loudly.
    let ticks = 0;
    while (!manager.checkPlayerCollisions(player) && ticks < 5000) {
        manager.updateAll(1 / 60);
        ticks++;
    }
    expect(ticks).toBeLessThan(5000);
    // Movement stayed inside the level-derived bounds the whole time.
    expect(enemy.x).toBeGreaterThanOrEqual(enemy.minX);
    expect(enemy.x + enemy.width).toBeLessThanOrEqual(enemy.maxX);
});

test("killing a Level-spawned enemy removes it from collision aggregation against the player", () => {
    const level = new Level(1, TILE);
    const { enemy } = spawnBandEnemy(level);
    const manager = level.getEnemyManager();

    const player = new Player(enemy.x, enemy.y, PLAYER_SPEED, JUMP_FORCE);
    expect(manager.checkPlayerCollisions(player)).toBe(true);

    enemy.die();
    expect(manager.checkPlayerCollisions(player)).toBe(false);
    expect(manager.getActiveEnemies()).toHaveLength(0);
});
