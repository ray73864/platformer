import { test, expect } from "bun:test";
import { Player } from "../../js/player.js";

test("Player moves left", () => {
    const player = new Player(100, 100, 200, 350);

    player.moveLeft();
    player.update(0.016, true, false);

    expect(player.vx).toBeLessThan(0);
});

test("Player moves right", () => {
    const player = new Player(100, 100, 200, 350);

    player.moveRight();
    player.update(0.016, false, true);

    expect(player.vx).toBeGreaterThan(0);
});

test("Player jumps", () => {
    const player = new Player(100, 100, 200, 350);

    player.jump();

    expect(player.vy).toBeLessThan(0); // Negative vy = upward
});

test("Player stops when no keys pressed", () => {
    const player = new Player(100, 100, 200, 350);

    player.moveRight();
    player.update(0.016, false, true);

    const initialVx = player.vx;

    player.stopLeft();
    player.stopRight();
    // Stopping is a ground behaviour: airborne coast is ballistic by design.
    player.grounded = true;
    player.update(0.016, false, false);

    // Velocity should decrease due to deceleration
    expect(player.vx).toBeLessThan(initialVx);
});

test("Player has state tracking", () => {
    const player = new Player(100, 100, 200, 350);

    expect(player.isGrounded()).toBe(false);

    player.grounded = true;
    expect(player.isGrounded()).toBe(true);
});

test("Player has portal reachability flag", () => {
    const player = new Player(100, 100, 200, 350);

    expect(player.hasReachedPortal()).toBe(false);

    player.reachedPortal = true;
    expect(player.hasReachedPortal()).toBe(true);
});

test("grounded coast brakes to a full stop quickly (no ice slide)", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;
    player.vx = 200;

    let slides = 0;
    let t = 0;
    const dt = 1 / 60;
    while (player.vx > 0 && t < 1) {
        const x0 = player.x;
        player.update(dt, false, false);
        slides += Math.abs(player.x - x0);
        t += dt;
    }

    // Crisp stop: under 0.1 s and under 12 px of world travel from full
    // speed (the old exponential decay drifted ~0.5 s / ~20 px).
    expect(t).toBeLessThan(0.1);
    expect(slides).toBeLessThan(12);
});

// ADAPTED (controls precision pass): this asserted the OLD airborne-coast
// contract ("release keeps ballistic drift"). The playtest ruling reversed
// it — "I can't stop in a specific spot ... I can't align myself with the
// hole above" — so releasing a direction mid-flight now air-brakes toward
// zero. Committed arcs (key HELD) remain exactly ballistic; see the
// regression guard below.
test("airborne release air-brakes toward zero instead of coasting forever", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = false;
    player.vx = 200;

    player.update(1 / 60, false, false);

    // Decaying at AIR_BRAKE_DECEL=900: exactly 15 px/s gone after one
    // 60 Hz frame — bleeding, not slamming to a standstill in one tick.
    expect(player.vx).toBeCloseTo(185, 6);
});

// ---------------------------------------------------------------------------
// Controls precision pass (playtest ruling, verbatim): "everytime I try to
// jump, I can't align myself with the hole above, so when I jump, I hit 1 of
// the 2 ledges above me. The movement is still too slippery, I can't stop in
// a specific spot or stand in a specific spot and jump 1 block to the left or
// right." Every test below pins a bound-safe capability: arcs may only
// shorten or inputs be forgiven — never extend rise/range beyond the
// generator model (rise 62.5 px, range ~143 px per grounded jump).
// ---------------------------------------------------------------------------

// Semi-implicit Euler flight (same integration order as Physics.applyGravity:
// vy first, then y) until apex. Returns total rise in px. cutAfterSec, when
// given, releases the jump key at that flight time (variable jump height).
function simulateJumpRise(cutAfterSec = null, dt = 1 / 240) {
    const player = new Player(0, 1000, 200, 350);
    player.grounded = true;
    player.jump();
    let t = 0;
    let cutDone = false;
    while (player.vy < 0) {
        if (!cutDone && cutAfterSec !== null && t >= cutAfterSec) {
            player.releaseJump();
            cutDone = true;
        }
        player.vy += 980 * dt;
        player.y += player.vy * dt;
        t += dt;
    }
    return 1000 - player.y;
}

// --- Jump buffering ---------------------------------------------------------

