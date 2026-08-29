export class Camera {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.x = 0;
        this.y = 0;
        this.initialized = false;
    }

    follow(player, levelWidthPx, levelHeightPx) {
        // Tests govern: the horizontal test expects exactly player.x - width/2,
        // so no +player.width/2 term (see task-6-report.md).
        const targetX = player.x - this.width / 2;
        // camera.y is the negated world-top offset: panning down (player below
        // view center) yields negative camera.y. Rendering must translate by
        // (-camera.x, +camera.y), since screen_y = world_y + camera.y.
        const targetY = this.height / 2 - (player.y + player.height / 2);

        if (!this.initialized) {
            this.x = targetX;
            this.y = targetY;
            this.initialized = true;
        } else {
            this.x += (targetX - this.x) * 0.1;
            this.y += (targetY - this.y) * 0.1;
        }

        this.x = Math.max(0, Math.min(this.x, levelWidthPx - this.width));

        // World top stays within [0, max(0, levelHeight - view height)] when a
        // level height is given; without it there is no lower bound (2-arg
        // calls in unit tests rely on the unclamped-below behavior).
        if (levelHeightPx !== undefined) {
            const minCamY = -(Math.max(0, levelHeightPx - this.height));
            this.y = Math.min(Math.max(this.y, minCamY), 0);
        } else {
            this.y = Math.min(this.y, 0);
        }
    }

    reset() {
        this.x = 0;
        this.y = 0;
        this.initialized = false;
    }
}
