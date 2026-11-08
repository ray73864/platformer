// M2 dash (capability program): burst vector, exact frame duration, one-per-
// airborne-arc consumption, grounded cooldown, coyote ruling, wall-jump
// interplay pins (kick wins / dash-out-of-kick consumes), jump-cut
// independence, autorepeat filtering at the InputHandler boundary, pause
// cancel semantics, and a monotonicity property pin against a frozen copy of
// the pre-dash (388de44) player policy over a scripted input corpus.
// Constants live in player.js — nothing here magic-numbers the tuning values
// except where the value IS the contract.
import { test, expect } from "bun:test";
import { Player, DASH_SPEED, DASH_TIME, DASH_COOLDOWN, WALL_JUMP_PUSH } from "../../js/player.js";
import { InputHandler } from "../../js/input.js";

const DT = 1 / 60;
const SPEED = 200;
const JUMP_FORCE = 350;
// Reference values for pins where the number IS the contract (player.js
// keeps these private; duplicating them here is the point of the pin).
const PLAYER_STOP_DECEL_REF = 2400;
const JUMP_CUT_FACTOR_REF = 0.45;

function groundedPlayer(x = 100, y = 100) {
    const p = new Player(x, y, SPEED, JUMP_FORCE);
    p.grounded = true;
    return p;
}

function airPlayer(x = 100, y = 100) {
    const p = new Player(x, y, SPEED, JUMP_FORCE);
    p.grounded = false;
    return p;
}

// --- constants ---------------------------------------------------------------

test("M2 constants are exported with the brief-exact values", () => {
    expect(DASH_SPEED).toBe(380);
    expect(DASH_TIME).toBe(0.15);
    expect(DASH_COOLDOWN).toBe(0.8);
});

// --- initiation vector -------------------------------------------------------

test("grounded dash: vx becomes exactly +DASH_SPEED, vy untouched, cooldown armed", () => {
    const p = groundedPlayer();
    p.vy = -42; // arbitrary vertical state must survive the flat burst
    expect(p.pressDash()).toBe(true);
    expect(p.vx).toBe(DASH_SPEED);
    expect(p.vy).toBe(-42);
    expect(p.dashTimer).toBe(DASH_TIME);
    expect(p.dashCooldown).toBe(DASH_COOLDOWN);
});

test("dash direction follows the last held direction", () => {
    const p = groundedPlayer();
    p.update(DT, true, false); // held-left frame sets facing
    expect(p.pressDash()).toBe(true);
    expect(p.vx).toBe(-DASH_SPEED);
    expect(p.dashDir).toBe(-1);
});

test("dash direction follows the moveLeft/moveRight press path between frames", () => {
    const p = groundedPlayer();
    p.moveLeft(); // input-callback path (no update frame in between)
    expect(p.pressDash()).toBe(true);
    expect(p.vx).toBe(-DASH_SPEED);
});

test("dash defaults to facing right with no directional history", () => {
    const p = groundedPlayer();
    expect(p.pressDash()).toBe(true);
    expect(p.vx).toBe(DASH_SPEED);
});

// --- duration ------------------------------------------------------------------

test("burst owns vx for exactly 9 frames at 60 Hz then releases", () => {
    const p = groundedPlayer();
    p.pressDash();
    let pinned = 0;
    for (let f = 0; f < 10; f++) {
        p.update(DT, false, false);
        if (p.vx === DASH_SPEED) pinned++;
    }
    expect(pinned).toBe(9); // 0.15 s × 60 Hz, float-boundary snap included
    expect(p.dashTimer).toBe(0);
    // Frame 10 onward: the ground brake re-asserts (2400 px/s² × dt = 40).
    expect(p.vx).toBe(DASH_SPEED - PLAYER_STOP_DECEL_REF * DT);
});

test("held keys cannot outrun or extend the burst", () => {
    const p = groundedPlayer();
    p.pressDash();
    // Holding the OPPOSITE direction mid-burst: dash still owns vx…
    p.update(DT, true, false);
    expect(p.vx).toBe(DASH_SPEED);
    // …and holding the SAME direction does not stretch past DASH_TIME.
    let pinned = 1;
    for (let f = 0; f < 12; f++) {
        p.update(DT, false, true);
        if (p.vx === DASH_SPEED) pinned++;
    }
    expect(pinned).toBe(9);
});

test("gravity channel is untouched: update() never writes vy during a dash", () => {
    const p = airPlayer();
    p.vy = 137;
    p.pressDash();
    for (let f = 0; f < 5; f++) {
        p.update(DT, false, false);
        expect(p.vy).toBe(137); // flat burst: only Physics.applyGravity moves y
    }
});

