// Integration: M5 style rewards driven through the SHIPPED main.js loop
// (SPEC §M5, Task 7). Pins what unit guards cannot: the secret premium and
// its popup landing through the real collection pass, the airborne stomp
// chain lifecycle (award once, flat, reset on grounded), the death-cut
// interaction with the new components, and the LEVEL_COMPLETE run-stats
// lines on a carved-seam alcove level (fixture reused from
// alcove_secret_loop.test.js — everything downstream of the carve is
// shipped code).
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";
import { Level } from "../../js/level.js";
import { Collectibles, COIN_POINTS, SECRET_COIN_SCORE } from "../../js/collectibles.js";
import { FX } from "../../js/fx.js";

const DT = 0.016;
const GRAVITY = 980; // mirrors main.js (not exported); cancels one Euler tick
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

// Coins overlapping the player so the very next tick collects them.
function coinsAtPlayer(game, n, secret = false) {
    const collectibles = new Collectibles();
    for (let i = 0; i < n; i++) {
        collectibles.coins.push({
            x: game.player.x, y: game.player.y,
            width: 16, height: 16, collected: false, secret
        });
    }
    return collectibles;
}

function popupTexts(game) {
    return game.popups.map(p => p.text);
}

// One scripted frame: teleport, cancel gravity, keep the hero AIRBORNE.
function stepAirborne(game, x, y) {
    game.player.x = x;
    game.player.y = y;
    game.player.vx = 0;
    game.player.vy = -(GRAVITY * DT);
    game.player.grounded = false;
    game.update(DT);
}

// Feet-first stomp of a freshly pinned walker directly below the feet —
// the exact geometry score_economy.test.js pins. Returns nothing; callers
// read score/popups.
function stompWalkerBelow(game) {
    game.player.grounded = false;
    game.player.vy = 200;
    game.enemyManager.addEnemy(
        game.player.x, game.player.y + game.player.height - 12,
        game.player.x - 50, game.player.x + 100
    );
    game.update(DT);
}

// Wins the current level through the real gate + portal contact.
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

// --- Secret coin value ------------------------------------------------------

test("a secret coin pays 25 through the loop with its own popup", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 1, true);
    game.update(DT);

    expect(game.score).toBe(SECRET_COIN_SCORE); // 25, hand-computed
    expect(game.runSecretsFound).toBe(1);
    const secret = game.popups.find(p => p.text === 'SECRET +25');
    expect(secret).toBeDefined();
    expect(secret.color).toBe('#3ecf6a');       // grass, distinct from coin gold
    expect(secret.big).toBe(true);
});

test("a normal coin still pays 10 with the chip-gold popup (regression pin)", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 1);
    game.update(DT);

    expect(game.score).toBe(COIN_POINTS);
    expect(game.runSecretsFound).toBe(0);
    const plain = game.popups.find(p => p.text === '+10');
    expect(plain).toBeDefined();
    expect(plain.color).toBe('#ffd23f');
    expect(popupTexts(game)).not.toContain('SECRET +25');
});

test("a mixed frame prices both tiers and shows both popups", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    const c = new Collectibles();
    c.coins.push({ x: game.player.x, y: game.player.y,
        width: 16, height: 16, collected: false });
    c.coins.push({ x: game.player.x, y: game.player.y,
        width: 16, height: 16, collected: false, secret: true });
    game.collectibles = c;
    game.update(DT);

    expect(game.score).toBe(COIN_POINTS + SECRET_COIN_SCORE); // 10 + 25
    expect(game.levelCoinPoints).toBe(35); // the coin line carries both tiers
    expect(game.runSecretsFound).toBe(1);
    expect(popupTexts(game)).toContain('+10');
    expect(popupTexts(game)).toContain('SECRET +25');
});

test("the secret popup honours the FX.popups kill switch but scoring does not", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 1, true);
    FX.popups = false;
    try {
        game.update(DT);
    } finally {
        FX.popups = true;
    }
    expect(game.score).toBe(SECRET_COIN_SCORE); // economy never gated by juice
    expect(game.popups.length).toBe(0);
});

test("secret collection stays out of the portal gate and the HUD count", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    const c = new Collectibles();
    c.coins.push({ x: game.player.x + 500, y: game.player.y,
        width: 16, height: 16, collected: false }); // required, far away
    c.coins.push({ x: game.player.x, y: game.player.y,
        width: 16, height: 16, collected: false, secret: true });
    game.collectibles = c;
    game._portalUnlocked = true; // suppress the unlock-chime branch
    game.update(DT);

    // The secret is banked...
    expect(c.getCoins()[1].collected).toBe(true);
    // ...but the gate still demands the required coin (T6 semantics intact)...
    expect(c.meetsPortalRequirement()).toBe(false);
    // ...and the HUD counted only the required subset all along.
    expect(document.getElementById('coins-display').textContent)
        .toBe('Coins: 0/1');
});

// --- Stomp-chain bonus --------------------------------------------------------

