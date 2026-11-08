// Integration: M4 secret alcoves through the SHIPPED main.js loop (Game.
// publishLevel + Game.update with synthetic keyboard events). Pins what unit
// tests cannot: a carved chimney actually climbed with scripted alternating
// kicks inside the live loop, the secret pickup scoring, the HUD chip
// showing REQUIRED-only counts (R4), and the portal completing the level
// WITHOUT the secret ever being touched.
//
// The generator ships ~0% natural alcoves today (heightmap terrain — see
// tests/unit/level_alcove.test.js header), so this test crafts a host crag
// onto a real Level via the sanctioned fixture seam (swap tiles, re-derive
// platforms, clear derived object sets) and carves through the SHIPPED
// _carveAlcove path before publishing. Everything downstream of the carve is
// shipped code.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";
import { Level } from "../../js/level.js";
import { COIN_POINTS } from "../../js/collectibles.js";

const DT = 1 / 60;
const T = 32;
const W = 14;
const H = 12;

// Canonical crag (same fixture as the unit files): terrace cols 0..4 at row
// 9 over full ground; massif cols 5..8; site {col:6, entryRow:9, h:3, side:-1}.
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
    lvl.width = W;
    lvl.height = H;
    // Clear everything derived from the ORIGINAL grid, then re-derive for
    // the crafted one (the documented swap seam: platforms/hazards re-extract
    // idempotently; enemies/pads/crates/decks are emptied outright).
    lvl.coins.length = 0;
    lvl.pads.length = 0;
    lvl.crates.length = 0;
    lvl.enemyManager.enemies.length = 0;
    lvl.movingPlatforms = [];
    lvl.bridgeGap = null;
    lvl.shaftGap = null;
    lvl.extractHazards(); // crafted grid has no teeth -> empty list
    lvl.platforms = lvl.extractPlatforms();
    // Three ordinary coins on the terrace strip (keeps the >= 3 floor and
    // gives the R4 HUD a required subset strictly smaller than the total).
    for (const x of [1, 3, 4]) {
        lvl.coins.push({ x: x * T, y: 9 * T, width: 16, height: 16, collected: false });
    }
    // Portal on the terrace between spawn and mouth; locked portals are
    // inert, so the climb route past it stays safe.
    lvl.portalTile = { x: 4, y: 9 };
    lvl.portal = { x: 4 * T, y: 9 * T, width: 32, height: 48 };
    lvl.spawnTile = { x: 1, y: 9 };
    lvl.spawnPoint = { x: 1 * T, y: 9 * T };
    // SHIPPED carve.
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

// Keyboard driver: syncs held direction keys to the policy's booleans and
// taps Space on press frames. Transitions land inside one frame, so the
// player's air-intent latch sees fresh presses exactly like a human tap.
function makeKeys() {
    const held = new Set();
    const setKey = (code, down) => {
        if (down && !held.has(code)) {
            held.add(code);
            window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        } else if (!down && held.has(code)) {
            held.delete(code);
            window.dispatchEvent(new KeyboardEvent('keyup', { code }));
        }
    };
    return (inp) => {
        setKey('ArrowLeft', !!inp.l);
        setKey('ArrowRight', !!inp.r);
        if (inp.press) {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        }
    };
}

// Alternating climber (wall_jump_loop doctrine) expressed as key intents.
function climber(p) {
    if (p.grounded) return { r: true, press: true };
    const towardR = p.wallSide !== 1;
    const fresh = p._airFrames > 2;
    const press = p.wallSide !== 0 && p.wallLockTimer <= 0 &&
        p.wallSide !== p.lastKickSide;
    return { press, l: towardR ? false : fresh, r: towardR ? fresh : false };
}

test("climbing the carved chimney collects the secret coins and scores them", () => {
    const game = startCrafted();
    const secrets = game.level.coins.filter((c) => c.secret);
    expect(secrets.length).toBeGreaterThanOrEqual(1);
    const scoreBefore = game.score;
    const p = game.player;
    p.x = 3 * T;
    p.y = 9 * T;
    p.vx = 0; p.vy = 0;
    const keys = makeKeys();
    let entered = false;
    let collectedAllAt = -1;
    for (let f = 0; f < 1500; f++) {
        let inp;
        if (!entered) {
            // Walk into the mouth first.
            inp = { r: true };
            if (p.grounded && p.x >= 6 * T - 4) entered = true;
        } else {
            inp = climber(p);
        }
        keys(inp);
        game.update(DT);
        if (entered && secrets.every((c) => c.collected) && collectedAllAt < 0) {
            collectedAllAt = f;
            break;
        }
    }
    expect(entered).toBe(true);
    expect(collectedAllAt).toBeGreaterThan(-1);
    // Every coin banked during the run (the two terrace coins brushed on the
    // walk in, plus all secrets) pays COIN_POINTS each through the loop.
    const banked = game.level.coins.filter((c) => c.collected).length;
    expect(game.score - scoreBefore).toBe(banked * COIN_POINTS);
    expect(secrets.every((c) => c.collected)).toBe(true);
});

test("HUD chip counts REQUIRED coins only (R4)", () => {
    const game = startCrafted();
    const total = game.level.coins.length;
    const required = total - game.level.coins.filter((c) => c.secret).length;
    expect(total).toBeGreaterThan(required); // secrets exist for this fixture
    const text = document.getElementById('coins-display').textContent;
    expect(text).toBe(`Coins: 0/${required}`);
    // Bank every required coin: the gate opens and the chip reads full while
    // the secret stays out there.
    game.level.coins.forEach((coin, i) => {
        if (!coin.secret) game.collectibles.collectCoin(i);
    });
    game._updateCoinHud();
    expect(document.getElementById('coins-display').textContent)
        .toBe(`Coins: ${required}/${required}`);
    expect(game.collectibles.meetsPortalRequirement()).toBe(true);
    expect(game.level.coins.some((c) => c.secret && !c.collected)).toBe(true);
});

test("portal completes the level WITHOUT the secret being collected", () => {
    const game = startCrafted();
    game.level.coins.forEach((coin, i) => {
        if (!coin.secret) game.collectibles.collectCoin(i);
    });
    const p = game.player;
    // Straight onto the portal cell; the chimney was never entered.
    p.x = 4 * T + 2;
    p.y = 8 * T - 10;
    p.vx = 0; p.vy = 0;
    for (let f = 0; f < 10; f++) game.update(DT);
    expect(p.hasReachedPortal()).toBe(true);
    expect(game.level.coins.some((c) => c.secret && !c.collected)).toBe(true);
});
