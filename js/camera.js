export class Camera {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.x = 0;
        this.y = 0;
        this.initialized = false;
    }

    follow(player, levelWidth) {
        // Tests govern: the horizontal test expects exactly player.x - width/2,
        // so no +player.width/2 term (see task-6-report.md).
        const targetX = player.x - this.width / 2;
        // Vertical convention: positive y is up. Following a player below the
        // view center yields negative camera.y (see task-6-report.md).
        const targetY = this.height / 2 - (player.y + player.height / 2);

        if (!this.initialized) {
            this.x = targetX;
            this.y = targetY;
            this.initialized = true;
        } else {
            this.x += (targetX - this.x) * 0.1;
            this.y += (targetY - this.y) * 0.1;
        }

        this.x = Math.max(0, Math.min(this.x, levelWidth - this.width));
        this.y = Math.min(this.y, 0);
    }

    reset() {
        this.x = 0;
        this.y = 0;
        this.initialized = false;
    }
}
