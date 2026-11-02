// Sprite rendering layer over the Kenney "Pixel Platformer" sheets (CC0 —
// see assets/kenney_pixel-platformer/LICENSE.txt). Every draw path degrades
// to the legacy flat-rectangle renderer when the sheets are not loaded
// (unit tests under happy-dom never load them; a missing file must never
// brick the game), so all draw entry points take `sprites` as an optional
// argument and callers gate on sprites.ready().
//
// Sheets (packed variants: no gaps between cells):
//   tiles.png        20 cols × 9 rows of 18px cells
//   characters.png    9 cols × 3 rows of 24px cells
//   backgrounds.png   three 64×72 theme columns: sky band (y 0-31),
//                     decoration strip (y 32-47), ground strip (y 48-71)

export const SHEETS = {
    tiles: { src: './assets/kenney_pixel-platformer/tiles.png', cols: 20, cell: 18 },
    characters: { src: './assets/kenney_pixel-platformer/characters.png', cols: 9, cell: 24 },
    // Backgrounds are drawn from THEMES column rects, not a uniform grid.
    backgrounds: { src: './assets/kenney_pixel-platformer/backgrounds.png' }
};

// Tile indices into tiles.png (row-major, col + row * cols). Verified by
// cropping each cell from the shipped sheet — do not change without
// re-checking the art.
export const TILES = {
    GRASS_TOP: 2,   // full-width green cap with dirt body (1/21 are padded edge variants)
    DIRT: 104,      // plain speckled dirt fill (interior); verified seamless
    SPIKE: 68,      // pair of metal spike teeth
    COIN: 151,      // gold ring coin
    FLAG_A: 111,    // goal flag, pennant variant A
    FLAG_B: 112     // goal flag, pennant wave variant B
};

// Green band of the grass-cap tile (tile 2): source rows 2..8 of its 18px
// cell — measured from the shipped sheet; rows 0-1 and 16-17 are baked dark
// borders that must not be drawn when tiles stack.
const GRASS_BAND_Y = 2;
const GRASS_BAND_H = 7;
const GRASS_BAND_SRC = 18;

// One tile cell: matches main.js TILE_SIZE (kept local so the sprite layer
// stays dependency-free). Used to stand the portal flag on the ground line.
const PORTAL_CELL = 32;

// Frames into characters.png. Player: tan astronaut idle/run. Enemies:
// spiked-shelled slime and bat, both 3-frame walk/flap cycles.
export const CHARS = {
    PLAYER_IDLE: 9,
    PLAYER_RUN: 10,
    SLIME: [15, 16, 17],
    BAT: [24, 25, 26]
};

// Background themes cycled by level number ((level - 1) % THEMES.length).
// The sheet's three theme columns are NOT equal thirds (measured from the
// shipped PNG): day spans x 0-95 (two cloud variants), dusk x 96-143,
// jungle x 144-191. `sky` is the solid band colour, `ground` the
// silhouette base tone used to fill below the world bottom on short
// levels so terrain never floats on open sky.
export const THEMES = [
    { x: 0, w: 96, sky: '#dff6f5', ground: '#c2e3e8' },
    { x: 96, w: 48, sky: '#fbc97b', ground: '#cb815e' },
    { x: 144, w: 48, sky: '#7ff0a5', ground: '#2eb082' }
];

// Source rect for a tile index in a packed sheet. Pure; unit-tested against
// the shipped sheet dimensions so a wrong constant fails loudly.
export function sheetRect(sheetKey, index) {
    const { cols, cell } = SHEETS[sheetKey];
    if (!Number.isInteger(index) || index < 0) {
        throw new Error(`sprite index must be a non-negative integer: ${index}`);
    }
    return {
        sx: (index % cols) * cell,
        sy: Math.floor(index / cols) * cell,
        sw: cell,
        sh: cell
    };
}

// Sheet bounds per key, used by tests to assert every referenced index
// actually exists inside its sheet.
export const SHEET_TILE_COUNTS = { tiles: 20 * 9, characters: 9 * 3 };

