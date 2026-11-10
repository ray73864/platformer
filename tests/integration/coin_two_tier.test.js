// Integration: W1 two-tier coin economy READS that way (owner ruling
// 2026-11-10: "if there are 15 coins and 5 of those are secret, then really
// there is only 10 coins to complete the level with 5 coins that will give
// you extra points"). The portal mechanic already excluded secrets (R4);
// these pins hold the VISIBILITY contract through the shipped main.js loop:
//   * HUD chip denominator = required-only, never demands the secrets;
//   * star badge appears exactly when the first secret banks and tracks the
//     count — hidden while zero, so it never spoils where secrets hide;
//   * the portal opens at required/required with every secret uncollected;
//   * LEVEL_COMPLETE separates the tiers with correct bonus math
//     ("Coins 3/3 · Secrets 2/2★ (+50)", premium = SECRET_COIN_SCORE each).
// Constructed-level seam per alcove_secret_loop.test.js doctrine: craft the
// grid, push EXACTLY 3 normal + 2 secret coins (deterministic, no carve RNG),
// publish through the shipped Game.publishLevel. Everything downstream of the
// publish is shipped code.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";
import { Level } from "../../js/level.js";
import { COIN_POINTS, SECRET_COIN_SCORE } from "../../js/collectibles.js";

const DT = 0.016;
const GRAVITY = 980; // mirrors main.js (not exported); cancels one Euler tick
const T = 32;

// Flat terrace over full ground: open air everywhere above row 10, so every
// teleport-seam pickup lands in free space. Portal far right, away from all
// coins, so collecting a coin can never win the level mid-pin.
const MAP = [
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "##############",
    "##############"
];

function craftTwoTierLevel() {
    const lvl = new Level(10, T, 20261110);
    lvl.tiles = MAP.map((r) => [...r].map((ch) => (ch === "#" ? 1 : 0)));
    lvl.width = 14;
    lvl.height = 12;
    // Clear everything derived from the ORIGINAL grid (documented swap seam).
    lvl.coins.length = 0;
    lvl.pads.length = 0;
    lvl.crates.length = 0;
    lvl.enemyManager.enemies.length = 0;
    lvl.movingPlatforms = [];
    lvl.bridgeGap = null;
    lvl.shaftGap = null;
    lvl.extractHazards();
    lvl.platforms = lvl.extractPlatforms();
    // Exactly 3 REQUIRED coins on the deck floor.
    for (const x of [1, 3, 4]) {
        lvl.coins.push({ x: x * T, y: 9 * T, width: 16, height: 16,
            collected: false });
    }
    // Exactly 2 SECRET coins floating one tier up (position is irrelevant to
    // the economy paths pinned here; the loop collects them via the same
    // AABB pass as normal coins).
    for (const x of [2, 3]) {
        lvl.coins.push({ x: x * T, y: 7 * T, width: 16, height: 16,
            collected: false, secret: true });
    }
    lvl.portalTile = { x: 11, y: 9 };
    lvl.portal = { x: 11 * T, y: 9 * T, width: 32, height: 48 };
    lvl.spawnTile = { x: 1, y: 9 };
    lvl.spawnPoint = { x: 1 * T, y: 9 * T };
    return lvl;
}

function startCrafted() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    game.currentLevel = 10;
    game.publishLevel(craftTwoTierLevel());
    return game;
}

// One scripted frame: teleport, cancel gravity, keep the hero AIRBORNE
// (score_economy / style_rewards doctrine — collection itself is shipped).
function stepAirborne(game, x, y) {
    game.player.x = x;
    game.player.y = y;
    game.player.vx = 0;
    game.player.vy = -(GRAVITY * DT);
    game.player.grounded = false;
    game.update(DT);
}

const chip = () => document.getElementById('coins-display');
const badge = () => document.getElementById('coin-bonus');

test("HUD chip demands REQUIRED coins only; a banked secret never joins the fraction", () => {
    const game = startCrafted();
    expect(chip().textContent).toBe('Coins: 0/3'); // not 0/5
    // Bank a SECRET through the loop: score moves, the chip does not.
    const secret = game.level.coins.find(c => c.secret);
    stepAirborne(game, secret.x, secret.y);
    expect(secret.collected).toBe(true);
    expect(game.score).toBe(SECRET_COIN_SCORE);
    expect(chip().textContent).toBe('Coins: 0/3');
    expect(game.collectibles.meetsPortalRequirement()).toBe(false);
    // Required pickups advance it one by one, still out of 3.
    const normals = game.level.coins.filter(c => !c.secret);
    stepAirborne(game, normals[0].x, normals[0].y);
    expect(chip().textContent).toBe('Coins: 1/3');
});

test("star badge appears exactly after the first secret and tracks the count", () => {
    const game = startCrafted();
    expect(badge().hidden).toBe(true); // zero found: nothing shown, no spoiler
    const secrets = game.level.coins.filter(c => c.secret);
    stepAirborne(game, secrets[0].x, secrets[0].y);
    expect(badge().hidden).toBe(false);
    expect(badge().textContent).toBe('+1\u2605');
    stepAirborne(game, secrets[1].x, secrets[1].y);
    expect(badge().textContent).toBe('+2\u2605');
    // Required pickups afterwards leave the badge alone.
    const normals = game.level.coins.filter(c => !c.secret);
    stepAirborne(game, normals[0].x, normals[0].y);
    expect(badge().textContent).toBe('+2\u2605');
});

