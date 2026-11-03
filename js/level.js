import { Collectibles } from './collectibles.js';
import { Difficulty, PHASE2_FIRST_LEVEL } from './difficulty.js';
import { EnemyManager } from './enemies.js';
import { Hazards } from './hazards.js';

const DIFFICULTY = new Difficulty();

const MAX_GENERATION_ATTEMPTS = 200;
const SPAWN_TILE_X = 2;
// Horizontal jump scan bound in tiles: hang time 2*350/980 ≈ 0.71s at speed
// 200 px/s covers ~143px, i.e. ~4 tiles of 32px. Conservative integer bound.
const MAX_H_JUMP = 4;
// Vertical levels (Task 9) climb a taller, narrower grid. Physics constants
// are unchanged; the grid simply gives the documented one-tile-per-jump
// climb more rows to spend, and death/camera already scale with
// level.height * tileSize.
const VERTICAL_WIDTH = 15;
const VERTICAL_HEIGHT = 24;
// Portal candidate band on vertical levels: reachable tiles at or above
// this row. Hazard/marker placement additionally keeps the bottom spawn
// neighborhood (y >= height - VERTICAL_SPAWN_EXCL_ROWS) clear.
const VERTICAL_PORTAL_MAX_Y = 4;
const VERTICAL_SPAWN_EXCL_ROWS = 6;
// Tile radius kept clear of spikes around a coin: dropping past a coin one
// tile off-line must never land the player on a tooth (playtest screenshot:
// coin over a spike corridor, uncollectable without dying).
const COIN_SPIKE_MARGIN = 2;
// Columns at each end of a horizontal map kept free of hazards and enemy
// markers (see hazardPlacementAllowed): spawn runway and portal apron.
const HAZARD_SPAWN_EXCLUDE_COLS = 9;

// Travel direction is deterministic from the level number so tests and E2E
// flows can rely on it: the shipped Phase 1 ramp (levels 1-4) stays
// right-facing, then right/left/vertical cycle from level 5 onward
// (L5 right, L6 left, L7 vertical, L8 right, L9 left).
function directionForLevel(levelNumber) {
    if (levelNumber < PHASE2_FIRST_LEVEL) return 'right';
    return ['right', 'left', 'vertical'][(levelNumber - PHASE2_FIRST_LEVEL) % 3];
}

// Seeded PRNG (mulberry32): a Level built with the same seed replays
// identically, so retrying a level re-runs the map you died on instead of
// rerolling for a friendier generation.
function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// In-place Fisher-Yates shuffle: bounded, no unbounded random retry loops.
function shuffle(items, rng = Math.random) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

// Movement model for the reachability check, matching the game's physics:
// JUMP_FORCE=350 / GRAVITY=980 gives a max jump rise of ~62px (< 2 tiles at
// tileSize 32), so climbing more than one tile in a single jump is not
// possible. Horizontal range per grounded jump: total hang time returning to
// launch height is t = 2*JUMP_FORCE/GRAVITY ≈ 0.71s; at PLAYER_SPEED=200 that
// is ~143px ≈ 4 tiles (tileSize 32), so we scan landings up to 4 columns away
// for same-or-lower targets. From any standing tile (air with solid below)
// the player can:
//   - walk or fall left/right, including jumping across bottomless pits up
//     to 3 tiles wide (landing column at most 4 away); every intermediate
//     column must be passable at the current row;
//   - jump up exactly one tile onto a step, straight across or over a gap of
//     one intermediate column.
// Out-of-bounds: side walls are solid, the sky is open, and falling below the
// grid bottom (a pit with no floor) kills, so it offers no landing.
//
// Spike tiles (type 2) are treated conservatively as death, never as terrain:
// they are NOT standable, they provide no support (standing on a spike tip
// is impossible), and they terminate downward landing scans (falling into a
// spike column kills rather than passing through). Aerial pass-through is
// bounded by simulation against Physics + Hazards, not assumed: the inset
// 24px lethal core of a ground-level spike forces feet ≥28px above the launch
// row, leaving ~0.54s of hang time ≈ 108px at speed 200 — enough to cross ONE
// core (32px body + 24px core = 56px sweep) with margin, and two adjacent
// cores only barely; three or more consecutive spikes cannot be crossed at
// all. So a flat jump may arc over strips of at most two adjacent surface
// spikes but never rests on or inside one, and a run of ≥3 adjacent spikes is
// modelled as a wall. A spike CAPPING a riser (sitting on a column whose top
// is one tile above the launch row) is worse: its core then forces feet ≥60px
// above launch — with max rise ~62.5px that leaves only ~28.6px of travel,
// less than the 56px sweep, so the crossing is physically impossible in every
// takeoff/timing combination (simulated: 0/4539 survived). Such capped risers
// are modelled as full wall height for step-up jumps. Generation keeps spikes
// ≥2 columns apart, so these stricter rules cost no accepted layouts; they
// only stop the BFS from validating routes the shipped physics cannot fly.
// Consequence: reachability of coins, portal, and enemy spawns never routes
// THROUGH death. Grids without type-2 tiles behave bit-identically to the
// pre-hazard model (hazard() is constant false there).
//
// requireOpenHead (used by the vertical validation): additionally reject any
// standable cell with a solid tile directly overhead. The 32x32 body fills a
// 32px tile exactly, so a ceiling leaves zero jump clearance — every rise the
// BFS would model from that cell is a head-butt. The vertical generator's
// ledges can hang over lower ledge tops (a bounce extends a ledge back over
// the columns two rows down), so without this rule those cells become
// validated launch/landing points and unfair coin/portal placements. Walking
// beneath an overhang stays modelled: the horizontal scans only test the body
// row for solidity. Horizontal heightmaps structurally never put a ceiling
// over a standable cell, so their callers keep the default (false) and
// byte-identical behaviour.
export function computeReachable(
    tiles,
    width,
    height,
    startTile,
    requireOpenHead = false
) {
    const solid = (x, y) => {
        if (x < 0 || x >= width) return true;
        if (y < 0 || y >= height) return false;
        return tiles[y][x] === 1;
    };
    const hazard = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        return tiles[y][x] === 2;
    };
    // A cell you could occupy: neither solid rock nor a spike.
    const freeCell = (x, y) => !solid(x, y) && !hazard(x, y);
    const standable = (x, y) =>
        freeCell(x, y) && solid(x, y + 1) &&
        (!requireOpenHead || !solid(x, y - 1));

    const key = (x, y) => y * width + x;
    const reachable = new Set();

    if (!standable(startTile.x, startTile.y)) {
        return reachable;
    }

    const queue = [[startTile.x, startTile.y]];
    reachable.add(key(startTile.x, startTile.y));

    while (queue.length > 0) {
        const [x, y] = queue.shift();

        for (const dir of [-1, 1]) {
            // Walk or fall along/across columns at current row height. A move
            // of distance d models a flat jump: every column between start and
            // landing must be air at the current row, and the landing column
            // is scanned downward from y for any standable tile (same-or-
            // lower target). Scan bound MAX_H_JUMP = physical jump range
            // ~143px / 32px.
            for (let dist = 1; dist <= MAX_H_JUMP; dist++) {
                let blocked = false;
                let hazardRun = 0;
                for (let m = 1; m < dist; m++) {
                    const midX = x + dir * m;
                    if (solid(midX, y)) {
                        blocked = true;
                        break;
                    }
                    // Physics-verified boundary (see header): three or more
                    // adjacent surface spikes cannot be cleared by a grounded
                    // jump, so the strip is a wall to this scan. Generation
                    // keeps spikes ≥2 columns apart; this only models what
                    // simulation showed, never rejecting generated layouts.
                    if (hazard(midX, y)) {
                        hazardRun++;
                        if (hazardRun >= 3) {
                            blocked = true;
                            break;
                        }
                    } else {
                        hazardRun = 0;
                    }
                }
                if (blocked) continue;

                const c = x + dir * dist;
                for (let ly = y; ly < height; ly++) {
                    // Falling into a spike cell is death: no landing here
                    // and nothing further down the column either.
                    if (hazard(c, ly)) break;
                    if (standable(c, ly) && !reachable.has(key(c, ly))) {
                        reachable.add(key(c, ly));
                        queue.push([c, ly]);
                    }
                    if (solid(c, ly)) break;
                }
            }

            // Jump up one tile onto a step: landing tile must be standable.
            for (const dist of [1, 2]) {
                const c = x + dir * dist;
                const ty = y - 1;
                if (!standable(c, ty)) continue;

                let clear = true;
                if (dist === 2) {
                    // The intermediate column must not be a >=2-tile-high
                    // wall: its top has to sit within jump rise (~62px). A
                    // spike capping a one-tile riser counts as that wall:
                    // clearing its inset core demands feet ≥60px above the
                    // launch row, leaving ~28.6px of travel against a 56px
                    // overlap sweep — impossible (see header).
                    const midX = x + dir;
                    if ((solid(midX, ty) || hazard(midX, ty)) &&
                        solid(midX, y)) {
                        clear = false;
                    }
                }
                if (clear && !reachable.has(key(c, ty))) {
                    reachable.add(key(c, ty));
                    queue.push([c, ty]);
                }
            }
        }
    }

    return reachable;
}

