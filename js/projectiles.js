/**
 * Bombardier cannonballs (player request 2026-11-04: "enemies that charge
 * and shoot :)"). A separate tiny module rather than more weight on
 * enemies.js: Enemy owns a grounded patrol body whose whole contract is
 * bounds-on-solid-runs; a projectile is airborne ballistics with terrain
 * collision and its own manager lifecycle (spawn/step/clear/draw), exactly
 * mirroring how EnemyManager aggregates Enemies. main.js wires it like every
 * other per-level manager, and both files keep their single-responsibility
 * header contracts readable.
 *
 * Contract:
 * - NO RNG EVER. Trajectories are pure state physics (gravity + initial
 *   velocity), so a same-seed replay reproduces every shot frame-for-frame.
 *   Visual dust bursts live in main.js through the existing Math.random
 *   particle system — render-only, outside this simulation.
 * - dt-driven only: updateAll runs exclusively inside Game.update's PLAYING
 *   branch, so PAUSED freezes shots mid-arc with zero extra machinery.
 * - FAIRNESS lineage (non-negotiable, see enemies.js bombardier header):
 *   the horizontal launch component is capped at PROJ_MAX_VX = 150 px/s,
 *   strictly below the player's 200 px/s run — a visible windup plus simply
 *   walking away always beats a shot.
 * - Death / interaction list, exhaustive (review m2 ruling, 2026-11-04):
 *     SOLID TILES      — die on contact, impact reported for the dust burst.
 *     MOVING DECKS     — NO collision, and line-of-fire reads them as
 *                        transparent too. RULING: decks are NOT cover for
 *                        projectiles, consistent with the one-way platform
 *                        philosophy — a deck only ever interacts with a
 *                        GROUNDED RIDER approaching from above; a flying
 *                        iron ball passing through is the same non-event as
 *                        walking off its side. Making decks shot-proof would
 *                        also invent a second, kind-dependent terrain view
 *                        (enemies' LoF vs balls vs players) for no fairness
 *                        gain: standing under a deck already reads as
 *                        "under open sky" to the gunner either way.
 *     ENEMIES          — no friendly fire, no enemy-vs-ball blocking.
 *     SPIKE TILES (2)  — floor teeth the ball sails over, never solids
 *                        (same reading as an arc over a spike bed).
 *     VOID             — despawn below the margin below (silent, no impact
 *                        event: nothing was hit). MAP SIDE EDGES differ:
 *                        the terrain adapter reads out-of-range columns as
 *                        solid, so shots hitting them burst like walls.
 *     OWNER DEATH      — does NOT cancel a fired ball (review n8): once the
 *                        iron leaves the muzzle the run ends on the
 *                        ballistics alone; stomping the gunner mid-flight
 *                        must never un-fire the shot already telegraphed.
 */
import { aabbOverlap } from './physics.js';

export const PROJ_RADIUS = 5;          // iron ball visual + lethal box half
export const PROJ_GRAVITY = 520;       // px/s² — gentler than the player's
// 980 so lobbed arcs hang visibly longer than any jump arc on screen: the
// threat reads as a slow falling bomb, never as a laser you must frame-dodge.
export const PROJ_MAX_VX = 150;        // px/s horizontal cap (< player 200)
// Terminal FALL speed (review M1, 2026-11-04). WHY a clamp instead of swept
// collision: with both velocity caps in place a swept/continuous test would
// guard nothing the point sample can't already see —
//   * vertical: TILE/dt-cap = 32/0.05 = 640 px/s, so ANY vy below 640 moves
//     the centre strictly less than one tile per frame; at 600 the worst
//     step is 30 px < 32, and the ball's centre must therefore LAND inside a
//     1-tile floor before it could stand below it — the existing point
//     sample catches every floor. Uncapped gravity reached vy ~1092 in the
//     reviewer's probe (steps of 55 px), which stepped clean through rows
//     12/19 and even "hit" a player sheltering UNDER a thin floor via the
//     position-sampled hitPlayer box. 600 leaves honest margin under 640.
//   * horizontal: PROJ_MAX_VX 150 * 0.05 = 7.5 px/frame ≪ 32, and walls are
//     multi-tile by construction; the ball radius (5) only widens what the
//     centre sample sees, never narrows it.
// Upward launch speeds need no clamp: the firing gate caps range at 8 cols
// and ±1.5 rows, where ballisticLaunch peaks at |vy| ≈ 471 → 24 px/frame
// < 32.
export const PROJECTILE_TERMINAL_VY = 600;
export const PROJ_MIN_FLIGHT = 0.5;    // s floor — point-blank shots still
// describe a full visible arc instead of flicking into the player's face.

