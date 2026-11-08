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
//
// Wave B note: this layer imports ONLY fx.js — a pure presentation-config
// leaf with no imports of its own (no cycle, no simulation reach). The "stay
// import-free" convention above targets game-logic modules; telegraph and
// juice embellishments must read the single FX object Wave C toggles, so a
// mirrored constant here would defeat that.

import { FX } from './fx.js';

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
// borders that must not be drawn when tiles stack. The day surface cap bakes
// this band into its strip (see _buildCapArt).
const GRASS_BAND_Y = 2;
const GRASS_BAND_H = 7;

// Baked surface-cap strip geometry (source px): rows [0, CAP_OVER) hang into
// the air cell above the tile (blades/fringe), the rest forms the lip.
const CAP_OVER = 4;
const CAP_H = CAP_OVER + 9;

// One tile cell: matches main.js TILE_SIZE (kept local so the sprite layer
// stays dependency-free). Used to stand the portal flag on the ground line.
const PORTAL_CELL = 32;

// Frames into characters.png. Enemies: spiked-shelled slime and bat, both
// 3-frame walk/flap cycles. The player left this sheet in the 2026-11-04
// hero redesign (baked indexed pixel art below); cells 9-10 of the sheet
// remain unused rather than renumbering the enemy frames.
export const CHARS = {
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
//
// Biome-identity fields (visual overhaul wave 1): each band owns its terrain
// MATERIAL, not just its sky. `rim` tints the surface rim-light pass, `mood`
// is the world tint composited over background+terrain+props (never entities),
// `haze` the horizon-mist colour, `portalGlow` harmonises the goal aura with
// the band, `ink` the near-black foreground-silhouette tone, and `dust` the
// walking-puff colour. Terrain baking parameters live in TERRAIN_MATS below.
export const THEMES = [
    {
        x: 0, w: 96, sky: '#dff6f5', ground: '#c2e3e8',
        skyTop: '#7cc0da', skyBottom: '#e8faf7', zenith: '#3d7ba3',
        // disc.kind drives the bake (cratered moon vs plain sun); x/y are
        // DEFAULTS only — look-A hashes a per-level position into the safe
        // upper-sky band so the disc never sits where the player travels.
        disc: { x: 0.74, y: 0.18, r: 26, core: '#fff6cf', halo: '#ffeeae', kind: 'sun' },
        cloud: '#ffffff', hillFar: '#aedbe1', hillNear: '#84c2cd',
        mote: '#fffbe0', fireflies: false,
        // Sparse night stars: colour + density (dots per 1024×300 band).
        stars: false, starColor: '#ffffff', starDensity: 0,
        rim: 'rgba(255,255,255,0.28)',
        // Sunward 1px flank rim + ambient-occlusion tint (look-A soft light).
        rimSide: 'rgba(255,246,214,0.34)', aoDark: 'rgba(24,14,6,',
        mood: 'rgba(255,246,214,0.045)',
        haze: '#eafcff',
        portalGlow: '#b06cf0',
        ink: '#1c2a17',
        dust: '#cbb98a',
        vignette: 0.10
    },
    {
        x: 96, w: 48, sky: '#fbc97b', ground: '#cb815e',
        skyTop: '#c76e79', skyBottom: '#fdd79b', zenith: '#6d2f4c',
        // Dusk is the night band: pale harvest moon + stars replace the old
        // low sun; warm halo keeps the moon inside the sunset palette.
        disc: { x: 0.66, y: 0.18, r: 20, core: '#ffeeda', halo: '#ffd9b8', kind: 'moon' },
        cloud: '#ffdcae', hillFar: '#b5727c', hillNear: '#93546a',
        mote: '#ffd9a8', fireflies: true,
        stars: true, starColor: '#ffe9d0', starDensity: 46,
        rim: 'rgba(255,226,170,0.30)',
        rimSide: 'rgba(255,214,150,0.34)', aoDark: 'rgba(74,32,12,',
        mood: 'rgba(255,120,54,0.11)',
        haze: '#ffd9a0',
        portalGlow: '#ef7fae',
        ink: '#2b150c',
        dust: '#c9986a',
        vignette: 0.12
    },
    {
        x: 144, w: 48, sky: '#7ff0a5', ground: '#2eb082',
        skyTop: '#1f9d79', skyBottom: '#9ff3c3', zenith: '#0b574a',
        disc: { x: 0.78, y: 0.16, r: 22, core: '#f2fff5', halo: '#c9f7dd', kind: 'sun' },
        cloud: '#d9fce6', hillFar: '#4fbe93', hillNear: '#2f9c78',
        mote: '#d6ffa8', fireflies: true,
        stars: false, starColor: '#eaffea', starDensity: 0,
        rim: 'rgba(206,244,208,0.22)',
        rimSide: 'rgba(206,244,208,0.26)', aoDark: 'rgba(4,30,16,',
        mood: 'rgba(24,104,66,0.12)',
        haze: '#b8ffd9',
        portalGlow: '#5fe8bc',
        ink: '#0d2317',
        dust: '#7fae7a',
        vignette: 0.12
    }
];

// Per-band terrain material recipes (index-aligned with THEMES). The Kenney
// dirt cell is the structural base everywhere — these veils/grains turn it
// into brown garden dirt (day), stratified sandstone (dusk) and dark mossy
// earth (jungle) so the three bands never share a material again.
const TERRAIN_MATS = [
    {
        // Day: keep the sheet's warm brown, just deepen the speckle.
        veil: null,
        grain: 'dark',           // scattered dark specks (the original look)
        interiorVeil: 'rgba(24,14,6,0.24)',
        // Aesthetic wave 2: buried-mass mottle dabs (see bakeBody interior).
        mottleDark: 'rgba(18,9,3,0.34)', mottleLight: 'rgba(255,236,190,0.13)'
    },
    {
        // Dusk: amber sandstone with horizontal strata, blockier faces.
        veil: 'rgba(226,146,78,0.40)',
        grain: 'strata',
        interiorVeil: 'rgba(74,32,12,0.26)',
        mottleDark: 'rgba(58,22,6,0.30)', mottleLight: 'rgba(255,214,150,0.10)'
    },
    {
        // Jungle: cool dark mossy earth with vertical grain/root streaks.
        veil: 'rgba(26,88,56,0.42)',
        grain: 'vertical',
        interiorVeil: 'rgba(4,30,16,0.30)',
        mottleDark: 'rgba(2,16,8,0.34)', mottleLight: 'rgba(190,240,190,0.08)'
    }
];

// Per-band metals for the moving-platform decks (index-aligned with THEMES).
// Deliberately manufactured — flat plates, strap bands, bolts — so a deck
// never reads as terrain at a glance; hues harmonise with each band's material
// (steel in day daylight, brass in dusk sandstone, verdigris in jungle moss).
const PLATFORM_METALS = [
    { plate: '#8a97ab', plateDark: '#5d6a80', band: '#3f4a5e', bolt: '#252d3c', rim: '#c3cfdf' },
    { plate: '#b08a5a', plateDark: '#7d5c36', band: '#57402a', bolt: '#33261a', rim: '#e8c795' },
    { plate: '#6f9a80', plateDark: '#48705a', band: '#2f4c3e', bolt: '#182a22', rim: '#b9dcc4' }
];

// Small-pixel decor scattered on exposed surfaces. Dark greens stay below
// the cap's luminance so tufts read as growth, not as hazards; petal colours
// are per-band members of the theme family (look-A): pale pink/cream by day,
// muted peach/lilac at dusk (nothing bright against amber sky), blossom/
// mint in the jungle. All heads are ≤5px — nothing here can obscure a tooth
// or a patrolling body (fairness ruling).
const BAND_PETALS = [
    ['#ffd7e8', '#fff3b0', '#ffffff'],   // day
    ['#f2c9a8', '#e6cfe0'],              // dusk (dusk-safe: low chroma)
    ['#f2b8c6', '#d9fce6']               // jungle
];

// ---------------------------------------------------------------------------
// HERO — hand-authored pixel art (2026-11-04 character redesign).
//
// The stock Kenney "dropin" astronaut read as an unfinished blob next to the
// bespoke biome art: one fused head/torso mass, no limbs at game zoom, and a
// tan/white palette that melted into the dusk sandstone. The replacement is a
// crimson-nightcap adventurer authored as indexed color-string frames (20x20
// content grid) and baked ONCE per Sprites instance into 22x22 offscreen
// canvases — the same bake-once/drawImage-blit convention as the terrain and
// prop art. A 1px warm-charcoal outline ring is generated at bake time from
// the transparent border of each frame, so every pose carries identical
// edge weight against all three bands (day blue, dusk amber, jungle green).
//
// Palette harmony: pants steel = PLATFORM_METALS[0].band family; scarf teal
// echoes the jungle skyTop/day hillNear; cap crimson is the single saturated
// warm note (complement of the jungle band, darkest-but-one value in the day
// sky); buckle gold matches the coin. Outline is #2a2118 — warm charcoal,
// never pure black.
// Palette roles documented above; exported alongside the frames so tests can
// assert every authored character is a known colour.
export const HERO_PALETTE = {
    '.': null,        // transparent
    o: '#2a2118',     // warm charcoal ink (outline ring + pupils)
    c: '#d4374a',     // nightcap crimson
    d: '#a02a3c',     // cap underside shade
    l: '#ef6672',     // cap highlight (sun side)
    s: '#f2d8b0',     // face cream
    k: '#d9b98c',     // face shade under the brim
    w: '#2fb3a6',     // scarf teal
    n: '#1e857c',     // scarf shade
    v: '#8a5230',     // vest brown
    b: '#64391f',     // vest seam shadow
    h: '#efe0bd',     // shirt sleeves
    p: '#3f4a5e',     // trousers steel blue
    t: '#6e4a2e',     // boots tan
    u: '#9c6b3f',     // satchel leather
    y: '#ffd76e'      // belt buckle gold (coin harmony)
};
const HERO_W = 20;
const HERO_H = 20;

// Frame inventory: idle x2 (breathing), run x4 (contact / pass / contact-
// mirror / pass-mirror with counter-swinging arms), jump-rise (tucked legs,
// arms up, cloth streaming down), fall (legs kicking, arms out, scarf
// streaming up). Facing right; drawPlayer mirrors via ctx.scale(face, 1).
export const HERO_FRAMES = {
    idle0: [
        '....................',
        '.......ccccc........',
        '......cllllccc......',
        '.....cclllccccc.....',
        '....cccccccccccc....',
        '..cc.dddddddddd.....',
        '..ccd.ssssssks......',
        '...cc.ssssssks......',
        '....c.ssoososs......',
        '......ssoososs......',
        '......ssssssks......',
        '......nnwwwwww......',
        '....nnvvvvvvu.......',
        '...nwhvvbbvvvh......',
        '.....hvvbbvvvh......',
        '....uuvvvvvvv.......',
        '....uypppyppp.......',
        '......ppppppp.......',
        '.......tt.tt........',
        '......ttt.ttt.......',
    ],
    idle1: [
        '....................',
        '....................',
        '.......ccccc........',
        '......cllllccc......',
        '.....cclllccccc.....',
        '....cccccccccccc....',
        '..cc.dddddddddd.....',
        '..ccd.ssssssks......',
        '...cc.ssssssks......',
        '....c.ssoososs......',
        '......ssoososs......',
        '......ssssssks......',
        '......nnwwwwww......',
        '....nnvvvvvvu.......',
        '...nwhvvbbvvvh......',
        '.....hvvbbvvvh......',
        '....uuvvvvvvv.......',
        '....uypppyppp.......',
        '.......tt.tt........',
        '......ttt.ttt.......',
    ],
    run0: [
        '.......ccccc........',
        '.cccc.cllllccc......',
        '.cccdcclllccccc.....',
        '..c.cccccccccccc....',
        '.....dddddddddd.....',
        '......ssssssks......',
        '......ssssssks......',
        '......ssoososs......',
        '......ssoososs......',
        '......ssssssks......',
        '.wwwn.nnwwwwww......',
        'wwn...vvvvvvuhh.....',
        '......vvbbvvv.......',
        '....hhvvbbvvv.......',
        '....uuvvvvvvv.......',
        '....uypppyppp.......',
        '......ppppppp.......',
        '.......pp..pp.......',
        '......pp....tt......',
        '.....ttt...ttt......',
    ],
    run1: [
        '.......ccccc........',
        '..cc..cllllccc......',
        '.ccd.cclllccccc.....',
        '..c.cccccccccccc....',
        '.....dddddddddd.....',
        '......ssssssks......',
        '......ssssssks......',
        '......ssoososs......',
        '......ssoososs......',
        '......ssssssks......',
        '..wwn.nnwwwwww......',
        '.wn...vvvvvvu.......',
        '.....hvvbbvvvh......',
        '......vvbbvvv.......',
        '....uuvvvvvvv.......',
        '....uypppyppp.......',
        '......ppppppp.......',
        '.......pp...........',
        '.......pptt.........',
        '......ttt...........',
    ],
    run2: [
        '.......ccccc........',
        '.cccc.cllllccc......',
        '.cccdcclllccccc.....',
        '..c.cccccccccccc....',
        '.....dddddddddd.....',
        '......ssssssks......',
        '......ssssssks......',
        '......ssoososs......',
        '......ssoososs......',
        '......ssssssks......',
        '.wwwn.nnwwwwww......',
        'wwn.hhvvvvvvu.......',
        '......vvbbvvv.......',
        '......vvbbvvvhh.....',
        '....uuvvvvvvv.......',
        '....uypppyppp.......',
        '......ppppppp.......',
        '......pp..pp........',
        '....tt....pp........',
        '...ttt...ttt........',
    ],
    run3: [
        '.......ccccc........',
        '..cc..cllllccc......',
        '.ccd.cclllccccc.....',
        '..c.cccccccccccc....',
        '.....dddddddddd.....',
        '......ssssssks......',
        '......ssssssks......',
        '......ssoososs......',
        '......ssoososs......',
        '......ssssssks......',
        '..wwn.nnwwwwww......',
        '.wn...vvvvvvu.......',
        '.....hvvbbvvvh......',
        '......vvbbvvv.......',
        '....uuvvvvvvv.......',
        '....uypppyppp.......',
        '......ppppppp.......',
        '.........pp.........',
        '.......ttpp.........',
        '.........ttt........',
    ],
    jump: [
        '.......ccccc........',
        '......cllllccc......',
        '.....cclllccccc.....',
        '....cccccccccccc....',
        '.....dddddddddd.....',
        '..cc..ssssssks......',
        '..cc..ssssssks......',
        '..cd..ssoososs......',
        '...c..ssoososs......',
        '.....sssssssks......',
        '.....hnnwwwwwh......',
        '....nhvvvvvvuh......',
        '...nw.vvbbvvv.......',
        '...nw.vvbbvvv.......',
        '....uuvvvvvvv.......',
        '....uypppyppp.......',
        '......ppppppp.......',
        '.......pppp.........',
        '......tttttt........',
        '....................',
    ],
    fall: [
        '..c....ccccc........',
        '.ccd..cllllccc......',
        '..cc.cclllccccc.....',
        '....cccccccccccc....',
        '.....dddddddddd.....',
        '......ssssssks......',
        '......ssssssks......',
        '......ssoososs......',
        '...nn.ssoososs......',
        '..wnn.ssssssks......',
        '...nn.nnwwwwww......',
        '....hhvvvvvvuhh.....',
        '......vvbbvvv.......',
        '......vvbbvvv.......',
        '....uuvvvvvvv.......',
        '....uypppyppp.......',
        '......ppppppp.......',
        '......pp...pp.......',
        '....tt.....tt.......',
        '............ttt.....',
    ],
};

// Bake every indexed frame into an outlined offscreen canvas once. Returns a
// map name -> canvas, or null where 2D rasterisation is unavailable (bun
// test/happy-dom: contexts exist but expose no fillRect), letting drawPlayer
// fall back to shadow-only without throwing.
function buildHeroCanvases() {
    if (typeof document === 'undefined') return null;
    const out = {};
    for (const [name, rows] of Object.entries(HERO_FRAMES)) {
        const c = makeCanvas(HERO_W + 2, HERO_H + 2);
        const g = c.getContext('2d');
        if (!g || typeof g.fillRect !== 'function') return null;
        const opaque = rows.map(r => [...r].map(ch => ch !== '.'));
        rows.forEach((row, y) => {
            [...row].forEach((ch, x) => {
                if (ch === '.') return;
                const hex = HERO_PALETTE[ch];
                if (!hex) throw new Error(`hero frame "${name}": unknown palette char "${ch}"`);
                g.fillStyle = hex;
                g.fillRect(x + 1, y + 1, 1, 1);
            });
        });
        // Generated 1px outline ring: any transparent cell orthogonally
        // adjacent to colour becomes ink. Guarantees uniform edge weight
        // across poses without hand-placing hundreds of outline pixels.
        const at = (x, y) => (x >= 0 && y >= 0 && x < HERO_W && y < HERO_H && opaque[y][x]);
        g.fillStyle = HERO_PALETTE.o;
        for (let y = -1; y <= HERO_H; y++) {
            for (let x = -1; x <= HERO_W; x++) {
                if (at(x, y)) continue;
                if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
                    g.fillRect(x + 1, y + 1, 1, 1);
                }
            }
        }
        out[name] = c;
    }
    return out;
}

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