export function canReach(
    tiles,
    width,
    height,
    startTile,
    goalTile,
    requireOpenHead = false
) {
    const reachable = computeReachable(
        tiles,
        width,
        height,
        startTile,
        requireOpenHead
    );
    return reachable.has(goalTile.y * width + goalTile.x);
}

export class Level {
    constructor(levelNumber, tileSize, seed) {
        this.levelNumber = levelNumber;
        this.tileSize = tileSize;
        // Seeded when given (Game passes runSeed-per-level so retries are
        // exact replays); unseeded callers keep fresh random maps.
        this.rng = makeRng(seed === undefined
            ? (Math.random() * 0xffffffff) >>> 0
            : seed >>> 0);
        // The resolved seed, kept for diagnostics: the HUD readout lets a
        // playtest screenshot pin the exact map for reproduction.
        this.seed = seed === undefined ? null : seed >>> 0;

        // Task 9: travel direction varies per level (deterministic mapping).
        this.direction = directionForLevel(levelNumber);

        // Difficulty tiers size horizontal maps (20x15 / 24x18 / 28x21 from
        // level 5 / 10). Vertical levels climb a fixed 15x24 grid.
        if (this.direction === 'vertical') {
            this.width = VERTICAL_WIDTH;   // tiles
            this.height = VERTICAL_HEIGHT; // tiles
        } else {
            const size = DIFFICULTY.getLevelSize(levelNumber);
            this.width = size.width;   // tiles
            this.height = size.height; // tiles
        }

        let attempt = 0;
        let valid = false;
        while (attempt < MAX_GENERATION_ATTEMPTS && !valid) {
            // Terrain, spike tiles (type 2), and enemy markers (type 4) are
            // all laid down before computeReachable runs, so the validation
            // BFS sees the final geometry. If spikes wall off the map, no
            // portal candidate survives and the retry regenerates.
            this.tiles = this.generateLevel();
            this.spawnTile = this.getSpawnTile();
            this.reachableTiles = computeReachable(
                this.tiles,
                this.width,
                this.height,
                this.spawnTile,
                // Vertical ledges create overhangs a 32px body cannot jump
                // out of; validate those maps headroom-aware (see
                // computeReachable). Horizontal heightmaps keep the default.
                this.direction === 'vertical'
            );
            this.portalTile = this.pickPortalTile();
            valid = this.portalTile !== null;
            // Patrol AI from level 5 onward is a product contract (README).
            // Jagged Phase-2 terrain can leave no legal marker site inside
            // the band, so a zero-marker construction is rejected here —
            // otherwise unit tests would flake on terrain variance (~0.1% of
            // constructions) and level 5+ could ship with no enemies at all.
            // The same reasoning covers spikes: the keep-if-harmless gate can
            // reject every candidate on heavily fragmented maps, so hazard
            // presence is required here too (level 5+ always ships spikes).
            if (valid && DIFFICULTY.hasPhase2Content(this.levelNumber)) {
                // Check what actually deploys, not raw markers: a marker that
                // fails deriveEnemySpawns' band/reachability/patrolSpan filters
                // ships zero enemies while a raw count reports success. Same
                // call spawnEnemies() makes below, on the same tiles and
                // reachableTiles, so guard and deployment cannot diverge.
                // Vertical climbs earn their difficulty from the ascent
                // itself; forcing a spike onto them historically meant
                // placing it on the route's walking surface (the map has
                // almost nowhere else). Spikes stay REQUIRED on horizontal
                // maps and opportunistic-but-fair on vertical ones.
                valid = this.deriveEnemySpawns().length > 0 &&
                    (this.direction === 'vertical' ||
                        this.countTilesOfType(2) > 0);
            }
            attempt++;
        }

        // Fail fast rather than hand back a soft-locked level: without a
        // portal the player can never finish, and the run would silently
        // stall. Reaching 200 failed attempts means the generator itself is
        // broken, not merely unlucky.
        if (!valid) {
            throw new Error(
                `Level ${levelNumber}: no reachable portal position after ` +
                `${MAX_GENERATION_ATTEMPTS} generation attempts`
            );
        }

        // Pixel-space spawn point sits on the forced flat ground at the
        // direction's spawn tile (left-facing mirrors it to the right edge,
        // vertical drops the player bottom-center on the ground band).
        this.spawnPoint = {
            x: this.spawnTile.x * tileSize,
            y: this.spawnTile.y * tileSize
        };
        this.platforms = this.extractPlatforms();
        this.portal = this.portalTile
            ? {
                x: this.portalTile.x * tileSize,
                y: this.portalTile.y * tileSize,
                width: 32,
                height: 48
            }
            : null;
        // Reachability-verified coins stay the generation source of truth;
        // Collectibles owns the collection bookkeeping over them. Both point
        // at the same array so draw() and getCoins() see collected flags.
        this.collectibles = new Collectibles();
        this.collectibles.loadCoins(this.extractCoins());
        this.coins = this.collectibles.getCoins();
        // Hazards scan the tile grid for spike tiles (type 2), which the
        // Phase 2 generator places at level >= 5.
        this.hazards = new Hazards();
        this.extractHazards();
        // Enemies scan the tile grid for enemy spawn tiles (type 4), which
        // the Phase 2 generator places at level >= 5; unreachable markers
        // are skipped by the spawn validation.
        this.enemyManager = new EnemyManager();
        this.spawnEnemies();
    }

