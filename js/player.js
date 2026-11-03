import { Entity } from './entities.js';

// Ground brake: linear deceleration applied when no direction key is held.
// Exponential decay left a long visual tail (~0.5 s drift, ~20 px slide)
// that read as ice — punishing on tight 2-tile platforms at high zoom.
// 2400 px/s² stops full speed (200 px/s) in ~0.08 s over ~8 px: crisp.
const PLAYER_STOP_DECEL = 2400;

// Air brake: deceleration on horizontal velocity while airborne with NO
// direction key held. Playtest ruling (screenshot-driven): "I can't stop in
// a specific spot and jump 1 block to the left or right … I can't align
// myself with the hole above, so when I jump, I hit 1 of the 2 ledges above
// me." Releasing the direction key mid-flight must bleed speed fast enough
// to drop nearly straight once aligned. 900 px/s² erases full speed
// (200 px/s) in ~0.22 s over ~24 px. Bound-safe: keys HELD re-assert
// ±speed exactly as before, so committed arcs still match the reachability
// BFS; only abandoned arcs shorten. Decay is clamped and never overshoots
// past zero.
const AIR_BRAKE_DECEL = 900;

// Jump buffering window: a jump press made while airborne still fires if
// contact happens within this window. Forgiving-input class — it can only
// start a standard jump slightly sooner after landing, never extend the arc.
// One press is consumed by exactly one jump (autorepeat is filtered upstream
// in InputHandler), so buffered presses cannot chain.
const JUMP_BUFFER_TIME = 0.12;

// Coyote time: ground contact is remembered this long after it ends WITHOUT
// a jump, so a press just after walking off a ledge still fires as if
// grounded. The launch uses the same -jumpForce, and the window itself caps
// the extra airtime versus a ground jump at 0.1 s (~20 px of range at full
// speed) — forgiveness, not a new capability.
const COYOTE_TIME = 0.1;

// Coyote fall-speed guard: the window may only pay out while downward speed
// is still small. Below ~120 px/s the fall since leaving the ledge is under
// ~0.12 s, so the reset to -jumpForce cannot exceed the modelled rise from
// the ledge row by material margin; a committed dive (or the seeded ledge
// drop below) is rejected and merely buffers. Rising (vy <= 0) always
// passes.
const COYOTE_MAX_FALL_SPEED = 120;

// Variable jump height: releasing the jump key while rising multiplies vy by
// this factor ONCE per jump (flag reset on each new jump). Shortens hops
// only — full-hold jumps never invoke the cut and stay byte-identical to the
// modelled 62.5 px rise, preserving the generator's upper bound. Answers
// "stand in a specific spot and jump 1 block sideways": tap for the short
// hop instead of being committed to the full arc.
const JUMP_CUT_FACTOR = 0.45;

// Walk modifier (Shift held, grounded only): fine-positioning speed. The
// playtest needs stand-on-a-spot precision; 110 px/s halves ground travel
// per frame while staying well under the 200 px/s the reachability BFS
// assumes. Airborne movement is NOT capped (committed arcs unchanged), and a
// jump launched from a walk leaves at walk speed — both under the bound.
const WALK_SPEED = 110;

// Downward velocity seeded when the player walks off a ledge and the coyote
// window closes without a jump: gravity from vy=0 drifts over narrow gaps
// instead of dropping cleanly. Deferred to the window's expiry (it used to
// fire on the departure frame in main.js) so a late ledge jump never
// launches against a seeded fall speed that COYOTE_MAX_FALL_SPEED would
// reject. The crossing fires exactly once per departure: jump() zeroes the
// coyote timer, so a genuine jump can never arm it — and therefore can
// never be slammed at apex when vy turns positive. The cost is a deliberate
// trade-off: the fall visibly glides for the ~0.1 s window before seeding,
// accepted because drift across narrow gaps reads better than a clean drop.
const LEDGE_FALL_SEED = 140;

export class Player extends Entity {
    constructor(x, y, speed, jumpForce) {
        super(x, y, 32, 32);
        this.speed = speed;
        this.jumpForce = jumpForce;
        this.reachedPortal = false;
        // Jump-feel state (timers tick in update(); see pressJump()).
        this.jumpBufferTimer = 0;      // airborne press awaiting landing contact
        this.coyoteTimer = 0;          // ground contact remembered
        this.jumpCutAvailable = false; // variable-height cut usable once/jump
    }

