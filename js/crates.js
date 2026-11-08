/**
 * Pushable crates (capability program M3, owner-approved 2026-11-08).
 * ASSIST-ONLY by construction (R2 ruling): the BFS never models crates, no
 * validated route may require one, and the generator seats each crate in a
 * NATURAL bounded pocket — zero terrain carving, so terrain/spikes/coins
 * stay byte-identical and only the entity sets grow.
 *
 * Physics contract (all deterministic, same fixed-dt loop as everything
 * else):
 *  - FULL solid to the player on both axes: the caller adds the crate to the
 *    list Physics.checkCollisions sees (unlike one-way decks, which join Y
 *    only — see movingplatforms.js for the contrast).
 *  - Gravity applies through the SAME Physics instance; the crate lands on
 *    terrain with the identical landing-credibility convention (it tracks
 *    prevX/prevY like the player).
 *  - Push-walk: while the player is grounded and pressing INTO the crate's
 *    side (frame-start geometry: feet-below-crate-top vertical overlap plus
 *    face-flush contact within PUSH_CONTACT_EPS), the crate slides at
 *    CRATE_PUSH_SPEED. The player's own resolution against the moved crate
 *    caps them at the crate face automatically — no separate velocity clamp.
 *  - Crate-vs-crate: none (the generator ships at most ONE crate per level).
 *  - Non-stompable: a Crate is not an Enemy — enemy contact resolution never
 *    sees it. Pad-immune: padUnderFeet() reads the player only; a crate
 *    crossing a pad cell changes nothing.
 *  - Enemies ignore crates completely (patrol kinematics read terrain only);
 *    the generator's pocket finder keeps channels disjoint from every patrol
 *    span so the two bodies can never interpenetrate visually.
 */
import { Entity } from './entities.js';
import { FX } from './fx.js';

// One tile footprint, matching the grid convention (pinned equal to
// main.js TILE_SIZE by tests/unit/crates.test.js).
export const CRATE_SIZE = 32;

// Push-walk speed (px/s) — deliberately half PLAYER_SPEED: pushing is work,
// and the reduced crawl keeps the crate readable ahead of the player.
export const CRATE_PUSH_SPEED = 40;

// Frame-start face-flush slack for push engagement. Resolution leaves the
// bodies EXACTLY flush (resolveXCollision pushes out the full overlap), so
// 1 px absorbs float noise without ever reading a gap as contact.
export const PUSH_CONTACT_EPS = 1.0;

export class Crate extends Entity {
    constructor(desc) {
        super(desc.x, desc.y, CRATE_SIZE, CRATE_SIZE);
        // Set by stepCrate each frame; drives the push-dust FX gate in
        // main.js (presentation only, always).
        this.pushed = false;
    }
}

/**
 * Which way (if any) the crate should slide THIS frame. Call between the
 * player's movement integration and its collision resolution: player.grounded
 * still holds last frame's resolved value, and prevX/prevY hold the frame-
 * start position the resolver left flush against whatever the player touched.
 * Standing ON TOP never pushes: the vertical overlap is strict, and a foot-
 * flush rider has none with the crate body.
 */
export function cratePushDirection(player, crate, dir) {
    if (!player.grounded || dir === 0) return 0;
    const px = player.prevX !== undefined ? player.prevX : player.x;
    const py = player.prevY !== undefined ? player.prevY : player.y;
    // Strict vertical overlap with the crate body (feet below crate top AND
    // head above crate bottom).
    if (!(py < crate.y + crate.height && py + player.height > crate.y)) {
        return 0;
    }
    if (dir > 0) {
        return Math.abs((px + player.width) - crate.x) <= PUSH_CONTACT_EPS
            ? 1 : 0;
    }
    return Math.abs(px - (crate.x + crate.width)) <= PUSH_CONTACT_EPS
        ? -1 : 0;
}

/**
 * Invisible containment walls for the crate ONLY (generator contract: a
 * pocket may legally end at the MAP EDGE — the tile model reads that as a
 * blocker, but off-grid cells produce no collider, so the crate alone needs
 * pixel walls at x<0 and x>=width to make the model's verdict physical).
 * Never passed to the player's collision list: the player's world edges stay
 * exactly as shipped (walk off and take the pit, untouched behaviour).
 */
export function crateContainmentWalls(widthPx, heightPx) {
    const PAD = 4 * CRATE_SIZE; // generous vertical span: crates never fly
    return [
        { x: -CRATE_SIZE, y: -PAD, width: CRATE_SIZE, height: heightPx + 2 * PAD },
        { x: widthPx, y: -PAD, width: CRATE_SIZE, height: heightPx + 2 * PAD }
    ];
}

/**
 * Advance one crate: push displacement first, then gravity. Resolution is
 * SPLIT per axis on purpose: Y resolves against real terrain ONLY (a full-
 * height map-edge wall would hand resolveYCollision a bogus 1000-tall
 * "platform" whose centre is far above a grounded crate — the shared center
 * comparison then reads side contact as a downward landing and teleports the
 * crate; pinned by tests/unit/crates.test.js), while X resolves against
 * terrain PLUS the optional map-edge wall rects. Same Y-then-X order the
 * player lives by.
 */
export function stepCrate(crate, physics, solids, dt, pushDir, wallSolids = []) {
    crate.prevX = crate.x;
    crate.prevY = crate.y;
    crate.pushed = pushDir !== 0;
    if (pushDir !== 0) {
        crate.x += pushDir * CRATE_PUSH_SPEED * dt;
    }
    physics.applyGravity(crate, dt);
    const hits = physics.checkCollisions(crate, solids);
    crate.grounded = false;
    physics.resolveYCollision(crate, hits);
    if (wallSolids.length > 0) {
        physics.resolveXCollision(crate, hits.concat(
            physics.checkCollisions(crate, wallSolids)));
    } else {
        physics.resolveXCollision(crate, hits);
    }
}

/**
 * Vector draw pass (no sheet art — degrade path IS the primary path, simple
 * shapes render with or without assets). Wooden box: fill, rim, plank seam.
 */
export function drawCrates(ctx, crates) {
    for (const c of crates) {
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(c.x, c.y, c.width, c.height);
        ctx.fillStyle = '#5c3a1a';
        ctx.fillRect(c.x, c.y, c.width, 3);
        ctx.fillRect(c.x, c.y + c.height - 3, c.width, 3);
        ctx.fillRect(c.x, c.y, 3, c.height);
        ctx.fillRect(c.x + c.width - 3, c.y, 3, c.height);
        // Diagonal braces read as crate construction at any zoom.
        if (FX.intensity > 0) {
            ctx.fillStyle = '#6e4622';
            ctx.fillRect(c.x + 6, c.y + c.height / 2 - 1, c.width - 12, 2);
        }
    }
}
