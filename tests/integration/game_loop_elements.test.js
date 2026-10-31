// Integration seam: Game.update() weaving the Phase 2 systems together.
//
// Unit tests pin Collectibles/Hazards/EnemyManager in isolation, and the
// element-level integration files pin Level -> system wiring. What nothing
// covers yet is the GAME LOOP itself: that a PLAYING tick actually consults
// the per-level enemy manager, hazards, and collectibles, in the specified
// order, with death triggering exactly once per frame across simultaneous
// hits, score accumulating across levels (never overwritten by a per-level
// getScore), retries restoring the level-start score snapshot, and pit death
// still firing at the exact world-pixel threshold after delegating to
// Hazards.checkPitFall. These tests drive Game.update(dt) directly under
// happy-dom, mirroring state_transitions.test.js.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game, STATE } from "../../js/main.js";
import { Collectibles } from "../../js/collectibles.js";

const DT = 0.016;
// Mirrors GRAVITY in main.js (not exported). Used to cancel one tick of
// gravity below so the pit-death boundary can be probed exactly:
// applyGravity is semi-implicit Euler (vy += g*dt; y += vy*dt), so seeding
// vy with -(GRAVITY * DT) — the identical float expression — leaves the
// player's y unchanged across the tick.
const GRAVITY = 980;
const COIN_POINTS = 10; // mirrors COIN_POINTS in collectibles.js

function startPlaying() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    return game;
}

// Puts overlays in a known-hidden baseline so "shown" assertions prove
// showGameOver actually revealed the overlay (state_transitions.test.js idiom).
function hideOverlays(game) {
    game.ui.hideOverlay('menu-screen');
    game.ui.hideOverlay('game-over-screen');
    game.ui.hideOverlay('level-complete-screen');
}

// Neutralises generator-produced enemies/spikes so only the elements a test
// injects can kill the player.
function clearGeneratedThreats(game) {
    game.enemyManager.clear();
    game.hazards.clear();
}

// A real Collectibles instance holding n coins stacked at the player's
// current position: one checkCollection call collects all n. Swapping it in
// for the level's own keeps the collection contract real while making the
// collected count deterministic.
function coinsAtPlayer(game, n) {
    const collectibles = new Collectibles();
    for (let i = 0; i < n; i++) {
        collectibles.addCoin(game.player.x, game.player.y);
    }
    return collectibles;
}

function advanceToNextLevel(game) {
    const portal = game.level.portal;
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.player.markPortalReached();
    game.update(DT);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);
    for (let i = 0; i < 3 && game.state === STATE.LEVEL_COMPLETE; i++) {
        game.update(0.8);
    }
    expect(game.state).toBe(STATE.PLAYING);
}

test("a MENU-state Game has no element systems and update() stays inert", () => {
    mountFixture();
    const game = new Game();

    expect(game.enemyManager).toBeNull();
    expect(game.collectibles).toBeNull();
    expect(game.hazards).toBeNull();
    expect(game.levelStartScore).toBe(0);

    game.update(DT);
    expect(game.state).toBe(STATE.MENU);
});

test("startLevel wires the per-level element systems from the level's getters", () => {
    const game = startPlaying();

    // Same-instance identity, not merely same-type: the loop must consult the
    // very objects the Level exposes, or generated content is invisible to it.
    expect(game.enemyManager).toBe(game.level.getEnemyManager());
    expect(game.collectibles).toBe(game.level.getCollectibles());
    expect(game.hazards).toBe(game.level.getHazards());
});

test("an enemy overlapping the player during a PLAYING tick ends the run", () => {
    const game = startPlaying();
    hideOverlays(game);
    clearGeneratedThreats(game);

    // Enemy body placed flush on the player; one tick of patrol (0.8px)
    // cannot break the deep overlap.
    game.enemyManager.addEnemy(
        game.player.x, game.player.y,
        game.player.x - 50, game.player.x + 100
    );

    game.update(DT);

    expect(game.state).toBe(STATE.GAME_OVER);
    expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(false);
});

test("spike core contact during a PLAYING tick ends the run", () => {
    const game = startPlaying();
    hideOverlays(game);
    clearGeneratedThreats(game);

    // Spike offset by 8px: even the 4px-inset lethal core overlaps the
    // player rect.
    game.hazards.addSpike(game.player.x + 8, game.player.y + 8);

    game.update(DT);

    expect(game.state).toBe(STATE.GAME_OVER);
    expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(false);
});

