// Risky enemy kinds (player ruling 2026-11-03: "I didn't like how I could
// just jump on top of every enemy, it added no risk"). Stomping stays a
// skill: walkers stay fully stompable; spinies kill on ANY contact (spiked
// back); chargers telegraph a windup then dash but stay stompable even
// mid-dash (risk/reward). These tests pin the combat rules, the charger
// state machine, the deployment gates/caps, and the seeded determinism of
// kind assignment. Geometry non-perturbation across versions is proven
// separately against a HEAD copy (scratch harness), because a repo test
// cannot import its own previous revision.
import { test, expect } from "bun:test";
import { Enemy, EnemyManager, ENEMY_STATES } from "../../js/enemies.js";
import { Level } from "../../js/level.js";

const T = 32;
const WALKER_SPEED = 40; // px/s (enemies.js ENEMY_SPEED)

// Plain-object player fixtures follow the established convention in
// enemies.test.js: resolvePlayerContact reads x/y/width/height/vy/prevY,
// the charger trigger reads x/y/width/height.
function fallingOnto(enemy) {
    return {
        x: enemy.x + 4, y: enemy.y - 22, width: 32, height: 32,
        vy: 200, prevY: enemy.y - 28
    };
}

function standingBeside(enemy, side) {
    const x = side > 0 ? enemy.x + enemy.width - 8 : enemy.x - 24;
    return { x, y: enemy.y, width: 32, height: 32, vy: 0, prevY: enemy.y };
}

// --- Spiny ------------------------------------------------------------------

test("spiny: top contact kills instead of stomping (no bounce, player dies)", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 200, 60, 200, 'spiny');
    const player = fallingOnto(manager.enemies[0]);

    const result = manager.resolvePlayerContact(player);

    expect(result.stomped).toBe(0);
    expect(result.deadly).toBe(true);
    expect(result.deadlyBySpiny).toBe(true); // distinct game-over teaching cause
    expect(manager.getActiveEnemies().length).toBe(1); // spiny survives
});

test("spiny: side contact kills like any enemy", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 200, 60, 200, 'spiny');
    const player = standingBeside(manager.enemies[0], 1);

    const result = manager.resolvePlayerContact(player);

    expect(result.stomped).toBe(0);
    expect(result.deadly).toBe(true);
});

test("spiny walks exactly like a walker (recognition is purely visual)", () => {
    const walker = new Enemy(100, 100, 50, 200, 'walker');
    const spiny = new Enemy(100, 100, 50, 200, 'spiny');

    for (let i = 0; i < 600; i++) {
        walker.update(1 / 60);
        spiny.update(1 / 60);
        expect(spiny.x).toBe(walker.x);
        expect(spiny.vx).toBe(walker.vx);
    }
    expect(spiny.state).toBe('patrol'); // never leaves patrol
});

// --- Charger: trigger zone ----------------------------------------------------

function chargerFixture({ minX = 256, maxX = 640, x = 320 } = {}) {
    const manager = new EnemyManager();
    manager.addEnemy(x, 200, minX, maxX, 'charger');
    return { manager, enemy: manager.enemies[0] };
}

function playerInLane(charger, { gapTiles = 3, rowOffset = 0, behind = false } = {}) {
    // Facing starts right; "in front" means to the right unless behind.
    const dir = behind ? -1 : 1;
    const x = charger.x + charger.width / 2 + dir * gapTiles * T - 16;
    return { x, y: charger.y + rowOffset * T, width: 32, height: 32 };
}

test("charger windup triggers only within range, row tolerance, and facing", () => {
    // In front, same row, 3 columns away: triggers.
    let { manager, enemy } = chargerFixture();
    manager.updateAll(1 / 60, playerInLane(enemy, { gapTiles: 3 }));
    expect(enemy.state).toBe('windup');
    expect(enemy.vx).toBe(0); // planted for the telegraph

    // Too far (> 6 columns): stays patrol.
    ({ manager, enemy } = chargerFixture());
    manager.updateAll(1 / 60, playerInLane(enemy, { gapTiles: 7 }));
    expect(enemy.state).toBe('patrol');

    // Behind the patrol facing: stays patrol until it turns around.
    ({ manager, enemy } = chargerFixture());
    manager.updateAll(1 / 60, playerInLane(enemy, { gapTiles: 3, behind: true }));
    expect(enemy.state).toBe('patrol');

    // Two tile rows off (outside the ±1-row tolerance): stays patrol.
    ({ manager, enemy } = chargerFixture());
    manager.updateAll(1 / 60, playerInLane(enemy, { gapTiles: 3, rowOffset: -2 }));
    expect(enemy.state).toBe('patrol');

    // One tile row off (inside tolerance): triggers.
    ({ manager, enemy } = chargerFixture());
    manager.updateAll(1 / 60, playerInLane(enemy, { gapTiles: 3, rowOffset: 1 }));
    expect(enemy.state).toBe('windup');

    // No player reference at all (updateAll(dt)): chargers idle-patrol.
    ({ manager, enemy } = chargerFixture());
    manager.updateAll(1 / 60);
    expect(enemy.state).toBe('patrol');
});

