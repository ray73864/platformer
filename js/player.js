import { Entity } from './entities.js';

// Ground brake: linear deceleration applied when no direction key is held.
// Exponential decay left a long visual tail (~0.5 s drift, ~20 px slide)
// that read as ice — punishing on tight 2-tile platforms at high zoom.
// 2400 px/s² stops full speed (200 px/s) in ~0.08 s over ~8 px: crisp.
const PLAYER_STOP_DECEL = 2400;

export class Player extends Entity {
    constructor(x, y, speed, jumpForce) {
        super(x, y, 32, 32);
        this.speed = speed;
        this.jumpForce = jumpForce;
        this.reachedPortal = false;
    }

    update(dt, left = false, right = false) {
        // Apply velocity to position (base integrates x).
        super.update(dt, left, right);

        if (left && !right) {
            // Held-direction keys re-assert speed each frame so movement is
            // instant and reversals are immediate.
            this.vx = -this.speed;
        } else if (right && !left) {
            this.vx = this.speed;
        } else if (this.grounded) {
            // Coasting on the ground: hard linear brake, exact stop.
            const drop = PLAYER_STOP_DECEL * dt;
            this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
        }
        // Airborne coast is deliberately untouched: jumps stay ballistic so
        // releasing a key mid-flight never drops the player short of the
        // ledge they were aiming for. (The legacy per-frame air decay bled
        // ~17% of horizontal speed per 60 Hz frame — the main source of
        // unpredictable landings.)
    }

    moveLeft() {
        this.vx = -this.speed;
    }

    moveRight() {
        this.vx = this.speed;
    }

    stopLeft() {
        // Deceleration handled in update() via the held-key arguments
    }

    stopRight() {
        // Deceleration handled in update() via the held-key arguments
    }

    jump() {
        // Deviation from brief reference: the gate `if (this.grounded)` is removed
        // because "Player jumps" calls jump() on a fresh player whose grounded is
        // false, while "Player has state tracking" requires that initial value.
        // Grounded-gating lives at the input wiring in main.js instead, so
        // autorepeat keydowns cannot extend flight.
        this.vy = -this.jumpForce;
        this.grounded = false;
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
