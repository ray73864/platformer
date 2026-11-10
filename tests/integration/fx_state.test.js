// Wave B juice state across the level lifecycle, exercised through the same
// seams the other integration files use: a real Game on the shared happy-dom
// fixture. Pins the three spec-mandated behaviours that only make sense at
// loop level — reduced-motion flag respect end-to-end, pooled effects capped
// under real event spam, and every transient wiped when a level publishes
// (retry must never inherit a stale shake/popup/burst from the death).
import { test, expect, afterAll } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";
import { Game, STATE, destroyAllGames } from "../../js/main.js";
import { FX, initFX, applyReducedMotion, _resetFXInitForTests, MAX_POPUPS } from "../../js/fx.js";
import { MAX_DUST } from "../../js/particles.js";
import { PAD_SQUASH_TIME } from "../../js/pads.js";

installGameTestScaffolding();

afterAll(() => {
    applyReducedMotion(false);
    _resetFXInitForTests();
});

function startFresh() {
    mountFixture();
    const game = new Game();
    game.startGame();
    return game;
}

function dirtyEffects(game) {
    game.particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 5, maxLife: 5, size: 2, color: '#fff' });
    game.dust.push({ x: 0, y: 0, vx: 0, vy: 0, life: 5, maxLife: 5, size: 2, color: '#fff' });
    game.popups.push({ x: 1, y: 1, text: '+10', color: '#ffd23f', big: false, age: 0, life: 0.7 });
    game.rings.push({ x: 1, y: 1, color: '#b06cf0', r0: 8, r1: 54, age: 0, life: 0.6 });
    game.shakeTime = 0.3;
    game.shakeMag = 9;
    game.shakeDur = 0.35;
    game.squashTimer = 0.1;
    game._punchTime = 0.1;
    game._launchStretch = 0.1;
    game._landDepth = 0.8;
    game._prevFrameVx = 120;
    game._lean = 0.05;
    game._lookAhead = 7;
    game._dustTx = 42;
}

test("level publish wipes every transient effect state (death -> retry)", () => {
    const game = startFresh();
    try {
        // Die with the full juice stack live.
        dirtyEffects(game);
        game.handleGameOver('pit');
        expect(game.state).toBe(STATE.GAME_OVER);
        // Death enhancements landed: shake armed, burst >= the old 16. (The
        // white-flash beat is a CSS entry animation on #game-over-screen —
        // no canvas state to pin here; see main.handleGameOver comment.)
        expect(game.shakeTime).toBeGreaterThan(0);
        expect(game.shakeMag).toBeGreaterThanOrEqual(9);
        expect(game.particles.length).toBeGreaterThanOrEqual(16);

        // Retry: the fresh attempt starts dead-still with empty pools.
        game.retryLevel();
        expect(game.state).toBe(STATE.PLAYING);
        expect(game.particles.length).toBe(0);
        expect(game.dust.length).toBe(0);
        expect(game.popups.length).toBe(0);
        expect(game.rings.length).toBe(0);
        expect(game.shakeTime).toBe(0);
        expect(game.shakeMag).toBe(0);
        expect(game.squashTimer).toBe(0);
        expect(game._punchTime).toBe(0);
        expect(game._launchStretch).toBe(0);
        expect(game._landDepth).toBe(0);
        expect(game._prevFrameVx).toBe(0);
        expect(game._lean).toBe(0);
        expect(game._lookAhead).toBe(0);
        expect(game._dustTx).toBe(-1);
    } finally {
        destroyAllGames();
    }
});

test("coin pickup through the loop spawns a score popup; pool stays capped", () => {
    const game = startFresh();
    try {
        const coins = game.collectibles.getCoins();
        const target = coins.find(c => !c.collected);
        expect(target).not.toBeNull();
        // Drop the hero onto the coin and step one frame (loop-scored path).
        game.player.x = target.x;
        game.player.y = target.y;
        game.update(1 / 60);
        expect(game.popups.length).toBe(1);
        expect(game.popups[0].text).toMatch(/^\+\d+$/);
        // Spam: collect the rest one frame apart — the pool never exceeds cap.
        for (let guard = 0; guard < coins.length * 4 + 60; guard++) {
            const next = game.collectibles.getCoins().find(c => !c.collected);
            if (!next) break;
            game.player.x = next.x;
            game.player.y = next.y;
            game.update(1 / 60);
            expect(game.popups.length).toBeLessThanOrEqual(MAX_POPUPS);
        }
    } finally {
        destroyAllGames();
    }
});

test("portal unlock fires a ring pulse + sparkle fan exactly once", () => {
    const game = startFresh();
    try {
        const coins = game.collectibles.getCoins();
        for (let i = 0; i < coins.length - 1; i++) game.collectibles.collectCoin(i);
        game.update(1 / 60);
        expect(game.rings.length).toBe(0); // gate not met yet
        game.collectibles.collectCoin(coins.length - 1);
        game.update(1 / 60);
        expect(game.rings.length).toBe(1);
        expect(game.particles.length).toBeGreaterThan(0); // sparkle fan
        // No re-ring while unlocked (edge-tracker contract preserved).
        game.update(1 / 60);
        expect(game.rings.length).toBeLessThanOrEqual(1);
    } finally {
        destroyAllGames();
    }
});

