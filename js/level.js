import { Collectibles } from './collectibles.js';
import { EnemyManager } from './enemies.js';
import { Hazards } from './hazards.js';

const MAX_GENERATION_ATTEMPTS = 200;
const SPAWN_TILE_X = 2;
// Horizontal jump scan bound in tiles: hang time 2*350/980 ≈ 0.71s at speed
// 200 px/s covers ~143px, i.e. ~4 tiles of 32px. Conservative integer bound.
const MAX_H_JUMP = 4;

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
// spike column kills rather than passing through). They do not block aerial
// pass-through: a grounded jump rises ~62px and clears a 32px surface spike,
// so a validated route may arc over short spike strips but never rests on or
// inside one. (Modelling spikes as full walls instead would make generation
// unsatisfiable: every level-5+ map places surface spikes, and any single
// spike would sever the heightmap's only corridor, exhausting the retry
// budget.) Consequence: reachability of coins, portal, and enemy spawns
// never routes THROUGH death. Grids without type-2 tiles behave bit-
// identically to the pre-hazard model (hazard() is constant false there).
export function computeReachable(tiles, width, height, startTile) {
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
    const standable = (x, y) => freeCell(x, y) && solid(x, y + 1);

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
                for (let m = 1; m < dist; m++) {
                    if (solid(x + dir * m, y)) {
                        blocked = true;
                        break;
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
                    // wall: its top has to sit within jump rise (~62px).
                    const midX = x + dir;
                    if (solid(midX, ty) && solid(midX, y)) {
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

export function canReach(tiles, width, height, startTile, goalTile) {
    const reachable = computeReachable(tiles, width, height, startTile);
    return reachable.has(goalTile.y * width + goalTile.x);
}

export class Level {
    constructor(levelNumber, tileSize) {
        this.levelNumber = levelNumber;
        this.tileSize = tileSize;

        // Phase 2: larger maps from level 5 onward; early levels keep the
        // shipped 20x15 footprint.
        this.width = levelNumber >= 5 ? 24 : 20;  // tiles
        this.height = levelNumber >= 5 ? 18 : 15; // tiles

        let attempt = 0;
        let valid = false;
        while (attempt < MAX_GENERATION_ATTEMPTS && !valid) {
            // Terrain, spike tiles (type 2), and enemy markers (type 4) are
            // all laid down before computeReachable runs, so the validation
            // BFS sees the final geometry. If spikes wall off the map, no
            // portal candidate survives and the retry regenerates.
            this.tiles = this.generateLevel();
            this.spawnTile = { x: SPAWN_TILE_X, y: this.height - 4 };
            this.reachableTiles = computeReachable(
                this.tiles,
                this.width,
                this.height,
                this.spawnTile
            );
            this.portalTile = this.pickPortalTile();
            valid = this.portalTile !== null;
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

        // Pixel-space spawn point sits on the forced flat ground near x=2.
        this.spawnPoint = { x: tileSize * 2, y: tileSize * (this.height - 4) };
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

    generateLevel() {
        const tiles = Array(this.height).fill(null).map(() =>
            Array(this.width).fill(0)
        );

        this.generatePlatforms(tiles);
        // Order matters: hazards and enemy markers exist in the grid before
        // the constructor's computeReachable pass validates the level.
        this.placeSpikes(tiles);
        this.placeEnemyMarkers(tiles);

        return tiles;
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
            gapStreak = 0;

            if (isSpawnZone) {
                currentY = this.height - 3;
            } else {
                // delta > 0 lowers the surface (drop), delta < 0 raises it.
                // Range [-maxRise, +maxDrop] keeps rises within the verified
                // one-tile climb and drops within the band's cap.
                const delta = Math.floor(Math.random() * (maxRise + maxDrop + 1)) - maxRise;
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
        // inside the spawn zone (x < 6) or the portal band (x >= width - 4).
        const candidates = [];
        for (let x = 6; x <= this.width - 5; x++) {
            for (let y = 0; y < this.height - 1; y++) {
                if (tiles[y][x] === 0 && tiles[y + 1][x] === 1) {
                    candidates.push({ x, y });
                }
            }
        }
        shuffle(candidates);

        let placed = 0;
        const usedColumns = new Set();
        for (const c of candidates) {
            if (placed >= target) break;
            // Keep spikes at least two columns apart: each hazard stays a
            // comfortable single hop within verified jump range, so spikes
            // can never combine into an unjumpable barrier. The BFS portal
            // validation remains the backstop safety net either way.
            if (usedColumns.has(c.x - 1) ||
                usedColumns.has(c.x) ||
                usedColumns.has(c.x + 1)) {
                continue;
            }
            tiles[c.y][c.x] = 2;
            usedColumns.add(c.x);
            placed++;
        }
    }

    placeEnemyMarkers(tiles) {
        // Same Phase 2 gate as spikes: no enemies before level 5.
        if (this.levelNumber < 5) return;

        const target = Math.min(5, Math.floor(this.levelNumber / 2));

        const solidAt = (x, y) =>
            x >= 0 && x < this.width && y >= 0 && y < this.height &&
            tiles[y][x] === 1;

        // Markers need a standable air tile whose contiguous solid run
        // beneath is at least 3 columns wide, so every spawned enemy gets a
        // real patrol. Spawn zone excluded like spikes; markers never
        // overwrite spike tiles (those are no longer air).
        const candidates = [];
        for (let y = 0; y < this.height - 1; y++) {
            for (let x = 6; x < this.width; x++) {
                if (tiles[y][x] !== 0 || !solidAt(x, y + 1)) continue;
                let left = x;
                while (solidAt(left - 1, y + 1)) left--;
                let right = x;
                while (solidAt(right + 1, y + 1)) right++;
                if (right - left + 1 >= 3) candidates.push({ x, y });
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

    pickPortalTile() {
        const candidates = [];
        for (const key of this.reachableTiles) {
            const x = key % this.width;
            const y = Math.floor(key / this.width);
            // Right-hand band, but never the extreme edge column (design doc:
            // portal is "not placed at extreme edges").
            if (x >= this.width - 4 && x <= this.width - 2 &&
                !(x === this.spawnTile.x && y === this.spawnTile.y)) {
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

        // Only place coins on tiles the player can actually reach.
        const candidates = [];
        for (const key of this.reachableTiles) {
            if (key === spawnKey || key === portalKey) continue;
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

        // Fallback so every level has at least 5 coins even in the unlikely
        // case fewer reachable tiles exist than the minimum.
        for (let y = 0; coins.length < 5 && y < this.height; y++) {
            for (let x = 0; coins.length < 5 && x < this.width; x++) {
                if (this.tiles[y][x] === 0) {
                    addCoin(x, y);
                }
            }
        }

        return coins;
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

        // Solidity convention matches computeReachable: only type 1 is solid.
        const solidAt = (x, y) =>
            x >= 0 && x < this.width && y >= 0 && y < this.height &&
            this.tiles[y][x] === 1;

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.tiles[y][x] !== 4) continue;

                // Spawn validation: the tile must be standable (air with a
                // solid tile below) AND reachable from the player spawn;
                // anything else is skipped entirely.
                if (!solidAt(x, y + 1)) continue;
                if (!this.reachableTiles.has(y * this.width + x)) continue;

                // Patrol bounds from real geometry: the contiguous run of
                // solid columns under the walk row, extending outward from
                // the spawn column, clamped within the level.
                let left = x;
                while (solidAt(left - 1, y + 1)) left--;
                let right = x;
                while (solidAt(right + 1, y + 1)) right++;
                const minX = Math.max(0, left * this.tileSize);
                const maxX = Math.min(
                    (right + 1) * this.tileSize,
                    this.width * this.tileSize
                );

                // Same placement convention as the player spawn point: the
                // body rests inside the standable air tile, its bottom edge
                // on the solid tile below.
                this.enemyManager.addEnemy(
                    x * this.tileSize,
                    y * this.tileSize,
                    minX,
                    maxX
                );
            }
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

        // Draw portal
        ctx.fillStyle = '#9400D3'; // Purple

        if (this.portal) {
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
