// Integration seam: Level -> EnemyManager -> Player.
//
// Unit tests already pin Enemy patrol math, AABB conventions, manager
// aggregation, and spawnEnemies validation on hand-built grids. These tests
// exercise the wiring instead: type-4 tiles injected into a REAL generated
// Level (the generator does not emit them until Task 5), spawned through the
// Level's own EnemyManager instance, and collided against real Player
// entities. They fail if Level stops delegating spawning to its exposed
// manager, if spawn validation misreads the real grid, or if the manager's
// aggregation stops seeing Level-spawned enemies.
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";
import { EnemyManager } from "../../js/enemies.js";
import { Player } from "../../js/player.js";

const TILE = 32;
const PLAYER_SPEED = 200; // Mirrors main.js constants used by startLevel()
const JUMP_FORCE = 350;

// The forced flat spawn zone (columns 0-5, solid from row height-3 down)
// gives deterministic standable+reachable air tiles at row height-4 without
// depending on the random terrain beyond it.
function spawnZoneAirTile(level, tileX) {
    return { x: tileX, y: level.height - 4 };
}

test("Level spawns injected enemy tiles into its exposed manager, and a real Player on the enemy dies", () => {
    const level = new Level(1, TILE);
    const tile = spawnZoneAirTile(level, 4);
    level.tiles[tile.y][tile.x] = 4;
    level.spawnEnemies();

    // Delegation seam: getEnemyManager() must be the very instance
    // spawnEnemies() populated, holding the enemy at the tile's pixel space.
    const manager = level.getEnemyManager();
    expect(manager).toBeInstanceOf(EnemyManager);
    const spawned = manager.getActiveEnemies();
    expect(spawned.length).toBe(1);
    expect(spawned[0].x).toBe(tile.x * TILE);
    expect(spawned[0].y).toBe(tile.y * TILE);

    // Patrol bounds derived from the real ground run under the walk row:
    // columns 0-5 are forced solid, so the run reaches the left wall, and
    // maxX covers at least the forced zone without leaving the level.
    expect(spawned[0].minX).toBe(0);
    expect(spawned[0].maxX).toBeGreaterThanOrEqual(6 * TILE);
    expect(spawned[0].maxX).toBeLessThanOrEqual(level.width * TILE);

    // A real Player dropped onto the spawned body registers as contact
    // through the manager's aggregation.
    const player = new Player(spawned[0].x, spawned[0].y, PLAYER_SPEED, JUMP_FORCE);
    expect(manager.checkPlayerCollisions(player)).toBe(true);
});

test("spawnEnemies validates against the real grid: floating type-4 tiles are ignored", () => {
    const level = new Level(1, TILE);
    const valid = spawnZoneAirTile(level, 3);
    // Row 0 is always open sky (terrain tops out at row 3), so this tile has
    // no solid below and must be skipped entirely.
    const floating = { x: 10, y: 0 };
    level.tiles[valid.y][valid.x] = 4;
    level.tiles[floating.y][floating.x] = 4;
    level.spawnEnemies();

    const spawned = level.getEnemyManager().getActiveEnemies();
    expect(spawned.length).toBe(1);
    expect(spawned[0].x).toBe(valid.x * TILE);
});

test("a patrolling Level-spawned enemy eventually reaches a player standing at its geometry-derived left bound", () => {
    const level = new Level(1, TILE);
    const tile = spawnZoneAirTile(level, 4);
    level.tiles[tile.y][tile.x] = 4;
    level.spawnEnemies();
    const manager = level.getEnemyManager();
    const enemy = manager.getActiveEnemies()[0];

    // Player stands on the ground at the far left of the patrol run, well
    // clear of the spawn point (x=128) so tick 0 cannot trivially collide.
    const player = new Player(0, tile.y * TILE, PLAYER_SPEED, JUMP_FORCE);
    expect(manager.checkPlayerCollisions(player)).toBe(false);

    // Enemy starts moving right; it must reverse at maxX and sweep back to
    // minX=0, where it contacts the stationary player. Worst case ~1100px of
    // travel at 50 px/s ≈ 1300 ticks; cap generously and fail loudly.
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
    const tile = spawnZoneAirTile(level, 4);
    level.tiles[tile.y][tile.x] = 4;
    level.spawnEnemies();
    const manager = level.getEnemyManager();
    const enemy = manager.getActiveEnemies()[0];

    const player = new Player(enemy.x, enemy.y, PLAYER_SPEED, JUMP_FORCE);
    expect(manager.checkPlayerCollisions(player)).toBe(true);

    enemy.die();
    expect(manager.checkPlayerCollisions(player)).toBe(false);
    expect(manager.getActiveEnemies()).toHaveLength(0);
});

// Direct manager-vs-player cases from the brief, using a real Player entity
// as the colliding rect instead of an object literal.
test("manager reports contact for an overlapping player and none for an avoiding one", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 100, 50, 200);

    const touching = new Player(110, 100, PLAYER_SPEED, JUMP_FORCE);
    expect(manager.checkPlayerCollisions(touching)).toBe(true);

    const avoiding = new Player(50, 100, PLAYER_SPEED, JUMP_FORCE);
    expect(manager.checkPlayerCollisions(avoiding)).toBe(false);
});
