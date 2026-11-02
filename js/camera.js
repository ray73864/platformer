export class Camera {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.x = 0;
        this.y = 0;
        this.initialized = false;
    }

    follow(player, levelWidthPx, levelHeightPx, dt = 1 / 60) {
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
            // Frame-rate independent snappy follow (~12/s convergence): the
            // old fixed 0.1-per-frame lag let the world keep streaming past
            // for half a second after the player stopped — read as sliding
            // on ice even though the player itself halted in ~0.08 s.
            const alpha = 1 - Math.exp(-12 * (dt || 1 / 60));
            this.x += (targetX - this.x) * alpha;
            this.y += (targetY - this.y) * alpha;
            // Snap the last pixel so a stopped player's camera settles dead
            // on target instead of asymptotically creeping.
            if (Math.abs(targetX - this.x) < 0.5) this.x = targetX;
            if (Math.abs(targetY - this.y) < 0.5) this.y = targetY;
        }

        // Centre the world on both axes whenever it is smaller than the
        // viewport (small levels, big zoomed-out screens); otherwise clamp to
        // the world edges as before.
        if (levelWidthPx <= this.width) {
            this.x = (levelWidthPx - this.width) / 2;
        } else {
            this.x = Math.max(0, Math.min(this.x, levelWidthPx - this.width));
        }

        // World top stays within [0, max(0, levelHeight - view height)] when a
        // level height is given; without it there is no lower bound (2-arg
        // calls in unit tests rely on the unclamped-below behavior).
        if (levelHeightPx !== undefined) {
            if (levelHeightPx <= this.height) {
                // screen_y = world_y + camera.y: positive centres downward.
                this.y = (this.height - levelHeightPx) / 2;
            } else {
                const minCamY = -(levelHeightPx - this.height);
                this.y = Math.min(Math.max(this.y, minCamY), 0);
            }
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
