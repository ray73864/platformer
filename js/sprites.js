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
//
// Everything atmospheric (clouds, hills, sun/moon, decor, dirt speckles) is
// DETERMINISTIC per level: shapes come from a local mulberry32 seeded by the
// level number, never from the game's generation RNG streams and never from
// Math.random (which would flicker frame to frame). Layers are pre-rendered
// once per level into offscreen canvases; the per-frame cost is a handful of
// drawImage blits plus cached-gradient fills.

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

// Opaque tooth band of the spike tile (tile 68): source rows 9..17 of its
// 18px cell — measured from the shipped sheet; rows 0-8 are empty.
const SPIKE_BAND_Y = 9;
const SPIKE_BAND_H = 9;

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
// jungle x 144-191. `sky` is the solid band colour (and the gradient's
// middle stop), `ground` the silhouette base tone used to fill below the
// world bottom on short levels so terrain never floats on open sky.
//
// Palette harmony rules for the extended fields:
//  - the gradient DARKENS toward the zenith and stays LIGHT at the horizon
//    (skyBottom >= sky in luminance): hazards live near the ground line, and
//    keeping the lower sky bright preserves the "every death is visually
//    explainable" contrast ruling for spikes and enemies;
//  - hills/clouds are desaturated versions of the theme hue so the saturated
//    Kenney terrain sprites stay the loudest thing on screen;
//  - `disc` is the sun (day/dusk) or moon (jungle) anchor: fractional screen
//    position plus core/halo colours; `mote`/`fireflies` drive the ambient
//    particle tint in main.js.
export const THEMES = [
    {
        x: 0, w: 96, sky: '#dff6f5', ground: '#c2e3e8',
        skyTop: '#7cc0da', skyBottom: '#e8faf7',
        disc: { x: 0.74, y: 0.14, r: 26, core: '#fff6cf', halo: '#ffeeae' },
        cloud: '#ffffff', hillFar: '#aedbe1', hillNear: '#84c2cd',
        mote: '#fffbe0', fireflies: false
    },
    {
        x: 96, w: 48, sky: '#fbc97b', ground: '#cb815e',
        skyTop: '#c76e79', skyBottom: '#fdd79b',
        disc: { x: 0.66, y: 0.46, r: 34, core: '#ffe7ad', halo: '#ffbf7a' },
        cloud: '#ffdcae', hillFar: '#b5727c', hillNear: '#93546a',
        mote: '#ffd9a8', fireflies: false
    },
    {
        x: 144, w: 48, sky: '#7ff0a5', ground: '#2eb082',
        skyTop: '#1f9d79', skyBottom: '#9ff3c3',
        disc: { x: 0.78, y: 0.12, r: 22, core: '#f2fff5', halo: '#c9f7dd' },
        cloud: '#d9fce6', hillFar: '#4fbe93', hillNear: '#2f9c78',
        mote: '#d6ffa8', fireflies: true
    }
];

// Small-pixel decor scattered on exposed grass tops. Dark greens stay below
// the cap's luminance so tufts read as growth, not as hazards; petal colours
// are chosen light and tiny (5px) — nothing here can obscure a tooth or a
// patrolling body (fairness ruling).
const FLOWER_COLORS = ['#ffd7e8', '#fff3b0', '#ffffff'];

// Local copy of the mulberry32 PRNG (same algorithm as level.js): atmosphere
// shapes derive from the level NUMBER only, so this stream never touches —
// and is never perturbed by — the generator's own RNG sequences.
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

// Stable integer hash of tile coordinates for the dirt-speckle variant pick:
// the same tile always gets the same texture across frames and sessions
// (no flicker, no RNG stream consumed).
function hash2(x, y) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}