test("reduced-motion profile silences shake/punch/lookahead end-to-end", () => {
    // Prime initFX through a fake window reporting prefers-reduced-motion so
    // the once-guard sees FX as already initialised: a bare
    // applyReducedMotion(true) would be overwritten when the next Game
    // constructor's initFX() reads happy-dom's matchMedia (false).
    _resetFXInitForTests();
    initFX({ matchMedia: () => ({ matches: true }) });
    const game = startFresh();
    try {
        expect(FX.shake).toBe(false);
        expect(FX.punch).toBe(false);
        expect(FX.lookahead).toBe(false);
        // Run rightward past the look-ahead deadzone: offset stays pinned 0.
        game.input.keys.add('ArrowRight');
        for (let f = 0; f < 40; f++) game.update(1 / 60);
        expect(game._lookAhead).toBe(0);
        // A death still arms its timers (state), but the draw-time gates
        // consume them as zeros — verified by the fx unit pins; here we pin
        // that nothing throws and the gentle families remain enabled.
        game.handleGameOver('pit');
        expect(game.shakeTime).toBeGreaterThan(0); // state armed regardless
        expect(FX.dust).toBe(true);
        expect(FX.intensity).toBe(0.5);
    } finally {
        destroyAllGames();
        _resetFXInitForTests();
    }
});

test("grounded running fills the dust pool without ever exceeding MAX_DUST", () => {
    const game = startFresh();
    try {
        game.input.keys.add('ArrowRight');
        let sawDust = false;
        for (let f = 0; f < 240; f++) {
            game.update(1 / 60);
            // Keep the run alive if the scripted walk met an early hazard.
            if (game.state !== STATE.PLAYING) break;
            expect(game.dust.length).toBeLessThanOrEqual(MAX_DUST);
            if (game.dust.length > 0) sawDust = true;
        }
        expect(sawDust).toBe(true);
    } finally {
        destroyAllGames();
    }
});

// Wave B fix-round pin: the acceleration lean is part of the squash family.
// With FX.squash off the hero must stay a rigid body — zero lean through a
// full press-from-rest impulse — and with intensity 0 likewise. The control
// leg proves the rig actually produces lean when the family is on, so the
// gated legs cannot pass vacuously.
test("FX.squash off (or intensity 0) => acceleration lean stays exactly zero", () => {
    // Control: default flags — a press from rest must tip the hero.
    let control = startFresh();
    let sawLean = 0;
    try {
        control.input.keys.add('ArrowRight');
        for (let f = 0; f < 30; f++) {
            control.update(1 / 60);
            sawLean = Math.max(sawLean, Math.abs(control._lean));
        }
    } finally {
        destroyAllGames();
    }
    expect(sawLean).toBeGreaterThan(0);

    // Gated legs: same impulse, flags off/zeroed.
    const game = startFresh();
    try {
        FX.squash = false;
        game.input.keys.add('ArrowRight');
        for (let f = 0; f < 30; f++) {
            game.update(1 / 60);
            expect(game._lean).toBe(0);
        }
        // Fresh press-from-rest impulse with squash back on but intensity 0:
        // the clamp collapses to ±0, so nothing accumulates either.
        FX.squash = true;
        FX.intensity = 0;
        game.player.vx = 0;
        game._prevFrameVx = 0;
        for (let f = 0; f < 30; f++) {
            game.update(1 / 60);
            expect(game._lean).toBe(0);
        }
    } finally {
        FX.squash = true;
        FX.intensity = 1;
        destroyAllGames();
    }
});

test("pad plate squash holds while PAUSED and decays on resume (B2)", () => {
    // T5-disclosed minor, fixed: the plate's visual clock used to run in
    // every state, so pausing right after a bounce leaked the squash back
    // to rest behind the frozen overlay — held time must read as HELD
    // (look-A ruling, same gate family as the motes). Fixture: L11
    // s40943818 ships one pad (house fixture from pad_crate_loop).
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    game.levelSeeds.set(11, 40943818);
    game.currentLevel = 11;
    game.startLevel();
    try {
        expect(game.pads.length).toBe(1);
        const pad = game.pads[0];
        pad.squash = PAD_SQUASH_TIME; // identical arming to a real launch
        game.togglePause();
        expect(game.state).toBe(STATE.PAUSED);
        for (let f = 0; f < 30; f++) game.update(1 / 60);
        expect(pad.squash).toBe(PAD_SQUASH_TIME); // frozen like the world
        game.togglePause();
        expect(game.state).toBe(STATE.PLAYING);
        for (let f = 0; f < 4; f++) game.update(1 / 60);
        expect(pad.squash).toBeLessThan(PAD_SQUASH_TIME); // decaying again
        for (let f = 0; f < 10; f++) game.update(1 / 60);
        expect(pad.squash).toBe(0);
    } finally {
        destroyAllGames();
    }
});