export class Sprites {
    constructor() {
        this.images = {};
        this.loaded = false;
        this.clock = 0;
        // Facing cache for flip decisions while vx decays through 0: WeakMap
        // so torn-down entities collect with their owners.
        this._facing = new WeakMap();

        // Non-DOM environments (bun test, happy-dom without real image IO)
        // simply never become ready: the game renders with fallback shapes.
        if (typeof Image === 'undefined') return;
        let pending = Object.keys(SHEETS).length;
        for (const [key, spec] of Object.entries(SHEETS)) {
            const img = new Image();
            img.onload = () => {
                this.images[key] = img;
                if (--pending === 0) this.loaded = true;
            };
            img.onerror = () => { /* stay not ready: fallback renderer */ };
            img.src = spec.src;
        }
    }

    ready() {
        return this.loaded;
    }

    advance(dt) {
        this.clock += dt;
    }

    _drawSheet(ctx, sheetKey, index, dx, dy, dw, dh) {
        const img = this.images[sheetKey];
        const { sx, sy, sw, sh } = sheetRect(sheetKey, index);
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    // Parallax sky: solid band plus two tiled strips (decoration drifts
    // slower than ground — classic depth cue). Camera-x only; vertical
    // camera travel does not move the bands. worldBottomScreen is the on-
    // screen y of the level's bottom edge: when it sits above the viewport
    // floor (short levels, tall windows) the ground silhouette anchors
    // there and deep-ground fill covers the remainder, so terrain rests on
    // earth instead of floating on sky.
    drawBackground(ctx, levelNumber, cameraX, viewW, viewH, worldBottomScreen = Infinity) {
        const theme = THEMES[(Math.max(1, levelNumber) - 1) % THEMES.length];
        ctx.fillStyle = theme.sky;
        ctx.fillRect(0, 0, viewW, viewH);
        if (!this.images.backgrounds) return;
        const img = this.images.backgrounds;
        // Decoration strip (clouds/ridges/trees): ×2 scale, factor 0.25.
        const decoH = 16 * 2;
        const decoY = viewH * 0.42 - decoH;
        this._tileStrip(ctx, img, theme.x, 32, theme.w, 16, decoH, cameraX * 0.25, decoY, viewW);
        // Ground silhouette: ×2 scale, factor 0.5, anchored to the world
        // bottom when that is on screen, else to the viewport floor.
        const groundH = 24 * 2;
        const bandY = Math.min(viewH - groundH, worldBottomScreen);
        this._tileStrip(ctx, img, theme.x, 48, theme.w, 24, groundH, cameraX * 0.5, bandY, viewW);
        if (bandY + groundH < viewH) {
            ctx.fillStyle = theme.ground;
            ctx.fillRect(0, bandY + groundH, viewW, viewH - bandY - groundH);
        }
    }

    _tileStrip(ctx, img, sx, sy, srcW, srcH, chunkH, scrollX, y, viewW) {
        const chunkW = srcW * 2;
        const offset = -(((scrollX % chunkW) + chunkW) % chunkW);
        for (let x = offset; x < viewW; x += chunkW) {
            ctx.drawImage(img, sx, sy, srcW, srcH, x, y, chunkW, chunkH);
        }
    }

    // Terrain from the tile grid with viewport culling: exposed solids get
    // the grass cap, buried ones the plain dirt body. Spikes draw as the
    // tooth tile filling their cell.
    drawWorld(ctx, level, cameraX, cameraY, viewW, viewH) {
        const size = level.tileSize;
        // +1px destination overlap: 18px source scaled to a fractional CSS
        // pixel size would otherwise leave hairline gaps between columns
        // (the nearest-neighbour rounding floors each rect independently).
        const drawn = size + 1;
        const c0 = Math.max(0, Math.floor(cameraX / size));
        const c1 = Math.min(level.width - 1, Math.ceil((cameraX + viewW) / size));
        const r0 = Math.max(0, Math.floor(-cameraY / size));
        const r1 = Math.min(level.height - 1, Math.ceil((-cameraY + viewH) / size));
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                const t = level.tiles[ty][tx];
                if (t === 1) {
                    const above = ty > 0 ? level.tiles[ty - 1][tx] : 0;
                    this._drawSheet(ctx, 'tiles', TILES.DIRT,
                        tx * size, ty * size, drawn, drawn);
                    if (above !== 1) {
                        // Exposed surface: overlay only the green band of
                        // the cap tile (source rows 2..8). The full cap cell
                        // carries baked dark top/bottom borders which read
                        // as black seams when tiles stack.
                        const cap = sheetRect('tiles', TILES.GRASS_TOP);
                        ctx.drawImage(this.images.tiles,
                            cap.sx, cap.sy + GRASS_BAND_Y, cap.sw, GRASS_BAND_H,
                            tx * size, ty * size, drawn, size * GRASS_BAND_H / GRASS_BAND_SRC);
                    }
                } else if (t === 2) {
                    this._drawSheet(ctx, 'tiles', TILES.SPIKE,
                        tx * size, ty * size, drawn, drawn);
                }
            }
        }
    }

    drawCoins(ctx, coins) {
        const bobPhase = this.clock * 3;
        for (const coin of coins) {
            if (coin.collected) continue;
            // Phase from x AND y so nearby coins never sync into a wall of
            // identical ellipses; floor the spin squash at 0.35 so a coin
            // is always visibly present even edge-on.
            const phase = coin.x * 0.11 + coin.y * 0.07;
            const cx = coin.x + coin.width / 2;
            const cy = coin.y + coin.height / 2 + Math.sin(bobPhase + phase) * 3;
            const spin = Math.max(0.35, Math.abs(Math.cos(this.clock * 4 + phase)));
            const s = 26;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(spin, 1);
            this._drawSheet(ctx, 'tiles', TILES.COIN, -s / 2, -s / 2, s, s);
            ctx.restore();
        }
    }

    drawPortal(ctx, portal, unlocked) {
        if (!portal) return;
        const frame = (this.clock % 0.8) < 0.4 ? TILES.FLAG_A : TILES.FLAG_B;
        // Anchor the flag's base on the ground line (the portal cell's
        // bottom, one TILE_SIZE below the cell top): the trigger rect is
        // deliberately taller than a tile, and filling it made the pennant
        // sink into the terrain. Draw upward from the feet instead.
        const w = 36;
        const h = 52;
        const feetY = portal.y + PORTAL_CELL;
        ctx.save();
        if (!unlocked) ctx.globalAlpha = 0.35;
        this._drawSheet(ctx, 'tiles', frame,
            portal.x + portal.width / 2 - w / 2, feetY - h, w, h);
        ctx.restore();
    }

    // Cached facing so a decaying vx does not strobe the sprite mid-stop.
    _faceOf(entity) {
        if (entity.vx > 1) { this._facing.set(entity, 1); return 1; }
        if (entity.vx < -1) { this._facing.set(entity, -1); return -1; }
        return this._facing.get(entity) ?? 1;
    }

    drawPlayer(ctx, player, squash = 1) {
        const moving = Math.abs(player.vx) > 5;
        // Two-frame sheet (idle + stride): alternating them at ~8 steps/s
        // reads as a run cycle; airborne holds the stride frame.
        let frame = CHARS.PLAYER_IDLE;
        if (!player.grounded) {
            frame = CHARS.PLAYER_RUN;
        } else if (moving) {
            frame = Math.floor(this.clock * 8) % 2 === 0
                ? CHARS.PLAYER_RUN
                : CHARS.PLAYER_IDLE;
        }
        const face = this._faceOf(player);
        const w = 44;                       // slight overhang past the 32px hitbox
        const h = 44 * squash;
        const cx = player.x + player.width / 2;
        // Small vertical bob while running lifts each footfall off the floor.
        const bob = moving && player.grounded ? Math.abs(Math.sin(this.clock * 8 * Math.PI)) * 2 : 0;
        const feet = player.y + player.height - bob;
        ctx.save();
        ctx.translate(cx, feet);
        ctx.scale(face, 1);
        this._drawSheet(ctx, 'characters', frame, -w / 2, -h, w, h);
        ctx.restore();
    }

    drawEnemy(ctx, enemy, index) {
        if (enemy.dead) return;
        const frames = index % 2 === 0 ? CHARS.SLIME : CHARS.BAT;
        const frame = frames[Math.floor(this.clock * 6 + index * 1.7) % frames.length];
        const face = this._faceOf(enemy);
        const w = 42;
        const h = 42;
        const cx = enemy.x + enemy.width / 2;
        const feet = enemy.y + enemy.height;
        ctx.save();
        ctx.translate(cx, feet);
        ctx.scale(face, 1);
        this._drawSheet(ctx, 'characters', frame, -w / 2, -h, w, h);
        ctx.restore();
    }
}
