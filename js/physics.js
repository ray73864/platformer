export class Physics {
    constructor(gravity = 980, maxFallSpeed = 600) {
        this.gravity = gravity;
        this.maxFallSpeed = maxFallSpeed;
    }

    applyGravity(entity, dt) {
        entity.vy += this.gravity * dt;

        if (entity.vy > this.maxFallSpeed) {
            entity.vy = this.maxFallSpeed;
        }

        entity.y += entity.vy * dt;
    }

    checkAABB(rect1, rect2) {
        return (
            rect1.x < rect2.x + rect2.width &&
            rect1.x + rect1.width > rect2.x &&
            rect1.y < rect2.y + rect2.height &&
            rect1.y + rect1.height > rect2.y
        );
    }

    checkCollisions(player, platforms) {
        const collisions = [];

        for (const platform of platforms) {
            if (this.checkAABB(player, platform)) {
                collisions.push(platform);
            }
        }

        return collisions;
    }

    resolveCollisions(player, collisions) {
        this.resolveYCollision(player, collisions);
        this.resolveXCollision(player, collisions);
    }

    resolveXCollision(player, platforms) {
        for (const platform of platforms) {
            if (this.checkAABB(player, platform)) {
                const overlapX = (player.x + player.width / 2) - (platform.x + platform.width / 2);
                const combinedHalfWidths = player.width / 2 + platform.width / 2;

                if (Math.abs(overlapX) < combinedHalfWidths) {
                    const overlap = combinedHalfWidths - Math.abs(overlapX);

                    if (overlapX > 0) {
                        // Player center is right of platform center, push right
                        player.x += overlap;
                    } else {
                        // Player center is left of platform center, push left
                        player.x -= overlap;
                    }

                    player.vx = 0;
                }
            }
        }
    }

    resolveYCollision(player, platforms) {
        for (const platform of platforms) {
            if (this.checkAABB(player, platform)) {
                const overlapY = (player.y + player.height / 2) - (platform.y + platform.height / 2);
                const combinedHalfHeights = player.height / 2 + platform.height / 2;

                if (Math.abs(overlapY) < combinedHalfHeights) {
                    const overlap = combinedHalfHeights - Math.abs(overlapY);

                    if (overlapY > 0) {
                        // Player center is below platform center, push down (hit head)
                        player.y += overlap;
                        player.vy = 0;
                    } else {
                        // Player center is above platform center, push up (landing)
                        player.y -= overlap;
                        player.vy = 0;
                    }
                }
            }
        }
    }
}