    // Standing tile per direction on the forced flat ground band: canonical
    // left spawn for 'right', mirrored right spawn for 'left' (mirror of
    // x=2 is width-3), bottom-center for 'vertical'.
    getSpawnTile() {
        const y = this.height - 4;
        switch (this.direction) {
            case 'left':
                return { x: this.width - 3, y };
            case 'vertical':
                return { x: Math.floor(this.width / 2), y };
            default:
                return { x: SPAWN_TILE_X, y };
        }
    }

    // Spawn tile in canonical right-facing generation space (before the
    // 'left' column flip): the single spelling shared by placeSpikes'
    // keep-if-harmless gate and generateLevel's marker reachability pass,
    // so neither can drift from the other.
    canonicalSpawnTile() {
        return this.direction === 'vertical'
            ? this.getSpawnTile()
            : { x: SPAWN_TILE_X, y: this.height - 4 };
    }

    generateLevel() {
        const tiles = Array(this.height).fill(null).map(() =>
            Array(this.width).fill(0)
        );

        // Cells carrying the validated vertical route (jump-off/landing);
        // spikes must never cover them. Null for horizontal generation.
        this.pathCells = null;

        if (this.direction === 'vertical') {
            this.generateVertical(tiles);
        } else {
            this.generatePlatforms(tiles);
        }
        // Order matters: hazards and enemy markers exist in the grid before
        // the constructor's computeReachable pass validates the level.
        this.placeSpikes(tiles);
        // Marker candidates must be judged against the final terrain plus
        // spikes (I2): a spike can strip a ledge of its only legal approach,
        // and deriveEnemySpawns would then silently drop every marker on it,
        // exhausting whole constructions on vertical maps (~6% at level 13).
        // Same BFS, spawn tile and headroom rule as the constructor's pass on
        // this same grid — markers that survive here deploy for real. Computed
        // in canonical (pre-mirror) space; the movement model is symmetric
        // in x, so 'left' reachability mirrors exactly.
        this.generationReachable = computeReachable(
            tiles,
            this.width,
            this.height,
            this.canonicalSpawnTile(),
            this.direction === 'vertical'
        );
        this.placeEnemyMarkers(tiles);

        // 'left' generates entirely in canonical right-facing space — spawn
        // zone, end zone, portal band and hazard exclusions are all written
        // for that space — and mirrors afterwards. The column flip maps the
        // terrain, the spike/marker exclusion bands, and the movement model
        // (symmetric in x) onto exact mirrored counterparts.
        if (this.direction === 'left') {
            for (const row of tiles) row.reverse();
        }

        return tiles;
    }

    generateVertical(tiles) {
        const w = this.width;
        const h = this.height;

        // Ground band along the bottom: full-width solid from row h-3 down,
        // so the standing surface is row h-4 across the whole floor and the
        // bottom-center spawn always stands on solid ground.
        for (let x = 0; x < w; x++) {
            for (let y = h - 3; y < h; y++) {
                tiles[y][x] = 1;
            }
        }

        // Ascending chain of floating ledges, each exactly one row above the
        // last: rise <= 1 per jump is the only climb the movement model
        // allows (see computeReachable), so the chain steps up from the
        // ground's standing row to the top portal band (y <= 4). Every link
        // is a single dist-1 or dist-2 rise-jump from the previous standing
        // spot, and each ledge extends FORWARD (direction of travel) from
        // its landing tile. Forward-only extension is what keeps the route
        // provably intact in the final grid: a ledge's solid row equals the
        // previous ledge's standing row, so painting backwards would bury
        // the very cells the validated route stands on. Direction bounces
        // off the side walls; the constructor's BFS stays the safety net.
        this.pathCells = new Set();
        let x = Math.floor(w / 2); // current standing column
        let dir = this.rng() < 0.5 ? 1 : -1;
        for (let row = h - 4; row >= VERTICAL_PORTAL_MAX_Y + 1; row--) {
            let c = x + dir * (this.rng() < 0.15 ? 2 : 1);
            if (c < 1 || c > w - 2) {
                // Bounce off the wall; the flipped step always fits since
                // every standing column stays inside [1, w-2].
                dir = -dir;
                c = x + dir;
            }
            // Decorative forward run (>= 2 tiles): gives the ledge body a
            // contiguous top at least 3 columns wide for enemy patrols.
            const ext = 2 + Math.floor(this.rng() * 4);
            const lo = dir === 1 ? c : c - ext;
            const hi = dir === 1 ? c + ext : c;
            for (let cx = Math.max(0, lo); cx <= Math.min(w - 1, hi); cx++) {
                // Never cap a route cell: painting (row, cx) directly above
                // a recorded jump-off/landing ((row + 1, cx) carries the
                // route) gives that stand cell a ceiling, and the
                // headroom-aware vertical BFS (computeReachable's
                // requireOpenHead) refuses every jump from a capped cell —
                // the chain link would be validated out of existence. Only
                // decorative run can be punched: a ledge's own landing
                // support (row, c) is never a cell-above-route (the route
                // column always moved), so the chain stays intact.
                if (this.pathCells.has((row + 1) * w + cx)) continue;
                tiles[row][cx] = 1;
            }
            // Jump-off and landing cells carry the route: protect them from
            // spikes AND enemy markers (a patrol sweeping a route cell
            // makes the only validated climb periodically lethal, S10).
            this.pathCells.add(row * w + x);
            this.pathCells.add((row - 1) * w + c);
            x = c;
        }
    }

