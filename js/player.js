import { Entity } from './entities.js';

export class Player extends Entity {
    constructor(x, y, speed, jumpForce) {
        super(x, y, 32, 32);
        this.speed = speed;
        this.jumpForce = jumpForce;
        this.reachedPortal = false;
    }

    update(dt, left = false, right = false) {
        // Apply velocity to position and grounded friction (Entity base)
        super.update(dt, left, right);

        // Held-direction keys re-assert speed each frame: base friction is
        // live now that physics maintains `grounded`, so a single keydown's
        // vx would otherwise decay away while the key is still held.
        if (left && !right) {
            this.vx = -this.speed;
        } else if (right && !left) {
            this.vx = this.speed;
        } else {
            // Decelerate when neither direction is active. The base friction
            // only runs while grounded, so also decay in the air.
            const decel = 10; // Matches the base friction coefficient
            this.vx -= this.vx * decel * dt;

            if (Math.abs(this.vx) < 0.1) {
                this.vx = 0;
            }
        }
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

    draw(ctx) {
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
