// Integration: the shipped Player + Physics + EnemyManager composed in the
// main.js frame order, pinning the M2 claims unit mocks cannot: a dash buys
// real horizontal reach WITHOUT touching the gravity channel, and it grants
// NO contact immunity — dashing into a hostile body kills exactly as a normal
// collision does, while a falling stomp still bounces mid-burst. Plus the
// Game-level wiring: KeyX fires the burst, held X never refires (autorepeat),
// PAUSED gates presses out entirely, pause mid-dash cancels the burst, and
// the streak/dust FX spawn gates honour js/fx.js flags.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";
import { Player, DASH_TIME } from "../../js/player.js";
import { Physics } from "../../js/physics.js";
import { EnemyManager } from "../../js/enemies.js";
import { Hazards } from "../../js/hazards.js";
import { ProjectileManager } from "../../js/projectiles.js";
import { FX } from "../../js/fx.js";

const DT = 1 / 60;
const GRAVITY = 980;
const MAX_FALL = 600;
const STOMP_BOUNCE = 260; // main.js loop constant (mirrored here for the sim)

// Flat world: one wide floor rect at y=320.
const FLOOR = [{ x: -2000, y: 320, width: 8000, height: 64 }];

// One frame in EXACT main.js order (no decks/projectiles on this fixture).
function stepFrame(p, physics, em, input = {}) {
    p.prevX = p.x;
    p.prevY = p.y;
    if (input.dash) p.pressDash();
    p.update(DT, !!input.l, !!input.r, {});
    physics.applyGravity(p, DT);
    physics.resolveCollisions(p, physics.checkCollisions(p, FLOOR));
    em.updateAll(DT, p);
    const contact = em.resolvePlayerContact(p);
    if (contact.stomped > 0) {
        p.vy = -STOMP_BOUNCE;
        p.coyoteTimer = 0;
        p.jumpCutAvailable = false;
    }
    return contact;
}

function groundRunner() {
    const physics = new Physics(GRAVITY, MAX_FALL);
    const em = new EnemyManager();
    return { physics, em };
}

test("dash INTO a walker is death — the burst grants no immunity", () => {
    const { physics, em } = groundRunner();
    em.addEnemy(300, 320 - 32, 280, 360, 'walker');
    const p = new Player(250, 320 - 32, 200, 350); // close enough to meet mid-burst
    p.grounded = true;
    let deadly = false, frames = 0, timerAtDeath = 0;
    p.pressDash(); // face right (default) → burst straight at the patrol
    for (let f = 0; f < 30 && !deadly; f++) {
        const c = stepFrame(p, physics, em);
        if (c.deadly) { deadly = true; timerAtDeath = p.dashTimer; frames = f; }
    }
    expect(deadly).toBe(true);
    // The contact lands WHILE the burst still owns vx (mid-dash death):
    // dash state never suppresses resolvePlayerContact.
    expect(frames).toBeLessThan(9);
    expect(timerAtDeath).toBeGreaterThan(0);
});

test("dash INTO a spiny is death by spiny — same rule, spiked back", () => {
    const { physics, em } = groundRunner();
    em.addEnemy(300, 320 - 32, 280, 360, 'spiny');
    const p = new Player(200, 320 - 32, 200, 350);
    p.grounded = true;
    p.pressDash();
    let out = null;
    for (let f = 0; f < 30 && !out; f++) {
        const c = stepFrame(p, physics, em);
        if (c.deadly) out = c.deadlyBySpiny ? 'spiny' : 'enemy';
    }
    expect(out).toBe('spiny');
});

