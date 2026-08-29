const MAX_GENERATION_ATTEMPTS = 200;
const SPAWN_TILE_X = 2;

// Movement model for the reachability check, matching the game's physics:
// JUMP_FORCE=350 / GRAVITY=980 gives a max jump rise of ~62px (< 2 tiles at
// tileSize 32), so climbing more than one tile in a single jump is not
// possible. Horizontal reach per grounded jump is up to 2 tiles. From any
// standing tile (air with solid below) the player can:
//   - walk or fall left/right, including crossing gaps up to 2 tiles wide at
//     same-or-lower height;
//   - jump up exactly one tile onto a step, straight across or over a gap of
//     one intermediate column.
// Out-of-bounds: side walls are solid, the sky is open, and falling below the
// grid bottom (a pit with no floor) kills, so it offers no landing.
export function computeReachable(tiles, width, height, startTile) {
    const solid = (x, y) => {
        if (x < 0 || x >= width) return true;
        if (y < 0 || y >= height) return false;
        return tiles[y][x] === 1;
    };
    const standable = (x, y) => !solid(x, y) && solid(x, y + 1);

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
            // Walk or fall along/across columns at current row height. A
            // distance-2 move models a flat jump across a gap up to 2 tiles;
            // the intermediate column must be passable at the current row.
            for (const dist of [1, 2]) {
                const mid = x + dir;
                if (solid(mid, y)) continue; // Blocked at current row

                const c = x + dir * dist;
                for (let ly = y; ly < height; ly++) {
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

        // Level dimensions
        this.width = 20;  // tiles
        this.height = 15; // tiles

        let attempt = 0;
        let valid = false;
        while (attempt < MAX_GENERATION_ATTEMPTS && !valid) {
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
        this.coins = this.extractCoins();
    }

    generateLevel() {
        const tiles = Array(this.height).fill(null).map(() =>
            Array(this.width).fill(0)
        );

        this.generatePlatforms(tiles);

        return tiles;
    }

    generatePlatforms(tiles) {
        const difficulty = Math.min(this.levelNumber, 4);
        const maxGap = 2;
        // Rise between adjacent ground columns is capped at 1 tile so every
        // step stays within the verified jump height; drops are capped at 2.
        const maxRise = 1;
        const maxDrop = 2;

        let currentY = this.height - 3; // Top solid row of the ground column
        let gapStreak = 0;

        for (let x = 0; x < this.width; x++) {
            const isSpawnZone = x < 6;
            const isEndZone = x >= this.width - 5;

            if (!isSpawnZone && !isEndZone && gapStreak < maxGap &&
                Math.random() < 0.18 + 0.04 * difficulty) {
                gapStreak++;
                continue; // Air column (pit); at most maxGap in a row
            }
            gapStreak = 0;

            if (isSpawnZone) {
                currentY = this.height - 3;
            } else {
                const delta = Math.floor(Math.random() * (maxRise + maxDrop + 1)) - maxDrop;
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

    pickPortalTile() {
        const candidates = [];
        for (const key of this.reachableTiles) {
            const x = key % this.width;
            const y = Math.floor(key / this.width);
            if (x >= this.width - 4 && !(x === this.spawnTile.x && y === this.spawnTile.y)) {
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
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }

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

    getSpawnPoint() {
        return this.spawnPoint;
    }

    getPlatforms() {
        return this.platforms;
    }

    getCoins() {
        return this.coins;
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
