/**
 * Patrolling enemies spawned by the Level from type-4 tiles.
 *
 * Contract:
 * - An Enemy is a 32x32 body walking back and forth along [minX, maxX] in
 *   pixel space at ENEMY_SPEED (40 px/s). Patrol bounds come from real
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
 *   other contact is deadly. Exception: kind 'spiny' carries spikes on its
 *   back and is NEVER stomped — every contact is deadly (player ruling
 *   2026-11-03: "I didn't like how I could just jump on top of every enemy,
 *   it added no risk"; stomping stays a skill against the other kinds).
 * - KINDS (read-only diagnostics on every Enemy: `kind`, `state`):
 *   - 'walker' (default): today's slime patrol, fully stompable. Motion is
 *     identical for every kind that patrols, so recognition is purely
 *     visual (sprites.js draws the spike row / horn silhouettes).
 *   - 'spiny': walks exactly like the walker; any contact including a
 *     top-down stomp attempt kills (see resolvePlayerContact).
 *   - 'charger': patrols at walker speed until the player lingers in its
 *     trigger zone (feet within ±1 tile row, within ~6 tiles horizontally,
 *     roughly in front). Then WINDUP (stands still, telegraphed squash +
 *     flash) -> DASH toward the player's side at 2.2x until a patrol bound
 *     or the dash timeout -> COOLDOWN patrolling normally. The windup
 *     aborts if the player leaves the zone before the dash locks its
 *     direction; a legitimate stomp (existing tolerance) still kills a
 *     dashing charger — risk/reward. Dash velocity can never carry it past
 *     [minX, maxX], which terrain derivation keeps solid-supported.
 *   `state` ∈ 'patrol' | 'windup' | 'dash' | 'cooldown' (walkers and
 *   spinies stay 'patrol' forever). Charger transitions need the player,
 *   so `update(dt, player)` / `updateAll(dt, player)` take an optional
 *   player reference; without one chargers simply patrol.
 * - A dead enemy (`die()`) stops moving, stops being reported by the
 *   manager's collision aggregation, and draws nothing.
 * - Stuck detection (>1s no movement -> reset) is deferred by owner
 *   ratification 2026-11-01 (plan "Execution notes and ratified deviations"
 *   item 6): static terrain plus walkable, band-clamped bounds cannot make
 *   these enemies stuck. Revisit for moving platforms / dynamic terrain.
 */
import { aabbOverlap } from './physics.js';

const ENEMY_WIDTH = 32;const ENEMY_HEIGHT = 32;
const ENEMY_SPEED = 40; // px/s (was 50: dodging on narrow shelves read as
// frame-perfect; 40 keeps patrols threatening without demanding precision)
// Lethal hitbox inset from the body rect: the shipped creature art leaves
// transparent margins at the cell edges (slime body spans roughly x+4..x-4
// at tile scale), so contact only registers on visible flesh.
const ENEMY_HITBOX_INSET_X = 4;
const ENEMY_HITBOX_INSET_TOP = 4;
// Feet-above-top window for a stomp: falling contacts whose previous feet
// position was within this of the enemy's top edge squash instead of kill.
const ENEMY_STOMP_TOLERANCE = 18; // was 12: reward sloppy-but-intended stomps

// --- Charger state machine (player ruling 2026-11-03, see header) ----------
// Telegraph durations are tuned for readability at 32px tiles / 40 px/s
// patrol: 0.45 s of visible windup is ~90 px of player movement — enough to
// step out of the lane or line up the risk/reward stomp; the dash caps at
// 1.2 s so a charge that reaches its bound ends on tempo, not on contact.
const CHARGER_WINDUP_TIME = 0.45;   // s standing still before the dash locks
const CHARGER_DASH_TIME = 1.2;      // s max dash duration
const CHARGER_COOLDOWN_TIME = 1.0;  // s normal patrol before re-triggering
const CHARGER_DASH_SPEED_MULT = 2.2;             // x ENEMY_SPEED while dashing
const CHARGER_TRIGGER_COLS = 6;                  // tile columns of horizontal reach
const CHARGER_TRIGGER_ROW_TOLERANCE = 32;        // ±1 tile row of feet height

export const ENEMY_STATES = ['patrol', 'windup', 'dash', 'cooldown'];

