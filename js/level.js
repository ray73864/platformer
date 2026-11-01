import { Collectibles } from './collectibles.js';
import { Difficulty } from './difficulty.js';
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

// Travel direction is deterministic from the level number so tests and E2E
// flows can rely on it: the shipped Phase 1 ramp (levels 1-4) stays
// right-facing, then right/left/vertical cycle from level 5 onward
// (L5 right, L6 left, L7 vertical, L8 right, L9 left).
function directionForLevel(levelNumber) {
    if (levelNumber < 5) return 'right';
    return ['right', 'left', 'vertical'][(levelNumber - 5) % 3];
}

// In-place Fisher-Yates shuffle: bounded, no unbounded random retry loops.
function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
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
    constructor(levelNumber, tileSize) {
        this.levelNumber = levelNumber;
        this.tileSize = tileSize;

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
            if (valid && this.levelNumber >= 5) {
                valid = this.countTilesOfType(4) > 0 &&
                    this.countTilesOfType(2) > 0;
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
        let dir = Math.random() < 0.5 ? 1 : -1;
        for (let row = h - 4; row >= VERTICAL_PORTAL_MAX_Y + 1; row--) {
            let c = x + dir * (Math.random() < 0.4 ? 2 : 1);
            if (c < 1 || c > w - 2) {
                // Bounce off the wall; the flipped step always fits since
                // every standing column stays inside [1, w-2].
                dir = -dir;
                c = x + dir;
            }
            // Decorative forward run (>= 2 tiles): gives the ledge body a
            // contiguous top at least 3 columns wide for enemy patrols.
            const ext = 2 + Math.floor(Math.random() * 4);
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
        const isPhase2 = this.levelNumber >= 5;
        // Difficulty scales past the old cap of 4 into the Phase 2 band;
        // the game tops out at level 9. The early-level ramp is unchanged.
        const difficulty = Math.min(this.levelNumber, 9);
        // Phase 2 widens gaps and drops. Rise stays capped at 1 tile because
        // the verified jump rise (~62px) cannot clear a 2-tile climb; the
        // spec's "max height difference 3" is satisfied through drops.
        const maxGap = isPhase2 ? 3 : 2;
        const maxRise = 1;
        const maxDrop = isPhase2 ? 3 : 2;
        const gapChance = isPhase2
            ? 0.22 + 0.02 * (this.levelNumber - 4) // .24 at lvl 5 .. .32 at 9
            : 0.18 + 0.04 * difficulty;            // shipped early-game ramp

        let currentY = this.height - 3; // Top solid row of the ground column
        let gapStreak = 0;

        for (let x = 0; x < this.width; x++) {
            const isSpawnZone = x < 6;
            const isEndZone = x >= this.width - 5;

            if (!isSpawnZone && !isEndZone && gapStreak < maxGap &&
                Math.random() < gapChance) {
                gapStreak++;
                continue; // Air column (pit); at most maxGap in a row
            }
            const resumedAfterWideGap = gapStreak >= 2;
            gapStreak = 0;

            if (isSpawnZone) {
                currentY = this.height - 3;
            } else {
                // delta > 0 lowers the surface (drop), delta < 0 raises it.
                // Range [-maxRise, +maxDrop] keeps rises within the verified
                // one-tile climb and drops within the band's cap. After a pit
                // two or more columns wide the landing must sit at same-or-
                // lower height: rise-jumps reach only dist <= 2 in the
                // movement model (and ~62px rise against the crossing's hang
                // time), so a column rising over a wide gap is an uncrossable
                // wall, not terrain.
                const minDelta = resumedAfterWideGap ? 0 : -maxRise;
                const delta = Math.floor(
                    Math.random() * (maxDrop - minDelta + 1)) + minDelta;
                currentY = Math.min(
                    this.height - 3,
                    Math.max(3, currentY + delta)
                );
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
        return coord >= 6 && coord <= this.width - 6;
    }

    // Tile bounds of the band a patrol may sweep, per direction: mirrors
    // hazardPlacementAllowed's canonical band. Patrols are clamped here so
    // they can never sweep the spawn tile or the portal band (I3): support-
    // row runs alone leak past both because the forced-flat spawn ground
    // connects to terrain beyond column 5.
    patrolBandBounds() {
        if (this.direction === 'left') {
            return [5, this.width - 7];
        }
        if (this.direction === 'vertical') {
            return [0, this.width - 1];
        }
        return [6, this.width - 6];
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
        // Phase 2 elements appear only at level >= 5: the early-game ramp
        // and existing E2E flows stay untouched below that line.
        if (this.levelNumber < 5) return;

        // Mild count scaling with level number, hard-capped far below the
        // spec's 10%-of-all-tiles density limit.
        const target = Math.min(
            2 + Math.floor((this.levelNumber - 5) / 2),
            Math.floor(this.width * this.height * 0.1)
        );

        // Surface hazards only: air tiles directly above solid ground, never
        // inside the direction's exclusion zones, and never on a vertical
        // route's jump-off/landing cells (a spike there would sever the one
        // constructed climb and burn retries).
        const candidates = [];
        for (let y = 0; y < this.height - 1; y++) {
            for (let x = 0; x < this.width; x++) {
                if (tiles[y][x] !== 0 || tiles[y + 1][x] !== 1) continue;
                if (!this.hazardPlacementAllowed(
                    this.direction === 'vertical' ? y : x)) {
                    continue;
                }
                if (this.pathCells &&
                    this.pathCells.has(y * this.width + x)) {
                    continue;
                }
                candidates.push({ x, y });
            }
        }
        shuffle(candidates);

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
        const spawn = this.direction === 'vertical'
            ? this.getSpawnTile()
            : { x: SPAWN_TILE_X, y: this.height - 4 };
        const portalStillReachable = () => {
            const reachable = computeReachable(
                tiles, this.width, this.height, spawn, headroom);
            for (const key of reachable) {
                const x = key % this.width;
                const y = Math.floor(key / this.width);
                if (this.direction === 'vertical'
                    ? y <= VERTICAL_PORTAL_MAX_Y
                    : x >= this.width - 4 && x <= this.width - 2) {
                    return true;
                }
            }
            return false;
        };

        let placed = 0;
        const usedColumns = new Set();
        for (const c of candidates) {
            if (placed >= target) break;
            // shortcut: on heavily fragmented advanced-tier maps fewer safe
            // sites exist than the target count, so realized spike density
            // runs below target there (~3.5 vs 7 at level 15); presence is
            // guaranteed by the constructor's zero-spike rejection instead.
            // Keep spikes at least two columns apart: each hazard stays a
            // comfortable single hop within verified jump range, so spikes
            // can never combine into an unjumpable barrier. The keep-if-
            // harmless gate below is the backstop either way.
            if (usedColumns.has(c.x - 1) ||
                usedColumns.has(c.x) ||
                usedColumns.has(c.x + 1)) {
                continue;
            }
            tiles[c.y][c.x] = 2;
            if (portalStillReachable()) {
                usedColumns.add(c.x);
                placed++;
            } else {
                tiles[c.y][c.x] = 0;
            }
        }
    }

    placeEnemyMarkers(tiles) {
        // Same Phase 2 gate as spikes: no enemies before level 5.
        if (this.levelNumber < 5) return;

        // Tier cap from difficulty.js is the single source of truth. Per spec
        // Difficulty Parameters the cap intentionally allows growth on
        // advanced levels: target rises past the old constant 5 from level 12
        // toward the cap of 8.
        const target = Math.min(
            DIFFICULTY.getMaxEnemies(this.levelNumber),
            Math.floor(this.levelNumber / 2)
        );

        const solidAt = (x, y) =>
            x >= 0 && x < this.width && y >= 0 && y < this.height &&
            tiles[y][x] === 1;

        // Markers need a standable air tile whose FREE patrol span beneath
        // is at least 3 columns wide, so every spawned enemy gets a real
        // walkable patrol (patrolSpan: rock and spikes on the walk row end
        // a run; support alone does not make one). The direction's spawn
        // zone and portal band are both excluded (see
        // hazardPlacementAllowed); markers never overwrite spike tiles
        // (those are no longer air), and vertical route cells are off
        // limits: an enemy sweeping a jump-off/landing cell makes the only
        // validated climb periodically lethal with no stomp mechanic (S10).
        const candidates = [];
        for (let y = 0; y < this.height - 1; y++) {
            for (let x = 0; x < this.width; x++) {
                if (!this.hazardPlacementAllowed(
                    this.direction === 'vertical' ? y : x)) {
                    continue;
                }
                if (tiles[y][x] !== 0 || !solidAt(x, y + 1)) continue;
                if (this.pathCells &&
                    this.pathCells.has(y * this.width + x)) {
                    continue;
                }
                const span = this.patrolSpan(tiles, x, y);
                // The candidate must offer at least 2 patrollable columns
                // AFTER clamping the free span to the direction's band.
                // Ground runs routinely extend into the forced-flat spawn
                // zone; requiring the raw run to sit fully inside the band
                // would reject nearly every ground marker on Phase-2
                // terrain, while a 1-column clamped window would spawn a
                // body that fits its bounds exactly and never moves. Two
                // columns = every patrol visibly walks. The clamp itself is
                // what keeps patrols out of excluded columns (I3).
                const [bandMin, bandMax] = this.patrolBandBounds();
                const left = Math.max(span ? span.left : 0, bandMin);
                const right = Math.min(span ? span.right : -1, bandMax);
                if (span && right - left + 1 >= 2) {
                    candidates.push({ x, y });
                }
            }
        }
        shuffle(candidates);

        let placed = 0;
        for (const c of candidates) {
            if (placed >= target) break;
            tiles[c.y][c.x] = 4;
            placed++;
        }
    }

    // Portal candidate band per direction. Horizontal bands avoid the
    // extreme edge column (design doc: portal is "not placed at extreme
    // edges"); 'left' mirrors [w-4, w-2] to [2, 4]. The vertical band is
    // the top rows (y <= VERTICAL_PORTAL_MAX_Y), reachable only via the
    // constructed ledge chain.
    inPortalBand(x, y) {
        switch (this.direction) {
            case 'left':
                return x >= 2 && x <= 4;
            case 'vertical':
                return y <= VERTICAL_PORTAL_MAX_Y;
            default:
                return x >= this.width - 4 && x <= this.width - 2;
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
        return candidates[Math.floor(Math.random() * candidates.length)];
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
        const candidates = [];
        for (const key of this.reachableTiles) {
            if (key === spawnKey || key === portalKey) continue;
            if (patrolCovered.has(key)) continue;
            const x = key % this.width;
            const y = Math.floor(key / this.width);
            candidates.push({ x, y });
        }

        // Fisher-Yates shuffle: bounded, no unbounded random retry loop.
        shuffle(candidates);

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

        for (const tile of candidates) {
            if (coins.length >= target) break;
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

    draw(ctx) {
        // Draw platforms
        ctx.fillStyle = '#8B4513'; // Brown

        for (const platform of this.platforms) {
            ctx.fillRect(platform.x, platform.y, platform.width, platform.height);

            // Add platform border
            ctx.strokeStyle = '#654321';
            ctx.lineWidth = 2;
            ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
        }

        // Draw coins
        ctx.fillStyle = '#FFD700'; // Gold

        for (const coin of this.coins) {
            if (!coin.collected) {
                ctx.beginPath();
                ctx.arc(coin.x + coin.width / 2, coin.y + coin.height / 2, 8, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw hazards (spikes) as red triangles filling the tile: sharp
        // silhouette keeps them visually distinct from platforms and coins.
        ctx.fillStyle = '#ff4444';

        for (const spike of this.hazards.getSpikes()) {
            ctx.beginPath();
            ctx.moveTo(spike.x, spike.y + spike.height);
            ctx.lineTo(spike.x + spike.width / 2, spike.y);
            ctx.lineTo(spike.x + spike.width, spike.y + spike.height);
            ctx.fill();
        }

        // Draw enemies (EnemyManager owns per-enemy drawing).
        this.enemyManager.drawAll(ctx);

        // Draw portal; hidden until the 70% coin gate is met.
        ctx.fillStyle = '#9400D3'; // Purple

        if (this.portal && this.collectibles.meetsPortalRequirement()) {
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