// W6 WCAG spot-check (World Program): "+N★" explores as "plus N black star"
// — meaningless. The badge therefore carries role="img" plus a spoken
// equivalent for direct AT exploration (a generic span cannot host
// aria-label), while dynamic changes keep riding the polite region exactly
// once per increment (W1 doctrine unchanged, pinned below the fold).
test("W6 WCAG: the star badge explores as spoken text, not glyph noise", () => {
    const game = startCrafted();
    expect(badge().getAttribute('role')).toBe(null); // zero: no label either
    const secrets = game.level.coins.filter(c => c.secret);
    stepAirborne(game, secrets[0].x, secrets[0].y);
    expect(badge().getAttribute('role')).toBe('img');
    expect(badge().getAttribute('aria-label')).toBe('1 bonus coin');
    stepAirborne(game, secrets[1].x, secrets[1].y);
    expect(badge().getAttribute('aria-label')).toBe('2 bonus coins');
    // Fix round N-3: a fresh-level reset must strip the spoken label too —
    // a hidden-but-labelled badge would still answer direct AT exploration
    // with a stale "2 bonus coins" on a level that has none banked.
    game.ui.updateSecretBadge(0);
    expect(badge().hidden).toBe(true);
    expect(badge().getAttribute('role')).toBe(null);
    expect(badge().getAttribute('aria-label')).toBe(null);
});

test("portal opens at 3/3 with BOTH secrets still uncollected", () => {
    const game = startCrafted();
    const normals = game.level.coins.filter(c => !c.secret);
    for (const n of normals) stepAirborne(game, n.x, n.y);
    expect(game.collectibles.meetsPortalRequirement()).toBe(true);
    expect(chip().textContent).toBe('Coins: 3/3');
    expect(game.level.coins.every(c => c.secret || c.collected)).toBe(true);
    // Straight onto the portal: the chimney-less route completes the level.
    const portal = game.level.portal;
    stepAirborne(game, portal.x, portal.y);
    expect(game.state).toBe('LEVEL_COMPLETE');
    expect(game.level.coins.filter(c => c.secret && !c.collected).length)
        .toBe(2);
});

test("LEVEL_COMPLETE separates required completion from the bonus tier", () => {
    const game = startCrafted();
    const normals = game.level.coins.filter(c => !c.secret);
    const secrets = game.level.coins.filter(c => c.secret);
    for (const n of normals) stepAirborne(game, n.x, n.y);
    for (const s of secrets) stepAirborne(game, s.x, s.y);
    expect(game.score).toBe(3 * COIN_POINTS + 2 * SECRET_COIN_SCORE); // 80
    const portal = game.level.portal;
    stepAirborne(game, portal.x, portal.y);
    expect(game.state).toBe('LEVEL_COMPLETE');

    // Flawless advanced-tier clear (currentLevel 10 -> 120 + 50 no-damage).
    expect(game.lastClearBreakdown).toEqual({
        coins: 80, combat: 0, clearBonus: 120, noDamageBonus: 50,
        enemiesBested: 0, deaths: 0, flawless: true,
        secretsFound: 2, secretsTotal: 2,
        coinsRequired: 3, coinsCollected: 3,
        secretBonus: 2 * SECRET_COIN_SCORE // 50 = the bonus half of `coins`
    });
    const line = document.getElementById('secrets-found');
    expect(line.hidden).toBe(false);
    expect(line.textContent)
        .toBe('Coins 3/3 \u00b7 Secrets 2/2\u2605 (+50)');
});

test("an untouched alcove still reports both tiers honestly", () => {
    const game = startCrafted();
    const normals = game.level.coins.filter(c => !c.secret);
    for (const n of normals) stepAirborne(game, n.x, n.y);
    stepAirborne(game, game.level.portal.x, game.level.portal.y);
    expect(game.state).toBe('LEVEL_COMPLETE');
    expect(game.lastClearBreakdown.secretBonus).toBe(0);
    const line = document.getElementById('secrets-found');
    expect(line.hidden).toBe(false); // the level DID hide secrets...
    expect(line.textContent).toBe('Coins 3/3 \u00b7 Secrets 0/2\u2605'); // ...none found
});

test("the badge is per-level: a fresh publish hides it again", () => {
    const game = startCrafted();
    const secret = game.level.coins.find(c => c.secret);
    stepAirborne(game, secret.x, secret.y);
    expect(badge().hidden).toBe(false);
    // Publish a brand-new attempt of a fresh level (same seam as level
    // advance): the chip AND the badge reset to this level's progress.
    game.currentLevel = 11;
    game.publishLevel(craftTwoTierLevel());
    expect(badge().hidden).toBe(true);
    expect(chip().textContent).toBe('Coins: 0/3');
});

test("a level without secrets never shows the badge", () => {
    const game = startCrafted();
    // Drop both secrets from the adopted ledger: pure-required level.
    game.level.coins.splice(3, 2);
    game._updateCoinHud();
    const normals = game.level.coins.filter(c => !c.secret);
    expect(normals.length).toBe(3);
    for (const n of normals) stepAirborne(game, n.x, n.y);
    expect(chip().textContent).toBe('Coins: 3/3');
    expect(badge().hidden).toBe(true);
});