// '#rrggbb' -> 'rgba(r,g,b,a)' for gradient stops and soft fills.
function withAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Offscreen canvas factory (only ever called from sprites-ready paths, so
// the DOM is guaranteed; bun-test environments never reach these builders).
function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

// One tileable cloud band: `count` puff-clusters placed by `rng`, baked at
// `alpha` into a `w`-wide canvas. Clusters are drawn three times (x, x±w) so
// shapes crossing the seam wrap continuously when the canvas tiles.
function buildCloudBand(rng, w, h, count, color, alpha) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.globalAlpha = alpha;
    g.fillStyle = color;
    for (let i = 0; i < count; i++) {
        const cx = rng() * w;
        const cy = h * (0.25 + rng() * 0.5);
        const s = 0.6 + rng() * 0.8;
        const puffs = [];
        const n = 4 + Math.floor(rng() * 3);
        for (let p = 0; p < n; p++) {
            puffs.push({
                dx: (p - n / 2) * 16 * s + (rng() - 0.5) * 8,
                dy: (rng() - 0.5) * 10 * s,
                r: (10 + rng() * 10) * s
            });
        }
        for (const shift of [-w, 0, w]) {
            for (const p of puffs) {
                g.beginPath();
                g.arc(cx + shift + p.dx, cy + p.dy, p.r, 0, Math.PI * 2);
                g.fill();
            }
        }
    }
    return c;
}

// Two layered ridge silhouettes on one canvas. Wave frequencies are whole
// cycles across the canvas width, so the ridge meets itself seamlessly when
// the layer tiles horizontally.
function buildHills(rng, w, h, farColor, nearColor) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const ridge = (color, baseY, amp1, amp2, freq1, freq2) => {
        const p1 = rng() * Math.PI * 2;
        const p2 = rng() * Math.PI * 2;
        const yAt = (x) => baseY
            - amp1 * Math.sin((x / w) * Math.PI * 2 * freq1 + p1)
            - amp2 * Math.sin((x / w) * Math.PI * 2 * freq2 + p2);
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(0, h);
        for (let x = 0; x <= w; x += 6) g.lineTo(x, yAt(x));
        // Close exactly at the ridge height of the right edge: w is not a
        // multiple of the sample step, and jumping straight from the last
        // sample to the bottom corner carved a sky-coloured notch into the
        // seam of every tiled copy.
        g.lineTo(w, yAt(w));
        g.lineTo(w, h);
        g.closePath();
        g.fill();
    };
    ridge(farColor, h * 0.45, h * 0.26, h * 0.12, 2, 5);
    ridge(nearColor, h * 0.72, h * 0.20, h * 0.10, 3, 7);
    return c;
}

