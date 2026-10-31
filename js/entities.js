export class Entity {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.vx = 0;
        this.vy = 0;
        this.grounded = false;
    }

    update(dt, _moveLeft = false, _moveRight = false) {
        // Apply horizontal velocity to position. Vertical integration belongs
        // solely to Physics.applyGravity: integrating y here as well doubled
        // gravity/jump displacement every frame.
        this.x += this.vx * dt;

        // Apply ground friction if grounded
        if (this.grounded) {
            const friction = 10; // Friction coefficient
            this.vx -= this.vx * friction * dt;

            // Stop completely if very slow
            if (Math.abs(this.vx) < 0.1) {
                this.vx = 0;
            }
        }
    }

    isGrounded() {
        return this.grounded;
    }
}