test("charger windup aborts back to patrol when the player leaves the zone", () => {
    const { manager, enemy } = chargerFixture();
    const player = playerInLane(enemy, { gapTiles: 3 });
    manager.updateAll(1 / 60, player);
    expect(enemy.state).toBe('windup');

    // Step out of the lane before the windup completes.
    player.x += 5 * T;
    manager.updateAll(1 / 60, player);
    expect(enemy.state).toBe('patrol');
    expect(enemy.vx).toBeGreaterThan(0); // resumes the pre-windup heading
});

test("charger windup completes into a dash toward the player's side at 2.2x", () => {
    const { manager, enemy } = chargerFixture();
    const player = playerInLane(enemy, { gapTiles: 3 });

    let ticks = 0;
    while (enemy.state !== 'dash' && ticks < 200) {
        manager.updateAll(1 / 60, player);
        ticks++;
    }
    // ~0.45 s of windup at 60 fps (frame 27-28 depending on float slop).
    expect(ticks).toBeGreaterThanOrEqual(26);
    expect(ticks).toBeLessThanOrEqual(30);
    expect(enemy.state).toBe('dash');
    expect(Math.abs(enemy.vx)).toBeCloseTo(WALKER_SPEED * 2.2, 5);
    expect(enemy.vx).toBeGreaterThan(0); // locked toward the player (right)
});

test("charger dash stays inside [minX, maxX] and ends at the bound in cooldown", () => {
    // Start close to the right bound so the dash reaches it well inside
    // the 1.2 s timeout.
    const { manager, enemy } = chargerFixture({ minX: 256, maxX: 640, x: 560 });
    const player = playerInLane(enemy, { gapTiles: 2 });

    let ticks = 0;
    while (enemy.state !== 'cooldown' && ticks < 200) {
        manager.updateAll(1 / 60, player);
        expect(enemy.x).toBeGreaterThanOrEqual(enemy.minX);
        expect(enemy.x + enemy.width).toBeLessThanOrEqual(enemy.maxX);
        ticks++;
    }
    expect(enemy.state).toBe('cooldown');
    // Clamped flush at the bound it charged into, heading inward.
    expect(enemy.x + enemy.width).toBe(enemy.maxX);
    expect(enemy.vx).toBe(-WALKER_SPEED);
});

test("charger dash times out (1.2 s) into cooldown on long patrols", () => {
    const { manager, enemy } = chargerFixture({ minX: 64, maxX: 2000, x: 320 });
    const player = playerInLane(enemy, { gapTiles: 5 });

    let ticks = 0;
    let dashTicks = 0;
    while (enemy.state !== 'cooldown' && ticks < 300) {
        manager.updateAll(1 / 60, player);
        if (enemy.state === 'dash') dashTicks++;
        ticks++;
    }
    expect(enemy.state).toBe('cooldown');
    // 1.2 s at 60 fps ≈ 72 ticks (one frame of boundary slop).
    expect(dashTicks).toBeGreaterThanOrEqual(70);
    expect(dashTicks).toBeLessThanOrEqual(73);
});

test("charger: a legitimate stomp mid-dash kills it without killing the player", () => {
    const { manager, enemy } = chargerFixture();
    const player = playerInLane(enemy, { gapTiles: 3 });

    // Run the state machine into an actual dash.
    let ticks = 0;
    while (enemy.state !== 'dash' && ticks < 120) {
        manager.updateAll(1 / 60, player);
        ticks++;
    }
    expect(enemy.state).toBe('dash');

    // Falling feet-first from above: the existing stomp rule applies even
    // mid-dash (risk/reward).
    const stomper = fallingOnto(enemy);
    const result = manager.resolvePlayerContact(stomper);

    expect(result.stomped).toBe(1);
    expect(result.deadly).toBe(false);
    expect(enemy.isDead()).toBe(true);
});

test("charger cooldown paces re-triggering (no instant chain-dash)", () => {
    const { manager, enemy } = chargerFixture({ minX: 256, maxX: 640, x: 560 });
    const player = playerInLane(enemy, { gapTiles: 2 });

    // Drive into cooldown via the bound.
    let ticks = 0;
    while (enemy.state !== 'cooldown' && ticks < 200) {
        manager.updateAll(1 / 60, player);
        ticks++;
    }
    // Player stays in the lane the whole cooldown: must NOT re-windup.
    for (let i = 0; i < 55; i++) { // < 1.0 s
        manager.updateAll(1 / 60, player);
        expect(enemy.state).toBe('cooldown');
    }
    // Past the ~1.0 s cooldown the zone re-arms — and a fresh trigger needs
    // the player in the charger's CURRENT facing lane (it now patrols left,
    // away from the stationary right-side player).
    let ticks2 = 0;
    while (enemy.state === 'cooldown' && ticks2 < 30) {
        manager.updateAll(1 / 60, player);
        ticks2++;
    }
    expect(enemy.state).toBe('patrol');
    manager.updateAll(1 / 60, playerInLane(enemy, {
        gapTiles: 2, behind: enemy.vx < 0
    }));
    expect(enemy.state).toBe('windup');
});