    // opts: { walk = false } — Shift-style ground speed cap. Positional
    // signature (dt, left, right) is unchanged for existing callers/tests.
    update(dt, left = false, right = false, opts = {}) {
        // Apply velocity to position (base integrates x).
        super.update(dt, left, right);

        // Held-direction keys re-assert speed each frame so movement is
        // instant and reversals are immediate. Airborne re-assertion is the
        // legacy ballistic contract the level generator's reachability model
        // relies on: a committed arc (key held end-to-end) is untouched.
        const walk = !!opts.walk && this.grounded;
        if (left && !right) {
            this.vx = -(walk ? WALK_SPEED : this.speed);
        } else if (right && !left) {
            this.vx = walk ? WALK_SPEED : this.speed;
        } else if (this.grounded) {
            // Coasting on the ground: hard linear brake, exact stop.
            const drop = PLAYER_STOP_DECEL * dt;
            this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
        } else {
            // Air brake (see AIR_BRAKE_DECEL): no direction held and
            // airborne — bleed toward zero, clamped so the sign never flips.
            const drop = AIR_BRAKE_DECEL * dt;
            this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
        }

        // --- Jump-feel timers ------------------------------------------
        if (this.grounded) {
            // Contact refreshes the coyote window every frame; the moment
            // contact ends (walked off a ledge) it drains from full.
            this.coyoteTimer = COYOTE_TIME;
        } else if (this.coyoteTimer > 0) {
            this.coyoteTimer -= dt;
            // Window just expired mid-air without a jump: commit the drop.
            if (this.coyoteTimer <= 0 && this.vy >= 0) {
                this.vy = Math.max(this.vy, LEDGE_FALL_SEED);
            }
        }

        if (this.jumpBufferTimer > 0) {
            this.jumpBufferTimer -= dt;
            // Landing contact within the window executes the press. jump()
            // zeroes the buffer, so one press yields exactly one jump.
            if (this.grounded) this.jump();
        }
    }

    moveLeft(walk = false) {
        this.vx = -(walk && this.grounded ? WALK_SPEED : this.speed);
    }

    moveRight(walk = false) {
        this.vx = walk && this.grounded ? WALK_SPEED : this.speed;
    }

    stopLeft() {
        // Deceleration handled in update() via the held-key arguments
    }

    stopRight() {
        // Deceleration handled in update() via the held-key arguments
    }

    // Single entry point for every jump press. main.js routes the (already
    // autorepeat-filtered) input callback here; grounded/coyote policy lives
    // in the Player so it is unit-testable without a Game loop. Fires
    // immediately when grounded or inside the guarded coyote window;
    // otherwise records ONE buffered press — consumed on landing contact or
    // dropped when the window expires, never chained.
    pressJump() {
        if (this.grounded ||
            (this.coyoteTimer > 0 && this.vy < COYOTE_MAX_FALL_SPEED)) {
            this.jump();
        } else {
            this.jumpBufferTimer = JUMP_BUFFER_TIME;
        }
    }

    jump() {
        // Deviation from brief reference: the gate `if (this.grounded)` is removed
        // because "Player jumps" calls jump() on a fresh player whose grounded is
        // false, while "Player has state tracking" requires that initial value.
        // Policy lives in pressJump()/the input wiring instead, so
        // autorepeat keydowns cannot extend flight.
        this.vy = -this.jumpForce;
        this.grounded = false;
        // A real launch cancels both forgiveness windows: a second press
        // mid-air must neither re-fire via coyote (that would extend rise
        // beyond the modelled arc) nor bank a buffered chain jump.
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        this.jumpCutAvailable = true;
    }

    // Variable jump height: wired to the jump key's keyup in main.js. Cuts
    // once per jump (flag reset in jump()) and only while rising; releasing
    // after the apex, after a fall, or with no jump in progress does
    // nothing. Full-hold jumps never call this, so their peak stays the
    // modelled 62.5 px (v²/2g = 350²/1960).
    releaseJump() {
        if (this.vy < 0 && this.jumpCutAvailable) {
            this.vy *= JUMP_CUT_FACTOR;
            this.jumpCutAvailable = false;
        }
    }

    // Drop pending forgiveness state (pause entry): a press or ledge contact
    // from before the interruption must not fire after the run resumes.
    cancelJumpFeel() {
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
    }

    hasReachedPortal() {
        return this.reachedPortal;
    }

    markPortalReached() {
        this.reachedPortal = true;
    }

    // Optional sprite layer: when loaded, the Kenney astronaut stands in
    // for the placeholder rectangle (feet-anchored, facing-aware). `squash`
    // compresses only the drawn height on landing — never the hitbox.
    draw(ctx, sprites = null, squash = 1) {
        if (sprites && sprites.ready()) {
            sprites.drawPlayer(ctx, this, squash);
            return;
        }

        // Draw player as blue rectangle (fallback placeholder)
        ctx.fillStyle = '#0066ff';
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Add simple eye detail
        ctx.fillStyle = '#fff';
        const eyeOffset = this.vx >= 0 ? 18 : 6;
        ctx.fillRect(this.x + eyeOffset, this.y + 8, 4, 4);
        ctx.fillRect(this.x + eyeOffset + 6, this.y + 8, 4, 4);
    }
}
