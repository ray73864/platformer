// Integration: B2 crate cover through the SHIPPED main.js loop (owner BETTER
// WAVE 2026-11-09 — shells must stop on crates like terrain, turning the
// wooden box into the cover players already read it as). Pins what the unit
// file cannot: the per-level setCrates wiring at publishLevel, a scripted
// shell dying on a LIVE shoved crate inside Game.update (impacts feeding the
// dust burst, run staying PLAYING), crate indestructibility under real play,
// and same-seed scripted-replay determinism INCLUDING shell and crate
// positions (the intentional SIM behaviour change stays byte-replayable).
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game, STATE } from "../../js/main.js";

const DT = 1 / 60;
const T = 32;
// L25 s607974 (vertical) ships one crate seated at col 12 row 20 with a
// 4-cell channel [11..14] — the reviewer's push-proof map reused from
// pad_crate_loop.test.js (floor top y=672; blocker at col 11 x=352).
const CRATE_LEVEL = 25;
const CRATE_SEED = 607974;

function startAt(levelNumber, seed) {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    game.levelSeeds.set(levelNumber, seed);
    game.currentLevel = levelNumber;
    game.startLevel();
    return game;
}

test("publish wires THIS level's live crate into the projectile manager", () => {
    const game = startAt(CRATE_LEVEL, CRATE_SEED);
    expect(game.crate).not.toBe(null);
    expect(game.projectiles.crates.length).toBe(1);
    expect(game.projectiles.crates[0]).toBe(game.crate); // live reference
    // A crate-free publish resets the lane (no stale blocker across levels).
    const plain = startAt(3, CRATE_SEED);
    expect(plain.crate).toBe(null);
    expect(plain.projectiles.crates.length).toBe(0);
});

// One scripted replay: shove the crate left while two shells rain onto its
// lane — one while it travels, one after it settles against the blocker.
// Returns the full per-frame trace plus the two tracked shell objects.
function runReplay() {
    const game = startAt(CRATE_LEVEL, CRATE_SEED);
    const crate = game.crate;
    const p = game.player;
    // Drop flush right of the crate, feet on the channel floor (house seam).
    p.x = crate.x + crate.width;
    p.y = crate.y + crate.height - p.height;
    p.vx = 0; p.vy = 0;
    for (let f = 0; f < 5; f++) game.update(DT); // settle
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    const s1 = game.projectiles.spawn(crate.x - 16, crate.y - 96, 0, 60, null);
    let s2 = null;
    const trace = [];
    for (let f = 0; f < 120; f++) {
        if (f === 60) {
            // Second drop onto the settled seat column (col 11 span).
            s2 = game.projectiles.spawn(11 * T + 16, crate.y - 96, 0, 60, null);
        }
        game.update(DT);
        // Hash the SIMULATION only: the particle/dust pools run on the
        // documented Math.random visual clock (projectiles.js header) and
        // live deliberately outside the replayable state.
        trace.push([
            p.x.toFixed(4), p.y.toFixed(4), p.vx.toFixed(4), p.vy.toFixed(4),
            p.grounded, crate.x.toFixed(4), crate.y.toFixed(4), crate.pushed,
            game.state,
            game.projectiles.list.map(q =>
                `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.vx},${q.vy}`
            ).join(" ")
        ].join("|"));
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    return { game, crate, s1, s2, trace: trace.join("\n") };
}

test("scripted shells die on the shoved crate; crate survives; run plays on", () => {
    const { game, crate, s1, s2 } = runReplay();
    const desc = game.level.getCrates()[0];
    // The shove really happened (crate travelled toward the col-11 blocker).
    expect(crate.x).toBeLessThan(desc.x);
    expect(crate.x).toBeGreaterThanOrEqual(desc.channelLeft * T);
    // Shell 1 died mid-shove ABOVE the channel floor line (672): only the
    // crate body was ever in that column-band — terrain could not have
    // caught it this high.
    expect(s1.dead).toBe(true);
    expect(s1.y).toBeGreaterThan(crate.y - T);
    expect(s1.y).toBeLessThan(672);
    // Shell 2 died on the settled box, likewise above the floor.
    expect(s2 && s2.dead).toBe(true);
    expect(s2.y).toBeGreaterThan(crate.y - T);
    expect(s2.y).toBeLessThan(672);
    // Indestructible furniture: geometry fields untouched by any impact.
    expect(crate.width).toBe(T);
    expect(crate.height).toBe(T);
    expect(crate.y).toBe(desc.y); // never left its floor line
    // Cover fairness: nothing ended the run out there in the open lane.
    expect(game.state).toBe(STATE.PLAYING);
});

test("determinism: same-seed scripted replay incl shell+crate identical twice", () => {
    const a = runReplay();
    const b = runReplay();
    expect(a.trace).toBe(b.trace);
    // Non-vacuity: 120 frames, live airborne shots inside the trace, and
    // real crate travel between first and last frame.
    const lines = a.trace.split("\n");
    expect(lines.length).toBe(120);
    expect(lines.some(l => l.split("|").pop().includes("."))).toBe(true);
    expect(lines[0].split("|")[5]).not.toBe(lines[119].split("|")[5]);
    expect(a.game.projectiles.crates.length).toBe(1);
});