// --- one per airborne arc ------------------------------------------------------

test("airborne dash allowed once per arc; second press rejected", () => {
    const p = airPlayer();
    expect(p.pressDash()).toBe(true);
    p.dashTimer = 0; // expire the burst WITHOUT touching the arc ledger
    expect(p.pressDash()).toBe(false);
});

test("ground contact re-arms the airborne dash", () => {
    const p = airPlayer();
    expect(p.pressDash()).toBe(true);
    p.grounded = true;
    p.update(DT, false, false);
    p.grounded = false;
    p.dashTimer = 0;
    expect(p.pressDash()).toBe(true);
});

test("a GROUNDED dash does not consume the airborne dash", () => {
    const p = groundedPlayer();
    expect(p.pressDash()).toBe(true);
    p.dashTimer = 0;
    p.grounded = false; // jumped away on the next arc
    expect(p.airDashUsed).toBe(false);
    expect(p.pressDash()).toBe(true);
});

// --- grounded cooldown ---------------------------------------------------------

test("grounded cooldown blocks the next grounded dash until expiry", () => {
    const p = groundedPlayer();
    expect(p.pressDash()).toBe(true);
    p.dashTimer = 0;
    expect(p.pressDash()).toBe(false); // still cooling
    for (let f = 0; f < Math.ceil(DASH_COOLDOWN / DT); f++) {
        p.update(DT, false, false);
    }
    expect(p.dashCooldown).toBe(0);
    expect(p.pressDash()).toBe(true);
});

test("a rejected grounded press does not refresh the cooldown", () => {
    const p = groundedPlayer();
    p.pressDash();
    p.dashTimer = 0;
    for (let f = 0; f < 30; f++) p.update(DT, false, false);
    const before = p.dashCooldown;
    expect(p.pressDash()).toBe(false);
    expect(p.dashCooldown).toBe(before);
});

test("dash during an active dash is rejected without disturbing the burst", () => {
    const p = groundedPlayer();
    p.pressDash();
    const timerBefore = p.dashTimer;
    expect(p.pressDash()).toBe(false);
    expect(p.dashTimer).toBe(timerBefore);
    expect(p.dashDir).toBe(1);
});

// --- coyote-window ruling -------------------------------------------------------
// PINNED DECISION (brief): a dash pressed inside the coyote window counts as
// AIRBORNE USE — it consumes the one-per-arc dash and pays NO grounded
// cooldown. Coyote means "no ground contact this frame"; the forgiveness
// stays a jump affordance only.

test("coyote-window dash consumes the air-dash and charges no cooldown", () => {
    const p = groundedPlayer();
    p.update(DT, false, false);          // arm the coyote window (grounded)
    p.grounded = false;                  // walked off the ledge
    p.update(DT, false, false);          // drains one tick, window still open
    expect(p.coyoteTimer).toBeGreaterThan(0);
    expect(p.pressDash()).toBe(true);    // airborne path fires
    expect(p.dashCooldown).toBe(0);      // grounded rate-limit NOT charged
    p.dashTimer = 0;
    expect(p.pressDash()).toBe(false);   // arc consumed
});

// --- wall-jump interplay (M1 ↔ M2) ----------------------------------------------

test("dash out of a wall kick is ALLOWED and consumes the air-dash", () => {
    const p = airPlayer();
    p.setWallContact(-1);
    p.pressJump();                       // wall kick off the left face
    expect(p.wallLockTimer).toBeGreaterThan(0);
    expect(p.vx).toBe(WALL_JUMP_PUSH);   // pushed away (+x)
    expect(p.pressDash()).toBe(true);    // dash extends the kick (facing rode away)
    expect(p.vx).toBe(DASH_SPEED);       // burst overrides vx for its duration
    p.dashTimer = 0;
    expect(p.pressDash()).toBe(false);   // …and it spent the arc's only dash
});

test("kick during a dash REPLACES the dash velocity (kick wins)", () => {
    const p = airPlayer();
    p.pressDash();                       // bursting right…
    p.setWallContact(1);                 // …into a right-hand wall face
    p.pressJump();                       // wall kick off it
    expect(p.vx).toBe(-WALL_JUMP_PUSH);  // kick vector replaces the burst
    expect(p.vy).toBe(-JUMP_FORCE);
    expect(p.dashTimer).toBe(0);         // burst cancelled outright
    expect(p.dashDir).toBe(0);
    // And it STAYS replaced: a following frame must not re-pin vx back to
    // burst speed (catches a missing cancel inside the kick branch).
    p.update(DT, false, false);
    expect(p.vx).toBeLessThan(0);        // air brake eases the kick, never flips
    expect(Math.abs(p.vx)).toBeLessThan(WALL_JUMP_PUSH);
});