// Does 2D rasterisation actually work here? happy-dom hands out contexts
// without fillRect, so "a context exists" is not enough. Probed ONCE at
// module load — before any test can stub document.createElement — so the
// atmosphere bakers can skip pixels (while still computing their pure
// PLACEMENT data, determinism-assertable) in headless runs.
const RASTER_OK = (() => {
    try {
        if (typeof document === 'undefined') return false;
        const g = makeCanvas(1, 1).getContext('2d');
        return !!g && typeof g.fillRect === 'function';
    } catch {
        return false;
    }
})();

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

// ---------------------------------------------------------------------------
// Near-background stratum (~0.55 parallax): saturated two-tone silhouettes
// standing on the horizon between the hill ridges and the ground strip.
// Distance rule: MORE saturated than the hills but LOW internal contrast and
// zero gameplay-visual vocabulary (no flat standable tops at gameplay height)
// so nothing here can be mistaken for terrain. Shapes wrap: each is drawn at
// x, x-w and x+w so the tiled band is seamless.
// ---------------------------------------------------------------------------
const NEARBG_W = 1024;
const NEARBG_H = 190;

function buildNearBg(rng, themeIdx) {
    const c = makeCanvas(NEARBG_W, NEARBG_H);
    const g = c.getContext('2d');
    const base = NEARBG_H;
    // Per-band palette: main tone + darker face + lighter accent, all kept
    // mid-luminance so the gameplay layer stays the brightest thing on screen.
    const PAL = [
        { a: '#4f9e63', b: '#43895a', c: '#c2c896', d: '#8f9a6c' }, // day greenery / farm
        { a: '#c96f4a', b: '#ad5a3a', c: '#bd6a50', d: '#8f4a34' }, // dusk terracotta
        { a: '#2f7d57', b: '#276b4b', c: '#37946a', d: '#2c7d58' }  // jungle canopy/trunk
    ][themeIdx];
    const trunkAt = (x, kind) => {
        if (kind === 0) {
            // Tree clump: three canopy blobs on short trunks.
            for (let i = 0; i < 3; i++) {
                const bx = x + (i - 1) * 26;
                const r = 16 + rng() * 10;
                const cy = base - 26 - r;
                g.fillStyle = i === 1 ? PAL.a : PAL.b;
                g.fillRect(bx - 3, base - 26, 6, 26);
                g.beginPath();
                g.arc(bx, cy, r, 0, Math.PI * 2);
                g.fill();
            }
        } else if (kind === 1) {
            // Farm windmill: tapered tower + four-blade cross.
            const hgt = 90 + rng() * 30;
            g.fillStyle = PAL.d;
            g.beginPath();
            g.moveTo(x - 14, base);
            g.lineTo(x - 8, base - hgt);
            g.lineTo(x + 8, base - hgt);
            g.lineTo(x + 14, base);
            g.closePath();
            g.fill();
            g.fillStyle = PAL.c;
            const hubY = base - hgt - 6;
            for (let b = 0; b < 4; b++) {
                const ang = b * Math.PI / 2 + 0.4;
                g.save();
                g.translate(x, hubY);
                g.rotate(ang);
                g.fillRect(-2, 0, 5, 34);
                g.restore();
            }
        } else if (kind === 2) {
            // Hay roll: squat bale with a winding seam hint.
            g.fillStyle = PAL.c;
            g.beginPath();
            g.ellipse(x, base - 14, 20, 14, 0, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = PAL.d;
            g.lineWidth = 3;
            g.beginPath();
            g.ellipse(x, base - 14, 11, 8, 0, 0, Math.PI * 2);
            g.stroke();
        } else if (kind === 3) {
            // Mesa with an eroded arch: blocky top, cut-out opening.
            const hgt = 80 + rng() * 50;
            const wHalf = 34 + rng() * 18;
            g.fillStyle = PAL.a;
            g.beginPath();
            g.moveTo(x - wHalf, base);
            g.lineTo(x - wHalf + 8, base - hgt);
            g.lineTo(x + wHalf - 8, base - hgt);
            g.lineTo(x + wHalf, base);
            g.closePath();
            g.fill();
            g.fillStyle = PAL.b;
            g.fillRect(x + wHalf - 14, base - hgt, 8, hgt);
            // Arch notch (destination-out punches through to the sky behind).
            g.save();
            g.globalCompositeOperation = 'destination-out';
            g.beginPath();
            g.arc(x, base, 16, Math.PI, 0);
            g.rect(x - 16, base - 1, 32, 4);
            g.fill();
            g.restore();
        } else if (kind === 4) {
            // Ruined tower: notched crown + dark window slit.
            const hgt = 100 + rng() * 45;
            g.fillStyle = PAL.c;
            g.fillRect(x - 16, base - hgt, 32, hgt);
            for (let n = 0; n < 3; n++) {
                g.clearRect(x - 16 + n * 11 + 2, base - hgt, 6, 8);
            }
            g.fillStyle = PAL.d;
            g.fillRect(x - 3, base - hgt + 22, 6, 12);
        } else if (kind === 5) {
            // Giant tree: flared trunk + heavy canopy mass overhead.
            const hgt = 120 + rng() * 40;
            g.fillStyle = PAL.a;
            g.beginPath();
            g.moveTo(x - 22, base);
            g.lineTo(x - 10, base - hgt * 0.55);
            g.lineTo(x - 12, base - hgt);
            g.lineTo(x + 12, base - hgt);
            g.lineTo(x + 10, base - hgt * 0.55);
            g.lineTo(x + 22, base);
            g.closePath();
            g.fill();
            g.fillStyle = PAL.b;
            g.fillRect(x - 4, base - hgt, 4, hgt);
            g.fillStyle = PAL.c;
            for (let i = 0; i < 3; i++) {
                g.beginPath();
                g.ellipse(x + (i - 1) * 30, base - hgt - 6 + (i % 2) * 10,
                    30, 20, 0, 0, Math.PI * 2);
                g.fill();
            }
        }
    };
    // Band-specific item vocabulary; spacing keeps silhouettes from merging
    // into one wall across the wrap seam.
    const kinds = themeIdx === 0 ? [0, 1, 2, 0] : themeIdx === 1 ? [3, 4, 3] : [5, 5, 0];
    let x = 60 + rng() * 120;
    while (x < NEARBG_W - 60) {
        const kind = kinds[Math.floor(rng() * kinds.length)];
        for (const shift of [-NEARBG_W, 0, NEARBG_W]) trunkAt(x + shift, kind);
        x += 150 + rng() * 170;
    }
    return c;
}

// Foreground silhouette art (per band): three very dark tuft/rock/frond
// shapes hugging the bottom screen edge. Pure ink — they read as "lens-edge
// foliage", never as gameplay objects.
function buildForeArt(themeIdx) {
    const ink = THEMES[themeIdx].ink;
    const mk = (w, h, draw) => {
        const c = makeCanvas(w, h);
        const g = c.getContext('2d');
        g.fillStyle = ink;
        draw(g, w, h);
        return c;
    };
    return [
        // Grass tuft cluster: overlapping blade triangles.
        mk(96, 64, (g, w, h) => {
            const blades = [[6, 30], [18, 48], [32, 26], [46, 58], [60, 34], [74, 46], [86, 24]];
            for (const [bx, bh] of blades) {
                g.beginPath();
                g.moveTo(bx - 5, h);
                g.lineTo(bx, h - bh);
                g.lineTo(bx + 5, h);
                g.closePath();
                g.fill();
            }
        }),
        // Boulder: low rounded rock.
        mk(84, 46, (g, w, h) => {
            g.beginPath();
            g.moveTo(4, h);
            g.quadraticCurveTo(10, h * 0.35, w * 0.42, h * 0.18);
            g.quadraticCurveTo(w * 0.8, h * 0.3, w - 4, h);
            g.closePath();
            g.fill();
        }),
        // Frond/spike cluster: broad leaves (day/jungle) or agave spikes (dusk).
        mk(110, 78, (g, w, h) => {
            const cx = w / 2;
            for (let i = 0; i < 5; i++) {
                const lean = (i - 2) * (w * 0.16);
                g.beginPath();
                g.moveTo(cx - 4, h);
                g.quadraticCurveTo(cx + lean * 0.5, h * 0.4, cx + lean, h * 0.08);
                g.quadraticCurveTo(cx + lean * 0.5 + 6, h * 0.5, cx + 4, h);
                g.closePath();
                g.fill();
            }
        })
    ];
}

// Horizon haze: a slim vertical-gradient strip (transparent above -> band
// mist colour at the horizon), blitted stretched across the viewport. Baked
// once per theme; the per-frame cost is one drawImage, no gradient objects.
const HAZE_H = 80;
function buildHaze(themeIdx) {
    const c = makeCanvas(4, HAZE_H);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, HAZE_H);
    grad.addColorStop(0, withAlpha(THEMES[themeIdx].haze, 0));
    grad.addColorStop(1, withAlpha(THEMES[themeIdx].haze, 0.38));
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, HAZE_H);
    return c;
}

