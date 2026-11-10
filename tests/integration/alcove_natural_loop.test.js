// Integration: W3b NATURAL stamped alcoves through the shipped main.js loop.
// Where alcove_secret_loop.test.js crafts a host fixture, this file pins the
// GENERATOR's own output: real seeded maps that ship a carved face chamber
// (class B, horizontal — the new host shape) and a real vertical stamp, each
// climbed with scripted alternating kicks inside the live loop, secrets
// collected and scored, and the portal completing WITHOUT any secret touched
// (R4 stays sacred on every host class). Seeds are fixed and deterministic;
// they sit in the W3b report's natural-stamp table.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";
import { Level } from "../../js/level.js";
import { COIN_POINTS, SECRET_COIN_SCORE } from "../../js/collectibles.js";

const DT = 1 / 60;
const T = 32;

// [label, levelNumber, seed] — verified natural stamps (see W3b report):
// CANYONS horizontal face chamber (side -1), CAVERNS horizontal face
// chamber (side +1), CAVERNS vertical stamp h=5 (side +1).
const MAPS = [
    ["canyons-H-side-1", 13, 2825904],
    ["caverns-H-side+1", 18, 2132396],
    ["caverns-V-h5", 16, 7038821]
];

function startNatural(levelNumber, seed) {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    game.currentLevel = levelNumber;
    const lvl = new Level(levelNumber, T, seed);
    // Non-vacuity: these seeds MUST ship a carved alcove through the real
    // generator — if prevalence ever drifts such that they don't, fail loud
    // rather than silently skip.
    if (!lvl.getAlcove()) {
        throw new Error(`seed ${seed}@L${levelNumber} no longer ships an alcove`);
    }
    game.publishLevel(lvl);
    return game;
}

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

// The proven alternating climber (alcove_secret_loop doctrine) with the
// W3b natural-host refinement: hop while steering DEEP (away from the open
// mouth) when grounded — hopping toward the mouth lets the bottom-row wall
// kick slide the player straight back out through the tunnel cell (measured
// on natural side=+1 hosts). Mid-air steering stays face-toward-the-wall:
// FRESH push only after the air latch opens, kick whenever a not-yet-used
// face reports contact past the lock.
function climber(p, deepRight) {
    if (p.grounded) return deepRight
        ? { r: true, press: true }
        : { l: true, press: true };
    const towardR = p.wallSide !== 1;
    const fresh = p._airFrames > 2;
    const press = p.wallSide !== 0 && p.wallLockTimer <= 0 &&
        p.wallSide !== p.lastKickSide;
    return { press, l: towardR ? false : fresh, r: towardR ? fresh : false };
}

for (const [label, levelNumber, seed] of MAPS) {
    test(`${label}: scripted climb collects every secret coin`, () => {
        const game = startNatural(levelNumber, seed);
        const lvl = game.level;
        const a = lvl.getAlcove();
        const secrets = lvl.coins.filter((c) => c.secret);
        expect(secrets.length).toBeGreaterThanOrEqual(1);
        const scoreBefore = game.score;
        const p = game.player;
        // Stand on the mouth terrace, walk in, then alternate-kick up.
        const terraceX = a.side === -1 ? a.col - 2 : a.col + 3;
        p.x = terraceX * T + 2;
        p.y = a.entryRow * T;
        p.vx = 0; p.vy = 0;
        const keys = makeKeys();
        const deepRight = a.side === -1; // mouth sits opposite the deep wall
        let entered = false;
        // Inside = player's box has crossed to the SHAFT CENTRE column
        // (edge thresholds let the climb start while still half in the
        // tunnel cell, where the first kick escapes outward).
        const insideX = a.side === -1
            ? () => p.x >= (a.col + 1) * T - 6
            : () => p.x <= (a.col + 1) * T + 6;
        for (let f = 0; f < 2000 && !secrets.every((c) => c.collected); f++) {
            let inp;
            if (!entered) {
                inp = { r: a.side === -1, l: a.side === 1 };
                if (p.grounded && insideX()) entered = true;
            } else {
                inp = climber(p, deepRight);
            }
            keys(inp);
            game.update(DT);
        }
        expect(entered, `${label}: entered the mouth`).toBe(true);
        expect(secrets.every((c) => c.collected), `${label}: all secrets`)
            .toBe(true);
        const bankedNormal = lvl.coins.filter(
            (c) => c.collected && !c.secret).length;
        const bankedSecret = lvl.coins.filter(
            (c) => c.collected && c.secret).length;
        expect(game.score - scoreBefore)
            .toBe(bankedNormal * COIN_POINTS + bankedSecret * SECRET_COIN_SCORE);
    }, 60000);
}

test("natural stamped maps: portal completes with every secret untouched", () => {
    for (const [, levelNumber, seed] of MAPS) {
        const game = startNatural(levelNumber, seed);
        const lvl = game.level;
        lvl.coins.forEach((coin, i) => {
            if (!coin.secret) game.collectibles.collectCoin(i);
        });
        const p = game.player;
        p.x = lvl.portalTile.x * T + 2;
        p.y = lvl.portalTile.y * T - 10;
        p.vx = 0; p.vy = 0;
        for (let f = 0; f < 10; f++) game.update(DT);
        expect(p.hasReachedPortal(), `L${levelNumber}/${seed}`).toBe(true);
        expect(lvl.coins.some((c) => c.secret && !c.collected),
            `L${levelNumber}/${seed} secrets intact`).toBe(true);
    }
}, 60000);
