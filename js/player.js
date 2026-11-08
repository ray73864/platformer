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

// --- Wall jumps (capability program M1, owner-approved 2026-11-08) ----------
// MONOTONIC ADDITION: these options only ADD movement. Nothing here fires
// unless the player is airborne, falling, and deliberately pressing INTO a
// terrain wall contact — every pre-existing trajectory (grounded launches,
// committed arcs, buffered presses away from walls) runs byte-identical, so
// the reachability BFS stays a conservative lower bound forever.
// Constants adjudicated by fixed-dt sim (/tmp/opencode/capability-program/
// wjchimney.mjs): 2-cell chimneys climb fully; single-wall laddering cannot
// profit because PUSH > SPEED (turning back toward an abandoned wall is
// slower than the push-off that left it).
//
// Slide: while airborne-falling and pressing INTO wall contact, downward
// speed caps at this value (same value family as COYOTE_MAX_FALL_SPEED).
export const WALL_SLIDE_MAX_FALL = 120;
// Horizontal launch away from the wall on a wall jump (~2 cells over the
// jump arc). Deliberately above SPEED: see adjudication note above.
export const WALL_JUMP_PUSH = 240;
// Rise is identical to a ground jump: -jumpForce (no separate constant).
// Directional lockout after a wall jump: input toward the wall just left is
// ignored for this long — the body completes the push-off arc instead of
// stick-spamming the same wall. Chimney chains become intentional alternation.
export const WALL_INPUT_LOCK = 0.15;

// --- Dash (capability program M2, owner-approved 2026-11-08) ------------------
// MONOTONIC ADDITION, same discipline as M1: the burst only ever fires from an
// explicit pressDash() call (KeyX/KeyC wiring in main.js). No legacy input —
// arrows/WASD/Space/Shift — reaches it, so every recorded trajectory runs
// byte-identical and the reachability BFS stays a conservative lower bound.
// A dash is a FLAT horizontal burst: vx is re-asserted at DASH_SPEED for
// DASH_TIME frames while gravity keeps integrating vy untouched (the arc
// falls exactly as far as it would have — the burst buys range, never lift).
// Net added travel ≈ 380 × 0.15 = 57 px ≈ 1.8 cells over the run-speed base.
// NO i-frames: contact resolution never reads any dash state, so dashing
// into a hostile body kills or bounces precisely as a normal collision does.
// Burst speed. Above PLAYER_SPEED (200) by design; below charger dash
// territory so hazards stay readable mid-burst.
export const DASH_SPEED = 380;
// Burst duration; vx is owned by the dash for this long (9 frames at 60 Hz).
export const DASH_TIME = 0.15;
// Minimum seconds between GROUNDED dashes (rate-limit on the spam-safe
// ground path only — airborne use is instead limited to one per arc). The
// timer drains in every state; it merely GATES grounded initiation.
export const DASH_COOLDOWN = 0.8;

/**
 * Wall-contact probe: 1px slivers either side of the entity, inset 4px at
 * top and bottom so floor edges and ceiling lips never read as side walls.
 * Tested against terrain rects only — one-way decks are NEVER walls (their
 * pure-help rule forbids blocking or sliding). Returns -1 (left contact),
 * +1 (right contact), 0 (none); when both sides touch (a shaft exactly as
 * wide as the player fits), the wall being moved TOWARD wins, matching the
 * adjudication prototype's tie-break.
 */