// Canvas widths per baked decor kind (px), used to clamp the horizontal jitter
// so an item can never straddle outside its own tile column.
const DECOR_ART_W = {
    tuft: 12, flower: 7, cactus: 12, bones: 13, pebbles: 12,
    fern: 14, mushroom: 12, speck: 5, vine: 8
};
// Per-band variant inventory of buildDecorArt (index-aligned with THEMES);
// kept in sync with the bake by the sprites.test determinism assertions.
const DECOR_VARIANTS = [
    { tuft: 3, flower: 3, vine: 3, speck: 2 },
    { cactus: 2, bones: 2, pebbles: 2, vine: 3, speck: 2 },
    { fern: 2, mushroom: 2, flower: 2, vine: 3, speck: 2 }
];

// ---------------------------------------------------------------------------
// Baked small-decor pattern canvases (look-A): every scatter kind exists as
// a handful of pre-rasterised variants at final world pixels (tile = 32), so
// the per-frame cost is ONE drawImage per placed item instead of a burst of
// fillRects + save/rotate pairs. All colours are theme-family derivations at
// muted luminance (never gameplay-salient), all shapes integer-pixel aligned,
// and every variant fits INSIDE its own tile column (or hangs into empty air
// below a shelf for strands). Deterministic bake constants — no rng needed.
// ---------------------------------------------------------------------------
function buildDecorArt(themeIdx) {
    const mk = (w, h, draw) => {
        const c = makeCanvas(w, h);
        const g = c.getContext('2d');
        draw(g);
        return c;
    };
    const bladeSet = (blades, dark, light) => mk(12, 8, (g) => {
        blades.forEach(([bx, bh], i) => {
            g.fillStyle = i % 2 ? light : dark;
            g.fillRect(bx, 8 - bh, 2, bh);
        });
    });
    const flower = (stem, petal) => mk(7, 12, (g) => {
        g.fillStyle = stem;
        g.fillRect(3, 6, 1, 6);
        g.fillRect(4, 9, 2, 1);
        g.fillStyle = petal;
        g.fillRect(2, 2, 3, 3);
    });
    const speck = (stone) => mk(5, 4, (g) => {
        g.fillStyle = stone;
        g.fillRect(0, 1, 2, 2);
        g.fillRect(3, 0, 1, 1);
    });
    // Hanging strand: trunk down the middle of an 8px column, side nubs or
    // leaves every 12px. Lengths 1–3 tiles (height clamped by the caller's
    // open-air run, canvas height bakes the max travel).
    const strand = (trunk, leaf, hasLeaves) => (len) =>
        mk(8, Math.max(10, len * 32 - 6), (g) => {
            g.fillStyle = trunk;
            g.fillRect(3, 0, 2, len * 32 - 6);
            if (hasLeaves) {
                g.fillStyle = leaf;
                for (let s = 8; s < len * 32 - 14; s += 12) {
                    const side = ((s / 12) | 0) % 2 ? 4 : 0;
                    g.fillRect(side, s, 4, 2);
                }
            } else {
                g.fillStyle = leaf;
                for (let s = 10; s < len * 32 - 12; s += 14) g.fillRect(1, s, 2, 2);
            }
        });

    if (themeIdx === 0) {
        // Day garden: grass blades, pastel flowers, pale stones, tendrils.
        const strands = [strand('#5d8a4e', '#7cc24e', true)];
        return {
            tuft: [
                bladeSet([[0, 5], [4, 7], [8, 4]], '#3f7d31', '#4c8f3a'),
                bladeSet([[1, 7], [5, 4], [9, 6]], '#3f7d31', '#4c8f3a'),
                bladeSet([[0, 4], [3, 6], [7, 7], [10, 3]], '#4c8f3a', '#5aa03c')
            ],
            flower: BAND_PETALS[0].map(p => flower('#3f7d31', p)),
            speck: [speck('#9aa4ad'), speck('#b3bcac')],
            vine: [1, 2, 3].map(len => strands[0](len))
        };
    }
    if (themeIdx === 1) {
        // Dusk desert: ribbed cacti, sun-bleached bones, terracotta chips.
        const cactus = (armL, armR) => mk(12, 16, (g) => {
            g.fillStyle = '#5d8a4e';
            g.fillRect(4, 2, 4, 14);
            if (armL) { g.fillRect(0, 7, 4, 3); g.fillRect(0, 3, 3, 5); }
            if (armR) { g.fillRect(8, 9, 4, 3); g.fillRect(9, 5, 3, 5); }
            g.fillStyle = 'rgba(28,52,24,0.35)';
            g.fillRect(5, 3, 1, 13);
        });
        return {
            cactus: [cactus(true, false), cactus(true, true)],
            bones: [
                mk(13, 6, (g) => {
                    g.fillStyle = '#e8dcc0';
                    g.fillRect(0, 3, 13, 2);
                    g.fillRect(2, 0, 2, 4);
                    g.fillRect(6, 1, 2, 3);
                    g.fillRect(10, 0, 2, 4);
                }),
                mk(9, 5, (g) => {
                    g.fillStyle = '#ddd0b2';
                    g.fillRect(0, 2, 9, 2);
                    g.fillRect(1, 0, 2, 3);
                    g.fillRect(5, 1, 2, 3);
                })
            ],
            pebbles: [
                mk(12, 4, (g) => {
                    g.fillStyle = '#a5765a';
                    g.fillRect(0, 1, 6, 3);
                    g.fillRect(7, 2, 4, 2);
                    g.fillStyle = 'rgba(255,226,178,0.35)';
                    g.fillRect(1, 1, 3, 1);
                }),
                mk(9, 3, (g) => {
                    g.fillStyle = '#9c6e52';
                    g.fillRect(0, 1, 5, 2);
                    g.fillRect(6, 0, 3, 3);
                })
            ],
            speck: [speck('#a5765a'), speck('#8a5c40')],
            vine: [1, 2, 3].map(len => strand('#8a6238', '#a8794f', false)(len))
        };
    }
    // Jungle moss: fern fans, capped mushrooms, blossom + heavy vines.
    const fern = (lean) => mk(14, 14, (g) => {
        g.fillStyle = '#3f8f52';
        for (const l of [-lean, 0, lean]) {
            g.beginPath();
            g.moveTo(6, 14);
            g.lineTo(6 + l, 1);
            g.lineTo(9, 14);
            g.closePath();
            g.fill();
        }
        g.fillStyle = 'rgba(16,56,32,0.35)';
        g.fillRect(7, 4, 1, 10);
    });
    return {
        fern: [fern(5), fern(3)],
        mushroom: [
            mk(12, 9, (g) => {
                g.fillStyle = '#d8c9a8';
                g.fillRect(2, 4, 3, 5);
                g.fillRect(8, 6, 2, 3);
                g.fillStyle = '#b06a4a';
                g.fillRect(0, 1, 7, 4);
                g.fillRect(6, 3, 6, 3);
                g.fillStyle = '#f2e6cc';
                g.fillRect(2, 2, 2, 1);
            }),
            mk(8, 7, (g) => {
                g.fillStyle = '#d8c9a8';
                g.fillRect(3, 3, 2, 4);
                g.fillStyle = '#a05f42';
                g.fillRect(1, 1, 6, 3);
                g.fillStyle = '#eeddbb';
                g.fillRect(2, 2, 2, 1);
            })
        ],
        flower: BAND_PETALS[2].map(p => flower('#2f6b3e', p)),
        speck: [speck('#5d7263'), speck('#74877a')],
        vine: [1, 2, 3].map(len => strand('#2f6b3e', '#4c8f4e', true)(len))
    };
}

// Signature props per band (one larger identity object standing on exposed
// ground where there is >=3 tiles of headroom): day lone tree, dusk saguaro,
// jungle bamboo cluster. Baked at final pixel size; canopy/arms stay within
// 3 tiles so they can never visually block a jump arc (placement rule in
// _ensureDecor enforces the clearance).
const PROP_H = 92; // <= 3 tiles at TILE_SIZE 32
function buildPropArt(themeIdx) {
    const variants = [];
    for (let v = 0; v < 2; v++) {
        const rng = makeRng(0xBEEF00 + themeIdx * 31 + v * 7);
        if (themeIdx === 0) {
            // Tree: warm trunk, three-blob canopy, bare lower trunk so the
            // walk line stays readable through it.
            const c = makeCanvas(64, PROP_H);
            const g = c.getContext('2d');
            g.fillStyle = '#6b4a2e';
            g.fillRect(29, PROP_H - 44, 6, 44);
            g.fillRect(24, PROP_H - 52, 16, 10);
            const blobs = [[20, 30], [40, 26], [30, 16]];
            for (const [bx, by] of blobs) {
                g.fillStyle = by < 20 ? '#4c8f3a' : '#3f7d31';
                g.beginPath();
                g.arc(bx + (rng() - 0.5) * 6, by + (rng() - 0.5) * 6, 17 + rng() * 5, 0, Math.PI * 2);
                g.fill();
            }
            variants.push(c);
        } else if (themeIdx === 1) {
            // Saguaro: ribbed column with one or two raised arms.
            const c = makeCanvas(44, PROP_H);
            const g = c.getContext('2d');
            g.fillStyle = '#5d8a4e';
            g.fillRect(18, 14, 9, PROP_H - 14);
            g.beginPath();
            g.arc(22.5, 14, 4.5, 0, Math.PI * 2);
            g.fill();
            const arm = (dir) => {
                const ax = dir < 0 ? 8 : 30;
                const ay = 34 + rng() * 18;
                g.fillRect(dir < 0 ? 12 : 26, ay, 12, 6);
                g.fillRect(ax, ay - 16, 6, 22);
                g.beginPath();
                g.arc(ax + 3, ay - 16, 3, 0, Math.PI * 2);
                g.fill();
            };
            arm(-1);
            if (v === 1) arm(1);
            g.fillStyle = 'rgba(30,52,26,0.35)';
            g.fillRect(21, 16, 1, PROP_H - 18);
            variants.push(c);
        } else {
            // Bamboo cluster: three segmented culms with leaf dabs.
            const c = makeCanvas(36, PROP_H);
            const g = c.getContext('2d');
            for (let s = 0; s < 3; s++) {
                const sx = 6 + s * 11 + (rng() - 0.5) * 4;
                const top = 6 + rng() * 14;
                g.fillStyle = s === 1 ? '#5f9e52' : '#4c8a46';
                g.fillRect(sx, top, 4, PROP_H - top);
                g.fillStyle = 'rgba(20,60,30,0.5)';
                for (let n = top + 8; n < PROP_H - 4; n += 12) g.fillRect(sx, n, 4, 2);
                g.fillStyle = '#6fb45e';
                g.fillRect(sx - 4, top + 2, 5, 2);
                g.fillRect(sx + 4, top + 8, 5, 2);
            }
            variants.push(c);
        }
    }
    return variants;
}

