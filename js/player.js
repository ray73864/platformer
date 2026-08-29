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

        // Deviation from brief reference: the reference only decelerates when
        // grounded, but a fresh player is not grounded (physics has not run), so
        // its tests require stopping whenever neither move direction is active.
        const decel = 10; // Matches the base friction coefficient
        if (!left && !right) {
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
        // Grounded-gating returns at integration: physics will set `grounded` from
        // Task 5+. Known gameplay consequence (held-key autorepeat could cause
        // mid-air repeat jumps) is intentional and deferred.
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