export function wallContactSide(entity, platforms) {
    const y = entity.y + 4;
    const h = entity.height - 8;
    let side = 0;
    for (const p of platforms) {
        if (y < p.y + p.height && y + h > p.y) {
            if (entity.x - 1 < p.x + p.width && entity.x > p.x) side |= 1;
            if (entity.x + entity.width < p.x + p.width &&
                entity.x + entity.width + 1 > p.x) side |= 2;
        }
    }
    if (side === 3) return entity.vx >= 0 ? 1 : -1;
    if (side === 1) return -1; // left wall only
    if (side === 2) return 1;  // right wall only
    return 0;
}

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
        // Wall-jump state (M1). wallSide is fed externally each frame after
        // collision resolution (main.js probes via wallContactSide()); the
        // rest lives entirely inside Player policy.
        this.wallSide = 0;             // -1 left / +1 right terrain contact
        this.lastKickSide = 0;         // face used by the last wall jump
        this.wallLockTimer = 0;        // directional lockout remaining (s)
        this.wallLockDir = 0;          // axis ignored while locked (-1/+1)
        this.sliding = 0;              // presentation-only: slide side or 0
        // Air-intent latch state for slide engagement (see update()): the
        // direction latched by a fresh airborne key press, airborne-frame
        // count since ground, and last-frame key snapshot.
        this._airIntent = 0;
        this._airFrames = 0;
        this._leftHeldPrev = false;
        this._rightHeldPrev = false;
        // Dash state (M2). dashTimer > 0 means the burst owns vx this frame;
        // airDashUsed enforces one-per-airborne-arc; dashCooldown rate-limits
        // grounded re-use; _facing is the last unambiguous travel direction
        // (default right) used when no key disambiguates a press.
        this.dashTimer = 0;
        this.dashDir = 0;            // -1/+1 while dashing, else 0
        this.dashCooldown = 0;       // remaining grounded cooldown (s)
        this.airDashUsed = false;    // air-dash consumed this airborne arc
        this._facing = 1;
    }

    // Feed the per-frame terrain wall-contact probe result (-1/+1/0). Called
    // by main.js AFTER collision resolution so next frame's pressJump() and
    // slide check read fresh contact, exactly like the grounded flag they
    // sit beside. Minimal surface on purpose: no opts plumbing because the
    // value is produced outside the player every frame regardless of who
    // calls update (bots, tests, harnesses all get identical policy).
    setWallContact(side) {
        this.wallSide = side || 0;
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
            this._facing = -1;
        } else if (right && !left) {
            this.vx = walk ? WALK_SPEED : this.speed;
            this._facing = 1;
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

        // --- Wall-jump mechanics (M1; see constants) ----------------------
        // Directional lockout: for WALL_INPUT_LOCK after a wall jump, keys
        // held toward the abandoned wall cannot cancel the push-off — the
        // body keeps flying away at push speed. Keys toward the OPPOSITE
        // wall steer normally (cross-shaft steering stays alive). The
        // adjudication prototype carried this branch as dead code under its
        // alternating policy; the shipped form implements the documented
        // intent, re-validated with both alternating AND naive hold-into-
        // wall policies (scratch sim, task-3 report).
        if (this.wallLockTimer > 0) {
            this.wallLockTimer -= dt;
            if (this.wallLockDir === -1 && left && !right) {
                this.vx = WALL_JUMP_PUSH;
            } else if (this.wallLockDir === 1 && right && !left) {
                this.vx = -WALL_JUMP_PUSH;
            }
        }
        // Wall slide: airborne + falling + pressing INTO contacted wall caps
        // the descent. Applied AFTER the movement re-assertion above so held
        // keys can never outrun it; the next frame's gravity adds its usual
        // increment on top of the cap, matching the adjudicated terminal-
        // slide value bit-for-bit.
        //
        // Engagement rule (monotonicity ruling, task-3): the press INTO the
        // wall must be an AIRBORNE DECISION — an "air intent" latches only
        // when a direction key becomes newly held on a frame STRICTLY after
        // leaving the ground, and lives until that key is released, the
        // opposite key takes over, or contact with the ground resets. A key
        // simply held from a grounded run (every legacy hop script brushing
        // a wall face) never engages: committed arcs stay byte-identical,
        // exactly the AIR_BRAKE precedent ("keys HELD re-assert speed; only
        // abandoned arcs change"). Catching a wall mid-air is the new
        // capability; hugging one on an old arc is not. Chimney chains are
        // unaffected: every cross-shaft steer IS a fresh airborne press.
        if (this.grounded) {
            this._airIntent = 0;
            this._airFrames = 0;
            // Ground contact re-arms every wall face (alternation rule).
            this.lastKickSide = 0;
            // ...and the single airborne dash (M2): one per arc means the
            // arc counter resets on contact, not on jump launch.
            this.airDashUsed = false;
        } else {
            const onlyLeft = left && !right;
            const onlyRight = right && !left;
            if (onlyLeft && !this._leftHeldPrev && this._airFrames > 0) {
                this._airIntent = -1;
            } else if (onlyRight && !this._rightHeldPrev && this._airFrames > 0) {
                this._airIntent = 1;
            } else if (this._airIntent === -1 && !onlyLeft) {
                this._airIntent = 0;
            } else if (this._airIntent === 1 && !onlyRight) {
                this._airIntent = 0;
            }
            this._airFrames++;
        }
        this._leftHeldPrev = !!left;
        this._rightHeldPrev = !!right;
        this.sliding = (this.vy > 0 && !this.grounded &&
            ((this.wallSide === -1 && this._airIntent === -1) ||
             (this.wallSide === 1 && this._airIntent === 1)))
            ? this.wallSide : 0;
        if (this.sliding && this.vy > WALL_SLIDE_MAX_FALL) {
            this.vy = WALL_SLIDE_MAX_FALL;
        }

        // --- Dash mechanics (M2; see constants) -------------------------------
        // The burst owns vx LAST: held keys, the wall-lockout override and the
        // brakes above all lose to a committed dash (deliberate press wins),
        // while vy stays entirely to gravity — the flat-burst contract. The
        // EPS snap closes the float boundary at exact divisors of DASH_TIME
        // (9 × 1/60 accumulates to 0.14999999999999997 < 0.15, which would
        // otherwise hand the burst a tenth frame): a frame participates iff
        // it STARTS with remaining time, and residue snaps to dead zero.
        if (this.dashTimer > 1e-9) {
            this.vx = this.dashDir * DASH_SPEED;
            this.dashTimer -= dt;
            if (this.dashTimer < 1e-9) this.dashTimer = 0;
        }
        if (this.dashCooldown > 0) {
            this.dashCooldown = Math.max(0, this.dashCooldown - dt);
        }
    }

    moveLeft(walk = false) {
        this.vx = -(walk && this.grounded ? WALK_SPEED : this.speed);
        this._facing = -1;
    }

    moveRight(walk = false) {
        this.vx = walk && this.grounded ? WALK_SPEED : this.speed;
        this._facing = 1;
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
    // otherwise a live terrain-wall contact fires a WALL JUMP instead of
    // buffering (M1, after both forgiveness paths so a coyote launch next
    // to a wall stays a normal jump); everything else records ONE buffered
    // press — consumed on landing contact or dropped when the window
    // expires, never chained.
    pressJump() {
        if (this.grounded ||
            (this.coyoteTimer > 0 && this.vy < COYOTE_MAX_FALL_SPEED)) {
            this.jump();
        } else if (this.wallSide !== 0 && this.wallLockTimer <= 0 &&
            this.wallSide !== this.lastKickSide) {
            // Wall jump: rise identical to a ground jump, horizontal push
            // AWAY from the contacted wall. Alternation rule: each wall
            // face launches at most once until the player touches ground
            // again (the next kick must come off the OTHER face) — this
            // is what kills the single-wall stick-spam ladder: repeated
            // kicks off one face reset vy to -jumpForce ever higher up
            // the wall, so unbounded same-wall chaining must be
            // impossible by construction. Chimney chains alternate faces
            // and stay fully alive.
            const away = this.wallSide === -1 ? 1 : -1;
            this.vy = -this.jumpForce;
            this.vx = away * WALL_JUMP_PUSH;
            this.grounded = false;
            // Both forgiveness windows die exactly like a real launch (no
            // coyote re-fire, no banked buffer), and the cut flag arms so
            // releasing the key mid-rise shortens this arc like any jump.
            this.coyoteTimer = 0;
            this.jumpBufferTimer = 0;
            this.jumpCutAvailable = true;
            this.sliding = 0;
            this.lastKickSide = this.wallSide;
            // Launch restarts the air-intent bookkeeping (same reasoning
            // as jump()): keys held through the kick are pre-kick decisions.
            this._airFrames = 0;
            this._airIntent = 0;
            // Lockout: pressing back toward the wall just abandoned is
            // ignored until the window expires (see update()).
            this.wallLockTimer = WALL_INPUT_LOCK;
            this.wallLockDir = -away;
            // Kick-during-dash interplay pin (M2): the KICK WINS. The dash
            // burst dies here so its vx override cannot fight the push-off
            // arc on later frames; the air-dash stays consumed (no refund —
            // it was spent mid-air like any other use). Facing turns with
            // the push-off (matching draw()'s velocity-facing eyes), so a
            // neutral dash out of a kick EXTENDS the kick; a freshly held
            // direction key re-faces and steers it instead (pinned below).
            this.dashTimer = 0;
            this.dashDir = 0;
            this._facing = away;
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
        // Wall-slide air-intent restarts with the launch: keys held at the
        // takeoff frame are grounded-run decisions, never a fresh airborne
        // press (update() sees grounded=false here because jump() just
        // cleared it — without this reset the launch frame would inherit
        // the pre-jump airborne count and miscredit them).
        this._airFrames = 0;
        this._airIntent = 0;
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

    // Single entry point for every dash press (KeyX/KeyC, autorepeat-filtered
    // upstream in InputHandler like the jump key). Policy lives here so bots,
    // tests and harnesses all get identical rules:
    //  - mid-burst presses are REJECTED (no chaining into itself);
    //  - GROUNDED initiation pays the DASH_COOLDOWN rate limit;
    //  - AIRBORNE initiation (including inside the coyote window — pinned
    //    ruling: coyote means no contact, so it reads as air) consumes the
    //    one dash granted per airborne arc; landing re-arms it;
    //  - direction = last unambiguous held/travel facing (_facing), which is
    //    exactly "held dir at initiation, default facing" (right).
    // Returns true only when the burst actually fired (main.js gates its FX
    // on the return value so rejected presses stay silent).
    pressDash() {
        if (this.dashTimer > 0) return false;
        if (this.grounded) {
            if (this.dashCooldown > 0) return false;
            this.dashCooldown = DASH_COOLDOWN;
        } else {
            if (this.airDashUsed) return false;
            this.airDashUsed = true;
        }
        this.dashDir = this._facing < 0 ? -1 : 1;
        this.dashTimer = DASH_TIME;
        this.vx = this.dashDir * DASH_SPEED;
        return true;
    }

    // Pause entry companion to cancelJumpFeel (documented API choice: a
    // SIBLING, not an extension — jump-feel and dash are separate mechanics
    // and their cancel sites should name what they cancel). An in-flight
    // burst ends immediately: pause is an interruption, not a frame boundary,
    // so half a committed teleport-like burst must not resume under the
    // player's feet. Nothing is REFUNDED — the air-arc consumption and the
    // cooldown stand, exactly like a buffered press dropped by pause. A dash
    // pressed while PAUSED never reaches pressDash() at all (PLAYING-gated
    // wiring in main.js).
    cancelDashFeel() {
        this.dashTimer = 0;
        this.dashDir = 0;
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
