/**
 * Patrolling enemies spawned by the Level from type-4 tiles.
 *
 * Contract:
 * - An Enemy is a 32x32 body walking back and forth along [minX, maxX] in
 *   pixel space at ENEMY_SPEED (40 px/s). Patrol bounds come from real
 *   terrain geometry (the contiguous solid run under its walk row, derived
 *   by Level.spawnEnemies), never a fixed radius around the spawn point.
 * - At a bound the enemy clamps flush against it and reverses; it never
 *   overshoots. Deployment guarantees at least one full tile of travel
 *   between bounds (ENEMY_MIN_RUN filter in level.js), so patrols never
 *   frame-flip on a single-column shelf.
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
 *   - 'bombardier' (player request 2026-11-04: "enemies that charge and
 *     shoot :)"): a DUAL threat sharing the charger's close-quarters leg
 *     plus a ranged cannon. From 'patrol':
 *       CLOSE  — player within 2.5 cols, ±1 row, in front -> the EXACT
 *                charger windup->dash->cooldown leg (shared `_chargeLeg`,
 *                same constants, same bounds clamp discipline).
 *       RANGED — feet within ±1.5 rows, 3..8 cols away, in front, a clear
 *                predicted-fire arc (see `_lineOfFireClear`), and NO live
 *                shot of its own -> WINDUP_RANGED (planted, visible squash
 *                + growing muzzle glow, 0.6 s) -> FIRE one ballistic ball
 *                (projectiles.js) -> COOLDOWN_RANGED patrolling 1.4 s.
 *     A ranged windup that the player CLOSING inside 2.5 cols interrupts
 *     ABORTS the shot and switches to the close charge instead (documented
 *     ruling: point-blank volleys are unfair by the same logic that bans
 *     narrow-shelf hostiles, while the dash is the kind's established
 *     answer to someone in your face). Leaving the ranged zone (out of
 *     band, around the back, arc blocked) aborts back to patrol — the shot
 *     only fires on a target that stayed visibly in the open for the whole
 *     telegraph. Stomping kills it (it is NOT spiny); it pays the charger
 *     premium tier because dismounting a gun-carrier is the harder read.
 *     Fairness lineage: windup ≥ 0.5 s before every shot, projectile
 *     strictly slower than the player run (PROJ_MAX_VX 150 < 200), never
 *     fires while its own charge leg is active, and the one-live-shot cap
 *     makes suppression barrages impossible.
 *   `state` ∈ 'patrol' | 'windup' | 'dash' | 'cooldown' | 'windup_ranged'
 *   | 'cooldown_ranged' (walkers and spinies stay 'patrol' forever; the
 *   close-charge states are SHARED with chargers so diagnostics read the
 *   same for both kinds). Charger/bombardier transitions need the player,
 *   so `update(dt, player)` / `updateAll(dt, player)` take an optional
 *   player reference; without one they simply patrol. Bombardiers also
 *   need a combat context ({projectiles, terrain}) handed in by
 *   Level.spawnEnemies; without one they patrol too.
 * - A dead enemy (`die()`) stops moving, stops being reported by the
 *   manager's collision aggregation, and draws nothing.
 * - Stuck detection (>1s no movement -> reset) is deferred by owner
 *   ratification 2026-11-01 (plan "Execution notes and ratified deviations"
 *   item 6): static terrain plus walkable, band-clamped bounds cannot make
 *   these enemies stuck. Revisit for moving platforms / dynamic terrain.
 */
import { aabbOverlap } from './physics.js';
import { ballisticLaunch, PROJ_GRAVITY, PROJ_MAX_VX } from './projectiles.js';
import { FX } from './fx.js';

// Exported so Level.spawnEnemies' deploy filter (ENEMY_MIN_RUN) measures
// patrol travel against the real body width instead of mirroring a magic
// number (same reasoning as COIN_POINTS in collectibles.js).
export const ENEMY_WIDTH = 32;
const ENEMY_HEIGHT = 32;
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

// --- Bombardier ranged leg (player request 2026-11-04) ----------------------
// The close-quarters leg REUSES the CHARGER_* constants above verbatim via
// the shared _chargeLeg helper — one telegraph language for every charging
// body keeps the readability math (0.45 s windup ≈ 90 px of player movement)
// true across kinds. These govern only the cannon.
const BOMBARDIER_WINDUP_RANGED_TIME = 0.6;  // s telegraph before FIRE — the
// fairness floor is ≥0.5 s visible windup per shot; 0.6 buys a margin over
// the charger's because a ball cannot be stomped back like a dashing body.
const BOMBARDIER_COOLDOWN_RANGED_TIME = 1.4; // s patrol before re-aiming
const BOMBARDIER_RANGE_MIN_COLS = 3;   // closer than this = close-leg territory
const BOMBARDIER_RANGE_MAX_COLS = 8;   // beyond it the lob can't threaten fairly
const BOMBARDIER_RANGED_ROW_TOLERANCE = 48; // ±1.5 tile rows of feet height
const BOMBARDIER_CLOSE_TRIGGER_COLS = 2.5;  // center-to-center px = 80