test("every enemy reports kind + state diagnostics", () => {
    const manager = new EnemyManager();
    manager.addEnemy(100, 100, 50, 200);
    manager.addEnemy(300, 100, 250, 400, 'spiny');
    manager.addEnemy(500, 100, 450, 600, 'charger');

    expect(manager.enemies.map(e => e.kind)).toEqual(['walker', 'spiny', 'charger']);
    for (const e of manager.enemies) expect(ENEMY_STATES).toContain(e.state);
});

// --- Deployment gating, caps, determinism (real generator) -------------------

const KINDS = new Set(['walker', 'spiny', 'charger']);

function kindsAt(levelNumber, seed) {
    const level = new Level(levelNumber, T, seed);
    return level.getEnemyManager().enemies.map(e => e.kind);
}

test("spinies never deploy below level 10; chargers never below level 20", { timeout: 30000 }, () => {
    for (let lvl = 5; lvl <= 19; lvl++) {
        for (let s = 1; s <= 10; s++) {
            for (const kind of kindsAt(lvl, lvl * 1000 + s)) {
                expect(KINDS.has(kind)).toBe(true);
                if (lvl < 10) expect(kind).not.toBe('spiny');
                expect(kind).not.toBe('charger');
            }
        }
    }
});

test("both gated kinds actually appear once past their gates", () => {
    let sawSpiny = false;
    let sawCharger = false;
    for (let lvl = 30; lvl <= 45 && !(sawSpiny && sawCharger); lvl++) {
        for (let s = 1; s <= 25; s++) {
            const kinds = kindsAt(lvl, lvl * 1000 + s);
            if (kinds.includes('spiny')) sawSpiny = true;
            if (kinds.includes('charger')) sawCharger = true;
        }
    }
    expect(sawSpiny).toBe(true);
    expect(sawCharger).toBe(true);
});

test("spiny count never exceeds ceil(enemies/3) on any map", { timeout: 150000 }, () => {
    for (let lvl = 10; lvl <= 45; lvl++) {
        for (let s = 1; s <= 25; s++) {
            const kinds = kindsAt(lvl, lvl * 1000 + s);
            const spinies = kinds.filter(k => k === 'spiny').length;
            expect(spinies).toBeLessThanOrEqual(Math.ceil(kinds.length / 3));
        }
    }
});

test("kind assignment is deterministic: same seed replays the same kinds", () => {
    for (const lvl of [12, 27, 33, 40]) {
        for (const s of [7, 123, 424242]) {
            const seed = lvl * 1000 + s;
            const a = new Level(lvl, T, seed);
            const b = new Level(lvl, T, seed);
            expect(a.getEnemyManager().enemies.map(e => e.kind))
                .toEqual(b.getEnemyManager().enemies.map(e => e.kind));
            // And the geometry itself still replays byte-identically.
            expect(JSON.stringify(a.tiles)).toBe(JSON.stringify(b.tiles));
        }
    }
});

test("deployed risky kinds ride legal sites: bounds inside the level, states patrol", () => {
    // Integration seam: whatever the generator deploys at gated levels gets
    // the same terrain-derived patrol bounds as walkers (charger dashes can
    // therefore never leave solid-supported ground — patrolSpan only spans
    // columns with solid tiles directly beneath them).
    let checked = 0;
    for (let lvl = 20; lvl <= 40; lvl += 5) {
        for (let s = 1; s <= 10; s++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            for (const e of level.getEnemyManager().enemies) {
                expect(e.minX).toBeGreaterThanOrEqual(0);
                expect(e.maxX).toBeLessThanOrEqual(level.width * T);
                expect(e.x).toBeGreaterThanOrEqual(e.minX);
                expect(e.x + e.width).toBeLessThanOrEqual(e.maxX);
                expect(e.state).toBe('patrol');
                checked++;
            }
        }
    }
    expect(checked).toBeGreaterThan(0);
});

test("generation health sweep L10..L30 x 25 seeds: zero throws with kinds live", { timeout: 90000 }, () => {
    // Kind assignment consumes rng only AFTER geometry/marker/coin streams
    // finish, so it must not perturb generation acceptance at all.
    for (let lvl = 10; lvl <= 30; lvl++) {
        for (let s = 1; s <= 25; s++) {
            expect(() => new Level(lvl, T, lvl * 1000 + s)).not.toThrow();
        }
    }
});