test("kick-cancelled dash is NOT refunded to the air ledger", () => {
    const p = airPlayer();
    p.pressDash();
    p.setWallContact(1);
    p.pressJump();
    expect(p.airDashUsed).toBe(true);
    p.dashTimer = 0;
    expect(p.pressDash()).toBe(false);
});

// --- jump-cut independence -------------------------------------------------------

test("releasing the jump key mid-rise cuts vy but leaves the dash untouched", () => {
    const p = airPlayer();
    p.jump();                            // arms jumpCutAvailable
    p.pressDash();
    const timerBefore = p.dashTimer;
    p.releaseJump();                     // variable-height cut on the VERTICAL
    expect(p.vy).toBe(-JUMP_FORCE * JUMP_CUT_FACTOR_REF);
    expect(p.vx).toBe(DASH_SPEED);       // horizontal channel: zero effect
    expect(p.dashTimer).toBe(timerBefore);
});

test("jump release with no cut available does nothing to an active dash", () => {
    const p = airPlayer();
    p.pressDash();
    p.releaseJump();                     // no jump in progress
    expect(p.vx).toBe(DASH_SPEED);
    expect(p.dashTimer).toBe(DASH_TIME);
});

// --- autorepeat filtering (InputHandler boundary, jump precedent) -----------------

test("KeyX and KeyC fire the dash callback on initial press only", () => {
    const input = new InputHandler();
    let dashes = 0;
    input.onDash(() => dashes++);
    input.handleKeyDown({ code: "KeyX" });
    input.handleKeyDown({ code: "KeyX" }); // OS autorepeat: no intervening keyup
    input.handleKeyDown({ code: "KeyX" });
    expect(dashes).toBe(1);
    input.handleKeyUp({ code: "KeyX" });
    input.handleKeyDown({ code: "KeyC" }); // alias binding
    expect(dashes).toBe(2);
    expect(input.isDash()).toBe(true);
    input.handleKeyUp({ code: "KeyC" });
    expect(input.isDash()).toBe(false);
    input.destroy();
});

test("dash keys do not fire movement/jump callbacks and vice versa", () => {
    const input = new InputHandler();
    let jumps = 0, moves = 0, dashes = 0;
    input.onJump(() => jumps++);
    input.onMoveRight(() => moves++);
    input.onDash(() => dashes++);
    input.handleKeyDown({ code: "KeyX" });
    input.handleKeyDown({ code: "Space" });
    expect([dashes, jumps, moves]).toEqual([1, 1, 0]);
    input.destroy();
});

// --- pause cancel (cancelFeel precedent, sibling API) ------------------------------

test("cancelDashFeel ends an in-flight burst with no refund", () => {
    const p = airPlayer();
    p.pressDash();
    expect(p.dashTimer).toBe(DASH_TIME);
    p.cancelDashFeel();
    expect(p.dashTimer).toBe(0);
    expect(p.dashDir).toBe(0);
    // No refund: the arc stays spent and the burst cannot be re-fired.
    expect(p.airDashUsed).toBe(true);
    expect(p.pressDash()).toBe(false);
});

test("cancelDashFeel on a grounded dash keeps the cooldown running", () => {
    const p = groundedPlayer();
    p.pressDash();
    p.cancelDashFeel();
    expect(p.dashCooldown).toBe(DASH_COOLDOWN);
    expect(p.pressDash()).toBe(false);
});

// =============================================================================
// Monotonicity property pin — frozen pre-dash baseline (388de44, post-M1).
// Verbatim copy of the shipped Player policy BEFORE this task (draw() aside),
// run over a scripted corpus that NEVER calls pressDash(): every trajectory
// must match the modified engine bit-for-bit. Non-vacuity guards assert the
// corpus actually exercises slide, kick, coyote, buffer and cut paths.
// =============================================================================

// Frozen module constants (verbatim from base/js/player.js @ 388de44).
const B_PLAYER_STOP_DECEL = 2400;
const B_AIR_BRAKE_DECEL = 900;
const B_JUMP_BUFFER_TIME = 0.12;
const B_COYOTE_TIME = 0.1;
const B_COYOTE_MAX_FALL_SPEED = 120;
const B_JUMP_CUT_FACTOR = 0.45;
const B_WALK_SPEED = 110;
const B_LEDGE_FALL_SEED = 140;
const B_WALL_SLIDE_MAX_FALL = 120;
const B_WALL_JUMP_PUSH = 240;
const B_WALL_INPUT_LOCK = 0.15;