test("falling stomp of a charger mid-dash bounces normally (stompable stays stompable)", () => {
    const { physics, em } = groundRunner();
    em.addEnemy(320, 320 - 32, 280, 400, 'charger');
    const p = new Player(250, 320 - 32 - 90, 200, 350); // above and left
    p.vy = 200;                 // committed descent
    p.pressDash();              // horizontal burst toward the body
    let stomped = 0, deadly = false;
    for (let f = 0; f < 60 && !stomped && !deadly; f++) {
        const c = stepFrame(p, physics, em);
        stomped = c.stomped;
        deadly = c.deadly;
    }
    expect(deadly).toBe(false);
    expect(stomped).toBe(1);
    expect(em.enemies[0].isDead()).toBe(true);
    expect(p.vy).toBe(-STOMP_BOUNCE); // the loop's bounce applied over the dash
});

test("dash extends airborne reach without altering the vertical channel", () => {
    const run = (withDash) => {
        const { physics, em } = groundRunner(); // empty manager: pure ballistics
        const p = new Player(100, 320 - 32, 200, 350);
        p.grounded = true;
        p.jump();                       // identical launch both runs
        if (withDash) p.pressDash();
        const vys = [];
        for (let f = 0; f < 40; f++) {
            stepFrame(p, physics, em, { r: true });
            vys.push(p.vy);
        }
        return { x: p.x, vys };
    };
    const base = run(false);
    const dashed = run(true);
    // Vertical channel byte-identical: the flat burst never writes vy.
    expect(dashed.vys).toEqual(base.vys);
    // Horizontal reach strictly greater (monotonic addition, felt).
    expect(dashed.x).toBeGreaterThan(base.x + 30);
});

// --- Game-level wiring ---------------------------------------------------------

function startPlaying() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    return game;
}

test("KeyX press fires the live burst and spawns the dust tell", () => {
    const game = startPlaying();
    game.update(1 / 60); // one resolver tick: spawn contact makes grounded
    const dustBefore = game.dust.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
    expect(game.player.grounded).toBe(true);
    expect(game.player.dashTimer).toBe(DASH_TIME);
    expect(game.player.dashCooldown).toBe(0.8);
    expect(game.dust.length).toBeGreaterThan(dustBefore); // FX.dust spawn gate
    game.update(1 / 60);
    expect(game._dashGhosts.length).toBeGreaterThan(0);   // FX.trails spawn gate
});

test("held X never refires after the burst expires (autorepeat filtered)", () => {
    const game = startPlaying();
    game.update(1 / 60); // ground the spawn before the press
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
    for (let f = 0; f < 12; f++) game.update(1 / 60); // burst done, key still down
    expect(game.player.dashTimer).toBe(0);
    const cd = game.player.dashCooldown;
    for (let f = 0; f < 10; f++) game.update(1 / 60);
    expect(game.player.dashTimer).toBe(0);             // no second burst…
    expect(game.player.dashCooldown).toBeLessThan(cd); // …cooldown just drains
});

test("PAUSED gates dash presses out entirely", () => {
    const game = startPlaying();
    game.togglePause();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
    expect(game.player.dashTimer).toBe(0);
    expect(game.player.dashCooldown).toBe(0);          // nothing charged either
});

test("pause mid-dash drops the pending burst (cancelFeel precedent)", () => {
    const game = startPlaying();
    game.update(1 / 60); // ground the spawn before the press
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
    game.update(1 / 60);                               // one burst frame + ghost
    game.togglePause();
    expect(game.player.dashTimer).toBe(0);
    expect(game.player.dashDir).toBe(0);
    // No refund: resuming cannot re-fire the spent arc/grounded dash until
    // the cooldown has fully drained (charged at initiation, untouched).
    game.togglePause();
    expect(game.player.pressDash()).toBe(false);
});

test("FX flags gate the streak and dust spawns (mechanic itself stays FX-immune)", () => {
    const game = startPlaying();
    game.update(1 / 60); // ground the spawn before the press
    FX.trails = false;
    FX.dust = false;
    try {
        const dustBefore = game.dust.length;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }));
        expect(game.player.dashTimer).toBe(DASH_TIME); // mechanic unaffected
        expect(game.dust.length).toBe(dustBefore);     // dust spawn gated
        game.update(1 / 60);
        expect(game._dashGhosts.length).toBe(0);       // streak spawn gated
    } finally {
        FX.trails = true;
        FX.dust = true;
    }
});

