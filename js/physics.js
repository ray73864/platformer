/**
 * Axis-aligned overlap with strict </> comparisons: touching edges do not
 * count as contact. Single source of truth for every collision convention
 * in the game (platforms via Physics.checkAABB, coins, enemies, spike
 * cores); previously four hand-synced copies drifted one convention change
 * away from each other (review S9).
 */
export function aabbOverlap(rect1, rect2) {
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
}

// Slack for the prev-frame landing check: resting contact re-penetrates by a
// fraction of a pixel each frame (gravity applies before resolution), so feet
// sitting exactly on a surface must still count as "was above".
const LANDING_TOLERANCE = 0.5;

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
        return aabbOverlap(rect1, rect2);
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
        // Floor contact is re-derived every frame: clear before resolution and
        // let the landing branch below set it, so grounded reflects current
        // contact instead of a latch from the last time the player touched a
        // platform.
        player.grounded = false;
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
                        // Landing credibility checks (skipped entirely for
                        // entities without tracked history, e.g. unit-test
                        // fakes, which keep the legacy always-land behaviour):
                        //
                        // 1. Side hit: feet were already BELOW the platform
                        //    top before this frame's movement — sinking into
                        //    a gap alongside a wall must not snap onto the
                        //    wall's top corner.
                        // 2. Level-corner clip: feet were exactly at the
                        //    platform's top height and only entered its
                        //    horizontal span this frame — walking off one
                        //    ledge into the lip of a same-height platform is
                        //    hitting a wall, not landing on a floor. Without
                        //    this, players glide across 1-2 tile gaps.
                        if (player.prevY !== undefined) {
                            const prevBottom = player.prevY + player.height;
                            if (prevBottom > platform.y + LANDING_TOLERANCE) {
                                continue; // Side contact: resolveXCollision handles it
                            }
                            const prevXOverlap = player.prevX === undefined ||
                                (player.prevX < platform.x + platform.width &&
                                 player.prevX + player.width > platform.x);
                            if (!prevXOverlap &&
                                prevBottom >= platform.y - LANDING_TOLERANCE) {
                                continue; // Level-corner clip: not a landing
                            }
                        }

                        // Player center is above platform center, push up (landing)
                        player.y -= overlap;
                        player.vy = 0;
                        player.grounded = true;
                    }
                }
            }
        }
    }
}
