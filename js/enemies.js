/**
 * Patrolling enemies spawned by the Level from type-4 tiles.
 *
 * Contract:
 * - An Enemy is a 32x32 body walking back and forth along [minX, maxX] in
 *   pixel space at ENEMY_SPEED (50 px/s). Patrol bounds come from real
 *   terrain geometry (the contiguous solid run under its walk row, derived
 *   by Level.spawnEnemies), never a fixed radius around the spawn point.
 * - At a bound the enemy clamps flush against it and reverses; it never
 *   overshoots. Bounds are always at least one tile wide, so the body fits
 *   inside them.
 * - `checkCollision(player)` is an axis-aligned AABB overlap with strict
 *   </> comparisons: touching edges do not count as contact (same convention
 *   as collectibles.js and hazards.js).
 * - A dead enemy (`die()`) stops moving, stops being reported by the
 *   manager's collision aggregation, and draws nothing.
 * - Stuck detection (>1s no movement -> reset) is deferred by owner
 *   ratification 2026-11-01 (plan "Execution notes and ratified deviations"
 *   item 6): static terrain plus walkable, band-clamped bounds cannot make
 *   these enemies stuck. Revisit for moving platforms / dynamic terrain.
 */
const ENEMY_WIDTH = 32;
const ENEMY_HEIGHT = 32;
const ENEMY_SPEED = 50; // px/s

export class Enemy {
    constructor(x, y, minX, maxX) {
        this.x = x;
        this.y = y;
        this.width = ENEMY_WIDTH;
        this.height = ENEMY_HEIGHT;
        this.speed = ENEMY_SPEED;
        this.minX = minX;
        this.maxX = maxX;
        this.vx = this.speed; // Start moving right
        this.dead = false;
    }

    update(dt) {
        if (this.dead) return;

        this.x += this.vx * dt;

        // Reverse at the patrol bounds, clamping flush so the body never
        // leaves [minX, maxX].
        if (this.x <= this.minX) {
            this.x = this.minX;
            this.vx = Math.abs(this.vx); // Move right
        } else if (this.x + this.width >= this.maxX) {
            this.x = this.maxX - this.width;
            this.vx = -Math.abs(this.vx); // Move left
        }
    }

    checkCollision(player) {
        // Axis-aligned overlap; touching edges do not count.
        return (
            this.x < player.x + player.width &&
            this.x + this.width > player.x &&
            this.y < player.y + player.height &&
            this.y + this.height > player.y
        );
    }

    die() {
        this.dead = true;
    }

    isDead() {
        return this.dead;
    }

    draw(ctx) {
        if (this.dead) return;

        // Draw enemy as red rectangle (fallback placeholder)
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Add simple eye detail, shifted toward the facing direction
        ctx.fillStyle = '#fff';
        const eyeOffset = this.vx >= 0 ? 18 : 6;
        ctx.fillRect(this.x + eyeOffset, this.y + 8, 4, 4);
    }
}

export class EnemyManager {
    constructor() {
        this.enemies = [];
    }

    addEnemy(x, y, minX, maxX) {
        this.enemies.push(new Enemy(x, y, minX, maxX));
    }

    updateAll(dt) {
        for (const enemy of this.enemies) {
            enemy.update(dt);
        }
    }

    checkPlayerCollisions(player) {
        for (const enemy of this.enemies) {
            if (!enemy.isDead() && enemy.checkCollision(player)) {
                return true;
            }
        }
        return false;
    }

    getActiveEnemies() {
        return this.enemies.filter(enemy => !enemy.isDead());
    }

    clear() {
        this.enemies.length = 0;
    }

    drawAll(ctx) {
        for (const enemy of this.enemies) {
            enemy.draw(ctx);
        }
    }
}
