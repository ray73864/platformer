// Unit: launch pads (M3). Pins the four contracts the sweeps cannot express
// per-value: the impulse BY FORMULA (gravity retunes must move with it), the
// MEASURED discrete-Euler apex (the honest physical truth, same family as
// the documented 59.62-vs-62.5 plain-jump relationship — see pads.js header
// and the MIN_SHAFT_LIFT precedent in level.js), padUnderFeet's support-line
// semantics, and applyPadLaunch's stomp-discipline state writes INCLUDING
// the jump-cut arming that makes releasing early shorten the arc.
import { test, expect } from "bun:test";
import {
    LaunchPad, PAD_IMPULSE, PAD_APEX_CELLS, PAD_FEET_TOLERANCE,
    padUnderFeet, applyPadLaunch
} from "../../js/pads.js";

const DT = 1 / 60;
const G = 980; // main.js GRAVITY (not exported; pinned indirectly via the impulse)

test("PAD_IMPULSE is pinned by formula, not by drifted literal", () => {
    expect(PAD_IMPULSE).toBe(Math.sqrt(2 * G * PAD_APEX_CELLS * 32));
    expect(PAD_IMPULSE).toBeCloseTo(500.879, 3);
});

test("tile mirror equals the shipped TILE_SIZE (no silent divergence)", async () => {
    const { TILE_SIZE } = await import("../../js/main.js");
    const { PAD_TILE } = await import("../../js/pads.js");
    expect(PAD_TILE).toBe(TILE_SIZE);
});

// Semi-implicit Euler rise from a standing launch: vy += g·dt BEFORE y +=
// vy·dt — byte-for-byte the shipped integration order.
function eulerRise(v0) {
    let vy = v0, y = 0, minY = 0;
    for (let f = 0; f < 600; f++) {
        vy += G * DT;
        y += vy * DT;
        if (y < minY) minY = y;
        if (vy > 0 && y > 0) break;
    }
    return -minY;
}

test("measured apex at 60 Hz is the discrete truth, under the continuous 128", () => {
    const rise = eulerRise(-PAD_IMPULSE);
    // Physical measured value (replay-det5): NOT the naive 4*32=128 — the
    // integrator undershoots by ~v0·dt/2 exactly like the plain jump.
    expect(rise).toBeCloseTo(123.856, 3);
    expect(rise).toBeLessThan(PAD_APEX_CELLS * 32);      // below continuous
    expect(rise).toBeGreaterThan(3.8 * 32);              // still a 4-cell-class bounce
});

test("padUnderFeet: flush feet + horizontal overlap only", () => {
    const pad = new LaunchPad(224, 512);                 // floor line y=544
    const feetOn = { x: 230, y: 544 - 48, width: 24, height: 48 };
    expect(padUnderFeet(feetOn, [pad])).toBe(pad);
    // Within the 1.5 px resting-contact slack (gravity re-penetrates a hair
    // every frame; strict equality would miss real resting contact).
    expect(padUnderFeet({ ...feetOn, y: feetOn.y + 1 }, [pad])).toBe(pad);
    // Beyond slack: airborne pass-through or falling short — no launch.
    expect(padUnderFeet({ ...feetOn, y: feetOn.y - PAD_FEET_TOLERANCE - 0.5 }, [pad])).toBeNull();
    // No horizontal overlap: beside the plate, not on it.
    expect(padUnderFeet({ ...feetOn, x: 224 - 24 }, [pad])).toBeNull();
});

test("applyPadLaunch mirrors stomp discipline and ARMS the jump cut", () => {
    const p = {
        vy: 120, grounded: true, coyoteTimer: 0.08,
        jumpBufferTimer: 0.1, jumpCutAvailable: false
    };
    applyPadLaunch(p);
    expect(p.vy).toBe(-PAD_IMPULSE);
    expect(p.grounded).toBe(false);
    expect(p.coyoteTimer).toBe(0);       // no coyote upgrade mid-arc
    expect(p.jumpBufferTimer).toBe(0);   // buffered press consumed by launch
    expect(p.jumpCutAvailable).toBe(true);
});

test("releasing jump mid-rise cuts the pad bounce (variable-height holds)", async () => {
    const { Player } = await import("../../js/player.js");
    const { Physics } = await import("../../js/physics.js");
    const run = (cutAfter) => {
        const physics = new Physics(G, 600);
        const p = new Player(100, 400, 200, 350);
        applyPadLaunch(p);
        let minY = p.y;
        for (let f = 0; f < 90; f++) {
            if (f === cutAfter) p.releaseJump();
            p.update(DT, false, false, {});
            physics.applyGravity(p, DT);
            if (p.y < minY) minY = p.y;
            if (p.vy >= 0 && p.y >= 400) break;
        }
        return 400 - minY;
    };
    const full = run(999);
    const cut = run(4);
    expect(full).toBeCloseTo(123.856, 2); // same physics as the pure sim above
    expect(cut).toBeLessThan(full * 0.6); // release visibly shortens the arc
});