class BaseRefPlayer {
    constructor(x, y, speed, jumpForce) {
        this.x = x; this.y = y; this.width = 32; this.height = 32;
        this.vx = 0; this.vy = 0; this.grounded = false;
        this.speed = speed;
        this.jumpForce = jumpForce;
        this.reachedPortal = false;
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
        this.jumpCutAvailable = false;
        this.wallSide = 0;
        this.lastKickSide = 0;
        this.wallLockTimer = 0;
        this.wallLockDir = 0;
        this.sliding = 0;
        this._airIntent = 0;
        this._airFrames = 0;
        this._leftHeldPrev = false;
        this._rightHeldPrev = false;
    }

    setWallContact(side) {
        this.wallSide = side || 0;
    }

    update(dt, left = false, right = false, opts = {}) {
        this.x += this.vx * dt;

        const walk = !!opts.walk && this.grounded;
        if (left && !right) {
            this.vx = -(walk ? B_WALK_SPEED : this.speed);
        } else if (right && !left) {
            this.vx = walk ? B_WALK_SPEED : this.speed;
        } else if (this.grounded) {
            const drop = B_PLAYER_STOP_DECEL * dt;
            this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
        } else {
            const drop = B_AIR_BRAKE_DECEL * dt;
            this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
        }

        if (this.grounded) {
            this.coyoteTimer = B_COYOTE_TIME;
        } else if (this.coyoteTimer > 0) {
            this.coyoteTimer -= dt;
            if (this.coyoteTimer <= 0 && this.vy >= 0) {
                this.vy = Math.max(this.vy, B_LEDGE_FALL_SEED);
            }
        }

        if (this.jumpBufferTimer > 0) {
            this.jumpBufferTimer -= dt;
            if (this.grounded) this.jump();
        }

        if (this.wallLockTimer > 0) {
            this.wallLockTimer -= dt;
            if (this.wallLockDir === -1 && left && !right) {
                this.vx = B_WALL_JUMP_PUSH;
            } else if (this.wallLockDir === 1 && right && !left) {
                this.vx = -B_WALL_JUMP_PUSH;
            }
        }
        if (this.grounded) {
            this._airIntent = 0;
            this._airFrames = 0;
            this.lastKickSide = 0;
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
        if (this.sliding && this.vy > B_WALL_SLIDE_MAX_FALL) {
            this.vy = B_WALL_SLIDE_MAX_FALL;
        }
    }

    moveLeft(walk = false) {
        this.vx = -(walk && this.grounded ? B_WALK_SPEED : this.speed);
    }

    moveRight(walk = false) {
        this.vx = walk && this.grounded ? B_WALK_SPEED : this.speed;
    }

    pressJump() {
        if (this.grounded ||
            (this.coyoteTimer > 0 && this.vy < B_COYOTE_MAX_FALL_SPEED)) {
            this.jump();
        } else if (this.wallSide !== 0 && this.wallLockTimer <= 0 &&
            this.wallSide !== this.lastKickSide) {
            const away = this.wallSide === -1 ? 1 : -1;
            this.vy = -this.jumpForce;
            this.vx = away * B_WALL_JUMP_PUSH;
            this.grounded = false;
            this.coyoteTimer = 0;
            this.jumpBufferTimer = 0;
            this.jumpCutAvailable = true;
            this.sliding = 0;
            this.lastKickSide = this.wallSide;
            this._airFrames = 0;
            this._airIntent = 0;
            this.wallLockTimer = B_WALL_INPUT_LOCK;
            this.wallLockDir = -away;
        } else {
            this.jumpBufferTimer = B_JUMP_BUFFER_TIME;
        }
    }

    jump() {
        this.vy = -this.jumpForce;
        this.grounded = false;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        this.jumpCutAvailable = true;
        this._airFrames = 0;
        this._airIntent = 0;
    }

    releaseJump() {
        if (this.vy < 0 && this.jumpCutAvailable) {
            this.vy *= B_JUMP_CUT_FACTOR;
            this.jumpCutAvailable = false;
        }
    }

    cancelJumpFeel() {
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
    }
}

// Scripted corpus: each entry drives BOTH engines identically. `g`/`w` fields
// simulate the collision-derived flags a resolver would feed; gravity and the
// landing vy-zeroing are emulated in the main.js order (update → gravity)
// with IDENTICAL inputs for both classes — the point is policy equivalence,
// not terrain fidelity. Events counted for the non-vacuity guard.
function runCorpus(P) {
    const events = { slides: 0, kicks: 0, cuts: 0, coyote: 0, ledgeSeed: 0 };
    const frames = [];
    const p = new P(100, 100, SPEED, JUMP_FORCE);
    const seg = (n, o = {}) => ({ n, ...o });
    const script = [
        seg(1, { g: true }),
        seg(20, { r: true, g: true }),            // grounded run
        seg(10, { g: true }),                     // ground brake to exact stop
        seg(10, { r: true, walk: true, g: true }),// walk-mode ground cap
        seg(1, { press: true, g: true }),         // grounded launch
        seg(40, { r: true }),                     // committed arc (rise + fall)
        seg(1, { g: true }),                      // land
        seg(1, { press: true, g: true }),         // hop…
        seg(4),
        seg(1, { release: true }),                // …variable-height cut mid-rise
        seg(30, { w: 0 }),                        // settle back into a fall
        seg(1, { g: true }),
        seg(1, { r: true, g: false }),            // walk off the ledge
        seg(2, { r: true }),
        seg(1, { press: true, r: true }),         // coyote-window jump
        seg(40, { r: true }),
        seg(1, { g: true }),
        seg(1, { g: false }),                     // step off again…
        seg(20),                                  // coyote EXPIRES -> ledge seed
        seg(10, { w: 0 }),                        // fast fall (vy well past 120)
        seg(1, { press: true }),                  // buffered press (no launch yet)
        seg(5),
        seg(1, { g: true }),                      // landing contact fires buffer
        seg(20, { r: true }),
        seg(1, { g: false }),                     // fresh airborne arc
        seg(2),                                   // neutral airborne frames
        seg(12, { l: true, w: -1 }),              // FRESH press into left face: slide
        seg(1, { press: true, l: true, w: -1 }),  // wall kick off the left face
        seg(6, { l: true }),                      // lockout fights the held key
        seg(12, { r: true, w: 1 }),               // cross-shaft steer onto right face
        seg(1, { press: true, r: true, w: 1 }),   // second-face kick (alternation)
        seg(40, { l: true, w: 0 }),               // ride the arc down, clear walls
        seg(1, { g: true }),                      // ground re-arms every ledger
        seg(20, { r: true })
    ];
    let prevVy = p.vy, prevCut = p.jumpCutAvailable, prevLock = 0;
    for (const s of script) {
        for (let f = 0; f < s.n; f++) {
            if ("g" in s) p.grounded = s.g;
            if ("w" in s) p.setWallContact(s.w);
            if (s.press) p.pressJump();
            if (s.release) p.releaseJump();
            p.update(DT, !!s.l, !!s.r, { walk: !!s.walk });
            // Counters read the POST-update / pre-gravity state so the
            // ledge-seed crossing (an exact-value handoff) stays visible.
            if (p.sliding !== 0) events.slides++;
            if (p.wallLockTimer > 0 && prevLock <= 0) events.kicks++;
            if (prevCut && !p.jumpCutAvailable && p.vy !== prevVy) events.cuts++;
            if (s.press && p.vy < 0 && prevVy >= 0) events.coyote++;
            if (p.vy === B_LEDGE_FALL_SEED && prevVy >= 0 && prevVy < B_LEDGE_FALL_SEED) {
                events.ledgeSeed++;
            }
            prevLock = p.wallLockTimer;
            prevCut = p.jumpCutAvailable;
            prevVy = p.vy;
            // Resolver/gravity emulation, byte-identical for both engines
            // (main.js order: player.update → applyGravity → resolve).
            if (p.grounded) p.vy = 0;
            else p.vy += 980 * DT;
            frames.push(`${p.x},${p.y},${p.vx},${p.vy},${p.grounded ? 1 : 0}`);
        }
    }
    return { frames, events };
}

test("monotonic addition: no legacy input changes ANY trajectory vs the frozen baseline", () => {
    const mod = runCorpus(Player);
    const base = runCorpus(BaseRefPlayer);
    expect(mod.frames.length).toBe(base.frames.length);
    // Bit-identical per-frame trajectories (full-array compare gives the
    // first divergent index for free on failure).
    expect(mod.frames).toEqual(base.frames);
});

test("non-vacuity: the corpus genuinely exercises every legacy policy path", () => {
    const { events } = runCorpus(Player);
    expect(events.slides).toBeGreaterThan(0);
    expect(events.kicks).toBeGreaterThan(0);
    expect(events.cuts).toBeGreaterThan(0);
    expect(events.coyote).toBeGreaterThan(0);
    expect(events.ledgeSeed).toBeGreaterThan(0);
});
