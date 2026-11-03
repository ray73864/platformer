// Integration seam: the score economy (owner ruling 2026-11-04) driven
// through the REAL Game.update() loop — clear bonuses, stomp/dodge awards,
// the per-level tracker transitions, and the LEVEL_COMPLETE overlay copy.
//
// Mirrors game_loop_elements.test.js scaffolding: scripted positions between
// update(DT) calls, threats cleared so only injected elements can kill, and
// hand-checked literal score math throughout (the ruling demands the numbers
// be pinned, not derived from the constants at assertion time).
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";
import { Collectibles } from "../../js/collectibles.js";

const DT = 0.016;
// Mirrors GRAVITY in main.js (not exported). Seeding vy with -(GRAVITY * DT)
// leaves y unchanged across one semi-implicit-Euler tick (vy += g*dt -> 0,
// y += 0*dt), the same probe game_loop_elements.test.js uses for the pit line.
const GRAVITY = 980;

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

// Zero-coin baseline: an empty Collectibles swaps out the level's coins so
// only scripted awards move the score (the portal gate opens trivially with
// no coins — same contract as collectibles.js documents).
function noCoins(game) {
    game.collectibles = new Collectibles();
}

function coinsAtPlayer(game, n) {
    const collectibles = new Collectibles();
    for (let i = 0; i < n; i++) {
        collectibles.addCoin(game.player.x, game.player.y);
    }
    return collectibles;
}

// Wins the current level through the real gate + portal AABB contact (no
// forced markPortalReached), asserting the transition happened.
function winCurrentLevel(game) {
    const collectibles = game.collectibles;
    const coins = collectibles.getCoins();
    for (let i = 0; i < coins.length && !collectibles.meetsPortalRequirement(); i++) {
        collectibles.collectCoin(i);
    }
    const portal = game.level.portal;
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.update(DT);
    expect(game.state).toBe("LEVEL_COMPLETE");
}

// Pins an enemy at exactly (ex, ey): patrol bounds one tile wide make
// _patrolStep clamp-flip around ex every frame, so its centre never moves
// while the real manager/motion code still runs.
function addPinnedEnemy(game, ex, ey, kind = 'walker') {
    game.enemyManager.addEnemy(ex, ey, ex, ex + 32, kind);
    return game.enemyManager.enemies[game.enemyManager.enemies.length - 1];
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

test("a flawless clear pays the full bonus into the score and the overlay", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 2);
    game.update(DT);
    expect(game.score).toBe(20); // 2 coins x 10

    winCurrentLevel(game);

    // 20 coins + 100 flawless basic-tier clear bonus, hand-computed.
    expect(game.score).toBe(120);
    expect(game.lastClearBreakdown).toEqual({
        coins: 20, combat: 0, clearBonus: 100, enemiesBested: 0,
        deaths: 0, flawless: true
    });
    const bonusEl = document.getElementById('clear-bonus');
    expect(bonusEl.hidden).toBe(false);
    expect(bonusEl.textContent).toBe('Flawless clear +100');
    // Nothing bested on a coin-only L1: the combat line stays hidden.
    expect(document.getElementById('enemies-bested').hidden).toBe(true);
});

test("one death then a clear pays the reduced bonus with matching copy", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    // Die once on a zero score (penalty floors to 0), then retry.
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe("GAME_OVER");
    expect(game.deathsOnCurrentLevel).toBe(1);
    document.getElementById('retry-btn').click();
    expect(game.state).toBe("PLAYING");

    game.collectibles = coinsAtPlayer(game, 1);
    game.update(DT);
    winCurrentLevel(game);

    // 10 coins + floor(100 * 0.4) = 40 reduced bonus, hand-computed.
    expect(game.score).toBe(50);
    expect(game.lastClearBreakdown).toEqual({
        coins: 10, combat: 0, clearBonus: 40, enemiesBested: 0,
        deaths: 1, flawless: false
    });
    const bonusEl = document.getElementById('clear-bonus');
    expect(bonusEl.hidden).toBe(false);
    expect(bonusEl.textContent).toBe('Cleared after 1 death +40');
});

test("a stomp pays walker points, counts as bested, and shows the overlay line", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    // Fall feet-first onto a walker placed just below the feet (the exact
    // geometry game_loop_elements.test.js pins for resolvePlayerContact).
    game.player.y -= 64;
    game.player.grounded = false;
    game.player.vy = 200;
    game.enemyManager.addEnemy(
        game.player.x, game.player.y + game.player.height - 12,
        game.player.x - 50, game.player.x + 100
    );
    game.update(DT);

    expect(game.state).toBe("PLAYING");
    expect(game.score).toBe(25); // STOMP_POINTS, hand-computed
    expect(game.levelCombatPoints).toBe(25);
    expect(game.levelEnemiesKilled).toBe(1);

    winCurrentLevel(game);
    // 25 stomp + 100 flawless bonus.
    expect(game.score).toBe(125);
    expect(game.lastClearBreakdown.combat).toBe(25);
    expect(game.lastClearBreakdown.enemiesBested).toBe(1);
    const bestedEl = document.getElementById('enemies-bested');
    expect(bestedEl.hidden).toBe(false);
    expect(bestedEl.textContent).toBe('Enemies bested +1');
});