test("one airborne stomp pays no chain bonus; a second before landing pays +30 once", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    // Stomp 1: +25, chain armed but unpaid.
    game.player.y -= 64;
    stompWalkerBelow(game);
    expect(game.score).toBe(25);
    expect(game.stompChain).toBe(1);
    expect(popupTexts(game)).not.toContain('+30 CHAIN!');

    // Stomp 2 WITHOUT touching ground: teleport above a fresh walker mid-arc.
    game.player.y -= 64;
    stompWalkerBelow(game);
    expect(game.state).toBe("PLAYING");
    expect(game.score).toBe(25 + 25 + 30); // two kills + the flat chain bonus
    expect(game.stompChain).toBe(2);
    expect(game.levelCombatPoints).toBe(80); // chain rides the combat line
    const chain = game.popups.find(p => p.text === '+30 CHAIN!');
    expect(chain).toBeDefined();
    expect(chain.color).toBe('#f4a460');      // amber, distinct from stomp purple
    expect(chain.big).toBe(true);

    // Stomp 3 on the same airborne streak: FLAT payout — no second +30.
    game.player.y -= 64;
    stompWalkerBelow(game);
    expect(game.score).toBe(25 + 25 + 30 + 25);
    expect(game.stompChain).toBe(3);
    expect(game.popups.filter(p => p.text === '+30 CHAIN!').length).toBe(1);
});

test("landing resets the chain: a lone stomp after touch-down pays nothing extra", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    game.player.y -= 64;
    stompWalkerBelow(game);
    expect(game.stompChain).toBe(1);

    // Land: drop onto the spawn shelf until the real physics reads grounded.
    const spawn = game.level.spawnPoint;
    game.player.x = spawn.x;
    game.player.vy = 100;
    for (let f = 0; f < 120 && !game.player.grounded; f++) game.update(DT);
    expect(game.player.grounded).toBe(true);
    expect(game.stompChain).toBe(0);
    expect(game._chainBonusPaid).toBe(false);

    // A single airborne stomp from here starts a NEW chain of 1: no bonus.
    game.player.y -= 64;
    stompWalkerBelow(game);
    expect(game.score).toBe(25 + 25); // two kills total, zero chain payouts
    expect(game.popups.filter(p => p.text === '+30 CHAIN!').length).toBe(0);
});

test("a retry hands the level a fresh chain state", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    game.player.y -= 64;
    stompWalkerBelow(game);
    expect(game.stompChain).toBe(1);

    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe("GAME_OVER");
    document.getElementById('retry-btn').click();
    expect(game.state).toBe("PLAYING");
    expect(game.stompChain).toBe(0);
    expect(game._chainBonusPaid).toBe(false);
});

// --- Death-cut interaction (per-total policy, unchanged) ----------------------

test("the death penalty cuts the running total INCLUDING secret premiums", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 1, true);
    game.update(DT);
    expect(game.score).toBe(25);

    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe("GAME_OVER");
    // Per-TOTAL cut, mirroring every other component: floor(25 * 0.25) = 6.
    expect(game.score).toBe(25 - Math.floor(25 * 0.25)); // 19
});

test("the death penalty cuts a banked chain payout too", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    game.player.y -= 64;
    stompWalkerBelow(game);
    game.player.y -= 64;
    stompWalkerBelow(game);
    expect(game.score).toBe(80); // 25 + 25 + 30

    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe("GAME_OVER");
    expect(game.score).toBe(80 - Math.floor(80 * 0.25)); // 60
});

// --- No-damage clear bonus under the REAL damage model ------------------------
// Every deadly contact (enemy body, spiny back, cannonball, spike, pit,
// timeout) routes through handleGameOver, the ONLY writer of
// deathsOnCurrentLevel — so "no damage" == "zero deaths this attempt series".
// These pins exercise two real lethal causes plus the clean path.

test("a death anywhere on the level forfeits the no-damage bonus", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    noCoins(game);

    // Die once (pit cause here; every lethal route shares handleGameOver and
    // deathsOnCurrentLevel), retry, then clear: the death stands, so
    // NO_DAMAGE must NOT pay (and the clear bonus stays reduced too).
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe("GAME_OVER");
    expect(game.deathsOnCurrentLevel).toBe(1);
    document.getElementById('retry-btn').click();

    winCurrentLevel(game);
    expect(game.lastClearBreakdown.noDamageBonus).toBe(0);
    expect(document.getElementById('no-damage-bonus').hidden).toBe(true);
});

// --- Run-stats line on a carved-seam alcove level -----------------------------

// Fixture copied from alcove_secret_loop.test.js: canonical crag + the
// SHIPPED _carveAlcove path; k = 1..3 secret coins land in the chimney.
const CRAG = [
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "......##......",
    ".....####.....",
    ".....####.....",
    ".....####.....",
    "##############",
    "##############"
];
const SITE = { col: 6, entryRow: 9, h: 3, side: -1 };

