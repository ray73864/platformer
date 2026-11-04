// Bombardier economy + lethality through the REAL Game.update() loop
// (player request 2026-11-04): stomp premium, dodge inheritance, and the
// 'projectile' death cause with its teachable overlay line. Mirrors the
// score_economy scaffolding: scripted positions between update(DT) calls,
// generated threats cleared, hand-computed literals throughout.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";
import { UI } from "../../js/ui.js";
import { Collectibles } from "../../js/collectibles.js";

const DT = 0.016;
const GRAVITY = 980; // mirrors main.js (not exported); cancels one tick
const T = 32;

function startPlaying() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    return game;
}

function clearGeneratedThreats(game) {
    game.enemyManager.clear();
    game.hazards.clear();
}

function noCoins(game) {
    game.collectibles = new Collectibles();
}

// One scripted frame: teleport the player, cancel gravity, tick.
function stepAt(game, x, y) {
    game.player.x = x;
    game.player.y = y;
    game.player.vx = 0;
    game.player.vy = -(GRAVITY * DT);
    game.player.grounded = false;
    game.update(DT);
}

// A bombardier wired into the level's REAL combat context (cannon -> the
// level's projectile manager + terrain view), patrolling a wide lane.
function addBombardier(game, ex, ey) {
    game.enemyManager.addEnemy(
        ex, ey, ex - T, ex + 10 * T, 'bombardier',
        { projectiles: game.projectiles, terrain: game.projectiles.terrain }
    );
    return game.enemyManager.enemies[game.enemyManager.enemies.length - 1];
}

// Carve a fully-open air box so no generated geometry can veto the shot.
function carveLane(game, colA, colB, rowTop, rowBottom) {
    for (let r = rowTop; r <= rowBottom; r++) {
        for (let c = colA; c <= colB; c++) {
            if (game.level.tiles[r]) game.level.tiles[r][c] = 0;
        }
    }
}

test("stomping a bombardier KILLS it and pays the 40-point premium once", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    // It is NOT spiny: falling feet-first squashes the gun-carrier.
    game.player.y -= 64;
    game.player.grounded = false;
    game.player.vy = 200;
    const bomb = addBombardier(game, game.player.x,
        game.player.y + game.player.height - 12);
    game.update(DT);

    expect(game.state).toBe("PLAYING");
    expect(bomb.isDead()).toBe(true);
    expect(game.score).toBe(40); // charger premium tier, hand-computed
    expect(game.levelEnemiesKilled).toBe(1);
    expect(game.levelCombatPoints).toBe(40);
});

test("dodging past a live bombardier pays the standard +5", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    const ex = game.player.x + 150;
    const ey = game.player.y;
    const bomb = addBombardier(game, ex, ey);

    // Cross at 84 px of feet separation: outside BOTH trigger bands (close
    // ±32, ranged ±48), so this measures the generic centre-cross award —
    // the dodge rule reads the enemy list kind-blind.
    stepAt(game, ex - 100, ey - 100);
    expect(game.score).toBe(0);
    for (let x = ex - 70; x <= ex + 100; x += 30) stepAt(game, x, ey - 100);
    expect(game.state).toBe("PLAYING");
    expect(bomb.dodged).toBe(true);
    expect(game.score).toBe(5); // DODGE_POINTS, hand-computed
    expect(game.levelEnemiesDodged).toBe(1);
});

test("a cannonball kills: cause 'projectile', overlay teaches the lesson", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    // Scene: gun five columns left of the player, feet aligned, everything
    // between carved to open air (no terrain lottery on the arc). Anchor
    // MID-MAP: level 1 spawns at x=64, which would push an offset gun into
    // the off-map solid veto column.
    const px = 9 * T, py = game.player.y;
    const gy = py + game.player.height - T; // gun feet on the player's line
    const gx = px - 5 * T;
    carveLane(game, Math.floor(gx / T) - 2, Math.floor(px / T) + 4,
        Math.floor(gy / T) - 5, Math.floor(gy / T));
    const bomb = addBombardier(game, gx, gy);

    // Stand STILL in the open: telegraph (0.6 s) -> flight -> impact.
    let died = false;
    for (let f = 0; f < 300 && !died; f++) {
        stepAt(game, px, py);
        died = game.state === "GAME_OVER";
        if (!died && f === 40) {
            // Mid-flight checkpoint: the telegraph completed and exactly
            // one ball exists while the run is still PLAYING.
            expect(bomb.state).not.toBe('windup_ranged');
            expect(game.projectiles.list.length).toBeGreaterThanOrEqual(1);
        }
    }
    expect(died).toBe(true);
    expect(document.getElementById('death-cause').hidden).toBe(false);
    expect(document.getElementById('death-cause').textContent)
        .toBe('Took a bombardier shot');
});

test("walking away during the telegraph escapes the shot entirely", () => {
    // Fairness contract end-to-end: the ball's horizontal speed (<=150) is
    // below the player run (200), so leaving the lane after the windup is
    // visible always works. Vertical escape here: climb two rows while the
    // telegraph runs, then the arc sails through the empty lane.
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    // Mid-map anchor (see the kill scene above): gun five columns left,
    // lane carved open.
    const px = 9 * T, py = game.player.y;
    const gy = py + game.player.height - T;
    const gx = px - 5 * T;
    carveLane(game, Math.floor(gx / T) - 2, Math.floor(px / T) + 4,
        Math.floor(gy / T) - 5, Math.floor(gy / T));
    addBombardier(game, gx, gy);

    // Hold the lane just long enough to arm the telegraph...
    stepAt(game, px, py);
    // ...then break the row band (ranged tolerance is ±48 px).
    let survived = true;
    for (let f = 0; f < 400 && survived; f++) {
        stepAt(game, px, py - 3 * T);
        survived = game.state !== "GAME_OVER";
    }
    expect(survived).toBe(true);
});

test("DEATH_CAUSE_TEXT maps 'projectile' verbatim", () => {
    expect(UI.DEATH_CAUSE_TEXT.projectile).toBe('Took a bombardier shot');
});