test("a charger stomp pays the mid-dash premium", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    game.player.y -= 64;
    game.player.grounded = false;
    game.player.vy = 200;
    game.enemyManager.addEnemy(
        game.player.x, game.player.y + game.player.height - 12,
        game.player.x - 50, game.player.x + 100, 'charger'
    );
    game.update(DT);

    expect(game.state).toBe("PLAYING");
    expect(game.score).toBe(40); // CHARGER_STOMP_POINTS, hand-computed
    expect(game.levelEnemiesKilled).toBe(1);
});

test("dodging past a live enemy awards exactly once across crossings", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    const ex = game.player.x + 150;
    const ey = game.player.y;
    const enemy = addPinnedEnemy(game, ex, ey);

    // Approach from the left (records side -1), then cross continuously to
    // the right. Vertical separation keeps the lethal inset box clear —
    // this is a centre-cross award, not a contact.
    stepAt(game, ex - 100, ey - 60);
    expect(game.score).toBe(0);
    expect(enemy.dodged).toBe(false);

    for (let x = ex - 70; x <= ex + 100; x += 30) stepAt(game, x, ey - 60);
    expect(game.state).toBe("PLAYING");
    expect(enemy.dodged).toBe(true);
    expect(game.score).toBe(5); // DODGE_POINTS, hand-computed
    expect(game.levelCombatPoints).toBe(5);
    expect(game.levelEnemiesDodged).toBe(1);

    // Lingering on the far side cannot re-arm the award...
    stepAt(game, ex + 100, ey - 60);
    stepAt(game, ex + 100, ey - 60);
    // ...and neither can crossing BACK past the same enemy.
    for (let x = ex + 70; x >= ex - 100; x -= 30) stepAt(game, x, ey - 60);
    expect(game.score).toBe(5);
    expect(game.levelEnemiesDodged).toBe(1);
});

test("a teleport across an enemy centre never pays — only continuous motion does", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    const ex = game.player.x + 150;
    const ey = game.player.y;
    const enemy = addPinnedEnemy(game, ex, ey);

    // Observe from the left, then seam-jump 200 px to the right: the side
    // flips but the step blows through DODGE_MAX_CROSS_STEP — the tracker
    // re-baselines unpaid (this is exactly the E2E coin-drop pattern that
    // would otherwise mint free points).
    stepAt(game, ex - 100, ey - 60);
    stepAt(game, ex + 100, ey - 60);
    expect(game.score).toBe(0);
    expect(enemy.dodged).toBe(false);

    // The same enemy DOES pay when crossed continuously afterwards.
    for (let x = ex + 70; x >= ex - 100; x -= 30) stepAt(game, x, ey - 60);
    expect(game.score).toBe(5);
    expect(enemy.dodged).toBe(true);
});

test("an enemy killed before being crossed never collects the dodge", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    // Stomp it first.
    game.player.y -= 64;
    game.player.grounded = false;
    game.player.vy = 200;
    game.enemyManager.addEnemy(
        game.player.x, game.player.y + game.player.height - 12,
        game.player.x - 50, game.player.x + 100
    );
    game.update(DT);
    const enemy = game.enemyManager.enemies[0];
    expect(enemy.isDead()).toBe(true);
    expect(game.score).toBe(25);

    // Sweep past the corpse on both sides: dead enemies are skipped by the
    // dodge pass forever, so the total stays at the stomp award.
    stepAt(game, enemy.x - 100, enemy.y - 60);
    stepAt(game, enemy.x + 100, enemy.y - 60);
    expect(game.score).toBe(25);
    expect(enemy.dodged).toBe(false);
    expect(game.levelEnemiesDodged).toBe(0);
    expect(game.levelCombatPoints).toBe(25);
});

