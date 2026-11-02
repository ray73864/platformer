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

        // No friction here: Player owns its stop model (exponential decay
        // here read as ice-skating at high zoom), and enemies set vx fresh
        // every patrol frame. Entities without ground contact never decay.
    }

    isGrounded() {
        return this.grounded;
    }
}