    generatePlatforms(tiles) {
        const isPhase2 = DIFFICULTY.hasPhase2Content(this.levelNumber);
        // Continuous per-level ramp: gaps widen at level 3+ and become more
        // frequent every level within what the reachability model validates
        // (rises stay <= 1 tile via the terrace walk; gaps stay <= 3 columns,
        // inside the ~142px crossing range at speed 200).
        const maxGap = this.levelNumber >= 3 ? 3 : 2;
        const gapChance = isPhase2
            ? 0.22 + 0.02 * (this.levelNumber - 4) // .24 at lvl 5 .. .32 at 9
            : 0.18 + 0.04 * this.levelNumber;      // early-game ramp
        // Terrain reads as designed plateaus, not per-column sawtooth noise:
        // each elevation holds for a segment, then steps at a junction.
        let segRemaining = 0;

        let currentY = this.height - 3; // Top solid row of the ground column
        let gapStreak = 0;

        for (let x = 0; x < this.width; x++) {
            const isSpawnZone = x < 6;
            const isEndZone = x >= this.width - 5;

            if (!isSpawnZone && !isEndZone && gapStreak < maxGap &&
                segRemaining === 0 && this.rng() < gapChance) {
                gapStreak++;
                continue; // Air column (pit) at a segment edge; max maxGap in a row
            }
            const resumedAfterWideGap = gapStreak >= 2;
            gapStreak = 0;

            if (isSpawnZone) {
                currentY = this.height - 3;
                segRemaining = 0;
            } else if (segRemaining > 0) {
                segRemaining--; // Hold this plateau's elevation
            } else {
                // Junction: terrace one step up or down, then hold for the
                // plateau's length. A reflecting +/-1 walk (slightly biased
                // down so ceilings don't stick) keeps adjacent heights within
                // the verified one-tile climb while producing terraced mesa
                // profiles instead of floor-hugging noise. After a pit two
                // or more columns wide the landing must sit at same-or-lower
                // height: rise-jumps reach only dist <= 2 in the movement
                // model, so a column rising over a wide gap is an uncrossable
                // wall.
                const atTop = currentY <= 3;
                const atFloor = currentY >= this.height - 3;
                let step;
                if (resumedAfterWideGap) step = 1;
                else if (atTop) step = 1;
                else if (atFloor) step = -1;
                else step = this.rng() < 0.55 ? 1 : -1;
                currentY = Math.min(this.height - 3, Math.max(3, currentY + step));
                segRemaining = 1 + Math.floor(this.rng() * 4);
            }

            for (let y = currentY; y < this.height; y++) {
                tiles[y][x] = 1; // Solid platform
            }
        }

        return tiles;
    }

    // Generation-space exclusion for spikes and enemy markers. Canonical
    // right-facing space keeps the spawn zone (x < 6) and portal band
    // (x >= width - 4) clear with a one-column buffer; 'left' generates in
    // that same space and mirrors afterwards, which maps its allowed band
    // x ∈ [6, w-6] exactly onto x ∈ [5, w-7] — disjoint from the mirrored
    // portal band x ∈ [2, 4] (the old w-5 bound overlapped it at column 4).
    // Vertical space keeps the bottom spawn neighborhood
    // (y >= height - VERTICAL_SPAWN_EXCL_ROWS) and the top portal band
    // (y <= VERTICAL_PORTAL_MAX_Y) clear.
    hazardPlacementAllowed(coord) {
        if (this.direction === 'vertical') {
            return coord > VERTICAL_PORTAL_MAX_Y &&
                coord < this.height - VERTICAL_SPAWN_EXCL_ROWS;
        }
        // Nine columns of opening runway: hazards/patrols inside the first
        // screenful of the level kill players before they have any context
        // (playtest ruling: ambushes at spawn read as cheating, not hard).
        return coord >= HAZARD_SPAWN_EXCLUDE_COLS &&
            coord <= this.width - 6;
    }

    // Tile bounds of the band a patrol may sweep, per direction: mirrors
    // hazardPlacementAllowed's canonical band. Patrols are clamped here so
    // they can never sweep the spawn tile or the portal band (I3): support-
    // row runs alone leak past both because the forced-flat spawn ground
    // connects to terrain beyond column 5.
    patrolBandBounds() {
        if (this.direction === 'left') {
            return [5, this.width - 1 - HAZARD_SPAWN_EXCLUDE_COLS];
        }
        if (this.direction === 'vertical') {
            return [0, this.width - 1];
        }
        return [HAZARD_SPAWN_EXCLUDE_COLS, this.width - 6];
    }