test("simultaneous enemy, spike, and pit hits produce exactly one game over", () => {
    const game = startPlaying();
    hideOverlays(game);
    clearGeneratedThreats(game);

    // Stack all three death sources on the same tick: an enemy and a spike
    // at the player position AND the player below the pit line.
    const worldBottom = game.level.height * game.level.tileSize;
    game.enemyManager.addEnemy(
        game.player.x, worldBottom + 200,
        game.player.x - 50, game.player.x + 100
    );
    game.hazards.addSpike(game.player.x, worldBottom + 200);
    game.player.y = worldBottom + 200;

    let gameOverCalls = 0;
    const original = game.handleGameOver.bind(game);
    game.handleGameOver = () => {
        gameOverCalls++;
        original();
    };

    game.update(DT);

    expect(game.state).toBe(STATE.GAME_OVER);
    expect(gameOverCalls).toBe(1);
    // And the run stays dead: further ticks do not re-trigger.
    game.update(DT);
    expect(gameOverCalls).toBe(1);
});

test("collected coins add 10 points each to the running total across levels", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    // Two coins on one tick: both counted, 20 points.
    game.collectibles = coinsAtPlayer(game, 2);
    game.update(DT);
    expect(game.score).toBe(2 * COIN_POINTS);

    // Advance to level 2 through the real LEVEL_COMPLETE path.
    advanceToNextLevel(game);
    expect(game.currentLevel).toBe(2);
    expect(game.score).toBe(2 * COIN_POINTS);
    expect(game.levelStartScore).toBe(2 * COIN_POINTS);

    // Level 2 collections accumulate onto the carried total. The fresh fake
    // reports its OWN score as 3 * COIN_POINTS = 30; if the loop assigned
    // per-level getScore() over the running total, score would read 30 here
    // instead of 50.
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 3);
    game.update(DT);
    expect(game.collectibles.getScore()).toBe(3 * COIN_POINTS);
    expect(game.score).toBe(2 * COIN_POINTS + 3 * COIN_POINTS);
});

test("retrying restores the score snapshot taken when the level started", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    // Bank 10 points on level 1, then complete it: level 2 starts at 10.
    game.collectibles = coinsAtPlayer(game, 1);
    game.update(DT);
    expect(game.score).toBe(COIN_POINTS);
    advanceToNextLevel(game);
    expect(game.levelStartScore).toBe(COIN_POINTS);

    // Farm 2 more coins mid-level-2, then die.
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 2);
    game.update(DT);
    expect(game.score).toBe(3 * COIN_POINTS);

    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);

    document.getElementById('retry-btn').click();

    // Score is back to what it was when this level began — repeated retries
    // of a regenerated level cannot farm coins — and the element systems are
    // rewired to the fresh level instance.
    expect(game.state).toBe(STATE.PLAYING);
    expect(game.score).toBe(COIN_POINTS);
    expect(game.levelStartScore).toBe(COIN_POINTS);
    expect(game.collectibles).toBe(game.level.getCollectibles());
    expect(game.enemyManager).toBe(game.level.getEnemyManager());
    expect(game.hazards).toBe(game.level.getHazards());
});

test("retrying a failed first level resets the score to zero", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    game.collectibles = coinsAtPlayer(game, 1);
    game.update(DT);
    expect(game.score).toBe(COIN_POINTS);

    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);

    document.getElementById('retry-btn').click();
    expect(game.state).toBe(STATE.PLAYING);
    expect(game.score).toBe(0);
});

test("pit death fires at the exact world-pixel threshold via the delegated check", () => {
    const game = startPlaying();
    hideOverlays(game);
    clearGeneratedThreats(game);

    const worldBottom = game.level.height * game.level.tileSize;
    // Cancel this tick's gravity so the pit check sees the y we set
    // (see GRAVITY note above): strict `>` means exactly at the line lives.
    game.player.vy = -(GRAVITY * DT);
    game.player.y = worldBottom + 100;
    game.update(DT);
    expect(game.state).toBe(STATE.PLAYING);

    // One pixel past the same line dies — the old inline threshold, preserved
    // through Hazards.checkPitFall.
    game.player.vy = -(GRAVITY * DT);
    game.player.y = worldBottom + 101;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);
});