export const ENEMY_STATES = ['patrol', 'windup', 'dash', 'cooldown',
    'windup_ranged', 'cooldown_ranged'];

export class Enemy {
    constructor(x, y, minX, maxX, kind = 'walker', context = null) {
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
        // |bombardier (assigned by Level.spawnEnemies from the seeded RNG),
        // state ∈ ENEMY_STATES. Only the game loop drives state transitions.
        this.kind = kind;
        this.state = 'patrol';
        this.stateTime = 0;
        // Bombardier combat context (Level.spawnEnemies hands in
        // {projectiles, terrain}; every other kind ignores it). `liveShot`
        // is the Projectile this gun last fired — its one-in-flight cap
        // reads the shot's own `dead` flag, so a ball that landed frees the
        // barrel exactly when it ceased to exist on screen.
        this._projectiles = context && context.projectiles
            ? context.projectiles : null;
        this._terrain = context && context.terrain ? context.terrain : null;
        this.liveShot = null;
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
        if (this.kind === 'bombardier') {
            this._updateBombardier(dt, player);
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
                    this._enterCloseWindup();
                }
                break;
            default:
                this._chargeLeg(dt, player);
        }
    }

    // Plant feet for the close-charge telegraph. `keepHeading` lets a
    // bombardier switching out of a ranged windup carry the heading it
    // already planted (its vx is 0 there); chargers enter straight from
    // patrol with live vx.
    _enterCloseWindup(keepHeading = null) {
        this.state = 'windup';
        this.stateTime = 0;
        this._preWindupVx = keepHeading !== null
            ? keepHeading : this.vx; // Abort resumes this heading
        this.vx = 0; // Plant feet: the telegraph reads as stopping
    }

    // Shared charger leg (bombardier's close threat runs THIS code, so both
    // kinds telegraph identically): windup -> dash -> cooldown. Behaviour is
    // byte-identical to the pre-bombardier charger.
    _chargeLeg(dt, player) {
        switch (this.state) {
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

    // --- Bombardier ---------------------------------------------------------
    // Live facing: patrol vx while moving, the planted pre-windup heading
    // while any windup stands it still (same rule the draw fallback uses).
    _facingDir() {
        if (this.vx !== 0) return Math.sign(this.vx);
        return Math.sign(this._preWindupVx || 1);
    }

    // Muzzle tip in world px: forward of the body centre at barrel height
    // (mirrors the sprites.js bronze barrel so the glow, the ball and the
    // arc math all agree on where a shot comes FROM).
    _muzzlePoint() {
        const face = this._facingDir();
        return {
            x: this.x + this.width / 2 + face * 22,
            y: this.y + 14
        };
    }

    // Line of fire over the PREDICTED ballistic arc (not the straight line):
    // sample the exact trajectory ballisticLaunch would produce against the
    // current target position, skipping the first samples still inside the
    // gunner's own cell. A wall OR a low ceiling between gun and player
    // vetoes the shot — sampling the arc instead of the chord is what makes
    // "no solid tile directly between muzzle and target" honest about a lob
    // that apexes two rows above the chord. Honest approximation: the
    // player can still drift off the predicted point during the 0.6 s
    // telegraph, so the fired arc may clip geometry the check never saw.
    _lineOfFireClear(player) {
        if (!this._terrain) return true; // no terrain view => open lane
        const m = this._muzzlePoint();
        const tx = player.x + player.width / 2;
        const ty = player.y + player.height / 2;
        const v = ballisticLaunch(m.x, m.y, tx, ty);
        const flight = Math.max(0.5, Math.abs(tx - m.x) / PROJ_MAX_VX);
        const steps = 14;
        for (let i = 1; i <= steps; i++) {
            const t = (i / steps) * flight;
            const sx = m.x + v.vx * t;
            const sy = m.y + v.vy * t + 0.5 * PROJ_GRAVITY * t * t;
            // Skip samples still inside the gunner's own 32px cell: the
            // muzzle sits beside its own body, not behind cover.
            if (Math.abs(sx - (this.x + this.width / 2)) < 20 &&
                Math.abs(sy - (this.y + this.height / 2)) < 20) continue;
            if (this._terrain.isSolidPx(sx, sy)) return false;
        }
        return true;
    }

    // Ranged trigger zone: 3..8 cols centre-to-centre, feet within ±1.5
    // rows, roughly in front, arc clear, and no live shot of its own yet
    // (one-in-flight cap — no suppression barrages, fairness ruling).
    _rangedTriggeredBy(player, facing = this._facingDir()) {
        if (!player || facing === 0) return false;
        if (this.liveShot && !this.liveShot.dead) return false;
        const dx = (player.x + player.width / 2) - (this.x + this.width / 2);
        if (dx === 0 || Math.sign(dx) !== Math.sign(facing)) return false;
        const adx = Math.abs(dx);
        if (adx < BOMBARDIER_RANGE_MIN_COLS * 32) return false;
        if (adx > BOMBARDIER_RANGE_MAX_COLS * 32) return false;
        const dyFeet = Math.abs((player.y + player.height) - (this.y + this.height));
        if (dyFeet > BOMBARDIER_RANGED_ROW_TOLERANCE) return false;
        return this._lineOfFireClear(player);
    }

    // Close trigger: strictly the charger leg's front-and-row test shrunk
    // to 2.5 cols — inside this range the cannon is useless and the dash
    // is the kind's established answer (see header ruling).
    _closeTriggeredBy(player, facing = this._facingDir()) {
        if (!player || facing === 0) return false;
        const dx = (player.x + player.width / 2) - (this.x + this.width / 2);
        if (dx === 0 || Math.sign(dx) !== Math.sign(facing)) return false;
        if (Math.abs(dx) > BOMBARDIER_CLOSE_TRIGGER_COLS * 32) return false;
        const dyFeet = Math.abs((player.y + player.height) - (this.y + this.height));
        return dyFeet <= CHARGER_TRIGGER_ROW_TOLERANCE;
    }

    _updateBombardier(dt, player) {
        this.stateTime += dt;
        switch (this.state) {
            case 'patrol':
                this._patrolStep(dt);
                // Close threat wins over ranged: someone already inside the
                // dash band must never eat an instant point-blank volley.
                if (this._closeTriggeredBy(player)) {
                    this._enterCloseWindup();
                } else if (this._rangedTriggeredBy(player)) {
                    this.state = 'windup_ranged';
                    this.stateTime = 0;
                    this._preWindupVx = this.vx; // Abort/planted-facing anchor
                    this.vx = 0; // Plant feet: the telegraph reads as stopping
                }
                break;
            case 'windup_ranged': {
                const facing = Math.sign(this._preWindupVx || 1);
                if (this._closeTriggeredBy(player, facing)) {
                    // Player CLOSED into the muzzle during the telegraph:
                    // abort the shot, switch to the close charge (documented
                    // ruling — see header). Heading carries over.
                    this._enterCloseWindup(this._preWindupVx);
                } else if (!this._rangedTriggeredBy(player, facing)) {
                    // Left the band / crossed behind / broke the arc: stand
                    // down exactly like the charger's windup abort.
                    this.state = 'patrol';
                    this.stateTime = 0;
                    this.vx = this._preWindupVx || Math.abs(this.speed);
                } else if (this.stateTime >= BOMBARDIER_WINDUP_RANGED_TIME) {
                    this._fireRanged(player);
                    this.state = 'cooldown_ranged';
                    this.stateTime = 0;
                }
                break;
            }
            case 'cooldown_ranged':
                this._patrolStep(dt);
                if (this.stateTime >= BOMBARDIER_COOLDOWN_RANGED_TIME) {
                    this.state = 'patrol';
                    this.stateTime = 0;
                }
                break;
            default:
                // 'windup' | 'dash' | 'cooldown': the shared charger leg.
                // No firing anywhere in here — the one-live-shot rule plus
                // these states' own triggers make a mid-charge volley
                // structurally impossible (fairness contract).
                this._chargeLeg(dt, player);
        }
    }

    // FIRE: aim at the player's CURRENT centre (no leading — the fairness
    // contract is "standing still gets punished, moving escapes", not
    // mind-reading). The returned Projectile reference gates the cap.
    _fireRanged(player) {
        if (!this._projectiles) return;
        const m = this._muzzlePoint();
        const v = ballisticLaunch(m.x, m.y,
            player.x + player.width / 2, player.y + player.height / 2);
        this.liveShot = this._projectiles.spawn(m.x, m.y, v.vx, v.vy, this);
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
    // than 'walker' own dedicated silhouettes (see sprites.js). The optional
    // `player` (Wave B) is READ-ONLY proximity context for telegraph
    // embellishments (spiny rattle); nothing below ever writes to it.
    draw(ctx, sprites = null, index = 0, player = null) {
        if (this.dead) return;

        if (sprites && sprites.ready()) {
            sprites.drawEnemy(ctx, this, index, player);
            return;
        }

        // Fallback placeholder rectangles stay inside the 32x32 cell (the
        // lethal box lives within it — protruding placeholder art would
        // misrepresent reach). Kind tints mirror the sprites.js palette so
        // recognition survives even without the sheets loaded.
        // Wave B: the degradation path gets the same telegraph family as the
        // sheet art. Spiny micro-rattle derives its phase from patrol x (no
        // new timing source; spinies are always moving while alive), the
        // charger windup pulses like the sheet dome, and the bombardier gun
        // kicks back after firing. All read-only, all FX-scaled.
        let jx = 0;
        if (this.kind === 'spiny' && FX.trails && player &&
            Math.abs((player.x + player.width / 2) - (this.x + this.width / 2)) <= 96) {
            jx = Math.sin(this.x * 1.9) * 1.3 * FX.intensity;
        }
        const rattled = jx !== 0 && typeof ctx.save === 'function';
        if (rattled) {
            ctx.save();
            ctx.translate(jx, 0);
        }
        let body = '#ff0000';
        if (this.kind === 'spiny') body = '#7b4fa0'; // purple-ish, spiked back
        else if (this.kind === 'charger') body = '#c8503c'; // rust-red, horned
        else if (this.kind === 'bombardier') body = '#4a1f52'; // dark plum
        ctx.fillStyle = body;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Windup-safe facing for every decoration below: a planted body has
        // no vx sign, so read the locked pre-windup heading instead (the
        // charger-horn review nit applies to BOTH windup flavours).
        const drawnFace = (this.state === 'windup' || this.state === 'windup_ranged')
            ? Math.sign(this._preWindupVx || 1)
            : (this.vx >= 0 ? 1 : -1);

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
                // Pulsing tell mirroring sprites.js _drawCharger (stateTime-
                // driven; intensity-scaled, never flag-gated — fairness).
                const k = Math.min(1, this.stateTime / 0.45);
                const pulse = 0.5 + 0.5 * Math.sin(this.stateTime * Math.PI * 12);
                const a = Math.min(0.85, (0.22 + 0.2 * k + 0.22 * pulse) * FX.intensity);
                ctx.fillStyle = `rgba(255,232,170,${a.toFixed(3)})`;
                ctx.fillRect(this.x, this.y, this.width, this.height);
            }
        } else if (this.kind === 'bombardier') {
            // Bronze cannon barrel mounted forward on the leading edge —
            // the silhouette signal that this body carries a gun. Wave B
            // muzzle recoil kick mirrors sprites.js _drawBombardier.
            const recoil = (FX.trails && this.state === 'cooldown_ranged' &&
                this.stateTime < 0.12) ? 5 * (1 - this.stateTime / 0.12) : 0;
            const muzzleX = (drawnFace > 0 ? this.x + this.width - 2 : this.x - 10) -
                drawnFace * recoil;
            ctx.fillStyle = '#b0803a';
            ctx.fillRect(muzzleX, this.y + 11, 12, 6);
            if (this.state === 'windup_ranged') {
                // Growing muzzle glow off stateTime (deterministic telegraph,
                // mirrors sprites.js _drawBombardier).
                const k = Math.min(1, this.stateTime / 0.6);
                ctx.fillStyle = `rgba(255,180,80,${0.25 + 0.5 * k})`;
                const gx = drawnFace > 0 ? this.x + this.width : this.x - 4 - 4 * k;
                ctx.fillRect(gx, this.y + 9 - 2 * k, 4 + 4 * k, 10 + 4 * k);
            } else if (this.state === 'cooldown_ranged' && this.stateTime < 0.08) {
                // One-frame FIRE flash at the muzzle.
                ctx.fillStyle = 'rgba(255,232,170,0.9)';
                const fx = drawnFace > 0 ? this.x + this.width : this.x - 6;
                ctx.fillRect(fx, this.y + 8, 6, 12);
            }
        }

        // Add simple eye detail, shifted toward the facing direction
        // (same windup-safe facing rule as the charger horn above).
        ctx.fillStyle = '#fff';
        const eyeOffset = drawnFace >= 0 ? 18 : 6;
        ctx.fillRect(this.x + eyeOffset, this.y + 8, 4, 4);
        if (rattled) ctx.restore(); // spiny rattle translate (jx) opened above
    }
}

export class EnemyManager {
    constructor() {
        this.enemies = [];
    }

    addEnemy(x, y, minX, maxX, kind = 'walker', context = null) {
        this.enemies.push(new Enemy(x, y, minX, maxX, kind, context));
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

    // Optional `player`: read-only proximity context for Wave B telegraph
    // embellishments (see Enemy.draw / sprites.drawEnemy).
    drawAll(ctx, sprites = null, player = null) {
        this.enemies.forEach((enemy, index) => enemy.draw(ctx, sprites, index, player));
    }
}