// Ballistic aim: solve the launch velocity that passes through
// (x1, y1) after flight time t under PROJ_GRAVITY, choosing t so the
// horizontal component hits exactly PROJ_MAX_VX at long range and the arc
// stays lobbed at short range (t floors at PROJ_MIN_FLIGHT).
// Same inputs -> same output, always (pure math, no rng, no clock).
export function ballisticLaunch(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(PROJ_MIN_FLIGHT, Math.abs(dx) / PROJ_MAX_VX);
    return {
        vx: dx / t,
        vy: (dy - 0.5 * PROJ_GRAVITY * t * t) / t
    };
}

class Projectile {
    constructor(x, y, vx, vy, owner) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.r = PROJ_RADIUS;
        this.dead = false;
        // Back-reference to the firing Enemy: it gates its own one-live-
        // shot rule on this object's `dead` flag (no suppression barrages).
        this.owner = owner || null;
        // Fire-sfx latch (n6): flipped once this ball survives its first
        // simulation step, where the count lands (see updateAll).
        this._sfxCounted = false;
    }
}

// Wave B shell glow trail: fading GHOST POSITIONS sampled at DRAW time into
// a module-level WeakMap keyed by the Projectile object. Deliberately not a
// field on the projectile and never touched by updateAll: the simulation
// stays byte-identical (no state writes, no reads), ghosts die with their
// projectile via WeakMap semantics, and a paused game simply stops recording
// movement (the <1px guard below collapses ghosts onto the resting point).
const TRAIL_GHOSTS = 6;
const ghostTrails = new WeakMap();

export class ProjectileManager {
    /**
     * terrain: { tileSize, width, height, isSolidPx(px, py) } — the Level
     * builds this adapter over its final grid. Duck-typed on purpose:
     * tests hand in fake grids without importing anything.
     */
    constructor(terrain) {
        this.terrain = terrain;
        this.list = [];
    }

    spawn(x, y, vx, vy, owner = null) {
        const p = new Projectile(x, y, vx, vy, owner);
        this.list.push(p);
        // n6 (review 2026-11-04): NO fire-sfx count here — see the
        // _sfxCounted note in updateAll. A ball spawned inside a wall dies
        // unseen on its spawn frame and must stay silent.
        return p;
    }

