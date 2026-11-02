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
 * - `checkCollision(player)` is an axis-aligned AABB overlap against a
 *   hitbox inset from the 32x32 body (visible creature art does not fill
 *   the cell edge-to-edge; killing on invisible margins read as dying
 *   "without touching"). Strict </> comparisons: touching edges do not
 *   count as contact (same convention as collectibles.js and hazards.js).
 * - `EnemyManager.resolvePlayerContact(player)` implements the stomp rule:
 *   a FALLING player whose feet were above the enemy's top last frame
 *   kills the enemy instead of dying (and the caller bounces them); any
 *   other contact is deadly.
 * - A dead enemy (`die()`) stops moving, stops being reported by the
 *   manager's collision aggregation, and draws nothing.
 * - Stuck detection (>1s no movement -> reset) is deferred by owner
 *   ratification 2026-11-01 (plan "Execution notes and ratified deviations"
 *   item 6): static terrain plus walkable, band-clamped bounds cannot make
 *   these enemies stuck. Revisit for moving platforms / dynamic terrain.
 */
import { aabbOverlap } from './physics.js';

const ENEMY_WIDTH = 32;const ENEMY_HEIGHT = 32;
const ENEMY_SPEED = 50; // px/s
// Lethal hitbox inset from the body rect: the shipped creature art leaves
// transparent margins at the cell edges (slime body spans roughly x+4..x-4
// at tile scale), so contact only registers on visible flesh.
const ENEMY_HITBOX_INSET_X = 4;
const ENEMY_HITBOX_INSET_TOP = 4;
// Feet-above-top window for a stomp: falling contacts whose previous feet
// position was within this of the enemy's top edge squash instead of kill.
const ENEMY_STOMP_TOLERANCE = 12;

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
        // Art-matched lethal box within the 32x32 body; axis-aligned
        // overlap, touching edges do not count.
        return aabbOverlap(player, {
            x: this.x + ENEMY_HITBOX_INSET_X,
            y: this.y + ENEMY_HITBOX_INSET_TOP,
            width: this.width - 2 * ENEMY_HITBOX_INSET_X,
            height: this.height - ENEMY_HITBOX_INSET_TOP
        });
    }

    die() {
        this.dead = true;
    }

    isDead() {
        return this.dead;
    }

    // Optional sprite layer: slime/bat frames by spawn index (assigned by
    // EnemyManager.drawAll), feet-anchored and facing-flipped.
    draw(ctx, sprites = null, index = 0) {
        if (this.dead) return;

        if (sprites && sprites.ready()) {
            sprites.drawEnemy(ctx, this, index);
            return;
        }

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

    // Stomp-aware contact resolution (replaces the raw death check in the
    // game loop). Returns { stomped, deadly }: stomped counts enemies the
    // player squashed this frame (falling feet-first from above); deadly is
    // true only when some other live enemy made contact. The caller applies
    // the bounce/feedback so physics constants stay in main.js.
    resolvePlayerContact(player) {
        let stomped = 0;
        let deadly = false;
        const prevBottom = (player.prevY !== undefined ? player.prevY : player.y) + player.height;

        for (const enemy of this.enemies) {
            if (enemy.isDead()) continue;
            if (!enemy.checkCollision(player)) continue;

            if (player.vy > 0 && prevBottom <= enemy.y + ENEMY_STOMP_TOLERANCE) {
                enemy.die();
                stomped++;
            } else {
                deadly = true;
            }
        }

        return { stomped, deadly };
    }

    getActiveEnemies() {
        return this.enemies.filter(enemy => !enemy.isDead());
    }

    clear() {
        this.enemies.length = 0;
    }

    drawAll(ctx, sprites = null) {
        this.enemies.forEach((enemy, index) => enemy.draw(ctx, sprites, index));
    }
}
