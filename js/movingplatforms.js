import { aabbOverlap } from './physics.js';

/**
 * Moving platforms: REQUIRED deck bridges over unjumpable gaps (player
 * ruling 2026-11-04: "moving platforms should only appear when the gap is
 * too large to jump over"). This supersedes the old optional-aids law —
 * decks now CARRY routes: the generator emits each bridge gap wider than
 * anything the plain reachability model accepts, and validates the route
 * through the deck's virtual corridor (level.js). The physics contract
 * below still makes decks pure-help in every other direction: they never
 * join the solid list, resolve on Y only, and can never block, wall-slide
 * or bonk a player who is not landing on them.
 *
 * Motion model: PING-PONG AT CONSTANT SPEED WITH DWELL HOLDS at both ends
 * (dwell added with the bridge wave: a required crossing must offer a fair
 * boarding window — chasing a departing plank across a forced gap is not
 * one; ~0.8 s flush at each lip is walk-on time at any speed). Still
 * closed-form position(t) piecewise-linear: determinism preserved (a retry
 * replays the identical schedule), per-frame dx stays exact for carry, and
 * deltas are zero during dwell so riders stand on a parked deck.
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
// Horizontal bridge decks move 26-44 px/s, so the cap only ever binds for
// future vertical elevators.
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
     * desc: { x, y, width, height, axis: 'h'|'v', min, max, speed, phase,
     *         dwell = 0 }
     * min/max are pixel coordinates of the platform's leading edge travel
     * bounds along its axis; phase in [0,1) offsets t by phase × period;
     * dwell is the hold time (seconds) at each end (0 = legacy instant
     * turnaround).
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
        this.dwell = desc.dwell ?? 0;
        this.vx = 0;
        this.vy = 0;
        this.dx = 0;
        this.dy = 0;
        this.dwelling = false;
        this.elapsed = 0;
        // Start exactly on the schedule, not at the descriptor's nominal x/y.
        const p0 = this.positionAt(0);
        this.x = this.axis === 'v' ? desc.x : p0;
        if (this.axis === 'v') this.y = p0;
        // Deck's position BEFORE the most recent update(): the one-way
        // credibility test compares against the PREVIOUS top so a fast
        // rising deck cannot phase through a near-stationary player (the
        // old gate compared the CURRENT, already-risen top and vetoed every
        // catch frame). Horizontal decks keep y constant, so prevY ≡ y and
        // their behavior is provably unchanged.
        this.prevY = this.y;
        this.prevX = this.x;
    }

    // Leg durations derived from the descriptor (pure, no state).
    traverseSeconds() {
        const span = this.max - this.min;
        return span > 0 ? span / this.speed : 0;
    }

    periodSeconds() {
        return 2 * (this.traverseSeconds() + this.dwell);
    }

    // Closed-form ping-pong with end dwell: hold min, linear rise, hold max,
    // linear fall. Pure function of t — no state, no RNG.
    positionAt(t) {
        const span = this.max - this.min;
        if (!(span > 0)) return this.min;
        const leg = this.traverseSeconds();
        const period = this.periodSeconds();
        let u = (t + this.phase * period) % period;
        if (u < 0) u += period;
        if (u < this.dwell) return this.min;
        u -= this.dwell;
        if (u < leg) return this.min + (u / leg) * span;
        u -= leg;
        if (u < this.dwell) return this.max;
        u -= this.dwell;
        return this.max - (u / leg) * span;
    }

    // True while t sits inside either end-hold segment (visual affordance +
    // tests; positionAt alone cannot distinguish the two holds).
    isDwellingAt(t) {
        if (this.dwell <= 0) return false;
        const period = this.periodSeconds();
        let u = (t + this.phase * period) % period;
        if (u < 0) u += period;
        const leg = this.traverseSeconds();
        return u < this.dwell || (u >= this.dwell + leg && u < 2 * this.dwell + leg);
    }

    update(dt) {
        this.elapsed += dt;
        const pos = this.positionAt(this.elapsed);
        this.prevX = this.x;
        this.prevY = this.y;
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
        this.dwelling = this.isDwellingAt(this.elapsed);
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
    // position each frame (a journey-end deposit stays gentle). Deltas are
    // zero during dwell holds, so a parked deck never shoves its rider.
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
     *  1. Feet were above the deck top LAST FRAME, measured against the
     *     deck's own position last frame: a rising deck (dy < 0) is judged
     *     by its PREVIOUS top (p.prevY), everything else by its current one.
     *     Without the prev-top reference a fast riser overtakes the feet
     *     mid-frame, the gate vetoes on the pass-through frame and after
     *     (feet stay below the risen top), and the deck phases through a
     *     near-stationary player instead of catching it (review Minor 1 —
     *     fixed here ahead of the vertical-elevator wave, pinned by the
     *     240 px/s-riser unit test). Horizontal decks have dy ≡ 0 and
     *     constant y, so prev top == current top: their behavior is
     *     bit-identical to the old gate. Rising or side-entry players still
     *     never see the rect at all — no side push, no head-bonk to lose.
     *  2. player.vy >= deck.vy - epsilon — the deck is not overtaking the
     *     player from behind vertically. A rising elevator still CATCHES a
     *     falling player (fall vy positive >= negative deck vy); a player
     *     jumping up through any deck (vy < deck vy) passes through freely.
     * Callers feed the result to Physics.resolveYCollision ONLY — never to
     * resolveXCollision — which is what keeps decks pure-help.
     */
    oneWayRects(player) {
        const out = [];
        for (const p of this.platforms) {
            if (!aabbOverlap(player, p)) continue;
            if (player.vy < p.vy - VY_EPSILON) continue;
            const topRef = p.dy < 0 ? p.prevY : p.y;
            if (player.prevY !== undefined &&
                player.prevY + player.height > topRef + LAND_TOLERANCE) {
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