test("the frame that kills the player never awards a dodge", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    const ex = game.player.x + 150;
    const ey = game.player.y;
    const enemy = addPinnedEnemy(game, ex, ey);

    // Left of the enemy, safely above: side -1 recorded, alive. Close in to
    // 30 px so the final hop stays under the continuity guard — what must
    // block the award here is DEATH, not the teleport cap.
    stepAt(game, ex - 30, ey - 60);
    expect(game.state).toBe("PLAYING");

    // Cross the centre WHILE landing inside the lethal box (horizontal step
    // 32 px, continuous): the deadly branch returns before the dodge pass,
    // so the crossing frame dies unpaid.
    game.player.x = ex + 2;
    game.player.y = ey;
    game.player.vy = -(GRAVITY * DT);
    game.player.grounded = false;
    game.update(DT);

    expect(game.state).toBe("GAME_OVER");
    expect(game.score).toBe(0);
    expect(enemy.dodged).toBe(false);
    expect(game.levelEnemiesDodged).toBe(0);
});

test("tracker transitions: retry keeps the death count, next level and run restart reset it", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    // Fresh run: everything zeroed.
    expect(game.deathsOnCurrentLevel).toBe(0);
    expect(game.levelCoinPoints).toBe(0);
    expect(game.levelCombatPoints).toBe(0);
    expect(game.levelEnemiesKilled).toBe(0);
    expect(game.levelEnemiesDodged).toBe(0);

    // Death 1 -> counted; retry KEEPS it (the "issues" signal survives).
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.deathsOnCurrentLevel).toBe(1);
    document.getElementById('retry-btn').click();
    expect(game.state).toBe("PLAYING");
    expect(game.deathsOnCurrentLevel).toBe(1);

    // Pause-menu Restart Level shares the retry contract: still kept.
    game.restartCurrentLevel('pause-screen');
    expect(game.deathsOnCurrentLevel).toBe(1);

    // Advancing to the NEXT level resets the sheet (its bonus was paid).
    winCurrentLevel(game);
    for (let i = 0; i < 3 && game.state === "LEVEL_COMPLETE"; i++) {
        game.update(0.8);
    }
    expect(game.currentLevel).toBe(2);
    expect(game.state).toBe("PLAYING");
    expect(game.deathsOnCurrentLevel).toBe(0);
    expect(game.levelCoinPoints).toBe(0);
    expect(game.levelCombatPoints).toBe(0);
    expect(game.levelEnemiesKilled).toBe(0);
    expect(game.levelEnemiesDodged).toBe(0);

    // Full-run restart resets mid-level deaths too.
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.deathsOnCurrentLevel).toBe(1);
    game.startGame();
    expect(game.currentLevel).toBe(1);
    expect(game.deathsOnCurrentLevel).toBe(0);
});

test("a retry hands out fresh enemies with clean dodge flags", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    const ex = game.player.x + 150;
    const ey = game.player.y;
    const enemy = addPinnedEnemy(game, ex, ey);
    stepAt(game, ex - 100, ey - 60);
    for (let x = ex - 70; x <= ex + 100; x += 30) stepAt(game, x, ey - 60);
    expect(enemy.dodged).toBe(true);

    // Die and retry: the rebuilt Level mints brand-new Enemy instances, so
    // every flag is born clean (award budget refreshes per attempt).
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    document.getElementById('retry-btn').click();
    expect(game.state).toBe("PLAYING");
    expect(game.enemyManager.enemies).not.toContain(enemy);
    for (const fresh of game.enemyManager.enemies) {
        expect(fresh.dodged).toBe(false);
        expect(fresh._dodgePrevSide).toBe(0);
    }
});

test("end-to-end: coins + stomp + dodge + flawless bonus sum by hand", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 2);
    game.update(DT);
    expect(game.score).toBe(20); // 2 coins x 10

    // Stomp a walker: +25 -> 45.
    game.player.y -= 64;
    game.player.grounded = false;
    game.player.vy = 200;
    game.enemyManager.addEnemy(
        game.player.x, game.player.y + game.player.height - 12,
        game.player.x - 50, game.player.x + 100
    );
    game.update(DT);
    expect(game.score).toBe(45);

    // Dodge past a pinned charger WITHOUT killing it: +5 -> 50. (Same row,
    // vertical clearance held for the whole continuous crossing.)
    const ex = game.player.x + 150;
    const ey = game.player.y;
    addPinnedEnemy(game, ex, ey, 'charger');
    stepAt(game, ex - 100, ey - 60);
    for (let x = ex - 70; x <= ex + 100; x += 30) stepAt(game, x, ey - 60);
    expect(game.score).toBe(50);

    // Flawless clear: +100 -> 150, every component visible in the overlay.
    winCurrentLevel(game);
    expect(game.score).toBe(150);
    expect(game.lastClearBreakdown).toEqual({
        coins: 20, combat: 30, clearBonus: 100, enemiesBested: 2,
        deaths: 0, flawless: true
    });
    expect(document.getElementById('clear-bonus').textContent)
        .toBe('Flawless clear +100');
    expect(document.getElementById('enemies-bested').textContent)
        .toBe('Enemies bested +2');
    expect(document.getElementById('enemies-bested').hidden).toBe(false);
});