test("draw pipeline survives an active streak (ghost pass under FX.trails)", () => {
    const game = startPlaying();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
    game.update(1 / 60);
    // The dash impulse frame makes _lean non-zero (rotate transform), and a
    // random spawn-adjacent coin may have banked a popup (strokeText): the
    // shared setup.js stub lacks both — extend it LOCALLY for this fixture
    // (same spirit as its own moveTo/lineTo additions — call-existence only).
    Object.assign(game.ctx, {
        rotate: () => {},
        strokeText: () => {}
    });
    expect(() => game.draw()).not.toThrow();
});

// --- R3 fold-in pins (review adjudication, M2): NO contact i-frames -------
// The reviewer proved these by execution (/tmp/opencode/reviewT4/noiframes_
// probe.mjs); they ship here so the guarantee can never silently regress:
// the burst owns vx, nothing else — spikes and live projectiles kill exactly
// as they do without a dash, WHILE the burst is still running.

test("dash INTO spikes is death mid-burst — no i-frame channel exists", () => {
    const physics = new Physics(GRAVITY, MAX_FALL);
    const hz = new Hazards();
    for (let i = 0; i < 3; i++) hz.addSpike(300 + i * 32, 320 - 16);
    const p = new Player(240, 320 - 32, 200, 350);
    p.grounded = true;
    expect(p.pressDash()).toBe(true);   // faces right by default → into spikes
    let died = false, timerAtDeath = 0;
    for (let f = 0; f < 30 && !died; f++) {
        p.prevX = p.x; p.prevY = p.y;
        p.update(DT, false, false, {});
        physics.applyGravity(p, DT);
        physics.resolveCollisions(p, physics.checkCollisions(p, FLOOR));
        if (hz.checkPlayerSpikes(p)) { died = true; timerAtDeath = p.dashTimer; }
    }
    expect(died).toBe(true);
    expect(timerAtDeath).toBeGreaterThan(0); // killed INSIDE the burst window
});

test("dash INTO a live projectile is a hit mid-burst — same rule, spelled out", () => {
    const physics = new Physics(GRAVITY, MAX_FALL);
    const terrain = { tileSize: 32, width: 100, height: 100, isSolidPx: () => false };
    const pm = new ProjectileManager(terrain);
    const p = new Player(200, 320 - 32, 200, 350);
    p.grounded = true;
    // Inbound at chest height: meets the player well inside the 9-frame burst.
    pm.spawn(290, p.y + 16, -150, 0, null);
    expect(p.pressDash()).toBe(true);
    let hit = false, timerAtHit = 0;
    for (let f = 0; f < 30 && !hit; f++) {
        p.prevX = p.x; p.prevY = p.y;
        p.update(DT, false, false, {});
        physics.applyGravity(p, DT);
        physics.resolveCollisions(p, physics.checkCollisions(p, FLOOR));
        const ev = pm.updateAll(DT, p);
        if (ev.hitPlayer) { hit = true; timerAtHit = p.dashTimer; }
    }
    expect(hit).toBe(true);
    expect(timerAtHit).toBeGreaterThan(0);
    // Control: the identical spike fixture kills a plain walker too — the
    // deaths above are the engine's normal lethality, not a dash artefact.
    const hz = new Hazards();
    for (let i = 0; i < 3; i++) hz.addSpike(300 + i * 32, 320 - 16);
    const walker = new Player(240, 320 - 32, 200, 350);
    walker.grounded = true;
    let walkerDied = false;
    for (let f = 0; f < 60 && !walkerDied; f++) {
        walker.prevX = walker.x; walker.prevY = walker.y;
        walker.update(DT, false, true, {}); // walk right, no dash
        physics.applyGravity(walker, DT);
        physics.resolveCollisions(walker, physics.checkCollisions(walker, FLOOR));
        if (hz.checkPlayerSpikes(walker)) walkerDied = true;
    }
    expect(walkerDied).toBe(true);
});