    // Free patrol span around a marker candidate (x, y): contiguous columns
    // whose walk row is actually walkable — solid support beneath AND the
    // body row itself free of rock and spikes. A support-only scan sweeps
    // into neighbouring terrain because heightmaps rise up to one tile per
    // column (a step-up's mass occupies this row), and type-2 spikes sit on
    // the walk row and are lethal, not terrain (I4). Other markers (type 4)
    // sit on ordinary standable air and do not break a run. On vertical
    // levels the recorded route cells also end a run: an enemy sweeping a
    // jump-off/landing cell makes the only validated climb periodically
    // lethal with no stomp mechanic (S10). Returns null when the marker
    // tile itself is unsupported or on the route.
    patrolSpan(tiles, x, y) {
        const solidAt = (cx, cy) =>
            cx >= 0 && cx < this.width && cy >= 0 && cy < this.height &&
            tiles[cy][cx] === 1;
        const blockedByRoute = (cx, cy) =>
            this.pathCells !== null &&
            this.pathCells.has(cy * this.width + cx);
        const walkable = (cx, cy) =>
            cx >= 0 && cx < this.width && cy >= 0 && cy < this.height &&
            tiles[cy][cx] !== 1 && tiles[cy][cx] !== 2 &&
            !blockedByRoute(cx, cy);
        if (!solidAt(x, y + 1) || blockedByRoute(x, y)) return null;
        let left = x;
        while (solidAt(left - 1, y + 1) && walkable(left - 1, y)) left--;
        let right = x;
        while (solidAt(right + 1, y + 1) && walkable(right + 1, y)) right++;
        return { left, right };
    }