    /**
     * Advance every live ball one step and resolve terrain/player/map-exit.
     * Returns the frame's events for the game loop:
     *   fired     — shots whose ball SURVIVED its first step since the
     *               previous call (sound hook). Counting on first-step
     *               survival is the n6 ruling: a muzzle pressed into a wall
     *               kills the ball inside that same updateAll pass, so the
     *               thump never plays for a shot nobody could see.
     *   impacts   — [{x, y}] terrain deaths (dust-burst hook);
     *   hitPlayer — true once this frame a ball touched the player (the
     *               caller ends the run with cause 'projectile').
     */
    updateAll(dt, player = null) {
        const events = { fired: 0, impacts: [], hitPlayer: false };
        const T = this.terrain.tileSize;
        const maxX = (this.terrain.width + 2) * T;   // off-map despawn margins
        const minX = -2 * T;                         // (generous: never pops
        const maxY = (this.terrain.height + 3) * T;  //  inside the camera)
        for (const p of this.list) {
            if (p.dead) continue;
            // M1 (review 2026-11-04): clamp fall speed BEFORE integrating —
            // see the PROJECTILE_TERMINAL_VY header for why 600 keeps every
            // vertical step under one tile at the main.js dt cap of 0.05 s,
            // which makes the point sample below tunnel-proof for 1-tile
            // floors (uncapped gravity reached ~1092 px/s = 55 px steps and
            // dropped balls straight through thin decks).
            p.vy = Math.min(p.vy + PROJ_GRAVITY * dt, PROJECTILE_TERMINAL_VY);
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (this.terrain.isSolidPx(p.x, p.y)) {
                p.dead = true;
                events.impacts.push({ x: p.x, y: p.y });
                continue;
            }
            if (player && aabbOverlap(player, {
                x: p.x - p.r, y: p.y - p.r, width: 2 * p.r, height: 2 * p.r
            })) {
                p.dead = true;
                events.hitPlayer = true;
                continue;
            }
            if (p.x < minX || p.x > maxX || p.y > maxY) p.dead = true;
            // n6 count site: only a ball still alive at the END of its first
            // step ever made it to a frame the player could see — count the
            // thump exactly once, here.
            if (!p.dead && !p._sfxCounted) {
                p._sfxCounted = true;
                events.fired++;
            }
        }
        // Reap dead balls so the list stays bounded by live fire.
        if (this.list.some(p => p.dead)) {
            this.list = this.list.filter(p => !p.dead);
        }
        return events;
    }

    getActive() {
        return this.list.filter(p => !p.dead);
    }

    clear() {
        this.list.length = 0;
    }

    // Dark iron ball with a short fading trail: two ghost circles sampled
    // BACK along the velocity vector (state-derived, deterministic — no
    // history buffers, no rng). Drawn by main.js between the entity pass
    // and the player so a ball never hides behind a coin pile.
    // Wave B: an optional `glowColor` turns on the trackable ember trail —
    // real ghost positions from the WeakMap above (cap TRAIL_GHOSTS), drawn
    // under FX.trails by the caller passing null to opt out. The legacy
    // velocity-derived ghosts stay: they are what makes the ball read as
    // MOVING even when the glow pool is cold right after the shot.
    drawAll(ctx, glowColor = null) {
        for (const p of this.list) {
            if (p.dead) continue;
            if (glowColor) {
                let ghosts = ghostTrails.get(p);
                if (!ghosts) {
                    ghosts = [];
                    ghostTrails.set(p, ghosts);
                }
                const head = ghosts[0];
                if (!head || Math.abs(head.x - p.x) > 1 ||
                    Math.abs(head.y - p.y) > 1) {
                    ghosts.unshift({ x: p.x, y: p.y });
                    if (ghosts.length > TRAIL_GHOSTS) ghosts.length = TRAIL_GHOSTS;
                }
                // Oldest → newest: widening + brightening toward the ball so
                // the eye rides the arc against dusk skies.
                for (let i = ghosts.length - 1; i >= 1; i--) {
                    const g = ghosts[i];
                    const k = 1 - i / (TRAIL_GHOSTS + 1);
                    ctx.globalAlpha = 0.3 * k;
                    ctx.fillStyle = glowColor;
                    ctx.beginPath();
                    ctx.arc(g.x, g.y, p.r * (0.4 + 0.5 * k), 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = '#23232c';
            ctx.beginPath();
            ctx.arc(p.x - p.vx * 0.07, p.y - p.vy * 0.07, p.r * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            ctx.arc(p.x - p.vx * 0.035, p.y - p.vy * 0.035, p.r * 0.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#23232c';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            // Top-left highlight keeps the ball readable on dark bands.
            ctx.fillStyle = '#8b8b9a';
            ctx.fillRect(p.x - 3, p.y - 3, 2, 2);
        }
    }
}