function craftAlcoveLevel() {
    const lvl = new Level(10, T, 20261108);
    lvl.tiles = CRAG.map((r) => [...r].map((ch) => (ch === "#" ? 1 : 0)));
    lvl.width = 14;
    lvl.height = 12;
    lvl.coins.length = 0;
    lvl.pads.length = 0;
    lvl.crates.length = 0;
    lvl.enemyManager.enemies.length = 0;
    lvl.movingPlatforms = [];
    lvl.bridgeGap = null;
    lvl.shaftGap = null;
    lvl.extractHazards();
    lvl.platforms = lvl.extractPlatforms();
    for (const x of [1, 3, 4]) {
        lvl.coins.push({ x: x * T, y: 9 * T, width: 16, height: 16, collected: false });
    }
    lvl.portalTile = { x: 4, y: 9 };
    lvl.portal = { x: 4 * T, y: 9 * T, width: 32, height: 48 };
    lvl.spawnTile = { x: 1, y: 9 };
    lvl.spawnPoint = { x: 1 * T, y: 9 * T };
    lvl._carveAlcove(SITE);
    return lvl;
}

function startCrafted() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    game.currentLevel = 10;
    game.publishLevel(craftAlcoveLevel());
    return game;
}

test("completing a carved alcove level reports Secrets n/n and pays every tier", () => {
    const game = startCrafted();
    const secrets = game.level.coins.filter((c) => c.secret);
    expect(secrets.length).toBeGreaterThanOrEqual(1);
    const k = secrets.length;

    // Bank every secret THROUGH THE LOOP (teleport onto each cell — the
    // sanctioned seam-drop pattern; collection itself is shipped code).
    for (const s of secrets) {
        stepAirborne(game, s.x, s.y);
        expect(s.collected).toBe(true);
    }
    expect(game.runSecretsFound).toBe(k);
    expect(game.score).toBe(k * SECRET_COIN_SCORE);

    // Bank two REQUIRED terrace coins THROUGH THE LOOP. The third sits on the
    // portal cell — collecting it loop-side would open the gate mid-stand and
    // win the level right there — so winCurrentLevel's seam pass covers it.
    const terrace = game.level.coins.filter(x => !x.secret);
    expect(terrace.length).toBe(3);
    stepAirborne(game, terrace[0].x, terrace[0].y);
    expect(terrace[0].collected).toBe(true);
    stepAirborne(game, terrace[1].x, terrace[1].y);
    expect(terrace[1].collected).toBe(true);
    expect(game.score).toBe(k * SECRET_COIN_SCORE + 2 * COIN_POINTS);

    // Portal: flawless clear on an advanced-tier level (currentLevel 10 ->
    // clearBonusFor(0, 10) = 120) plus the +50 no-damage bonus.
    winCurrentLevel(game);
    expect(game.score).toBe(k * 25 + 20 + 120 + 50);
    expect(game.lastClearBreakdown).toEqual({
        coins: 20 + k * 25, combat: 0, clearBonus: 120, noDamageBonus: 50,
        enemiesBested: 0, deaths: 0, flawless: true,
        secretsFound: k, secretsTotal: k
    });

    // The run-stats line renders with real counts, and the no-damage line
    // rides alongside it.
    const secretsEl = document.getElementById('secrets-found');
    expect(secretsEl.hidden).toBe(false);
    expect(secretsEl.textContent).toBe(`Secrets: ${k}/${k}`);
    expect(document.getElementById('no-damage-bonus').textContent)
        .toBe('No-damage bonus +50');
});

test("an untouched alcove honestly reports Secrets: 0/k on the clear", () => {
    const game = startCrafted();
    const k = game.level.coins.filter((c) => c.secret).length;

    // Required coins only, then straight to the portal (chimney unvisited).
    winCurrentLevel(game);
    expect(game.lastClearBreakdown.secretsFound).toBe(0);
    expect(game.lastClearBreakdown.secretsTotal).toBe(k);
    const secretsEl = document.getElementById('secrets-found');
    expect(secretsEl.hidden).toBe(false); // the level DID hide secrets...
    expect(secretsEl.textContent).toBe(`Secrets: 0/${k}`); // ...none found
    expect(game.runSecretsFound).toBe(0);
});

test("runSecretsFound spans levels and resets only with a new run", () => {
    const game = startCrafted();
    const secrets = game.level.coins.filter((c) => c.secret);
    stepAirborne(game, secrets[0].x, secrets[0].y);
    expect(game.runSecretsFound).toBe(1);

    // Advancing to the NEXT level keeps the RUN total (it is a run stat).
    winCurrentLevel(game);
    for (let i = 0; i < 3 && game.state === "LEVEL_COMPLETE"; i++) {
        game.update(0.8);
    }
    expect(game.state).toBe("PLAYING");
    expect(game.runSecretsFound).toBe(1);

    // A brand-new run zeroes it (session-only, never persisted).
    game.startGame();
    expect(game.runSecretsFound).toBe(0);
});
