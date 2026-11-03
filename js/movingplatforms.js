import { aabbOverlap } from './physics.js';

/**
 * Moving platforms: OPTIONAL traversal aids (player ask 2026-11-03).
 *
 * The law they live under: every level's BFS-validated route stays valid
 * WITHOUT any platform. A deck never joins the solid collision list — it is
 * resolved on the Y axis only, and only for feet that were above its top
 * last frame — so passing through from below or the side is always free, and
 * no deck can ever block a route, wall-slide a jumper, or bonk a head. Carry
 * (the frame delta applied to a rider) can only transport, never knock back:
 * placement validation keeps every swept rect inside an air gap whose flanks
 * are flush with the deck, so a rider is never pressed into terrain.
 *
 * Motion model: PING-PONG AT CONSTANT SPEED with instant turnarounds
 * (chosen over a sinusoid: closed-form position(t) makes replays exact, the
 * per-frame dx is trivially correct for carry, and eased ends would add
 * visual mush without gameplay gain). Position is a pure function of elapsed
 * time, so a retry — fresh Level, fresh manager, elapsed reset to 0 —
 * replays the identical trajectory schedule for the same seed.
 */

// Landing tolerance mirrors physics.js LANDING_TOLERANCE (resting contact
// re-penetrates a fraction of a pixel per frame; feet sitting exactly on the
// deck must still count as "was above"). Kept local so physics.js stays
// byte-identical; the two conventions are pinned together by tests.
const LAND_TOLERANCE = 0.5;

// Slack for the relative-fall catch check: player.vy >= platform.vy - EPS
// catches a falling player onto a rising elevator, while anything moving up
// faster than the deck passes through it.
const VY_EPSILON = 1e-6;

// Jump-off inheritance cap (px/s): launching from a moving deck adds the
// deck's velocity to the player, clamped so a boost can never rival a jump.
// Routes never require platforms, so this extra transport can only help.
export const JUMP_BOOST_CAP = 40;

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Additive launch boost inherited from a ridden platform. Shared by main.js
 * (every real launch path) and the unit tests, so the policy lives once.
 */
export function applyJumpBoost(player, platform) {
    if (!platform) return;
    player.vy += clamp(platform.vy, -JUMP_BOOST_CAP, JUMP_BOOST_CAP);
    player.vx += clamp(platform.vx, -JUMP_BOOST_CAP, JUMP_BOOST_CAP);
}

export class MovingPlatform {
    /**
     * desc: { x, y, width, height, axis: 'h'|'v', min, max, speed, phase }
     * min/max are pixel coordinates of the platform's leading edge travel
     * bounds along its axis; phase in [0,1) offsets the start along the
     * first traverse (seeded at placement time, deterministic).
     */
    constructor(desc) {
        this.y = desc.y;
        this.width = desc.width;
        this.height = desc.height;
        this.axis = desc.axis;
        this.min = desc.min;
        this.max = desc.max;
        this.speed = desc.speed;
        this.phase = desc.phase;
        this.vx = 0;
        this.vy = 0;
        this.dx = 0;
        this.dy = 0;
        this.elapsed = 0;
        // Start exactly on the schedule, not at the descriptor's nominal x/y.
        const p0 = this.positionAt(0);
        this.x = this.axis === 'v' ? desc.x : p0;
        if (this.axis === 'v') this.y = p0;
    }

    // Closed-form ping-pong position: triangular wave between min and max at
    // constant speed. Pure function of t — no state, no RNG.
    positionAt(t) {
        const span = this.max - this.min;
        if (!(span > 0)) return this.min;
        const u = (t * this.speed / span + this.phase * 2) % 2;
        const f = u <= 1 ? u : 2 - u;
        return this.min + f * span;
    }

    update(dt) {
        this.elapsed += dt;
        const pos = this.positionAt(this.elapsed);
        if (this.axis === 'v') {
            this.dy = pos - this.y;
            this.dx = 0;
            this.y = pos;
        } else {
            this.dx = pos - this.x;
            this.dy = 0;
            this.x = pos;
        }
        this.vx = dt > 0 ? this.dx / dt : 0;
        this.vy = dt > 0 ? this.dy / dt : 0;
    }

    // True while a player's feet rest on this deck (within the resting-
    // contact slack) and their body overlaps it horizontally.
    isUnder(player) {
        return Math.abs((player.y + player.height) - this.y) < 1.5 &&
            player.x < this.x + this.width &&
            player.x + player.width > this.x;
    }

    // Translate a rider with the deck's frame delta. Callers apply this
    // BEFORE history capture and tile-collision resolution so the landing-
    // credibility convention sees a gliding rider as stationary relative to
    // the deck; terrain next to the gap then gets first say on the rider's
    // position each frame (a journey-end deposit stays gentle).
    carry(player) {
        player.x += this.dx;
        player.y += this.dy;
    }
}

export class MovingPlatformManager {
    constructor(descriptors = []) {
        this.platforms = descriptors.map(d => new MovingPlatform(d));
    }

    updateAll(dt) {
        for (const p of this.platforms) p.update(dt);
    }

    /**
     * One-way filter: the subset of decks the player may land on THIS frame.
     * A deck enters the resolver only when it strictly overlaps the player
     * AND both credibility gates hold:
     *  1. Feet were above the deck top last frame (LAND_TOLERANCE slack, same
     *     convention as physics.js resolveYCollision) — rising or side-entry
     *     players never see the rect at all, so there is no side push and no
     *     head-bonk to lose.
     *  2. player.vy >= deck.vy - epsilon — the deck is not overtaking the
     *     player from behind vertically. A rising elevator still CATCHES a
     *     falling player (fall vy positive >= negative deck vy); a player
     *     jumping up through any deck (vy < deck vy) passes through freely.
     *     KNOWN LIMITATION (review Minor 1, horizontal-only wave): if a
     *     future 'v' deck rises FASTER per frame than its distance to the
     *     player's feet, gate 1 vetoes on the pass-through frame and after
     *     (feet stay below the risen top), so very fast elevators phase
     *     through near-stationary players instead of catching. All shipped
     *     decks have vy ≡ 0; fix the credibility test against the deck's
     *     PREVIOUS top when verticals ship.
     * Callers feed the result to Physics.resolveYCollision ONLY — never to
     * resolveXCollision — which is what makes decks pure-help.
     */
    oneWayRects(player) {
        const out = [];
        for (const p of this.platforms) {
            if (!aabbOverlap(player, p)) continue;
            if (player.vy < p.vy - VY_EPSILON) continue;
            if (player.prevY !== undefined &&
                player.prevY + player.height > p.y + LAND_TOLERANCE) {
                continue;
            }
            out.push(p);
        }
        return out;
    }

    // Which deck (if any) the player is standing on after collision
    // resolution. Null unless grounded — callers store the result as the
    // ride attachment and clear it implicitly every frame here.
    supportUnder(player) {
        if (!player.grounded) return null;
        for (const p of this.platforms) {
            if (p.isUnder(player)) return p;
        }
        return null;
    }
}
