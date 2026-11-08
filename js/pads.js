/**
 * Launch pads (capability program M3, owner-approved 2026-11-08).
 *
 * A pad is a STATIC object occupying the stand cell on top of a floor tile.
 * When the player arrives from above and resolves to grounded contact with
 * the pad's cell (feet flush on the floor line), the contact converts into a
 * fixed-apex bounce: vy = -PAD_IMPULSE. MONOTONIC ADDITION: the impulse only
 * ever fires from deliberate floor contact at the pad's cell — no validated
 * route needs one (R1 ruling: the base reachability BFS stays untouched;
 * pad-aware edges enter the EXTENDED model in T6), enemies never read pads
 * (they walk over unaffected), and crates are immune (too heavy — the pad
 * check reads the player only).
 *
 * Contact convention: feet-line flushness with the same 1.5 px resting-
 * contact slack as MovingPlatform.isUnder / physics.js LANDING_TOLERANCE
 * (resting contact re-penetrates a fraction of a pixel per frame because
 * gravity integrates before resolution). The strict </> aabb convention of
 * physics.aabbOverlap governs every OVERLAP test in the game; this is a
 * support-line test, spelled explicitly rather than smuggled through an
 * overlap that touching edges would (correctly) refuse.
 *
 * Apex math: PAD_IMPULSE is pinned BY FORMULA — sqrt(2·g·h) with h = 4 cells
 * — so retuning gravity moves the bounce with the jump model instead of
 * silently drifting. The shipped integrator is semi-implicit Euler (vy +=
 * g·dt BEFORE y += vy·dt), which undershoots the continuous apex by ~v0·dt/2
 * — measured 123.86 px at 60 Hz against the continuous 128 px, exactly the
 * documented 59.62-vs-62.5 relationship of the plain jump (see the
 * MIN_SHAFT_LIFT header in level.js). Both numbers are pinned by
 * tests/unit/pads.test.js; the discrete value is the physical truth.
 *
 * Variable jump-cut applies naturally: applyPadLaunch() arms
 * jumpCutAvailable, so releasing the jump key mid-rise cuts the bounce like
 * any other launch (Player.releaseJump multiplies vy by JUMP_CUT_FACTOR).
 */
import { Entity } from './entities.js';
import { FX } from './fx.js';

// Tile/gravity mirrors of main.js TILE_SIZE / GRAVITY, kept local so this
// module never imports main.js (import-cycle-free); equality is pinned by
// tests/unit/pads.test.js — same convention as movingplatforms.js keeping
// LAND_TOLERANCE local to leave physics.js byte-identical.
export const PAD_TILE = 32;
const PAD_GRAVITY = 980;

// Fixed apex in tile cells (full-hold, continuous-model claim).
export const PAD_APEX_CELLS = 4;

// The impulse itself — BY FORMULA, see header. ~500.879 px/s.
export const PAD_IMPULSE = Math.sqrt(2 * PAD_GRAVITY * PAD_APEX_CELLS * PAD_TILE);

// Resting-contact slack for the feet-line test (see header; mirrors the
// 1.5 px MovingPlatform.isUnder / 0.5 px LANDING_TOLERANCE family).
export const PAD_FEET_TOLERANCE = 1.5;

// Presentation-only squash duration on launch (draw-time, hitbox untouched).
export const PAD_SQUASH_TIME = 0.12;

export class LaunchPad extends Entity {
    constructor(x, y) {
        // Full stand-cell rect: x/y are the CELL origin (pixel space), so the
        // contact line is y + height (the floor top the feet rest on).
        super(x, y, PAD_TILE, PAD_TILE);
        // Visual squash clock (presentation only; decremented by main.js on
        // the render clock, never read by the simulation).
        this.squash = 0;
    }
}

/**
 * Which pad (if any) the player's feet currently rest on. Grounded contact
 * from above is established by the CALLER's vy-before-resolution gate
 * (main.js): this function only answers the geometric question "are the feet
 * flush on this pad's floor line with horizontal overlap".
 */
export function padUnderFeet(player, pads) {
    const feet = player.y + player.height;
    for (const pad of pads) {
        if (Math.abs(feet - (pad.y + pad.height)) < PAD_FEET_TOLERANCE &&
            player.x < pad.x + pad.width &&
            player.x + player.width > pad.x) {
            return pad;
        }
    }
    return null;
}

/**
 * Apply the bounce to the player. Mirrors the stomp-bounce discipline in
 * main.js: both forgiveness windows die so pressJump()'s coyote branch
 * cannot upgrade the bounce mid-arc, the buffered press is consumed by the
 * launch (one launch per contact), and the jump-cut flag ARMS so releasing
 * the key early shortens this arc like a normal jump (pinned behaviour).
 */
export function applyPadLaunch(player) {
    player.vy = -PAD_IMPULSE;
    player.grounded = false;
    player.coyoteTimer = 0;
    player.jumpBufferTimer = 0;
    player.jumpCutAvailable = true;
}

/**
 * Vector draw pass (no sheet art exists for pads, so this renders with or
 * without assets — the degrade path IS the primary path). A spring plate:
 * dark base band + bright chevron face sitting on the floor line. The launch
 * squash compresses the DRAWN height only (feet-anchored, hitbox untouched),
 * gated by FX.squash like every other Wave-B transform; the plate itself is
 * never hidden (gameplay objects stay legible under reduced motion).
 */
export function drawPads(ctx, pads) {
    for (const pad of pads) {
        const baseY = pad.y + pad.height; // floor top the plate sits on
        let h = 10;
        if (FX.squash && pad.squash > 0) {
            const k = Math.min(1, pad.squash / PAD_SQUASH_TIME);
            h = 10 * (1 - 0.55 * k * FX.intensity);
        }
        ctx.fillStyle = '#3b2a1e';
        ctx.fillRect(pad.x + 2, baseY - h, pad.width - 4, h);
        ctx.fillStyle = '#f2b13c';
        ctx.fillRect(pad.x + 2, baseY - h, pad.width - 4, 3);
        // Chevron ticks read as "springs" at any zoom.
        ctx.fillStyle = '#8a5a1d';
        ctx.fillRect(pad.x + 6, baseY - 4, 4, 3);
        ctx.fillRect(pad.x + pad.width - 10, baseY - 4, 4, 3);
    }
}