// Sun/moon: crisp core disc inside a soft radial halo, baked once per level
// (drawn with a slow ~2%-of-scroll parallax drift, never wraps).
function buildDisc(disc) {
    const size = disc.r * 4;
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(
        size / 2, size / 2, disc.r * 0.5, size / 2, size / 2, size / 2);
    grad.addColorStop(0, withAlpha(disc.halo, 0.55));
    grad.addColorStop(0.45, withAlpha(disc.halo, 0.22));
    grad.addColorStop(1, withAlpha(disc.halo, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.fillStyle = withAlpha(disc.core, 0.95);
    g.beginPath();
    g.arc(size / 2, size / 2, disc.r, 0, Math.PI * 2);
    g.fill();
    return c;
}

// Soft radial glow sprite (coin/portal aura): opaque-ish core fading to
// transparent, baked once per colour and reused for every instance.
function buildGlow(color) {
    const size = 64;
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(
        size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grad.addColorStop(0, withAlpha(color, 0.5));
    grad.addColorStop(0.5, withAlpha(color, 0.16));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
}

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

// Horizontal wrap for a prerendered parallax layer: negative-modulo so the
// layer scrolls continuously left as the camera advances right.
function wrapOffset(scrollPx, w) {
    return -(((scrollPx % w) + w) % w);
}

export class Sprites {
    constructor() {
        this.images = {};
        this.loaded = false;
        this.clock = 0;
        // Facing cache for flip decisions while vx decays through 0: WeakMap
        // so torn-down entities collect with their owners.
        this._facing = new WeakMap();

        // Render-only caches. All assigned BEFORE the Image guard below so
        // headless environments hold inert (never-populated) containers too.
        // Sky gradients: one per theme, rebuilt only when the viewport
        // height changes (resize), never per frame.
        this._skyCache = [null, null, null];
        // Prerendered atmosphere layers for the current level.
        this._backdrop = null;
        // Speckled dirt tile variants (built once after the sheet loads).
        this._dirtVariants = null;
        // Grass-top decor list, rebuilt only when the level instance swaps.
        this._decor = [];
        this._decorSource = null;
        // Grid reference set by drawWorld each frame; the entity drop-shadow
        // probes read it (drawWorld always runs before entities in main.draw).
        this._level = null;
        // Glow sprites keyed by colour string.
        this._glows = {};

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

    // Cached vertical sky gradient for a theme; rebuilt only on viewport
    // height change so the steady-state frame allocates nothing.
    _skyGradient(ctx, themeIdx, viewH) {
        const entry = this._skyCache[themeIdx];
        if (entry && entry.h === viewH) return entry.grad;
        const t = THEMES[themeIdx];
        const grad = ctx.createLinearGradient(0, 0, 0, viewH);
        grad.addColorStop(0, t.skyTop);
        grad.addColorStop(0.62, t.sky);
        grad.addColorStop(1, t.skyBottom);
        this._skyCache[themeIdx] = { h: viewH, grad };
        return grad;
    }

    // Per-level atmosphere kit: sun/moon disc + three cloud bands + twin
    // hill ridges, all baked into offscreen canvases from a level-seeded
    // PRNG. Rebuilt only when the level number changes (once per level).
    _ensureBackdrop(levelNumber, themeIdx) {
        if (this._backdrop && this._backdrop.levelNumber === levelNumber) {
            return this._backdrop;
        }
        const theme = THEMES[themeIdx];
        const rng = makeRng(Math.imul(levelNumber, 0x9E3779B1) ^ 0xA17AC391);
        this._backdrop = {
            levelNumber,
            disc: buildDisc(theme.disc),
            cloudsFar: buildCloudBand(rng, 1024, 110, 5, theme.cloud, 0.5),
            cloudsMid: buildCloudBand(rng, 1024, 130, 7, theme.cloud, 0.72),
            cloudsLow: buildCloudBand(rng, 1024, 80, 6, theme.cloud, 0.45),
            hills: buildHills(rng, 1024, 170, theme.hillFar, theme.hillNear)
        };
        return this._backdrop;
    }

    // Parallax sky: cached vertical gradient, sun/moon, three cloud bands
    // (factors 0.10/0.25/0.40 of cameraX), hill silhouettes (0.35) resting on
    // the horizon, and the sheet's ground strip (0.5). Camera-x only;
    // vertical camera travel does not move the bands. worldBottomScreen is
    // the on-screen y of the level's bottom edge: when it sits above the
    // viewport floor (short levels, tall windows) the ground silhouette
    // anchors there and deep-ground fill covers the remainder, so terrain
    // rests on earth instead of floating on sky.
    drawBackground(ctx, levelNumber, cameraX, viewW, viewH, worldBottomScreen = Infinity) {
        const themeIdx = (Math.max(1, levelNumber) - 1) % THEMES.length;
        const theme = THEMES[themeIdx];
        ctx.fillStyle = this._skyGradient(ctx, themeIdx, viewH);
        ctx.fillRect(0, 0, viewW, viewH);
        if (!this.images.backgrounds) return;

        const bd = this._ensureBackdrop(levelNumber, themeIdx);
        // Horizon line shared by hills and the ground strip.
        const groundH = 24 * 2;
        const bandY = Math.min(viewH - groundH, worldBottomScreen);

        // Sun/moon: near-static anchor with a few pixels of drift across a
        // whole level width (factor 0.02) — too slow to ever wrap visibly.
        const disc = theme.disc;
        ctx.drawImage(bd.disc,
            viewW * disc.x - cameraX * 0.02 - bd.disc.width / 2,
            viewH * disc.y - bd.disc.height / 2);

        this._blitWrapped(ctx, bd.cloudsFar, cameraX * 0.10, viewH * 0.06, viewW);
        this._blitWrapped(ctx, bd.cloudsMid, cameraX * 0.25, viewH * 0.2, viewW);
        this._blitWrapped(ctx, bd.hills, cameraX * 0.35,
            bandY - bd.hills.height + 12, viewW);
        // Low wisps in FRONT of the hills: reads as weather passing the
        // ridgeline, one more depth layer for free.
        this._blitWrapped(ctx, bd.cloudsLow, cameraX * 0.40,
            bandY - bd.cloudsLow.height - 10, viewW);

        // Ground silhouette: ×2 scale, factor 0.5, anchored to the world
        // bottom when that is on screen, else to the viewport floor.
        this._tileStrip(ctx, this.images.backgrounds, theme.x, 48, theme.w, 24,
            groundH, cameraX * 0.5, bandY, viewW);
        if (bandY + groundH < viewH) {
            ctx.fillStyle = theme.ground;
            ctx.fillRect(0, bandY + groundH, viewW, viewH - bandY - groundH);
        }
    }

    _blitWrapped(ctx, canvas, scrollPx, y, viewW) {
        const w = canvas.width;
        // Integer scroll: fractional destinations make nearest-neighbour
        // floor each tile copy independently, opening a 1px sky-coloured
        // hairline at every seam.
        const start = wrapOffset(Math.round(scrollPx), w);
        for (let x = start; x < viewW; x += w) {
            ctx.drawImage(canvas, x, y);
        }
    }

    _tileStrip(ctx, img, sx, sy, srcW, srcH, chunkH, scrollX, y, viewW) {
        const chunkW = srcW * 2;
        const offset = wrapOffset(Math.round(scrollX), chunkW);
        for (let x = offset; x < viewW; x += chunkW) {
            ctx.drawImage(img, sx, sy, srcW, srcH, x, y, chunkW, chunkH);
        }
    }

    // Four speckled variants of the dirt tile, baked once: the tile-grid hash
    // picks a variant per tile, so masses get stable texture variation
    // without per-frame speckle draws and without flicker.
    _buildDirtVariants() {
        const rect = sheetRect('tiles', TILES.DIRT);
        const variants = [];
        for (let v = 0; v < 4; v++) {
            const c = makeCanvas(rect.sw, rect.sh);
            const g = c.getContext('2d');
            g.drawImage(this.images.tiles, rect.sx, rect.sy, rect.sw, rect.sh,
                0, 0, rect.sw, rect.sh);
            const rng = makeRng(0xD117E ^ Math.imul(v + 1, 0x9E3779B1));
            for (let i = 0; i < 4; i++) {
                // Mostly dark grain, one light fleck per variant.
                g.fillStyle = i === 3 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.16)';
                g.fillRect(Math.floor(rng() * (rect.sw - 2)),
                    Math.floor(rng() * (rect.sh - 2)), 2, 2);
            }
            variants.push(c);
        }
        this._dirtVariants = variants;
        return variants;
    }

    // Grass-top decor list: tufts, flowers and pebbles on exposed surfaces,
    // precomputed ONCE per level instance from a level-seeded PRNG and reused
    // every frame. Skips cells capped by anything (only pure sky above) and
    // cells with a spike overhead, so decor never crowds a hazard.
    _ensureDecor(level) {
        if (this._decorSource === level) return this._decor;
        const decor = [];
        const rng = makeRng(Math.imul(level.levelNumber, 0x51F3B6A1) ^ 0xB3D7B9F2);
        for (let ty = 1; ty < level.height; ty++) {
            for (let tx = 0; tx < level.width; tx++) {
                if (level.tiles[ty][tx] !== 1 || level.tiles[ty - 1][tx] !== 0) continue;
                if (rng() > 0.34) continue;
                const roll = rng();
                decor.push({
                    tx,
                    ty,
                    kind: roll < 0.5 ? 'tuft' : roll < 0.8 ? 'flower' : 'pebble',
                    ox: Math.floor(rng() * 18),
                    petal: Math.floor(rng() * FLOWER_COLORS.length)
                });
            }
        }
        this._decorSource = level;
        this._decor = decor;
        return decor;
    }

    // Terrain from the tile grid with viewport culling: exposed solids get
    // the grass cap, buried ones the hashed speckled dirt variant. Spikes
    // draw as the tooth tile filling their cell. Readability passes (rim
    // light, mass-edge shading, decor) run as separate fill-style batches so
    // fillStyle never thrashes per tile.
    drawWorld(ctx, level, cameraX, cameraY, viewW, viewH) {
        // Entity drop shadows probe this grid; drawWorld precedes every
        // entity draw in main.js's frame order.
        this._level = level;
        const size = level.tileSize;
        // +1px destination overlap: 18px source scaled to a fractional CSS
        // pixel size would otherwise leave hairline gaps between columns
        // (the nearest-neighbour rounding floors each rect independently).
        const drawn = size + 1;
        const c0 = Math.max(0, Math.floor(cameraX / size));
        const c1 = Math.min(level.width - 1, Math.ceil((cameraX + viewW) / size));
        const r0 = Math.max(0, Math.floor(-cameraY / size));
        const r1 = Math.min(level.height - 1, Math.ceil((-cameraY + viewH) / size));
        const dirt = this._dirtVariants ?? this._buildDirtVariants();

        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                const t = level.tiles[ty][tx];
                if (t === 1) {
                    const above = ty > 0 ? level.tiles[ty - 1][tx] : 0;
                    ctx.drawImage(dirt[hash2(tx, ty) & 3],
                        0, 0, 18, 18, tx * size, ty * size, drawn, drawn);
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
                    // Stretch the tooth band (source rows 9..17 — measured
                    // opaque extent) across the full cell so the VISIBLE
                    // metal matches the lethal core (the tile rect inset 4px
                    // per side). Drawing the raw 18px cell left the teeth in
                    // the bottom half only, and players died to an invisible
                    // kill zone above the tips.
                    const spike = sheetRect('tiles', TILES.SPIKE);
                    ctx.drawImage(this.images.tiles,
                        spike.sx, spike.sy + SPIKE_BAND_Y, spike.sw, SPIKE_BAND_H,
                        tx * size, ty * size, drawn, drawn);
                }
            }
        }

        // Surface rim light: a 2px sheen along every exposed top edge makes
        // the standable line instantly readable against both sky and dirt.
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                if (ty > 0 && level.tiles[ty - 1][tx] === 1) continue;
                ctx.fillRect(tx * size, ty * size, drawn, 2);
            }
        }
        // Mass-edge shading: darker strips on the exposed flanks of solid
        // bodies (right heavier — the sun sits right-of-centre in day/jungle
        // themes) give terrain volumes instead of flat columns.
        ctx.fillStyle = 'rgba(10,16,32,0.10)';
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                if (tx > 0 && level.tiles[ty][tx - 1] === 1) continue;
                ctx.fillRect(tx * size, ty * size, 3, drawn);
            }
        }
        ctx.fillStyle = 'rgba(10,16,32,0.16)';
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                if (tx < level.width - 1 && level.tiles[ty][tx + 1] === 1) continue;
                ctx.fillRect((tx + 1) * size - 3, ty * size, 3, drawn);
            }
        }

        this._drawDecor(ctx, this._ensureDecor(level), size, c0, c1);
    }

    _drawDecor(ctx, decor, size, c0, c1) {
        for (const d of decor) {
            if (d.tx < c0 || d.tx > c1) continue;
            const x = d.tx * size + d.ox;
            const y = d.ty * size;
            if (d.kind === 'tuft') {
                ctx.fillStyle = '#3f7d31';
                ctx.fillRect(x, y - 6, 2, 6);
                ctx.fillRect(x + 3, y - 9, 2, 9);
                ctx.fillRect(x + 6, y - 5, 2, 5);
            } else if (d.kind === 'flower') {
                ctx.fillStyle = '#3f7d31';
                ctx.fillRect(x + 1, y - 7, 2, 7);
                ctx.fillStyle = FLOWER_COLORS[d.petal];
                ctx.fillRect(x, y - 11, 5, 4);
            } else {
                ctx.fillStyle = '#8f9aa3';
                ctx.fillRect(x, y - 3, 5, 3);
            }
        }
    }

    // Cheap downward tile-grid probe: the top of the first solid row under
    // (cx, feetY) within 4 tiles, or null when nothing catches the shadow.
    _groundBelow(cx, feetY) {
        const level = this._level;
        if (!level) return null;
        const size = level.tileSize;
        const tx = Math.floor(cx / size);
        if (tx < 0 || tx >= level.width) return null;
        const r0 = Math.max(0, Math.floor(feetY / size));
        const r1 = Math.min(level.height - 1, r0 + 4);
        for (let ty = r0; ty <= r1; ty++) {
            if (level.tiles[ty][tx] === 1) return ty * size;
        }
        return null;
    }

    // Soft elliptical contact shadow projected onto the ground below an
    // entity: shrinks and fades with fall distance, disappears over pits.
    _entityShadow(ctx, cx, feetY, halfW) {
        const gy = this._groundBelow(cx, feetY);
        if (gy === null) return;
        const span = 4 * this._level.tileSize;
        const k = Math.min(Math.max(gy - feetY, 0), span) / span;
        ctx.save();
        ctx.globalAlpha = 0.06 + 0.28 * (1 - k);
        ctx.fillStyle = '#0a1020';
        ctx.beginPath();
        ctx.ellipse(cx, gy + 2, halfW * (1 - 0.45 * k), 5 * (1 - 0.4 * k),
            0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    _glowSprite(color) {
        if (!this._glows[color]) this._glows[color] = buildGlow(color);
        return this._glows[color];
    }

    drawCoins(ctx, coins) {
        const bobPhase = this.clock * 3;
        const glow = this._glowSprite('#ffd76a');
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
            // Faint breathing aura: pickups read as valuable from across
            // the screen without needing the sprite itself resolved.
            ctx.globalAlpha = 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(bobPhase * 0.8 + phase));
            ctx.drawImage(glow, cx - 22, cy - 22, 44, 44);
            ctx.globalAlpha = 1;
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
        const cx = portal.x + portal.width / 2;
        const cy = feetY - h / 2;
        // Slow pulsing aura: locked it smoulders dim, unlocked it breathes —
        // the gate's state is legible at a glance, time-based not frame-based.
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 1.8);
        ctx.globalAlpha = unlocked ? 0.32 + 0.26 * pulse : 0.12;
        const glow = this._glowSprite(unlocked ? '#b06cf0' : '#8a7fa8');
        const gs = 96 + 14 * pulse;
        ctx.drawImage(glow, cx - gs / 2, cy - gs / 2, gs, gs);
        ctx.globalAlpha = 1;
        ctx.save();
        if (!unlocked) ctx.globalAlpha = 0.35;
        this._drawSheet(ctx, 'tiles', frame, cx - w / 2, feetY - h, w, h);
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
        this._entityShadow(ctx, cx, player.y + player.height, 16);
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
        this._entityShadow(ctx, cx, feet, 15);
        ctx.save();
        ctx.translate(cx, feet);
        ctx.scale(face, 1);
        this._drawSheet(ctx, 'characters', frame, -w / 2, -h, w, h);
        ctx.restore();
    }
}