export class Enemy {
    constructor(x, y, minX, maxX, kind = 'walker') {
        this.x = x;
        this.y = y;
        this.width = ENEMY_WIDTH;
        this.height = ENEMY_HEIGHT;
        this.speed = ENEMY_SPEED;
        this.minX = minX;
        this.maxX = maxX;
        this.vx = this.speed; // Start moving right
        this.dead = false;
        // Read-only diagnostics (tests + playbot): kind ∈ walker|spiny|charger
        // (assigned by Level.spawnEnemies from the seeded RNG), state ∈
        // ENEMY_STATES. Only the game loop drives state transitions.
        this.kind = kind;
        this.state = 'patrol';
        this.stateTime = 0;
        // Dodge-award diagnostics (owner ruling 2026-11-04, see main.js):
        // `dodged` latches once the game loop has paid the pass-by award;
        // `_dodgePrevSide` remembers the sign of (player centre - enemy
        // centre) from the previous resolved frame (0 = never observed) and
        // `_dodgePrevPx` that frame's player centre x (continuity guard —
        // teleport-sized jumps re-baseline unpaid). All written by
        // Game.update only; fresh flags arrive with every rebuilt Level, so
        // a retry re-arms the award for each patrol.
        this.dodged = false;
        this._dodgePrevSide = 0;
        this._dodgePrevPx = 0;
    }

    update(dt, player = null) {
        if (this.dead) return;

        if (this.kind === 'charger') {
            this._updateCharger(dt, player);
            return;
        }

        // Walker and spiny: identical motion by design — the spiny's threat
        // must be readable from its silhouette alone, never from gait.
        this._patrolStep(dt);
    }