    // One geometry pass over the grid's type-4 markers producing every
    // valid enemy deployment: standable marker tile, reachable from the
    // player spawn, free patrol span (patrolSpan), clamped to the
    // direction's band (patrolBandBounds). Shared by spawnEnemies and the
    // coin exclusion so patrol bounds and coin placement can never diverge.
    // Markers outside the band are skipped: the generator never emits them,
    // and an enemy whose spawn column sits beyond its own clamped bounds
    // would teleport on its first tick.
    deriveEnemySpawns() {
        const spawns = [];
        const [bandMin, bandMax] = this.patrolBandBounds();
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.tiles[y][x] !== 4) continue;
                if (x < bandMin || x > bandMax) continue;
                if (!this.reachableTiles.has(y * this.width + x)) continue;
                const span = this.patrolSpan(this.tiles, x, y);
                if (!span) continue;
                spawns.push({
                    x,
                    y,
                    left: Math.max(span.left, bandMin),
                    right: Math.min(span.right, bandMax)
                });
            }
        }
        return spawns;
    }

    placeSpikes(tiles) {
        // Phase 2 elements appear only from the tier boundary up: the
        // early-game ramp and existing E2E flows stay untouched below it.
        if (!DIFFICULTY.hasPhase2Content(this.levelNumber)) return;

        // Mild count scaling with level number, hard-capped far below the
        // spec's 10%-of-all-tiles density limit.
        const target = Math.min(
            2 + Math.floor((this.levelNumber - PHASE2_FIRST_LEVEL) / 2),
            Math.floor(this.width * this.height * 0.1)
        );

        // Surface hazards only: air tiles directly above solid ground, never
        // inside the direction's exclusion zones, never within two columns
        // of a constructed climb's jump-off/landing cells, and never beside
        // a drop-off or raised lip: players WALK off ledges, and a tooth at
        // feet level under a lip kills anyone who steps instead of jumps
        // (playtest ruling — deaths must be explainable and avoidable by
        // ordinary movement).
        // Local geometry (works for every direction, including vertical
        // maps whose floating ledges make any global surface array lie):
        // the spike's own support is row y+1, so inspect neighbours against
        // THAT surface, not the column's first solid from the sky.
        const besideDropOff = (x, y) => {
            for (let dx = -3; dx <= 3; dx++) {
                if (dx === 0) continue;
                const nx = x + dx;
                if (nx < 0 || nx >= this.width) continue;
                // A pit/bottomless drop within rollout distance of the tooth.
                let ground = false;
                for (let r = y + 1; r <= y + 4 && r < this.height; r++) {
                    if (tiles[r][nx] === 1) { ground = true; break; }
                }
                if (!ground) return true;
                // Raised mass beside the spike: players WALK off its lip and
                // the tooth sits at feet level exactly where they land
                // (playtest ruling — deaths must be avoidable by ordinary
                // movement, and stepping off a ledge is ordinary).
                if (tiles[y][nx] === 1 || tiles[y - 1][nx] === 1) return true;
            }
            return false;
        };
        const nearRouteCell = (x, y) => {
            if (!this.pathCells) return false;
            // Route cells are the forced landing/jump-off spots of the
            // constructed climb. A tooth ON THE SAME WALKING SURFACE within
            // two columns turns a mandatory jump into a pixel-perfect one
            // (screenshot ruling: "everytime I try to jump up onto the
            // ledge near the spikes, I end up hitting the spikes"). Other
            // rows are different platforms; banning them starves vertical
            // maps, where the snaking route touches nearly every row.
            for (let dx = -2; dx <= 2; dx++) {
                const nx = x + dx;
                if (nx >= 0 && nx < this.width &&
                    this.pathCells.has(y * this.width + nx)) return true;
            }
            return false;
        };
        const candidates = [];
        for (let y = 0; y < this.height - 1; y++) {
            for (let x = 0; x < this.width; x++) {
                if (tiles[y][x] !== 0 || tiles[y + 1][x] !== 1) continue;
                if (!this.hazardPlacementAllowed(
                    this.direction === 'vertical' ? y : x)) {
                    continue;
                }
                if (nearRouteCell(x, y)) continue;
                if (this.direction === 'vertical') {
                    // Vertical ledges are ALL edge, so the horizontal
                    // rollout rule would veto every cell. Instead: teeth
                    // sit mid-shelf only — solid support one column each
                    // way — so a spike never caps a ledge tip over a drop.
                    if (x < 1 || x > this.width - 2 ||
                        tiles[y + 1][x - 1] !== 1 ||
                        tiles[y + 1][x + 1] !== 1) continue;
                } else if (besideDropOff(x, y)) continue;
                candidates.push({ x, y });
            }
        }
        shuffle(candidates, this.rng);

        // Keep-if-harmless gate: a spike is kept only when the grid still has
        // a reachable portal-band tile after placing it. A surface spike makes
        // its entire column unlandable (the movement model breaks downward
        // landing scans on hazards — falling onto a spike kills), so a spike
        // on a pit rim or capping a riser can silently wall the corridor off.
        // Blind placement plus whole-map retries starved the advanced-tier
        // sizes (~98% of attempts unreachable at level 15, throwing after
        // MAX_GENERATION_ATTEMPTS); testing each placement against the same
        // validation the constructor applies rejects severing spikes at the
        // source instead. Bounded by the candidate list, like everything else
        // here. Evaluated in canonical right-facing space: 'left' mirrors
        // afterwards and the movement model is symmetric in x, so a mirrored
        // route mirrors its validation exactly.
        const headroom = this.direction === 'vertical';
        const spawn = this.canonicalSpawnTile();
        // Keep-if-harmless gate, two survival requirements (I2):
        // 1. Portal reachability: a surface spike makes its entire column
        //    unlandable (the movement model breaks downward landing scans on
        //    hazards — falling onto a spike kills), so a spike on a pit rim
        //    or capping a riser can silently wall the corridor off. Blind
        //    placement plus whole-map retries starved the advanced-tier sizes
        //    (~98% of attempts unreachable at level 15, throwing after
        //    MAX_GENERATION_ATTEMPTS); testing each placement against the
        //    same validation the constructor applies rejects severing spikes
        //    at the source instead.
        // 2. Marker-site survival: a spike that strips the last deployable
        //    enemy site forces whole-map rejection by the constructor's
        //    deployed-spawn guard — on vertical level 13 that coupling burned
        //    ~6% of construction budgets. Requiring one surviving site per
        //    accepted placement measured 0/400 exhaustion (was 22-48/400).
        // Bounded by the candidate list, like everything else here. Evaluated
        // in canonical right-facing space: 'left' mirrors afterwards and the
        // movement model is symmetric in x, so a mirrored route mirrors its
        // validation exactly.
        const placementSafe = () => {
            const reachable = computeReachable(
                tiles, this.width, this.height, spawn, headroom);
            let portalBand = false;
            for (const key of reachable) {
                const x = key % this.width;
                const y = Math.floor(key / this.width);
                // Shared with pickPortalTile through the canonical-band
                // predicate: one spelling of the band numbers, so a future
                // change cannot void this safety net while it reports
                // success. Canonical (pre-mirror) space is required here —
                // 'left' mirrors only after generateLevel returns.
                if (this.inCanonicalPortalBand(x, y)) {
                    portalBand = true;
                    break;
                }
            }
            if (!portalBand) return false;
            for (const key of reachable) {
                if (this.isMarkerSite(
                    tiles, key % this.width,
                    Math.floor(key / this.width), reachable)) {
                    return true;
                }
            }
            return false;
        };

        let placed = 0;
        const usedColumns = new Set();
        // Threat isolation: a jump travels ~142px (4+ tiles) with no air
        // control, so hazards closer together than a full arc force chained
        // frame-perfect takeoffs (playtest bot + human reports agreed this
        // reads as unfair, not hard). Each spike claims THREAT_SPACING
        // columns on both sides against every other spike.
        const THREAT_SPACING = 4;
        for (const c of candidates) {
            if (placed >= target) break;
            // shortcut: on heavily fragmented advanced-tier maps fewer safe
            // sites exist than the target count, so realized spike density
            // runs below target there; presence is guaranteed by the
            // constructor's zero-spike rejection instead.
            let blocked = false;
            for (let dx = -THREAT_SPACING; dx <= THREAT_SPACING && !blocked; dx++) {
                if (usedColumns.has(c.x + dx)) blocked = true;
            }
            if (blocked) continue;
            tiles[c.y][c.x] = 2;
            if (placementSafe()) {
                for (let dx = -THREAT_SPACING; dx <= THREAT_SPACING; dx++) {
                    usedColumns.add(c.x + dx);
                }
                placed++;
            } else {
                tiles[c.y][c.x] = 0;
            }
        }
    }

    // Single-cell enemy marker site predicate, shared by placeEnemyMarkers'
    // candidate scan and placeSpikes' keep-if-harmless gate (I2): allowed
    // coordinate band (rows on vertical), air on solid ground, off the
    // constructed route, reachable in the given set, and a patrol span of at
    // least two columns after clamping to the direction's band — one column
    // would spawn a body that fits its bounds exactly and never moves. One
    // spelling so the gate cannot drift from placement while both report
    // success (same reasoning as deriveEnemySpawns sharing spawnEnemies).
    isMarkerSite(tiles, x, y, reachable, opts = {}) {
        if (!this.hazardPlacementAllowed(
            this.direction === 'vertical' ? y : x)) {
            return false;
        }
        if (tiles[y][x] !== 0 || tiles[y + 1][x] !== 1) return false;
        if (this.pathCells && this.pathCells.has(y * this.width + x)) {
            return false;
        }
        if (!reachable.has(y * this.width + x)) return false;
        // Patrols must not share a walking surface with the climb route's
        // landing spots: a body one tile from a forced jump target is a
        // free death on the approach (same ruling as spike clearance).
        // Relaxed only by placeEnemyMarkers' fallback pass, which prefers
        // an adjacent patrol over throwing the whole construction.
        if (this.pathCells && !opts.allowRouteAdjacent) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                if (nx >= 0 && nx < this.width &&
                    this.pathCells.has(y * this.width + nx)) return false;
            }
        }
        // No spike-enemy ambush combos: a patrol standing next to a tooth
        // turns "dodge the enemy" into "land on the spike" (playtest bot:
        // this pairing alone accounted for every level-5 death). Checks the
        // marker row AND the row above it — a spike on the shelf beside the
        // patrol stands one row higher than the marker cell itself. THREAT_
        // SPACING matches placeSpikes' claim window: one jump decision at
        // a time, never a chained frame-perfect sequence.
        for (let dx = -4; dx <= 4; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= this.width) continue;
            if (tiles[y][nx] === 2) return false;
            if (y > 0 && tiles[y - 1][nx] === 2) return false;
        }
        const span = this.patrolSpan(tiles, x, y);
        if (!span) return false;
        const [bandMin, bandMax] = this.patrolBandBounds();
        // Strict sites patrol at least two columns. The fallback pass also
        // accepts a one-column shelf — a stationary enemy, which derive-
        // EnemySpawns deploys happily (it only needs a span) and the player
        // can see, wait out, or stomp. Starving these last sites is what
        // burned whole 200-attempt budgets on tight climb grids.
        const minSpan = opts.allowRouteAdjacent ? 1 : 2;
        return Math.min(span.right, bandMax) -
            Math.max(span.left, bandMin) + 1 >= minSpan;
    }

    placeEnemyMarkers(tiles) {
        // Same Phase 2 gate as spikes: no enemies below the tier boundary.
        if (!DIFFICULTY.hasPhase2Content(this.levelNumber)) return;

        // Tier cap from difficulty.js is the single source of truth. Per spec
        // Difficulty Parameters the cap intentionally allows growth on
        // advanced levels: target rises past the old constant 5 from level 12
        // toward the cap of 8.
        const target = Math.min(
            DIFFICULTY.getMaxEnemies(this.levelNumber),
            Math.floor(this.levelNumber / 2)
        );

        // Markers need a standable air tile whose FREE patrol span beneath
        // is at least 3 columns wide, so every spawned enemy gets a real
        // walkable patrol (patrolSpan: rock and spikes on the walk row end
        // a run; support alone does not make one). The direction's spawn
        // zone and portal band are both excluded (see
        // hazardPlacementAllowed); markers never overwrite spike tiles
        // (those are no longer air), and vertical route cells are off
        // limits: an enemy sweeping a jump-off/landing cell makes the only
        // validated climb periodically lethal with no stomp mechanic (S10).
        // isMarkerSite adds reachability (I2): deriveEnemySpawns drops
        // unreachable markers, so placing on one buys a raw marker count
        // while the guard demands deployed spawns — on vertical maps every
        // marker could land on an off-route ledge and burn the whole
        // 200-attempt budget. Requiring reach here makes placed ≈ deployed.
        const collectSites = (allowRouteAdjacent) => {
            const sites = [];
            for (let y = 0; y < this.height - 1; y++) {
                for (let x = 0; x < this.width; x++) {
                    if (this.isMarkerSite(tiles, x, y,
                        this.generationReachable, { allowRouteAdjacent })) {
                        sites.push({ x, y });
                    }
                }
            }
            return sites;
        };
        let candidates = collectSites(false);

        shuffle(candidates, this.rng);

        let placed = 0;
        for (const c of candidates) {
            if (placed >= target) break;
            tiles[c.y][c.x] = 4;
            placed++;
        }
        if (placed === 0 && this.pathCells) {
            // Fallback pass on climb maps: an enemy adjacent to the route
            // beats a construction throw (the guard demands deployed
            // spawns; strict fairness can starve on tight late-level grids).
            candidates = collectSites(true);
            shuffle(candidates, this.rng);
            for (const c of candidates) {
                if (placed >= Math.min(target, 1)) break;
                tiles[c.y][c.x] = 4;
                placed++;
            }
        }
    }

    // Portal band in canonical right-facing space — the space generateLevel
    // (and therefore placeSpikes' keep-if-harmless validation) operates in,
    // before the 'left' column flip. The single spelling of the band numbers;
    // horizontal bands avoid the extreme edge column (design doc: portal is
    // "not placed at extreme edges"); the vertical band is the top rows
    // (y <= VERTICAL_PORTAL_MAX_Y), reachable only via the ledge chain.
    inCanonicalPortalBand(x, y) {
        return this.direction === 'vertical'
            ? y <= VERTICAL_PORTAL_MAX_Y
            : x >= this.width - 4 && x <= this.width - 2;
    }

    // Band as consumed by pickPortalTile on the final (post-mirror) grid:
    // 'left' mirrors [w-4, w-2] to [2, 4].
    inPortalBand(x, y) {
        switch (this.direction) {
            case 'left':
                return x >= 2 && x <= 4;
            default:
                return this.inCanonicalPortalBand(x, y);
        }
    }

    pickPortalTile() {
        const candidates = [];
        for (const key of this.reachableTiles) {
            const x = key % this.width;
            const y = Math.floor(key / this.width);
            if (x === this.spawnTile.x && y === this.spawnTile.y) {
                continue;
            }
            if (this.inPortalBand(x, y)) {
                candidates.push({ x, y });
            }
        }

        if (candidates.length === 0) {
            return null;
        }
        return candidates[Math.floor(this.rng() * candidates.length)];
    }

    extractPlatforms() {
        const platforms = [];

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.tiles[y][x] === 1) {
                    platforms.push({
                        x: x * this.tileSize,
                        y: y * this.tileSize,
                        width: this.tileSize,
                        height: this.tileSize,
                        type: 'solid'
                    });
                }
            }
        }

        return platforms;
    }

    extractCoins() {
        const target = Math.max(5 + this.levelNumber, 5);
        const coins = [];
        const used = new Set();

        const spawnKey = this.spawnTile.y * this.width + this.spawnTile.x;
        const portalKey = this.portalTile
            ? this.portalTile.y * this.width + this.portalTile.x
            : -1;

        // Only place coins on tiles the player can actually reach — and
        // never under an enemy patrol: the game loop's death check precedes
        // collection, so a coin inside a sweep is bait for a kill (before
        // this exclusion ~18% of coins sat on the enemy's own marker tile).
        const patrolCovered = new Set();
        for (const s of this.deriveEnemySpawns()) {
            for (let cx = s.left; cx <= s.right; cx++) {
                patrolCovered.add(s.y * this.width + cx);
            }
        }
        const spikeNear = (x, y) => {
            for (let dy = -COIN_SPIKE_MARGIN; dy <= COIN_SPIKE_MARGIN; dy++) {
                for (let dx = -COIN_SPIKE_MARGIN; dx <= COIN_SPIKE_MARGIN; dx++) {
                    const cx = x + dx;
                    const cy = y + dy;
                    if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height &&
                        this.tiles[cy][cx] === 2) {
                        return true;
                    }
                }
            }
            return false;
        };
        const candidates = [];
        for (const key of this.reachableTiles) {
            if (key === spawnKey || key === portalKey) continue;
            if (patrolCovered.has(key)) continue;
            const x = key % this.width;
            const y = Math.floor(key / this.width);
            candidates.push({ x, y, safe: !spikeNear(x, y) });
        }

        // Fisher-Yates shuffle: bounded, no unbounded random retry loop.
        shuffle(candidates, this.rng);

        const addCoin = (x, y) => {
            const key = y * this.width + x;
            if (used.has(key)) return false;
            used.add(key);
            coins.push({
                x: x * this.tileSize,
                y: y * this.tileSize,
                width: 16,
                height: 16,
                collected: false
            });
            return true;
        };

        // Safe candidates first; only if they cannot fill the target does
        // the margin relax (a slightly exposed coin beats an uncollectable
        // shortfall against the all-coins gate).
        for (const tile of candidates) {
            if (coins.length >= target) break;
            if (tile.safe) addCoin(tile.x, tile.y);
        }
        for (const tile of candidates) {
            if (coins.length >= Math.min(target, 5)) break;
            addCoin(tile.x, tile.y);
        }

        // No unreachable-tile fallback: it was unreachable-by-construction
        // dead code. Every direction forces a walk-connected band of at
        // least six standable tiles (the x < 6 flat spawn zone on
        // horizontal maps; the full-width standing row above the ground
        // band on vertical maps), and the constructor only accepts a level
        // once pickPortalTile found a reachable tile distinct from spawn.
        // Candidates therefore always number >= 6, past the 5-coin floor —
        // anything the old fallback could add would sit outside
        // reachableTiles, i.e. an uncollectable coin.
        // Spec §Error Handling (Difficulty Scaling): coin placement must not
        // exceed 20% of level tiles. Current tuning can't approach that
        // (target ≤ 20 coins on ≥300-tile grids; observed worst ~3.4%), so
        // this guards future retuning: warn and trim to the cap rather than
        // ship a broken-density level.
        const densityCap = Math.floor(this.width * this.height * 0.2);
        if (coins.length > densityCap) {
            console.warn('Coin density exceeds 20% of level tiles:',
                coins.length, '>', densityCap, '- trimming');
            coins.length = densityCap;
        }
        return coins;
    }

    countTilesOfType(type) {
        let n = 0;
        for (const row of this.tiles) {
            for (const t of row) {
                if (t === type) n++;
            }
        }
        return n;
    }

    extractHazards() {
        // Re-extraction replaces the list so repeated calls stay idempotent.
        this.hazards.clear();

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.tiles[y][x] === 2) {
                    this.hazards.addSpike(x * this.tileSize, y * this.tileSize);
                }
            }
        }
    }

    spawnEnemies() {
        // Re-spawning replaces the list so repeated calls stay idempotent.
        this.enemyManager.clear();

        // Derived fresh from the current grid every call (never cached):
        // bounds come from walkable patrol spans clamped to the direction's
        // band, so no patrol ever sweeps the spawn tile or the portal band,
        // and none walks through rock or spikes.
        for (const s of this.deriveEnemySpawns()) {
            // Same placement convention as the player spawn point: the
            // body rests inside the standable air tile, its bottom edge
            // on the solid tile below.
            this.enemyManager.addEnemy(
                s.x * this.tileSize,
                s.y * this.tileSize,
                s.left * this.tileSize,
                (s.right + 1) * this.tileSize
            );
        }
    }

    getSpawnPoint() {
        return this.spawnPoint;
    }

    getPlatforms() {
        return this.platforms;
    }

    getCoins() {
        return this.collectibles.getCoins();
    }

    getCollectibles() {
        return this.collectibles;
    }

    getHazards() {
        return this.hazards;
    }

    getEnemyManager() {
        return this.enemyManager;
    }

    getPortal() {
        return this.portal;
    }

    hasValidPath() {
        if (!this.portalTile || !this.reachableTiles) {
            return false;
        }
        const key = this.portalTile.y * this.width + this.portalTile.x;
        return this.reachableTiles.has(key);
    }

    // Optional `sprites`: when the Kenney sheets are loaded, terrain tiles
    // and spikes come from Game's culled grid pass (Sprites.drawWorld) and
    // this method only owns entities; without them every element falls back
    // to the legacy flat-shape renderer (tests, missing files).
    draw(ctx, sprites = null) {
        const art = sprites && sprites.ready();

        if (!art) {
            // Draw platforms
            ctx.fillStyle = '#8B4513'; // Brown

            for (const platform of this.platforms) {
                ctx.fillRect(platform.x, platform.y, platform.width, platform.height);

                // Add platform border
                ctx.strokeStyle = '#654321';
                ctx.lineWidth = 2;
                ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
            }
        }

        // Draw coins
        if (art) {
            sprites.drawCoins(ctx, this.coins);
        } else {
            ctx.fillStyle = '#FFD700'; // Gold

            for (const coin of this.coins) {
                if (!coin.collected) {
                    ctx.beginPath();
                    ctx.arc(coin.x + coin.width / 2, coin.y + coin.height / 2, 8, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Draw hazards (spikes). Art path: the tooth tile was painted by
        // drawWorld straight from the grid — nothing left to do here.
        if (!art) {
            ctx.fillStyle = '#ff4444';

            for (const spike of this.hazards.getSpikes()) {
                ctx.beginPath();
                ctx.moveTo(spike.x, spike.y + spike.height);
                ctx.lineTo(spike.x + spike.width / 2, spike.y);
                ctx.lineTo(spike.x + spike.width, spike.y + spike.height);
                ctx.fill();
            }
        }

        // Draw enemies (EnemyManager owns per-enemy drawing).
        this.enemyManager.drawAll(ctx, sprites);

        // Draw portal; ghosted until the all-coins gate is met.
        if (art) {
            sprites.drawPortal(ctx, this.portal, this.collectibles.meetsPortalRequirement());
        } else if (this.portal && this.collectibles.meetsPortalRequirement()) {
            ctx.fillStyle = '#9400D3'; // Purple

            ctx.fillRect(
                this.portal.x,
                this.portal.y,
                this.portal.width,
                this.portal.height
            );

            // Portal border
            ctx.strokeStyle = '#DA70D6';
            ctx.lineWidth = 3;
            ctx.strokeRect(
                this.portal.x,
                this.portal.y,
                this.portal.width,
                this.portal.height
            );
        }
    }
}