test("buffering: airborne press + landing inside the window jumps exactly once", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = false;
    player.vy = 100; // sinking toward the platform

    let jumps = 0;
    const originalJump = player.jump.bind(player);
    player.jump = () => { jumps++; originalJump(); };

    player.pressJump();
    expect(player.vy).toBe(100);                    // not fired in mid-air
    expect(player.jumpBufferTimer).toBeGreaterThan(0);

    player.grounded = true;                         // landing contact
    player.update(1 / 60, false, false);
    expect(jumps).toBe(1);
    expect(player.vy).toBe(-350);                   // standard launch

    player.update(1 / 60, false, false);            // next frame: consumed
    expect(jumps).toBe(1);
});

test("buffering: press older than the window expires without jumping", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = false;
    player.vy = 100;

    player.pressJump();
    for (let t = 0; t < 0.2; t += 1 / 60) {         // 0.2 s > 0.12 s window
        player.update(1 / 60, false, false);
    }
    expect(player.jumpBufferTimer).toBeLessThanOrEqual(0);

    player.grounded = true;                         // late landing
    player.update(1 / 60, false, false);
    expect(player.vy).toBe(100);                    // stale press dropped
});

test("autorepeat-style second press cannot re-launch mid-air (banked once)", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;

    player.pressJump();
    expect(player.vy).toBe(-350);
    expect(player.coyoteTimer).toBe(0);             // jump cancels coyote

    player.vy += 980 * (1 / 60);                    // one frame of gravity
    player.pressJump();                             // press #2 while airborne
    expect(player.vy).toBeCloseTo(-350 + 980 / 60, 10); // NOT reset upward
    expect(player.jumpBufferTimer).toBeGreaterThan(0);  // banked as one press

    // And the banked press yields exactly ONE jump on landing, never a chain.
    let jumps = 0;
    const originalJump = player.jump.bind(player);
    player.jump = () => { jumps++; originalJump(); };
    player.grounded = true;
    player.update(1 / 60, false, false);
    expect(jumps).toBe(1);
});

// --- Coyote time ------------------------------------------------------------

test("coyote: jump within 0.10 s of walking off a ledge fires", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;
    player.update(1 / 60, false, false);            // arms the window

    player.grounded = false;                        // walked off the edge
    for (let i = 0; i < 4; i++) player.update(1 / 60, false, false); // ~0.067 s
    player.vy = 60;                                 // shallow fall, under guard

    player.pressJump();
    expect(player.vy).toBe(-350);                   // fired as if grounded
});

test("coyote: press after 0.15 s airborne does not fire", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;
    player.update(1 / 60, false, false);

    player.grounded = false;
    for (let i = 0; i < 10; i++) player.update(1 / 60, false, false); // ~0.167 s
    player.vy = 60;

    player.pressJump();
    expect(player.vy).toBe(60);                     // window closed
    expect(player.jumpBufferTimer).toBeGreaterThan(0); // falls back to buffer
});

test("coyote: high-speed fall (vy > 120) is rejected — arc bound holds", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;
    player.update(1 / 60, false, false);            // window alive

    player.grounded = false;
    player.vy = 200;                                // committed dive

    player.pressJump();
    expect(player.vy).toBe(200);                    // no launch from a dive
    expect(player.jumpBufferTimer).toBeGreaterThan(0);
});

test("coyote: a normal jump cancels the window", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;
    player.update(1 / 60, false, false);
    expect(player.coyoteTimer).toBeGreaterThan(0);

    player.pressJump();                             // genuine jump
    expect(player.coyoteTimer).toBe(0);
});

test("ledge-fall seed fires once the coyote window closes without a jump", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;
    player.update(1 / 60, false, false);

    player.grounded = false;
    for (let i = 0; i < 3; i++) player.update(1 / 60, false, false);
    expect(player.vy).toBe(0);                      // inside window: unseeded,
                                                    // so the vy<120 coyote
                                                    // guard stays passable
    for (let i = 0; i < 7; i++) player.update(1 / 60, false, false);
    expect(player.vy).toBe(140);                    // window expired: decisive drop
});

