// Integration: M3 pads + crates through the SHIPPED main.js loop (Game.update
// with synthetic keyboard events — the same seam driver3 uses). Pins what
// unit tests cannot: the launch fires from real terrain resolution (vyBefore-
// Resolve gate, deck pass ordering), the measured discrete apex envelope in
// the live loop, crate engagement + bounded real travel under real input on
// the reviewer's proof map (channel containment asserted through the shipped
// loop), push-dust FX gating, and the degrade-path vector draws
// surviving game.draw(). The apex claim is the EMPIRICAL 123.86 px (semi-
// implicit Euler undershoots the continuous 128 — see pads.js header; a plain
// 4-cell ledge is therefore NOT clearable by a bounce alone, and no shipped
// route asks it to be).
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";
import { PAD_IMPULSE } from "../../js/pads.js";
import { FX } from "../../js/fx.js";

const DT = 1 / 60;
// Fixtures harvested from the generator (deterministic per seed):
// W3a RE-HARVESTED: L11 now lives in CANYONS, so the old M3-era fixtures
// moved. L11 s40943818 ships one pad at cell (8,16) and no crate;
// L16 s600048 (CAVERNS) ships one crate seated at col 12 row 20 with a
// 4-cell channel [11..14] — the same push-proof geometry the reviewer used
// on the pre-world L25 s607974.
const PAD_LEVEL = 11;
const PAD_SEED = 40943818;
const CRATE_LEVEL = 16;
const CRATE_SEED = 600048;

function startAt(levelNumber, seed) {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    game.levelSeeds.set(levelNumber, seed);
    game.currentLevel = levelNumber;
    game.startLevel();
    return game;
}

test("the published level carries its pad object; L1-era levels carry none", () => {
    const padded = startAt(PAD_LEVEL, PAD_SEED);
    expect(padded.pads.length).toBe(1);
    expect(padded.crate).toBe(null);
    const plain = startAt(3, PAD_SEED); // below tier gate
    expect(plain.pads.length).toBe(0);
    expect(plain.crate).toBe(null);
});

test("falling onto a pad launches at exactly -PAD_IMPULSE with the measured rise", () => {
    const game = startAt(PAD_LEVEL, PAD_SEED);
    const pad = game.pads[0];
    const p = game.player;
    // Drop from chest height above the plate, centred, zero velocity.
    p.x = pad.x + 4;
    p.y = pad.y + pad.height - p.height - 60;
    p.vx = 0; p.vy = 0;
    const contactY = pad.y + pad.height - p.height; // feet flush on floor line
    let launchVy = null;
    let minY = p.y;
    for (let f = 0; f < 90; f++) {
        game.update(DT);
        if (launchVy === null && p.vy <= -PAD_IMPULSE + 1e-9) launchVy = p.vy;
        if (p.y < minY) minY = p.y;
        if (launchVy !== null && p.vy >= 0) break; // apex reached
    }
    expect(launchVy).not.toBe(null);
    expect(launchVy).toBeCloseTo(-PAD_IMPULSE, 6);
    // Rise envelope measured from the CONTACT line: discrete truth ~123.86,
    // strictly under continuous 128, comfortably above a 3-row lift.
    const rise = contactY - minY;
    expect(rise).toBeGreaterThan(3 * 32);
    expect(rise).toBeLessThan(4 * 32);
});

test("pushing a crate travels it inside its channel and kicks dust", () => {
    // MN-1 survivors always seat strictly inside the channel, so a real map
    // delivers genuine bounded travel: from col 12 leftward to the blocker
    // at col 11 (32 px), never past channelLeft (containment through the
    // SHIPPED loop incl the crate-only wall path).
    const game = startAt(CRATE_LEVEL, CRATE_SEED);
    const crate = game.crate;
    expect(crate).not.toBe(null);
    const T = 32;
    const desc = game.level.getCrates()[0];
    const p = game.player;
    // Drop into the free cell right of the crate, feet on the channel floor.
    const floorLine = crate.y + crate.height;
    p.x = crate.x + crate.width;
    p.y = floorLine - p.height;
    p.vx = 0; p.vy = 0;
    for (let f = 0; f < 5; f++) game.update(DT); // settle
    const dustBefore = game.dust.length;
    const x0 = crate.x;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    let pushedFrames = 0;
    for (let f = 0; f < 90; f++) {
        game.update(DT);
        if (crate.pushed) pushedFrames++;
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    expect(pushedFrames).toBeGreaterThan(10);            // engagement works
    expect(crate.x).toBeLessThan(x0);                    // REAL travel
    expect(crate.x).toBeGreaterThanOrEqual(desc.channelLeft * T); // contained
    expect(game.dust.length).toBeGreaterThan(dustBefore); // push-dust cadence
});

test("standing on a crate never drags it", () => {
    const game = startAt(CRATE_LEVEL, CRATE_SEED);
    const crate = game.crate;
    const p = game.player;
    // W3a fixture hygiene (same seam as the push tests): DROP from just
    // above the box and settle, instead of teleport-flush — a flush
    // teleport leaves stale prevX/prevY that trip the push detector's
    // vertical-overlap gate and eject the rider off the seat.
    p.x = crate.x + 4;
    p.y = crate.y - p.height - 24;
    p.vx = 0; p.vy = 0;
    for (let f = 0; f < 10; f++) game.update(DT); // land flush on top
    expect(p.grounded).toBe(true);
    const x0 = crate.x;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
    for (let f = 0; f < 30; f++) game.update(DT);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));
    expect(crate.x).toBe(x0);   // rider friction is not towing the box
});

test("FX.dust off silences strain dust but never the engagement itself", () => {
    const game = startAt(CRATE_LEVEL, CRATE_SEED);
    const crate = game.crate;
    const p = game.player;
    p.x = crate.x + crate.width;
    p.y = crate.y + crate.height - p.height;
    p.vx = 0; p.vy = 0;
    for (let f = 0; f < 5; f++) game.update(DT); // settle
    FX.dust = false;
    try {
        const dustBefore = game.dust.length;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
        let pushedFrames = 0;
        for (let f = 0; f < 40; f++) {
            game.update(DT);
            if (crate.pushed) pushedFrames++;
        }
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
        expect(pushedFrames).toBeGreaterThan(10);       // mechanic FX-immune
        expect(game.dust.length).toBe(dustBefore);      // spawn gated
    } finally {
        FX.dust = true;
    }
});

test("degrade-path vector draws survive game.draw() with objects on screen", () => {
    // No sheet art exists for pads/crates — the vector path IS the primary
    // path; the shared stub ctx only asserts call existence.
    for (const [lvl, seed] of [[PAD_LEVEL, PAD_SEED], [CRATE_LEVEL, CRATE_SEED]]) {
        const game = startAt(lvl, seed);
        for (let f = 0; f < 10; f++) game.update(DT);
        expect(() => game.draw()).not.toThrow();
    }
});

test("retry rebuilds byte-identical placements (stored-seed replay)", () => {
    const game = startAt(PAD_LEVEL, PAD_SEED);
    const padsA = JSON.parse(JSON.stringify(game.level.getPads()));
    const crateA = JSON.parse(JSON.stringify(game.level.getCrates()));
    game.startLevel(); // same stored seed path a retry takes
    expect(game.level.getPads()).toEqual(padsA);
    expect(game.level.getCrates()).toEqual(crateA);
});