    _patrolStep(dt) {
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

    // Charger trigger zone: feet within ±1 tile row of the charger's row,
    // center-to-center within ~6 columns, and roughly in FRONT (the sign of
    // `facing` — live vx while patrolling, the planted pre-windup heading
    // while winding up, since a stopped body has no sign to compare).
    // No grounded check: "grounded-ish" is exactly what the row tolerance
    // models, and demanding vy===0 would miss the common case of a player
    // mid-fall into the lane.
    _triggeredBy(player, facing = this.vx) {
        if (!player) return false;
        const dx = (player.x + player.width / 2) - (this.x + this.width / 2);
        if (dx === 0 || facing === 0) return false;
        if (Math.sign(dx) !== Math.sign(facing)) return false;
        if (Math.abs(dx) > CHARGER_TRIGGER_COLS * 32) return false;
        const dyFeet = Math.abs((player.y + player.height) - (this.y + this.height));
        return dyFeet <= CHARGER_TRIGGER_ROW_TOLERANCE;
    }

    _updateCharger(dt, player) {
        this.stateTime += dt;
        switch (this.state) {
            case 'patrol':
                this._patrolStep(dt);
                if (this._triggeredBy(player)) {
                    this.state = 'windup';
                    this.stateTime = 0;
                    this._preWindupVx = this.vx; // Abort resumes this heading
                    this.vx = 0; // Plant feet: the telegraph reads as stopping
                }
                break;
            case 'windup':
                // Abort back to patrol while the player stays outside the
                // zone; the dash direction only locks when the windup runs
                // its full time (fairness contract in the header).
                if (!this._triggeredBy(player, this._preWindupVx)) {
                    this.state = 'patrol';
                    this.stateTime = 0;
                    this.vx = this._preWindupVx || Math.abs(this.speed);
                    break;
                }
                if (this.stateTime >= CHARGER_WINDUP_TIME) {
                    this.state = 'dash';
                    this.stateTime = 0;
                    // Lock toward the player's side NOW (they could have
                    // crossed behind during the windup).
                    const dir = (player.x + player.width / 2) >= (this.x + this.width / 2)
                        ? 1 : -1;
                    this.vx = dir * this.speed * CHARGER_DASH_SPEED_MULT;
                }
                break;
            case 'dash':
                // Same clamp discipline as patrol: the dash can NEVER leave
                // [minX, maxX], so a charger cannot be lured into a pit —
                // patrol spans are solid-supported runs derived from terrain.
                this.x += this.vx * dt;
                if (this.x <= this.minX) {
                    this.x = this.minX;
                    this._endDash(1);
                } else if (this.x + this.width >= this.maxX) {
                    this.x = this.maxX - this.width;
                    this._endDash(-1);
                } else if (this.stateTime >= CHARGER_DASH_TIME) {
                    this._endDash(Math.sign(this.vx) || 1);
                }
                break;
            case 'cooldown':
                this._patrolStep(dt);
                if (this.stateTime >= CHARGER_COOLDOWN_TIME) {
                    this.state = 'patrol';
                    this.stateTime = 0;
                }
                break;
        }
    }

    // Dash ends -> cooldown patrolling at walker speed, heading inward from
    // the bound it just hit (or along the last heading on timeout).
    _endDash(inwardDir) {
        this.state = 'cooldown';
        this.stateTime = 0;
        this.vx = inwardDir * this.speed;
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
    // EnemyManager.drawAll), feet-anchored and facing-flipped. Kinds other
    // than 'walker' own dedicated silhouettes (see sprites.js).
    draw(ctx, sprites = null, index = 0) {
        if (this.dead) return;

        if (sprites && sprites.ready()) {
            sprites.drawEnemy(ctx, this, index);
            return;
        }

        // Fallback placeholder rectangles stay inside the 32x32 cell (the
        // lethal box lives within it — protruding placeholder art would
        // misrepresent reach). Kind tints mirror the sprites.js palette so
        // recognition survives even without the sheets loaded.
        let body = '#ff0000';
        if (this.kind === 'spiny') body = '#7b4fa0'; // purple-ish, spiked back
        else if (this.kind === 'charger') body = '#c8503c'; // rust-red, horned
        ctx.fillStyle = body;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        if (this.kind === 'spiny') {
            // Dark tooth row along the back (rect approximation keeps this
            // renderer free of path calls).
            ctx.fillStyle = '#1c1c24';
            for (let i = 0; i < 4; i++) {
                ctx.fillRect(this.x + 3 + i * 7, this.y - 0, 5, 5);
            }
        } else if (this.kind === 'charger') {
            // Forward horn block on the leading edge + windup flash band.
            // Facing must survive the planted-windup frame (vx === 0): read
            // the locked pre-windup heading instead of vx, or a left-charging
            // windup draws its horn backwards (review nit).
            const face = (this.state === 'windup')
                ? Math.sign(this._preWindupVx || 1)
                : (this.vx >= 0 ? 1 : -1);
            const hornX = (face > 0 ? this.x + this.width - 7 : this.x + 1);
            ctx.fillStyle = '#e8d8b0';
            ctx.fillRect(hornX, this.y + 5, 6, 5);
            if (this.state === 'windup') {
                ctx.fillStyle = 'rgba(255,232,170,0.55)';
                ctx.fillRect(this.x, this.y, this.width, this.height);
            }
        }

        // Add simple eye detail, shifted toward the facing direction
        // (same windup-safe facing rule as the charger horn above).
        ctx.fillStyle = '#fff';
        const eyeFace = (this.state === 'windup')
            ? Math.sign(this._preWindupVx || 1)
            : (this.vx >= 0 ? 1 : -1);
        const eyeOffset = eyeFace >= 0 ? 18 : 6;
        ctx.fillRect(this.x + eyeOffset, this.y + 8, 4, 4);
    }
}

export class EnemyManager {
    constructor() {
        this.enemies = [];
    }

    addEnemy(x, y, minX, maxX, kind = 'walker') {
        this.enemies.push(new Enemy(x, y, minX, maxX, kind));
    }

    updateAll(dt, player = null) {
        for (const enemy of this.enemies) {
            enemy.update(dt, player);
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
    // game loop). Returns { stomped, deadly, deadlyBySpiny, stompedEnemies }:
    // stomped counts enemies the player squashed this frame (falling feet-
    // first from above); deadly is true only when some other live enemy made
    // contact. stompedEnemies lists the killed Enemy instances (in sweep
    // order, length === stomped) so the caller can score by kind without a
    // second pass — the per-kind point values stay in main.js with the rest
    // of the economy constants. Spinies are never stomped — their spiked back
    // makes every contact deadly.
    resolvePlayerContact(player) {
        let stomped = 0;
        let deadly = false;
        let deadlyBySpiny = false;
        const stompedEnemies = [];
        const prevBottom = (player.prevY !== undefined ? player.prevY : player.y) + player.height;

        for (const enemy of this.enemies) {
            if (enemy.isDead()) continue;
            if (!enemy.checkCollision(player)) continue;

            if (enemy.kind === 'spiny') {
                deadly = true;
                // Distinct cause for the game-over readout: the exact moment
                // the spiked-back rule bites must TEACH it (fairness ruling:
                // deaths explainable), not blend into "Touched a patrol".
                deadlyBySpiny = true;
            } else if (player.vy > 0 && prevBottom <= enemy.y + ENEMY_STOMP_TOLERANCE) {
                enemy.die();
                stomped++;
                stompedEnemies.push(enemy);
            } else {
                deadly = true;
            }
        }

        return { stomped, deadly, deadlyBySpiny, stompedEnemies };
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