test("held jump is never slammed at apex by the ledge-fall seed", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;
    player.pressJump();

    const dt = 1 / 60;
    let vyAtApex = 0;
    for (let i = 0; i < 300; i++) {
        player.vy += 980 * dt;
        player.y += player.vy * dt;
        player.update(dt, false, false);
        if (player.vy >= 0) { vyAtApex = player.vy; break; }
    }
    // Descent hang-time intact: vy just past apex is gravity-sized, NOT
    // force-seeded to 140 (fall-gravity multipliers are forbidden).
    expect(vyAtApex).toBeLessThan(140);
});

// --- Variable jump height ---------------------------------------------------

test("variable jump: releasing mid-rise lowers the peak strictly", () => {
    const held = simulateJumpRise();
    const tapped = simulateJumpRise(0.1);           // release at t=0.1 s
    expect(tapped).toBeLessThan(held * 0.75);       // decisively shorter hop
});

test("variable jump: full-hold peak matches the model (~62.5 px)", () => {
    const held = simulateJumpRise();
    // v²/2g = 350²/1960 = 62.5; semi-implicit Euler lands slightly under.
    expect(held).toBeGreaterThan(61);
    expect(held).toBeLessThanOrEqual(62.5);
});

test("variable jump: release cuts once per jump, only while rising", () => {
    const player = new Player(100, 100, 200, 350);

    player.jump();                                  // vy = -350
    player.releaseJump();
    expect(player.vy).toBeCloseTo(-350 * 0.45, 6);  // -157.5
    player.releaseJump();                           // second release: no-op
    expect(player.vy).toBeCloseTo(-157.5, 6);

    player.vy = 100;                                // falling
    player.releaseJump();
    expect(player.vy).toBe(100);                    // release-after-fall: no-op

    player.jump();                                  // new jump re-arms the cut
    expect(player.jumpCutAvailable).toBe(true);
    player.releaseJump();
    expect(player.vy).toBeCloseTo(-157.5, 6);
});

// --- Air brake ---------------------------------------------------------------

test("air brake: released direction bleeds to zero in ~0.22 s, bounded drift", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = false;
    player.vx = 200;

    let t = 0;
    let drift = 0;
    const dt = 1 / 60;
    while (player.vx > 0 && t < 1) {
        const x0 = player.x;
        player.update(dt, false, false);
        expect(player.vx).toBeGreaterThanOrEqual(0); // clamped, never flips
        drift += player.x - x0;
        t += dt;
    }

    // 200 / 900 ≈ 0.222 s of bleed; ~24 px of residual travel.
    expect(t).toBeGreaterThanOrEqual(0.18);
    expect(t).toBeLessThanOrEqual(0.28);
    expect(drift).toBeLessThan(30);
});

test("regression guard: holding a direction keeps the exact legacy arc", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = false;
    player.vx = 200;

    const dt = 1 / 60;
    for (let i = 0; i < 10; i++) {
        const x0 = player.x;
        player.update(dt, false, true);
        expect(player.vx).toBe(200);                // re-asserted, untouched
        expect(player.x - x0).toBeCloseTo(200 * dt, 10);
    }
});

// --- Walk modifier -----------------------------------------------------------

test("walk: Shift caps ground speed to 110, release restores 200", () => {
    const player = new Player(100, 100, 200, 350);
    player.grounded = true;

    player.update(1 / 60, false, true, { walk: true });
    expect(player.vx).toBe(110);
    player.update(1 / 60, true, false, { walk: true });
    expect(player.vx).toBe(-110);

    player.update(1 / 60, false, true);             // Shift released
    expect(player.vx).toBe(200);
});

test("walk: airborne keys keep full speed; jump from a walk launches under bound", () => {
    const player = new Player(100, 100, 200, 350);

    player.grounded = true;
    player.moveRight(true);                         // walk callback, grounded
    expect(player.vx).toBe(110);
    player.moveLeft(true);
    expect(player.vx).toBe(-110);

    player.grounded = false;                        // airborne
    player.moveRight(true);                         // walk ignored in air
    expect(player.vx).toBe(200);
    player.update(1 / 60, false, true, { walk: true });
    expect(player.vx).toBe(200);

    // A jump initiated while walking starts at walk speed — both 110 and
    // 200 sit under the BFS's 200 px/s bound, so range can only shrink.
    player.grounded = true;
    player.update(1 / 60, false, true, { walk: true });
    player.jump();
    expect(player.vx).toBe(110);
    expect(player.vy).toBe(-350);
});