// Sun/moon: crisp core disc inside a soft radial halo, baked once per level
// (drawn with a slow ~2%-of-scroll parallax drift, never wraps). Moon kind
// gets flat crater dabs (integer pixel style, no gradients beyond the halo)
// so it reads as MOON at a glance even in a thumbnail.
function buildDisc(disc) {
    const size = disc.r * 4;
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const haloA = disc.kind === 'moon' ? 0.4 : 0.55;
    const grad = g.createRadialGradient(
        size / 2, size / 2, disc.r * 0.5, size / 2, size / 2, size / 2);
    grad.addColorStop(0, withAlpha(disc.halo, haloA));
    grad.addColorStop(0.45, withAlpha(disc.halo, haloA * 0.4));
    grad.addColorStop(1, withAlpha(disc.halo, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.fillStyle = withAlpha(disc.core, 0.95);
    g.beginPath();
    g.arc(size / 2, size / 2, disc.r, 0, Math.PI * 2);
    g.fill();
    if (disc.kind === 'moon') {
        // Three shallow craters, darker than the core by one step of the
        // halo hue — deterministic placement (bake-time constant geometry).
        g.fillStyle = withAlpha(disc.halo, 0.55);
        const r = disc.r;
        g.fillRect(size / 2 - r * 0.45, size / 2 - r * 0.3, r * 0.34, r * 0.34);
        g.fillRect(size / 2 + r * 0.1, size / 2 + r * 0.15, r * 0.5, r * 0.5);
        g.fillRect(size / 2 - r * 0.15, size / 2 + r * 0.5, r * 0.26, r * 0.26);
    }
    return c;
}

// Sparse night stars for the dusk band: 1–2px dots at hashed positions in a
// 1024×300 wrap band, alpha varied two-step so the field twinkles as a whole
// without any per-star animation cost. Placement data is also returned so
// determinism can be asserted without rasterising.
const STARS_W = 1024;
const STARS_H = 300;
function buildStars(rng, count, color) {
    const pts = [];
    for (let i = 0; i < count; i++) {
        pts.push({
            x: Math.floor(rng() * STARS_W),
            y: Math.floor(rng() * STARS_H * 0.85),
            s: rng() < 0.75 ? 1 : 2,
            a: 0.5 + (rng() < 0.5 ? 0 : 0.3)
        });
    }
    if (!RASTER_OK) return { canvas: null, points: pts };
    const c = makeCanvas(STARS_W, STARS_H);
    const g = c.getContext('2d');
    for (const p of pts) {
        g.globalAlpha = p.a;
        g.fillStyle = color;
        g.fillRect(p.x, p.y, p.s, p.s);
    }
    return { canvas: c, points: pts };
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

// Coin life (look-A): spin period ~1.2 s with a per-index phase offset, and
// a 2px white cross glint roughly every 3 s per coin, staggered by index so
// a row of coins twinkles instead of blinking in lockstep. Pure predicates
// (clock + index only) so tests can pin the cadence without a canvas.
export const COIN_SPIN_PERIOD = 1.2;
export const COIN_GLINT_PERIOD = 3.0;
export const COIN_GLINT_WINDOW = 0.12;
export function coinGlintAt(clock, index) {
    return ((clock + index * 1.37) % COIN_GLINT_PERIOD) < COIN_GLINT_WINDOW;
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
        // Per-theme terrain material sets (body/interior variants + cap).
        this._terrainArt = [null, null, null];
        // Per-theme foreground silhouette art + signature prop canvases.
        this._foreArt = [null, null, null];
        this._propArt = [null, null, null];
        // Per-theme baked small-decor pattern canvases (look-A).
        this._decorArt = [null, null, null];
        // Buried-tile ambient-occlusion depth map, rebuilt only when the
        // level instance swaps (same guard style as _decor).
        this._aoSource = null;
        this._aoDepth = null;
        // Screen-space vignette gradient, rebuilt only on viewport resize.
        this._vigCache = [null, null, null];
        // Grass-top decor list, rebuilt only when the level instance swaps.
        this._decor = [];
        this._decorSource = null;
        // Grid reference set by drawWorld each frame; the entity drop-shadow
        // probes read it (drawWorld always runs before entities in main.draw).
        this._level = null;
        // Glow sprites keyed by colour string.
        this._glows = {};
        // Baked hero canvases (see buildHeroCanvases); undefined = not yet
        // attempted, null = raster unavailable in this environment. Baked on
        // first draw so steady-state frames only blit + transform.
        this._hero = undefined;

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

    // Aesthetic wave 2 — upper-sky depth cue. On tall (vertical) maps the
    // camera climbs far above the ground line while the base gradient stays
    // screen-fixed, so every altitude looks like the same afternoon. When the
    // world floor drops out below the viewport we blend a zenith-toned
    // overlay in from the top of the screen, strengthening with climb height
    // (quantised to 20 px buckets so the cache rebuilds rarely). The trigger
    // is floor VISIBILITY, not orientation: it fires whenever the world
    // floor sinks >64 px below the viewport bottom, which horizontal maps
    // never do (their floor stays framed by the camera clamp) — so those
    // render byte-identical to before. Purely render-side: no rng, no state.
    _zenithOverlay(ctx, themeIdx, viewH, altPx) {
        const bucket = Math.min(8, Math.floor((altPx - 64) / 20));
        const key = `${themeIdx}:${bucket}`;
        const cached = this._zenithCache?.[key];
        if (cached && cached.h === viewH) return cached.grad;
        const t = THEMES[themeIdx];
        // A full vertical map pans the ground line roughly one viewport past
        // the screen bottom, so the usable signal lives in the first couple
        // hundred px: reach full strength there rather than stretching it
        // thin over a never-seen 512 px ramp.
        const strength = Math.min(1, bucket * 20 / 140) * 0.6;
        const grad = ctx.createLinearGradient(0, 0, 0, viewH * 0.85);
        grad.addColorStop(0, withAlpha(t.zenith, strength));
        grad.addColorStop(1, withAlpha(t.zenith, 0));
        (this._zenithCache ??= {})[key] = { h: viewH, grad };
        return grad;
    }

    // Per-level atmosphere kit: sun/moon disc + three cloud bands + twin hill
    // ridges + near-background biome structures + horizon haze + night stars +
    // foreground placement list, all baked into offscreen canvases from a
    // PRNG seeded by the LEVEL SEED (render-only hash of it — never the
    // generation rng stream), so the same map always gets the same sky and
    // hills across frames and retries. Rebuilt only when the level instance
    // changes (once per level). `placements` carries every random NUMBER in
    // plain data so determinism is assertable without rasterising.
    _ensureBackdrop(levelNumber, themeIdx, seed = null) {
        const seedKey = (seed === null || seed === undefined)
            ? Math.imul(levelNumber, 0x9E3779B1) >>> 0
            : seed >>> 0;
        if (this._backdrop && this._backdrop.levelNumber === levelNumber &&
            this._backdrop.seedKey === seedKey) {
            return this._backdrop;
        }
        const theme = THEMES[themeIdx];
        const rng = makeRng(seedKey ^ 0xA17AC391);
        // Sun/moon home: hashed inside the SAFE UPPER-SKY band (y 14–30% of
        // the viewport, x 12–88%) — above every platform the player stands
        // on, below the HUD plate row, and never at gameplay height.
        const discPos = { x: 0.12 + rng() * 0.76, y: 0.14 + rng() * 0.16 };
        // Foreground tuft placements live on the same 1024px wrap band as the
        // silhouettes; sparse on purpose (the strip frames play, never fills).
        const fore = [];
        const foreCount = 5 + Math.floor(rng() * 3);
        for (let i = 0; i < foreCount; i++) {
            fore.push({
                a: Math.floor(rng() * 3),
                x: rng() * NEARBG_W,
                // Scale cap 1.15 (review F-1): at zoom=1 the tallest tufts
                // from the old 1.35 ceiling grazed the lowest standing plane
                // by ~3px, blurring the foreground/gameplay separation the
                // strip exists to create.
                s: 0.65 + rng() * 0.5,
                ph: rng() * Math.PI * 2,
                k: 0.6 + rng() * 0.8
            });
        }
        const stars = theme.stars ? buildStars(rng, theme.starDensity, theme.starColor) : null;
        // Headless runs (bun test / happy-dom): placements above are final;
        // the pixel bakers below are skipped — nothing consumes rng after
        // them, so placements stay byte-identical to a browser run.
        const bake = RASTER_OK;
        this._backdrop = {
            levelNumber,
            seedKey,
            disc: bake ? buildDisc(theme.disc) : null,
            discPos,
            cloudsFar: bake ? buildCloudBand(rng, 1024, 110, 5, theme.cloud, 0.5) : null,
            cloudsMid: bake ? buildCloudBand(rng, 1024, 130, 7, theme.cloud, 0.72) : null,
            cloudsLow: bake ? buildCloudBand(rng, 1024, 80, 6, theme.cloud, 0.45) : null,
            hills: bake ? buildHills(rng, 1024, 170, theme.hillFar, theme.hillNear) : null,
            nearBg: bake ? buildNearBg(rng, themeIdx) : null,
            fore,
            stars,
            haze: bake ? buildHaze(themeIdx) : null,
            // Pure mirror of every random number consumed above, for tests
            // and harnesses (no canvas access required).
            placements: { seedKey, discPos, fore, stars: stars ? stars.points : [] }
        };
        return this._backdrop;
    }

    // Parallax sky: cached vertical gradient, night stars, sun/moon, three
    // cloud bands (factors 0.05/0.12/0.25 of cameraX, all BEHIND the hill
    // silhouettes at 0.35), hill ridges resting on the horizon, and the
    // sheet's ground strip (0.5). Vertical camera travel nudges each sky
    // stratum gently downward by a fraction of the climb (nearer strata move
    // more) so ascending reads as gaining altitude even before the zenith
    // overlay takes over. worldBottomScreen is the on-screen y of the level's
    // bottom edge: when it sits above the viewport floor (short levels, tall
    // windows) the ground silhouette anchors there and deep-ground fill covers
    // the remainder, so terrain rests on earth instead of floating on sky.
    // `seed` (the level's generation seed) re-hashes the sky/hill/star layout
    // — render-only: same seed => same backdrop, every frame, every retry.
    drawBackground(ctx, levelNumber, cameraX, viewW, viewH,
        worldBottomScreen = Infinity, seed = null) {
        const themeIdx = (Math.max(1, levelNumber) - 1) % THEMES.length;
        const theme = THEMES[themeIdx];
        ctx.fillStyle = this._skyGradient(ctx, themeIdx, viewH);
        ctx.fillRect(0, 0, viewW, viewH);
        // Upper-sky depth cue: strengthen toward zenith as the ground line
        // falls further below the viewport (vertical climbs only).
        const altPx = Number.isFinite(worldBottomScreen) ? worldBottomScreen - viewH : 0;
        if (altPx > 64) {
            ctx.fillStyle = this._zenithOverlay(ctx, themeIdx, viewH, altPx);
            ctx.fillRect(0, 0, viewW, viewH * 0.85);
        }
        if (!this.images.backgrounds) return;

        const bd = this._ensureBackdrop(levelNumber, themeIdx, seed);
        // Horizon line shared by hills and the ground strip.
        const groundH = 24 * 2;
        const bandY = Math.min(viewH - groundH, worldBottomScreen);
        // Climb nudge per stratum: capped so no band ever slides past the
        // horizon it should sit above.
        const rise = (k, cap) => Math.min(cap, Math.max(0, altPx * k));

        // Night stars ride the deepest parallax with a whole-field shimmer
        // (one globalAlpha read per frame — no per-star animation cost).
        if (bd.stars) {
            ctx.save();
            ctx.globalAlpha = 0.72 + 0.16 * Math.sin(this.clock * 0.7);
            this._blitWrapped(ctx, bd.stars.canvas, cameraX * 0.02,
                rise(0.02, 40), viewW);
            ctx.restore();
        }

        // Sun/moon: hashed home in the safe upper-sky band plus a few pixels
        // of drift across a whole level width (factor 0.02) — too slow to
        // ever wrap visibly, and never low enough to crowd a platform.
        ctx.drawImage(bd.disc,
            viewW * bd.discPos.x - cameraX * 0.02 - bd.disc.width / 2,
            viewH * bd.discPos.y + rise(0.03, 50) - bd.disc.height / 2);

        this._blitWrapped(ctx, bd.cloudsFar, cameraX * 0.05,
            viewH * 0.06 + rise(0.04, 60), viewW);
        this._blitWrapped(ctx, bd.cloudsMid, cameraX * 0.12,
            viewH * 0.2 + rise(0.07, 80), viewW);
        this._blitWrapped(ctx, bd.cloudsLow, cameraX * 0.25,
            bandY - bd.cloudsLow.height - 10 + rise(0.10, 44), viewW);
        this._blitWrapped(ctx, bd.hills, cameraX * 0.35,
            bandY - bd.hills.height + 12, viewW);
        // Horizon mist fogs the ridgeline (distance cue) before anything
        // nearer draws over it.
        ctx.drawImage(bd.haze, 0, bandY - HAZE_H, viewW, HAZE_H);

        // Ground silhouette: ×2 scale, factor 0.5, anchored to the world
        // bottom when that is on screen, else to the viewport floor.
        this._tileStrip(ctx, this.images.backgrounds, theme.x, 48, theme.w, 24,
            groundH, cameraX * 0.5, bandY, viewW);
        if (bandY + groundH < viewH) {
            ctx.fillStyle = theme.ground;
            ctx.fillRect(0, bandY + groundH, viewW, viewH - bandY - groundH);
        }
        // Near-background biome structures (factor 0.55 — nearer than the
        // ground strip they stand on): windmill/hayrolls/tree clumps by day,
        // mesa arches + ruined towers at dusk, giant trunks in the jungle.
        // Saturated but low-contrast silhouettes rooted at the horizon, so
        // they never occupy gameplay heights where a platform could be
        // mistaken for one.
        this._blitWrapped(ctx, bd.nearBg, cameraX * 0.55,
            bandY - bd.nearBg.height + 14, viewW);
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

    // World-space mood wash (light & mood pass): a per-band translucent veil
    // over everything drawn so far this frame — sky, parallax strata, terrain
    // material and props — unifying the palette. Call it inside the world
    // transform BETWEEN drawWorld and the entity pass: entities (coins,
    // enemies, player) paint afterwards at full contrast, preserving the
    // hazard-readability ruling. The rect is padded past the viewport so the
    // death shake never exposes an untinted edge.
    drawMoodTint(ctx, levelNumber, cameraX, cameraY, effW, effH) {
        const theme = THEMES[(Math.max(1, levelNumber) - 1) % THEMES.length];
        ctx.fillStyle = theme.mood;
        ctx.fillRect(cameraX - 16, -cameraY - 16, effW + 32, effH + 32);
    }

    // Foreground silhouette strip (~1.15 parallax, screen space): sparse dark
    // tufts/rocks/fronds hugging the very bottom viewport edge with a lazy
    // sway. They frame the play area from the near side; they never enter the
    // camera's gameplay band centre or the HUD corner. `seed` must match the
    // one passed to drawBackground or the shared backdrop cache would thrash.
    drawForeground(ctx, levelNumber, cameraX, viewW, viewH, seed = null) {
        const themeIdx = (Math.max(1, levelNumber) - 1) % THEMES.length;
        const bd = this._ensureBackdrop(levelNumber, themeIdx, seed);
        const art = this._foreArt[themeIdx] ?? buildForeArt(themeIdx);
        this._foreArt[themeIdx] = art;
        ctx.save();
        ctx.globalAlpha = 0.85;
        const base = wrapOffset(Math.round(cameraX * 1.15), NEARBG_W);
        const reps = Math.ceil(viewW / NEARBG_W) + 1;
        for (const f of bd.fore) {
            const img = art[f.a];
            const w = img.width * f.s;
            const h = img.height * f.s;
            for (let rep = 0; rep <= reps; rep++) {
                const sx = base + f.x + rep * NEARBG_W;
                if (sx < -w || sx > viewW + w) continue;
                ctx.save();
                ctx.translate(sx, viewH + 2);
                ctx.rotate(Math.sin(this.clock * f.k + f.ph) * 0.03);
                ctx.drawImage(img, -w / 2, -h + 4, w, h);
                ctx.restore();
            }
        }
        ctx.restore();
    }

    // Very subtle screen-space vignette (corner alpha <= 0.12): pulls focus
    // toward the centre without dimming anything the player must react to.
    // Gradient rebuilt only when the viewport size changes.
    drawVignette(ctx, levelNumber, viewW, viewH) {
        const themeIdx = (Math.max(1, levelNumber) - 1) % THEMES.length;
        const theme = THEMES[themeIdx];
        let entry = this._vigCache[themeIdx];
        if (!entry || entry.w !== viewW || entry.h !== viewH) {
            const grad = ctx.createRadialGradient(
                viewW / 2, viewH * 0.46, Math.min(viewW, viewH) * 0.42,
                viewW / 2, viewH * 0.46, Math.max(viewW, viewH) * 0.72);
            grad.addColorStop(0, 'rgba(8,10,20,0)');
            grad.addColorStop(1, withAlpha('#0a0e1c', theme.vignette));
            entry = this._vigCache[themeIdx] = { w: viewW, h: viewH, grad };
        }
        ctx.fillStyle = entry.grad;
        ctx.fillRect(0, 0, viewW, viewH);
    }

    // Per-theme terrain art: four surface/body variants + four mottled
    // interior variants + a baked surface cap, all derived once from the
    // sheet's dirt cell through the TERRAIN_MATS recipe (veil colour +
    // directional grain).
    // The tile-grid hash picks a variant, so masses get stable texture
    // variation without per-frame draws and without flicker. Interior tiles
    // (solid on all four sides) use the darker, flatter variants: exposed
    // faces carry detail, buried mass reads as deep volume.
    _ensureTerrainArt(themeIdx) {
        if (this._terrainArt[themeIdx]) return this._terrainArt[themeIdx];
        const mat = TERRAIN_MATS[themeIdx];
        const rect = sheetRect('tiles', TILES.DIRT);
        const bakeBody = (v, interior) => {
            const c = makeCanvas(rect.sw, rect.sh);
            const g = c.getContext('2d');
            g.drawImage(this.images.tiles, rect.sx, rect.sy, rect.sw, rect.sh,
                0, 0, rect.sw, rect.sh);
            if (mat.veil) {
                g.fillStyle = mat.veil;
                g.fillRect(0, 0, rect.sw, rect.sh);
            }
            const rng = makeRng(0xD117E ^ Math.imul(v + 1 + (interior ? 97 : 0), 0x9E3779B1));
            if (mat.grain === 'dark') {
                for (let i = 0; i < 4; i++) {
                    // Mostly dark grain, one light fleck per variant.
                    g.fillStyle = i === 3 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.16)';
                    g.fillRect(Math.floor(rng() * (rect.sw - 2)),
                        Math.floor(rng() * (rect.sh - 2)), 2, 2);
                }
            } else if (mat.grain === 'strata') {
                // Horizontal sediment lines: two dark beds + one lit seam.
                for (let i = 0; i < 2; i++) {
                    const y = 2 + Math.floor(rng() * (rect.sh - 4));
                    g.fillStyle = 'rgba(112,54,26,0.30)';
                    g.fillRect(0, y, rect.sw, 1 + (rng() < 0.4 ? 1 : 0));
                }
                g.fillStyle = 'rgba(255,226,178,0.16)';
                g.fillRect(0, 1 + Math.floor(rng() * (rect.sh - 2)), rect.sw, 1);
                // Chipped corners keep the blocky faces from looking stamped.
                g.fillStyle = 'rgba(96,44,20,0.24)';
                g.fillRect(Math.floor(rng() * (rect.sw - 3)),
                    Math.floor(rng() * (rect.sh - 3)), 3, 2);
            } else {
                // Vertical grain: root streaks down the whole cell. Two
                // soft streaks (not three hard ones) so tiled masses never
                // pulse into a picket-fence rhythm.
                for (let i = 0; i < 2; i++) {
                    g.fillStyle = 'rgba(8,42,24,0.18)';
                    g.fillRect(Math.floor(rng() * (rect.sw - 2)), 0, 2, rect.sh);
                }
                g.fillStyle = 'rgba(198,232,176,0.10)';
                g.fillRect(Math.floor(rng() * rect.sw), 0, 1, rect.sh);
            }
            if (interior) {
                // Buried: flatten the texture back out under a deep veil.
                g.fillStyle = mat.interiorVeil;
                g.fillRect(0, 0, rect.sw, rect.sh);
                // Aesthetic wave 2 — hash-of-cell mottling: the grid hash
                // picks one of four baked interiors, each carrying its own
                // stable dab pattern (mostly dark void pockets + one lit
                // mineral fleck), so buried mass reads as volume instead of
                // a flat fill. Baked per biome at load; zero per-frame cost.
                const mrng = makeRng(0x8CCED ^ Math.imul(v + 1, 0x9E3779B1));
                for (let i = 0; i < 6; i++) {
                    g.fillStyle = i === 5 ? mat.mottleLight : mat.mottleDark;
                    g.fillRect(Math.floor(mrng() * (rect.sw - 2)),
                        Math.floor(mrng() * (rect.sh - 2)),
                        2, i === 5 ? 1 : 2);
                }
            }
            return c;
        };
        const body = [];
        for (let v = 0; v < 4; v++) body.push(bakeBody(v, false));
        const interior = [];
        for (let v = 0; v < 4; v++) interior.push(bakeBody(v, true));
        this._terrainArt[themeIdx] = { body, interior, cap: this._buildCapArt(themeIdx) };
        return this._terrainArt[themeIdx];
    }

    // Surface cap strip baked at source resolution (18px wide): rows above
    // CAP_OVER hang into the air cell (grass blades / moss fringe), rows below
    // form the standable lip. Each band gets its own material voice: bright
    // grass over the sheet cap (day), stratified sandstone steps (dusk),
    // mossy greens with hanging filaments (jungle).
    _buildCapArt(themeIdx) {
        const c = makeCanvas(18, CAP_H);
        const g = c.getContext('2d');
        const rng = makeRng(0xCAFE0 + themeIdx * 7919);
        if (themeIdx === 0) {
            // Day: the sheet's verified grass band, lifted below the blades.
            const cap = sheetRect('tiles', TILES.GRASS_TOP);
            g.drawImage(this.images.tiles,
                cap.sx, cap.sy + GRASS_BAND_Y, cap.sw, GRASS_BAND_H,
                0, CAP_OVER, 18, GRASS_BAND_H);
            for (let i = 0; i < 4; i++) {
                g.fillStyle = i % 2 ? '#7cc24e' : '#5aa03c';
                g.fillRect(Math.floor(rng() * 17), CAP_OVER - (2 + Math.floor(rng() * 3)),
                    1, 2 + Math.floor(rng() * 3));
            }
            // Aesthetic wave 2: two-tone sunlit-shoulder row under the grass.
            // The lit row reads as soil catching the same light as the blades;
            // the shade row below it separates cap from body so stacked
            // surfaces never merge into one flat green-brown slab.
            g.fillStyle = '#b9895a';
            g.fillRect(0, CAP_OVER + GRASS_BAND_H, 18, 1);
            g.fillStyle = '#8a6238';
            g.fillRect(0, CAP_OVER + GRASS_BAND_H + 1, 18, 1);
        } else if (themeIdx === 1) {
            // Dusk: sunlit sandstone lip stepping down through strata.
            g.fillStyle = '#f4cf94'; g.fillRect(0, CAP_OVER, 18, 2);
            g.fillStyle = '#d99a5e'; g.fillRect(0, CAP_OVER + 2, 18, 2);
            g.fillStyle = '#b06a3c'; g.fillRect(0, CAP_OVER + 4, 18, 2);
            g.fillStyle = '#8f5230'; g.fillRect(0, CAP_OVER + 6, 18, 2);
            // Blocky tonal breaks so stacked caps never look like one rail.
            for (let i = 0; i < 3; i++) {
                g.fillStyle = 'rgba(122,62,30,0.5)';
                g.fillRect(Math.floor(rng() * 14), CAP_OVER + 1 + Math.floor(rng() * 6),
                    2 + Math.floor(rng() * 3), 1);
            }
        } else {
            // Jungle: bright moss dabs over a deep green body, filaments up.
            g.fillStyle = '#4c8f4e'; g.fillRect(0, CAP_OVER, 18, 3);
            g.fillStyle = '#2f6b3e'; g.fillRect(0, CAP_OVER + 3, 18, 3);
            g.fillStyle = '#20502f'; g.fillRect(0, CAP_OVER + 6, 18, 2);
            for (let i = 0; i < 5; i++) {
                g.fillStyle = i % 2 ? '#77c46a' : '#8fd47e';
                g.fillRect(Math.floor(rng() * 16), CAP_OVER, 2, 1);
            }
            for (let i = 0; i < 3; i++) {
                g.fillStyle = '#3f7d43';
                g.fillRect(Math.floor(rng() * 17), CAP_OVER - (2 + Math.floor(rng() * 2)),
                    1, 2 + Math.floor(rng() * 2));
            }
        }
        return c;
    }

    // Prop scatter list: small growth (per-band kinds), signature props
    // (lone tree / saguaro / bamboo) and hanging strands under shelf faces,
    // precomputed ONCE per level instance from a level-seeded PRNG and reused
    // every frame. Look-A densities (owner brief): grass tufts ≈15% of
    // eligible top cells, flowers ≈5% (max 3 per contiguous shelf, ≥4 cells
    // apart), pebble specks ≈8% of exposed dirt flanks, hanging strands ≈10%
    // of open shelf undersides on EVERY band. Exclusion rules: only pure sky
    // above (never under an overhang or next to stacked terrain), never
    // within one cell of a spike, and signature props additionally need three
    // clear tiles of headroom plus a two-cell spike margin — decoration must
    // never crowd a hazard or block a jump line.
    _ensureDecor(level) {
        if (this._decorSource === level) return this._decor;
        const decor = [];
        const themeIdx = (Math.max(1, level.levelNumber) - 1) % THEMES.length;
        const rng = makeRng(Math.imul(level.levelNumber, 0x51F3B6A1) ^ 0xB3D7B9F2);
        const spikeNear = (tx, ty, r) => {
            for (let y = ty - r; y <= ty + r; y++) {
                if (y < 0 || y >= level.height) continue;
                for (let x = tx - r; x <= tx + r; x++) {
                    if (x < 0 || x >= level.width) continue;
                    if (level.tiles[y][x] === 2) return true;
                }
            }
            return false;
        };
        const openAbove = (tx, ty, n) => {
            for (let y = ty - n; y < ty; y++) {
                if (y < 0 || level.tiles[y][tx] !== 0) return false;
            }
            return true;
        };
        // Canyon canopy cells never host surface growth: cactus/battlement
        // art on an overhead slab top sells it as a floating island and
        // kills the corridor read (level.exposeCeilingSpans marks the rects;
        // empty list on every other map). Ceiling STRANDS below stay — hanging
        // greenery reads as canopy, not as walkable ground.
        const ceilSpans = typeof level.exposeCeilingSpans === 'function'
            ? level.exposeCeilingSpans() : [];
        const onCeiling = (tx, ty) => {
            for (const s of ceilSpans) {
                if (tx >= s.x0 && tx <= s.x1 && ty >= s.yTop && ty <= s.yBot) {
                    return true;
                }
            }
            return false;
        };
        // Cumulative kind picks per band (small growth only). The first entry
        // doubles as the flower-downgrade target when a shelf is already at
        // its flower budget.
        const KINDS = [
            [['tuft', 0.75], ['flower', 0.25]],
            [['cactus', 0.5], ['bones', 0.25], ['pebbles', 0.25]],
            [['fern', 0.6], ['mushroom', 0.25], ['flower', 0.15]]
        ][themeIdx];
        const SIGNATURE = ['tree', 'bigcactus', 'bamboo'][themeIdx];
        // Flower shelf budget: max 3 per contiguous exposed run, ≥4 cells
        // apart (a wide ledge gets a sparse sprinkle, never a flowerbed).
        let flowerLastTx = -99;
        let flowerRunCount = 0;
        let prevEligibleTx = -99;
        for (let ty = 1; ty < level.height; ty++) {
            for (let tx = 0; tx < level.width; tx++) {
                if (level.tiles[ty][tx] !== 1 || level.tiles[ty - 1][tx] !== 0) continue;
                if (spikeNear(tx, ty, 1)) continue;
                if (onCeiling(tx, ty)) continue;
                if (tx !== prevEligibleTx + 1) { flowerLastTx = -99; flowerRunCount = 0; }
                prevEligibleTx = tx;
                if (rng() <= 0.20) {
                    let roll = rng();
                    let kind = KINDS[KINDS.length - 1][0];
                    for (const [name, weight] of KINDS) {
                        if (roll < weight) { kind = name; break; }
                        roll -= weight;
                    }
                    if (kind === 'flower') {
                        if (tx - flowerLastTx < 4 || flowerRunCount >= 3) {
                            kind = KINDS[0][0];   // back off to plain growth
                        } else {
                            flowerLastTx = tx;
                            flowerRunCount++;
                        }
                    }
                    const variants = DECOR_VARIANTS[themeIdx][kind];
                    decor.push({
                        tx, ty, kind,
                        v: Math.floor(rng() * variants),
                        ox: Math.floor(rng() * (32 - DECOR_ART_W[kind])),
                        ph: rng() * Math.PI * 2
                    });
                } else if (rng() <= 0.05 && openAbove(tx, ty, 3) && !spikeNear(tx, ty, 2)) {
                    // Signature prop: identity object with guaranteed air
                    // space above so its silhouette can never be mistaken
                    // for, or obstruct, a platform hop.
                    decor.push({
                        tx, ty, kind: SIGNATURE,
                        ox: 0, v: Math.floor(rng() * 2),
                        ph: rng() * Math.PI * 2
                    });
                }
            }
        }
        // Pebble specks on exposed dirt FLANKS (the vertical faces of runs):
        // dedicated stream so they never perturb the surface sequence.
        const prng = makeRng((Math.imul(level.levelNumber, 0x51F3B6A1) ^ 0xB3D7B9F2) + 2);
        for (let ty = 0; ty < level.height; ty++) {
            for (let tx = 0; tx < level.width; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                const leftAir = tx === 0 || level.tiles[ty][tx - 1] !== 1;
                const rightAir = tx === level.width - 1 || level.tiles[ty][tx + 1] !== 1;
                if (!leftAir && !rightAir) continue;
                if (onCeiling(tx, ty)) continue;
                if (prng() > 0.08 || spikeNear(tx, ty, 1)) continue;
                decor.push({
                    tx, ty, kind: 'speck', v: Math.floor(prng() * 2),
                    side: leftAir && !rightAir ? -1 : (rightAir && !leftAir ? 1
                        : (prng() < 0.5 ? -1 : 1)),
                    oy: 14 + Math.floor(prng() * 12)
                });
            }
        }
        // Hanging strands under shelf faces into open air, on EVERY band
        // (look-A): jungle keeps leafy vines, day grows thin tendrils, dusk
        // dry desert grass-ropes. Separate RNG stream so adding them never
        // perturbs the ground scatter sequence.
        const vrng = makeRng((Math.imul(level.levelNumber, 0x51F3B6A1) ^ 0xB3D7B9F2) + 1);
        for (let ty = 0; ty < level.height - 1; ty++) {
            for (let tx = 0; tx < level.width; tx++) {
                if (level.tiles[ty][tx] !== 1 || level.tiles[ty + 1][tx] !== 0) continue;
                if (vrng() > 0.10 || spikeNear(tx, ty + 1, 1)) continue;
                let len = 1 + Math.floor(vrng() * 3);
                while (len > 0 && ty + 1 + len < level.height &&
                    level.tiles[ty + 1 + len][tx] !== 0) len--;
                if (len <= 0) continue;
                decor.push({
                    tx, ty: ty + 1, kind: 'vine',
                    ox: 4 + Math.floor(vrng() * (32 - DECOR_ART_W.vine)),
                    len, ph: vrng() * Math.PI * 2
                });
            }
        }
        this._decorSource = level;
        this._decor = decor;
        return decor;
    }

    // Buried-tile ambient-occlusion profile, computed ONCE per level publish
    // (column scan, same cache-guard style as _ensureDecor): for every solid
    // cell, how many consecutive solid cells sit directly above it (capped).
    // 0 = exposed cap row; ≥1 = buried. drawWorld shades the upper rows of
    // buried visible tiles by this depth so overhangs and stacked mass read
    // as layered volume. Pure data — assertable headlessly.
    _ensureAo(level) {
        if (this._aoSource === level) return this._aoDepth;
        const w = level.width, h = level.height;
        const depth = new Uint8Array(w * h);
        for (let tx = 0; tx < w; tx++) {
            let run = 0;
            for (let ty = 0; ty < h; ty++) {
                if (level.tiles[ty][tx] === 1) {
                    depth[ty * w + tx] = Math.min(8, run);
                    run++;
                } else {
                    run = 0;
                }
            }
        }
        this._aoSource = level;
        this._aoDepth = depth;
        return depth;
    }

    // Terrain from the tile grid with viewport culling: exposed solids get
    // the band's baked surface cap, buried ones the hashed speckled body
    // variant, and fully-enclosed tiles the darker flat interior variant
    // (detail on exposed faces, volume in the mass). Spikes draw as the
    // tooth tile filling their cell. Readability passes (rim light,
    // mass-edge shading, decor) run as separate fill-style batches so
    // fillStyle never thrashes per tile.
    drawWorld(ctx, level, cameraX, cameraY, viewW, viewH) {
        // Entity drop shadows probe this grid; drawWorld precedes every
        // entity draw in main.js's frame order.
        this._level = level;
        const size = level.tileSize;
        const themeIdx = (Math.max(1, level.levelNumber) - 1) % THEMES.length;
        const art = this._ensureTerrainArt(themeIdx);
        // +1px destination overlap: 18px source scaled to a fractional CSS
        // pixel size would otherwise leave hairline gaps between columns
        // (the nearest-neighbour rounding floors each rect independently).
        const drawn = size + 1;
        const capScale = drawn / 18;
        const c0 = Math.max(0, Math.floor(cameraX / size));
        const c1 = Math.min(level.width - 1, Math.ceil((cameraX + viewW) / size));
        const r0 = Math.max(0, Math.floor(-cameraY / size));
        const r1 = Math.min(level.height - 1, Math.ceil((-cameraY + viewH) / size));

        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                const t = level.tiles[ty][tx];
                if (t === 1) {
                    const above = ty > 0 ? level.tiles[ty - 1][tx] : 0;
                    const below = ty < level.height - 1 ? level.tiles[ty + 1][tx] : 0;
                    const left = tx > 0 ? level.tiles[ty][tx - 1] : 0;
                    const right = tx < level.width - 1 ? level.tiles[ty][tx + 1] : 0;
                    const h = hash2(tx, ty);
                    if (above === 1 && below === 1 && left === 1 && right === 1) {
                        ctx.drawImage(art.interior[h & 3],
                            0, 0, 18, 18, tx * size, ty * size, drawn, drawn);
                    } else {
                        ctx.drawImage(art.body[h & 3],
                            0, 0, 18, 18, tx * size, ty * size, drawn, drawn);
                    }
                    if (above !== 1) {
                        // Exposed surface: the band's baked cap — grass blades
                        // over the sheet green (day), stratified sandstone lip
                        // (dusk), mossy fringe with filaments (jungle). Rows
                        // above the tile line hang into the air cell.
                        ctx.drawImage(art.cap,
                            tx * size, ty * size - CAP_OVER * capScale,
                            drawn, art.cap.height * capScale);
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
        // Tinted per band (white day sun, warm dusk lip-light, pale moss).
        ctx.fillStyle = THEMES[themeIdx].rim;
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                if (ty > 0 && level.tiles[ty - 1][tx] === 1) continue;
                ctx.fillRect(tx * size, ty * size, drawn, 2);
            }
        }
        // Mass-edge shading + look-A rim light: the hashed sun/moon position
        // picks the lit side; flanks facing AWAY from it carry the heavier
        // ambient shade, flanks facing it catch a 1px theme rim (rimSide, the
        // same light step family as the cap shoulders). Three batched passes
        // so fillStyle never thrashes per tile.
        const bd = this._ensureBackdrop(level.levelNumber, themeIdx,
            level.seed === undefined || level.seed === null ? null : level.seed);
        const litRight = bd.discPos.x >= 0.5;
        ctx.fillStyle = litRight ? 'rgba(10,16,32,0.16)' : 'rgba(10,16,32,0.10)';
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                if (tx > 0 && level.tiles[ty][tx - 1] === 1) continue;
                ctx.fillRect(tx * size, ty * size, 3, drawn);
            }
        }
        ctx.fillStyle = litRight ? 'rgba(10,16,32,0.10)' : 'rgba(10,16,32,0.16)';
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                if (tx < level.width - 1 && level.tiles[ty][tx + 1] === 1) continue;
                ctx.fillRect((tx + 1) * size - 3, ty * size, 3, drawn);
            }
        }
        ctx.fillStyle = THEMES[themeIdx].rimSide;
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                const neighbour = litRight
                    ? (tx < level.width - 1 ? level.tiles[ty][tx + 1] : 0)
                    : (tx > 0 ? level.tiles[ty][tx - 1] : 0);
                if (neighbour === 1) continue;
                ctx.fillRect(litRight ? (tx + 1) * size - 1 : tx * size, ty * size, 1, drawn);
            }
        }
        // Ambient occlusion (look-A): buried-but-visible tiles (solid with a
        // solid directly above) get their upper rows darkened by burial depth
        // — strongest just under caps/overhangs, gentler deep in the mass
        // where the interior variant already flattens detail. Depth comes
        // from the per-column profile cached at publish (_ensureAo).
        const ao = this._ensureAo(level);
        const aoTint = THEMES[themeIdx].aoDark;   // 'rgba(r,g,b,' prefix
        ctx.fillStyle = aoTint + '0.10)';
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                if (ty > 0 && level.tiles[ty - 1][tx] === 1 && ao[ty * level.width + tx] <= 2) {
                    ctx.fillRect(tx * size, ty * size, drawn, 4);
                }
            }
        }
        ctx.fillStyle = aoTint + '0.05)';
        for (let ty = r0; ty <= r1; ty++) {
            for (let tx = c0; tx <= c1; tx++) {
                if (level.tiles[ty][tx] !== 1) continue;
                if (ty > 0 && level.tiles[ty - 1][tx] === 1 && ao[ty * level.width + tx] > 2) {
                    ctx.fillRect(tx * size, ty * size, drawn, 4);
                }
            }
        }

        this._drawDecor(ctx, this._ensureDecor(level), size, c0, c1, themeIdx);
    }

    // Per-band prop palettes. Every hue here sits BELOW the spike/enemy
    // contrast floor by construction: muted mid-tones, no bright metal or
    // white teeth, so gameplay readability law holds everywhere. Small growth
    // and strands are ONE drawImage each (baked variants, see buildDecorArt);
    // only the large signature props keep a per-frame sway transform.
    _drawDecor(ctx, decor, size, c0, c1, themeIdx) {
        const art = this._decorArt[themeIdx] ?? buildDecorArt(themeIdx);
        this._decorArt[themeIdx] = art;
        const clock = this.clock;
        for (const d of decor) {
            if (d.tx < c0 || d.tx > c1) continue;
            switch (d.kind) {
                case 'speck':
                    ctx.drawImage(art.speck[d.v],
                        d.tx * size + (d.side < 0 ? 1 : size - DECOR_ART_W.speck - 1),
                        d.ty * size + d.oy);
                    break;
                case 'vine':
                    // Hangs from the shelf underside into its open-air column.
                    ctx.drawImage(art.vine[d.len - 1], d.tx * size + d.ox, d.ty * size);
                    break;
                case 'tree':
                case 'bigcactus':
                case 'bamboo': {
                    // Signature props: baked identity art, gentle sway about
                    // the base. Canopy/arms live above the walk line inside
                    // the guaranteed 3-tile headroom.
                    const arts = this._propArt[themeIdx] ?? buildPropArt(themeIdx);
                    this._propArt[themeIdx] = arts;
                    const img = arts[d.v];
                    const k = d.kind === 'bamboo' ? 1.3 : d.kind === 'tree' ? 0.9 : 1.1;
                    const amp = d.kind === 'bamboo' ? 0.02 : 0.012;
                    ctx.save();
                    ctx.translate(d.tx * size + size / 2, d.ty * size);
                    ctx.rotate(Math.sin(clock * k + d.ph) * amp);
                    ctx.drawImage(img, -img.width / 2, -img.height + 2);
                    ctx.restore();
                    break;
                }
                default: {
                    // Small growth: one blit of the baked variant, feet on
                    // the surface line (+1 overlap kills hairline seams).
                    const img = art[d.kind][d.v];
                    ctx.drawImage(img, d.tx * size + d.ox, d.ty * size - img.height + 1);
                }
            }
        }
    }

    // Moving traversal decks: deliberately ARTIFICIAL against organic terrain
    // — a riveted metal plank with strap bands (per-band harmonised metals),
    // a soft two-step drop shadow beneath, and direction chevrons whose alpha
    // tracks |vx| so motion reads at a glance. Pure vector art derived from
    // platform state only (no clock, no RNG): replays render identical
    // frames, and the method works headlessly (stub contexts) as well as in
    // the browser. Drawn after tiles/props, before entities (main.js order).
    drawMovingPlatforms(ctx, platforms, levelNumber) {
        const m = PLATFORM_METALS[(Math.max(1, levelNumber) - 1) % THEMES.length];
        const H = 14; // visual deck thickness; collision rect stays 1 tile tall
        for (const p of platforms) {
            // Soft drop shadow: two stacked translucent slabs under the deck.
            ctx.fillStyle = 'rgba(8,12,24,0.10)';
            ctx.fillRect(p.x + 2, p.y + H + 3, p.width - 4, 6);
            ctx.fillStyle = 'rgba(8,12,24,0.18)';
            ctx.fillRect(p.x + 5, p.y + H + 7, p.width - 10, 4);
            // Underside frame + plate body + standable rim light.
            ctx.fillStyle = m.plateDark;
            ctx.fillRect(p.x, p.y + 4, p.width, H - 4);
            ctx.fillStyle = m.plate;
            ctx.fillRect(p.x, p.y, p.width, H - 3);
            ctx.fillStyle = m.rim;
            ctx.fillRect(p.x, p.y, p.width, 2);
            // Strap bands with bolts: the manufactured signature.
            ctx.fillStyle = m.band;
            ctx.fillRect(p.x + 8, p.y + 2, 4, H - 4);
            ctx.fillRect(p.x + p.width - 12, p.y + 2, 4, H - 4);
            ctx.fillStyle = m.bolt;
            ctx.fillRect(p.x + 9, p.y + 4, 2, 2);
            ctx.fillRect(p.x + 9, p.y + H - 6, 2, 2);
            ctx.fillRect(p.x + p.width - 11, p.y + 4, 2, 2);
            ctx.fillRect(p.x + p.width - 11, p.y + H - 6, 2, 2);
            // Motion cue: two chevrons pointing along travel, brightening
            // with speed (state-derived, never random). Axis 'v' cabins get
            // the same chevrons rotated 90° (up/down), keyed to |vy|.
            const vert = p.axis === 'v';
            const v = vert ? p.vy : p.vx;
            const sp = Math.min(1, Math.abs(v) / 30);
            if (sp > 0.05) {
                const dir = v > 0 ? 1 : -1;
                ctx.fillStyle = `rgba(255,255,255,${(0.16 + 0.3 * sp).toFixed(3)})`;
                for (let i = 0; i < 2; i++) {
                    ctx.beginPath();
                    if (vert) {
                        const by0 = dir > 0 ? p.y + H - 10 : p.y + 10;
                        const by = by0 + i * 5 * dir;
                        const cx0 = p.x + p.width / 2;
                        ctx.moveTo(cx0 - 5, by);
                        ctx.lineTo(cx0, by + 4 * dir);
                        ctx.lineTo(cx0 + 5, by);
                    } else {
                        const bx0 = dir > 0 ? p.x + p.width - 26 : p.x + 20;
                        const bx = bx0 + i * 6 * dir;
                        ctx.moveTo(bx, p.y + 4);
                        ctx.lineTo(bx + 4 * dir, p.y + H / 2 - 1);
                        ctx.lineTo(bx, p.y + H - 4);
                    }
                    ctx.fill();
                }
            } else if (p.dwelling) {
                // Boarding affordance (deck bridges): a PARKED deck lights
                // its rim and end caps — "step on now" without any clock or
                // RNG, so replays render identical frames. The chevrons are
                // dark precisely because the deck holds still; this is the
                // complementary signal during the dwell window.
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.fillRect(p.x, p.y, p.width, 2);
                ctx.fillRect(p.x, p.y + 2, 3, H - 6);
                ctx.fillRect(p.x + p.width - 3, p.y + 2, 3, H - 6);
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
        // Spin: cos wave at ~1.2 s period, phase offset per coin INDEX so a
        // string of coins never syncs into one wall of ellipses; floor the
        // squash at 0.35 so a coin is always visibly present edge-on.
        const spinW = (Math.PI * 2) / COIN_SPIN_PERIOD;
        for (let i = 0; i < coins.length; i++) {
            const coin = coins[i];
            if (coin.collected) continue;
            const phase = i * 0.618;
            const cx = coin.x + coin.width / 2;
            const cy = coin.y + coin.height / 2 + Math.sin(bobPhase + i * 0.9) * 3;
            const spin = Math.max(0.35, Math.abs(Math.cos(this.clock * spinW + phase)));
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
            // Glint: 2px white cross flash on the face, ~every 3 s per coin,
            // staggered by index; only while the face is broadside so it
            // reads as light catching gold, not a blinking hazard dot.
            if (coinGlintAt(this.clock, i) && spin > 0.6) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.fillRect(cx + 3, cy - 8, 2, 6);
                ctx.fillRect(cx + 1, cy - 6, 6, 2);
            }
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
        // Slow pulsing aura: locked it smoulders dim, unlocked it breathes at
        // DOUBLE the intensity — the gate's state must read at thumbnail
        // size. The unlocked hue harmonises with the level's band (violet
        // day, rose dusk, mint jungle); the locked grey-violet stays
        // band-neutral so the "not yet" read never changes meaning between
        // biomes.
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 1.2);
        const themeIdx = (Math.max(1, this._level?.levelNumber ?? 1) - 1) % THEMES.length;
        const colour = unlocked ? THEMES[themeIdx].portalGlow : '#8a7fa8';
        ctx.globalAlpha = unlocked ? 0.34 + 0.28 * pulse : 0.12;
        const gs = (unlocked ? 124 : 92) + 16 * pulse;
        ctx.drawImage(this._glowSprite(colour), cx - gs / 2, cy - gs / 2, gs, gs);
        ctx.globalAlpha = 1;
        // Look-A vortex: seven pixel sparks orbiting the pennant on a slow
        // ellipse plus a breathing core disc behind the cloth. Sparks pass
        // BEHIND the flag (drawn first) for a free depth cue. Locked draws
        // the whole rig as a desaturated ghost; unlocked burns in the band's
        // portalGlow — unmistakable side by side in a screenshot pair.
        const R = 30 + 3 * pulse;
        const spin = this.clock * 0.9;
        ctx.fillStyle = unlocked ? colour : 'rgba(138,127,168,0.35)';
        for (let i = 0; i < 7; i++) {
            const a = spin + (i * Math.PI * 2) / 7;
            ctx.fillRect(Math.round(cx + Math.cos(a) * R) - 1,
                Math.round(cy + Math.sin(a) * R * 0.82) - 1, 2, 2);
        }
        ctx.globalAlpha = unlocked ? 0.5 + 0.3 * pulse : 0.16;
        ctx.beginPath();
        ctx.arc(cx, cy, 10 + 3 * pulse, 0, Math.PI * 2);
        ctx.fill();
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

    _ensureHero() {
        if (this._hero === undefined) this._hero = buildHeroCanvases();
        return this._hero;
    }

    // Pose pick from player state + clock only (pause-safe, no RNG):
    // airborne rising -> jump, falling -> fall; grounded moving -> the 4-frame
    // run cycle at 20 frame-steps/s (10 footfalls: contact frames 0 and 2);
    // grounded still -> idle pair alternating every 0.5 s (breathing).
    _heroPose(player) {
        if (!player.grounded) return player.vy < 0 ? 'jump' : 'fall';
        if (Math.abs(player.vx) > 5) return 'run' + (Math.floor(this.clock * 20) % 4);
        return 'idle' + (Math.floor(this.clock * 2) % 2);
    }

    drawPlayer(ctx, player, squash = 1) {
        const moving = Math.abs(player.vx) > 5;
        const face = this._faceOf(player);
        const w = 44;                       // baked 22px grid at exactly 2x
        const h = 44 * squash;              // slight overhang past the 32px hitbox
        const cx = player.x + player.width / 2;
        this._entityShadow(ctx, cx, player.y + player.height, 16);
        // Bob synced to the run cadence: zero at each footfall (t = k/10),
        // peak lift between contacts — feet plant on the deck when they land.
        const bob = moving && player.grounded ? Math.abs(Math.sin(this.clock * 10 * Math.PI)) * 2 : 0;
        const feet = player.y + player.height - bob;
        const hero = this._ensureHero();
        if (!hero) return;                  // headless: shadow-only, never throws
        ctx.save();
        ctx.translate(cx, feet);
        ctx.scale(face, 1);
        ctx.drawImage(hero[this._heroPose(player)], -w / 2, -h, w, h);
        ctx.restore();
    }

    drawEnemy(ctx, enemy, index, player = null) {
        if (enemy.dead) return;
        const kind = enemy.kind || 'walker';
        if (kind === 'spiny') {
            this._drawSpiny(ctx, enemy, player);
            return;
        }
        if (kind === 'charger') {
            this._drawCharger(ctx, enemy);
            return;
        }
        if (kind === 'bombardier') {
            this._drawBombardier(ctx, enemy);
            return;
        }
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

    // Spiny: the slime silhouette wearing a black spike row — recognition
    // must be instant at game zoom because stomping it is fatal. Vector art
    // (no sheet cell exists for this kind); motion is the walker's exactly,
    // so the tint + teeth carry the whole warning. Same feet-anchored,
    // facing-flipped, contact-shadowed convention as the sheet enemies.
    // Wave B: when the player closes within ~3 tiles, the dome micro-rattles
    // (a few px of clock-driven jitter on the BODY only — the contact shadow
    // stays planted so the deck line never lies). Reads as "do not touch"
    // without moving the lethal box a pixel; gated by FX.trails and scaled
    // by intensity, never by anything the simulation reads.
    _drawSpiny(ctx, enemy, player = null) {
        const cx = enemy.x + enemy.width / 2;
        const feet = enemy.y + enemy.height;
        this._entityShadow(ctx, cx, feet, 15);
        const face = this._faceOf(enemy);
        let jx = 0;
        let jy = 0;
        if (player && FX.trails &&
            Math.abs((player.x + player.width / 2) - cx) <= 96) {
            const amp = 1.2 * FX.intensity;
            jx = Math.sin(this.clock * 34 + enemy.x * 0.35) * amp;
            jy = Math.sin(this.clock * 41 + 2.1) * amp * 0.4;
        }
        ctx.save();
        ctx.translate(cx + jx, feet + jy);
        ctx.scale(face, 1);
        // Purple-tinted slime dome (same footprint as the sheet slime).
        ctx.fillStyle = '#7d4fa8';
        ctx.beginPath();
        ctx.moveTo(-13, 0);
        ctx.quadraticCurveTo(-16, -13, -8, -19);
        ctx.quadraticCurveTo(0, -24, 8, -19);
        ctx.quadraticCurveTo(16, -13, 13, 0);
        ctx.closePath();
        ctx.fill();
        // Belly shading for volume (inset style from the visual pass).
        ctx.fillStyle = 'rgba(18,8,38,0.28)';
        ctx.fillRect(-13, -4, 26, 4);
        // THE signal: dark triangular spike row along the back. Four teeth
        // riding the dome arc, unmistakable even mid-jump above it.
        ctx.fillStyle = '#16161d';
        const tooth = (bx, by, w, h) => {
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + w / 2, by - h);
            ctx.lineTo(bx + w, by);
            ctx.closePath();
            ctx.fill();
        };
        tooth(-11, -13, 6, 7);
        tooth(-4.5, -18, 6, 9);
        tooth(2, -18, 6, 9);
        tooth(8, -12, 6, 7);
        // Eye toward the facing direction (shared read with the walker).
        ctx.fillStyle = '#fff';
        ctx.fillRect(5, -14, 4, 4);
        ctx.fillStyle = '#16161d';
        ctx.fillRect(7, -13, 2, 2);
        ctx.restore();
    }

    // Charger: heavier rust-red body with a forward horn; its WINDUP tele-
    // graph (squash + flash) and dash stretch render deterministically from
    // enemy.state/stateTime — no per-frame randomness, so replays and the
    // bot see exactly what the player sees. CHARGER_WINDUP_TIME mirrors the
    // constant in enemies.js (sprite layer stays import-free by convention).
    _drawCharger(ctx, enemy) {
        const CHARGER_WINDUP_TIME = 0.45; // mirror of enemies.js
        const cx = enemy.x + enemy.width / 2;
        const feet = enemy.y + enemy.height;
        this._entityShadow(ctx, cx, feet, 17);
        const face = this._faceOf(enemy);
        let sx = 1;
        let sy = 1;
        let flashA = 0;
        const t = enemy.stateTime || 0;
        if (enemy.state === 'windup') {
            // Crouch-load toward the dash: sink and widen across the windup.
            const k = Math.min(1, t / CHARGER_WINDUP_TIME);
            sx = 1 + 0.18 * k;
            sy = 1 - 0.25 * k;
            // Wave B: the tell got LOUDER — a deep amber pulse (fixed-rate,
            // stateTime-driven like the old strobe so replays and the bot see
            // exactly what the player sees) riding a rising mean: the last
            // third of the windup flashes hottest right before the dash
            // locks. Intensity-scaled only: NEVER flag-gated, because this
            // flash is fairness-critical information, not decoration.
            const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 12);
            flashA = (0.22 + 0.2 * k + 0.22 * pulse) * FX.intensity;
        } else if (enemy.state === 'dash') {
            sx = 1.12;
            sy = 0.9;
        }
        ctx.save();
        ctx.translate(cx, feet);
        ctx.scale(face * sx, sy);
        // Body: slightly larger than the slime, squared shoulders.
        ctx.fillStyle = '#b5493a';
        ctx.beginPath();
        ctx.moveTo(-15, 0);
        ctx.quadraticCurveTo(-17, -14, -9, -21);
        ctx.quadraticCurveTo(0, -26, 9, -21);
        ctx.quadraticCurveTo(17, -14, 15, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(20,8,4,0.28)';
        ctx.fillRect(-15, -4, 30, 4);
        // Forward horn/beak: the charge read lives here.
        ctx.fillStyle = '#e8d8b0';
        ctx.beginPath();
        ctx.moveTo(9, -20);
        ctx.lineTo(21, -15);
        ctx.lineTo(9, -13);
        ctx.closePath();
        ctx.fill();
        // Eye.
        ctx.fillStyle = '#fff';
        ctx.fillRect(5, -15, 4, 4);
        ctx.fillStyle = '#16161d';
        ctx.fillRect(7, -14, 2, 2);
        if (flashA > 0.01) {
            // Windup flash tint over the visible flesh only.
            ctx.fillStyle = `rgba(255,232,170,${Math.min(0.85, flashA).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(-15, 0);
            ctx.quadraticCurveTo(-17, -14, -9, -21);
            ctx.quadraticCurveTo(0, -26, 9, -21);
            ctx.quadraticCurveTo(17, -14, 15, 0);
            ctx.closePath();
            ctx.fill();
            // Sunward warning rim (Wave A litRight convention: the rim rides
            // the lit side of the dome): a bright cap stroke that grows with
            // the windup so the last frames read as "about to GO".
            const k = Math.min(1, t / CHARGER_WINDUP_TIME);
            ctx.strokeStyle = `rgba(255,196,92,${(0.35 + 0.45 * k) * FX.intensity})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-9, -21);
            ctx.quadraticCurveTo(0, -26, 9, -21);
            ctx.stroke();
        }
        if (enemy.state === 'dash') {
            // Speed streaks trailing behind the body — Wave B lengthens them
            // (the dash's tell stays distinct from the windup's flash).
            ctx.strokeStyle = 'rgba(255,214,170,0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-18, -18);
            ctx.lineTo(-30, -18);
            ctx.moveTo(-18, -12);
            ctx.lineTo(-27, -12);
            ctx.moveTo(-18, -6);
            ctx.lineTo(-24, -6);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Bombardier: stocky dark-plum body with a BRONZE CANNON BARREL mounted
    // forward — the silhouette signal for "this one shoots". Dark plum sits
    // clear of the spiny's mid-purple and the charger's rust-red, and the
    // bronze barrel + fuse spark stay readable against all three band
    // palettes (day/dusk/night contrast spot-checked via screenshot pixel
    // sampling, wave 2026-11-04). All telegraph frames derive from
    // enemy.state/stateTime — deterministic, replay- and bot-accurate.
    // BOMBARDIER_WINDUP_RANGED_TIME mirrors the constant in enemies.js
    // (sprite layer stays import-free by convention, same as _drawCharger).
    _drawBombardier(ctx, enemy) {
        const BOMBARDIER_WINDUP_RANGED_TIME = 0.6; // mirror of enemies.js
        const cx = enemy.x + enemy.width / 2;
        const feet = enemy.y + enemy.height;
        this._entityShadow(ctx, cx, feet, 17);
        const face = this._faceOf(enemy);
        let sx = 1;
        let sy = 1;
        const t = enemy.stateTime || 0;
        if (enemy.state === 'windup_ranged') {
            // Trunnion recoil-load: sink slightly and lean back across the
            // windup while the muzzle glow grows (the shot clock made
            // visible).
            const k = Math.min(1, t / BOMBARDIER_WINDUP_RANGED_TIME);
            sx = 1 + 0.1 * k;
            sy = 1 - 0.15 * k;
        } else if (enemy.state === 'windup') {
            const k = Math.min(1, t / 0.45); // close charge: charger squash
            sx = 1 + 0.18 * k;
            sy = 1 - 0.25 * k;
        } else if (enemy.state === 'dash') {
            sx = 1.12;
            sy = 0.9;
        }
        ctx.save();
        ctx.translate(cx, feet);
        ctx.scale(face * sx, sy);
        // Body: squat wide dome, wider and lower than the charger's.
        ctx.fillStyle = '#4a1f52';
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        ctx.quadraticCurveTo(-18, -11, -10, -17);
        ctx.quadraticCurveTo(0, -21, 10, -17);
        ctx.quadraticCurveTo(18, -11, 16, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(14,4,20,0.3)';
        ctx.fillRect(-16, -4, 32, 4);
        // THE signal: bronze cannon barrel mounted forward at muzzle height.
        // Wave B muzzle recoil kick: right after FIRE the whole gun group
        // snaps backward off its trunnions and springs back over 0.12 s
        // (stateTime-driven, deterministic; FX.trails family — cosmetic, the
        // shot itself was already resolved by the simulation).
        const recoil = (FX.trails && enemy.state === 'cooldown_ranged' &&
            t < 0.12) ? 5 * (1 - t / 0.12) : 0;
        ctx.save();
        ctx.translate(-recoil, 0);
        ctx.fillStyle = '#b0803a';
        ctx.fillRect(6, -15, 18, 6);
        ctx.fillStyle = '#7d5a26';           // breech shading
        ctx.fillRect(6, -15, 4, 6);
        ctx.fillStyle = '#d8a94e';           // muzzle ring highlight
        ctx.fillRect(21, -16, 3, 8);
        // Fuse on top of the breech with a steady micro-spark (clock-driven
        // flicker only — deterministic like every other render pass here).
        ctx.strokeStyle = '#c9c2b2';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(7, -15);
        ctx.quadraticCurveTo(4, -21, 8, -22);
        ctx.stroke();
        const spark = 1.5 + ((Math.floor(this.clock * 14) % 2) ? 0.6 : 0);
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(8, -22, spark, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Eye toward facing.
        ctx.fillStyle = '#fff';
        ctx.fillRect(2, -12, 4, 4);
        ctx.fillStyle = '#16161d';
        ctx.fillRect(4, -11, 2, 2);
        if (enemy.state === 'windup_ranged') {
            // Growing muzzle glow: radius + alpha ride stateTime, so the
            // 0.6 s telegraph reads as a charging shot, not decoration.
            const k = Math.min(1, t / BOMBARDIER_WINDUP_RANGED_TIME);
            ctx.fillStyle = `rgba(255,180,80,${0.25 + 0.5 * k})`;
            ctx.beginPath();
            ctx.arc(25, -12, 2 + 6 * k, 0, Math.PI * 2);
            ctx.fill();
        }
        if (enemy.state === 'cooldown_ranged' && t < 0.08) {
            // Brief FIRE flash frame at the muzzle.
            ctx.fillStyle = 'rgba(255,232,170,0.9)';
            ctx.beginPath();
            ctx.arc(26, -12, 7, 0, Math.PI * 2);
            ctx.fill();
        }
        if (enemy.state === 'dash') {
            // Speed streaks trailing behind (shared read with the charger).
            ctx.strokeStyle = 'rgba(255,214,170,0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-19, -15);
            ctx.lineTo(-31, -15);
            ctx.moveTo(-19, -9);
            ctx.lineTo(-28, -9);
            ctx.moveTo(-19, -3);
            ctx.lineTo(-25, -3);
            ctx.stroke();
        }
        ctx.restore();
    }
}
