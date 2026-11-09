import { test, expect } from "bun:test";
import { Sprites, SHEETS, SHEET_TILE_COUNTS, TILES, THEMES, sheetRect, HERO_FRAMES, HERO_PALETTE, coinGlintAt, COIN_GLINT_PERIOD, COIN_GLINT_WINDOW, COIN_SPIN_PERIOD, secretSparkleAt, SECRET_COIN_GLOW, SECRET_STAR_COLOR, SECRET_SPARKLE_PERIOD, SECRET_SPARKLE_WINDOW } from "../../js/sprites.js";
import * as SpritesNS from "../../js/sprites.js";
import { FX } from "../../js/fx.js";
import { ENEMY_FRAMES } from "../../js/enemyart.js";
import { Level, motifForLevel } from "../../js/level.js";

// Frame-map integrity: every index referenced by the renderer must exist
// inside its packed sheet, or the game draws garbage rectangles of pixels.
test("every referenced tile index lives inside tiles.png", () => {
    for (const [name, index] of Object.entries(TILES)) {
        expect(index, `${name} in range`).toBeGreaterThanOrEqual(0);
        expect(index, `${name} in range`).toBeLessThan(SHEET_TILE_COUNTS.tiles);
        const r = sheetRect('tiles', index);
        expect(r.sx % SHEETS.tiles.cell).toBe(0);
        expect(r.sy % SHEETS.tiles.cell).toBe(0);
        expect(r.sx + r.sw).toBeLessThanOrEqual(SHEETS.tiles.cols * SHEETS.tiles.cell);
    }
});

// (2026-11-10 enemy art pass) characters.png is fully retired: hero AND
// enemies bake from indexed row strings now. The old "every referenced
// character frame lives inside characters.png" pin retires with the sheet;
// the new contract is pinned in tests/unit/enemy_art.test.js.
test("the Kenney characters sheet is no longer loaded or referenced", () => {
    expect(SHEETS.characters).toBeUndefined();
    expect(Object.keys(SHEETS).sort()).toEqual(['backgrounds', 'tiles']);
});

test("sheetRect rejects nonsense indices", () => {
    expect(() => sheetRect('tiles', -1)).toThrow();
    expect(() => sheetRect('tiles', 1.5)).toThrow();
    expect(() => sheetRect('tiles', 'x')).toThrow();
});

test("themes cover the three background columns with sky and ground colours", () => {
    expect(THEMES.length).toBe(3);
    // Measured from the shipped sheet: day x0-95, dusk x96-143, jungle x144-191.
    expect(THEMES.map(t => [t.x, t.w])).toEqual([[0, 96], [96, 48], [144, 48]]);
    for (const t of THEMES) {
        expect(t.sky).toMatch(/^#[0-9a-f]{6}$/i);
        expect(t.ground).toMatch(/^#[0-9a-f]{6}$/i);
    }
});

// Vector silhouettes for the risky kinds (enemies.js kind contracts): the
// spiny's spike row and the charger's windup telegraph must render purely
// from enemy state — no clock, no randomness — so replays show exactly what
// the player saw. Recording ctx captures the draw sequence for comparison.
function recordingCtx() {
    const ops = [];
    const ctx = {
        ops,
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
        save: () => ops.push('save'),
        restore: () => ops.push('restore'),
        translate: (x, y) => ops.push(`translate ${x} ${y}`),
        scale: (x, y) => ops.push(`scale ${x} ${y}`),
        beginPath: () => ops.push('beginPath'),
        moveTo: (x, y) => ops.push(`moveTo ${x} ${y}`),
        lineTo: (x, y) => ops.push(`lineTo ${x} ${y}`),
        quadraticCurveTo: (a, b, c, d) => ops.push(`quad ${a} ${b} ${c} ${d}`),
        closePath: () => ops.push('closePath'),
        fill: () => ops.push(`fill ${ctx.fillStyle}`),
        fillRect: (x, y, w, h) => ops.push(`fillRect ${ctx.fillStyle} ${x} ${y} ${w} ${h}`),
        stroke: () => ops.push(`stroke ${ctx.strokeStyle}`),
        ellipse: () => ops.push('ellipse'),
        drawImage: () => ops.push('drawImage')
    };
    return ctx;
}

function kindFixture(kind, extra = {}) {
    return {
        x: 100, y: 200, width: 32, height: 32, vx: 40,
        kind, state: 'patrol', stateTime: 0, dead: false, ...extra
    };
}

// Enemy draw recorder: captures blit identity (fake canvases carry their
// bake tag), geometry AND globalAlpha at call time — the baked-art contract
// (2026-11-10) moved body shapes from vector fills to pre-baked canvas blits,
// so telegraph evidence is now "which frame got blitted at which alpha".
function enemyCtx() {
    const ops = [];
    const ctx = {
        ops,
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
        save: () => ops.push('save'),
        restore: () => ops.push('restore'),
        translate: (x, y) => ops.push(`translate ${x} ${y}`),
        scale: (x, y) => ops.push(`scale ${x} ${y}`),
        beginPath: () => ops.push('beginPath'),
        moveTo: (x, y) => ops.push(`moveTo ${x} ${y}`),
        lineTo: (x, y) => ops.push(`lineTo ${x} ${y}`),
        arc: (x, y, r) => ops.push(`arc ${x} ${y} ${r}`),
        closePath: () => ops.push('closePath'),
        fill: () => ops.push(`fill ${ctx.fillStyle}`),
        fillRect: (x, y, w, h) => ops.push(`fillRect ${ctx.fillStyle} ${x} ${y} ${w} ${h}`),
        stroke: () => ops.push(`stroke ${ctx.strokeStyle}`),
        ellipse: () => ops.push('ellipse'),
        drawImage: (img, dx, dy, dw, dh) =>
            ops.push(`drawImage ${img && img.tag} ${dx} ${dy} ${dw} ${dh} a=${ctx.globalAlpha}`)
    };
    return ctx;
}

// Headless environments never rasterise (buildEnemyCanvases -> null), so
// blit/geometry tests inject tagged stand-ins past the bake guard — same
// convention as withFakeHero below for the hero.
const ENEMY_FRAME_NAMES = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2'];
function withFakeEnemies(sprites) {
    const kindArt = (kind, extra = []) => Object.fromEntries(
        [...ENEMY_FRAME_NAMES, ...extra].map(n => [n, { tag: `${kind}.${n}` }]));
    sprites._enemies = {
        walker: kindArt('walker'),
        spiny: kindArt('spiny'),
        charger: kindArt('charger', ENEMY_FRAME_NAMES.map(n => `${n}_flash`)),
        bombardier: kindArt('bombardier', ['gun'])
    };
    return sprites;
}

test("spiny bakes a purple pot under a bone spike crown", () => {
    // Data-level lethal signal (the old pin checked four dark triangles in
    // the vector op log; the baked equivalent is the bone crown itself):
    // enough bone pixels to read bristled, over a solid purple body.
    const { idle0 } = ENEMY_FRAMES.spiny;
    const bone = idle0.join('').split('b').length - 1;
    const purple = idle0.join('').split('p').length - 1;
    expect(bone).toBeGreaterThanOrEqual(30);
    expect(purple).toBeGreaterThan(bone * 2);
    // The crown occupies the grid's top rows: pure black at shipped size, the
    // bristled silhouette is what makes this kind lethal-readable. Pin the
    // TALLEST spike-tips row specifically (mutation-checked: shaving the
    // spikes fails here even while the base band survives).
    expect(idle0[0].split('b').length - 1).toBeGreaterThanOrEqual(2);
    expect(idle0.slice(0, 4).join('').replace(/[^b]/g, '').length)
        .toBeGreaterThanOrEqual(20);
    // And the renderer blits the spiny frame family (feet-anchored, flipped).
    const sprites = withFakeEnemies(new Sprites());
    sprites.clock = 0.1;
    const ctx = enemyCtx();
    sprites.drawEnemy(ctx, kindFixture('spiny', { vx: 0 }), 0);
    expect(ctx.ops.some(o => o.startsWith('drawImage spiny.idle'))).toBe(true);
});

test("charger windup telegraph (squash + flash) is deterministic from state", () => {
    const sprites = withFakeEnemies(new Sprites());
    sprites.clock = 0.1;
    const early = kindFixture('charger', { vx: 0, state: 'windup', stateTime: 0.1 });
    const a = enemyCtx();
    sprites.drawEnemy(a, early, 0);
    const b = enemyCtx();
    sprites.drawEnemy(b, { ...early }, 0);
    expect(a.ops).toEqual(b.ops); // identical inputs -> identical draws

    // Squash-load: vertical scale sinks below 1 while winding up.
    const scales = a.ops.filter(o => o.startsWith('scale '));
    expect(scales.length).toBeGreaterThan(0);
    expect(Number.parseFloat(scales[0].split(' ')[2])).toBeLessThan(1);

    // Wave B adaptation (NOT a weakening): the rising-mean amber pulse now
    // tints the EXACT baked silhouette (alpha-blended mask blit instead of a
    // bezier approximation of the body). Alpha still rides stateTime only —
    // identical inputs draw identically (op-log equality above) while
    // consecutive windup frames differ in intensity. The tint must exist
    // through the whole windup AND stay absent from every other state (the
    // dash tells with speed streaks instead — distinct reads by design).
    const flashOps = (ops) => ops.filter(o => o.includes('_flash') && !/\sa=0$/.test(o));
    const earlyFlash = flashOps(a.ops);
    expect(earlyFlash.length).toBe(1);
    const late = enemyCtx();
    sprites.drawEnemy(late, { ...early, stateTime: 0.2 }, 0);
    const lateFlash = flashOps(late.ops);
    expect(lateFlash.length).toBe(1);
    expect(lateFlash[0]).not.toBe(earlyFlash[0]); // pulse moved frame to frame
    // Pixel-diff guarantee: the flash blits the same footprint as the body
    // at alpha > 0, so at least every body pixel changes colour vs patrol.
    const patrol = enemyCtx();
    sprites.drawEnemy(patrol, { ...early, state: 'patrol' }, 0);
    expect(flashOps(patrol.ops)).toHaveLength(0);
    expect(patrol.ops).not.toEqual(a.ops);
    const dash = enemyCtx();
    sprites.drawEnemy(dash, { ...early, state: 'dash', stateTime: 0.2 }, 0);
    expect(flashOps(dash.ops)).toHaveLength(0);
    // Dash keeps its streak tell (distinct from the windup's flash).
    expect(dash.ops.filter(o => o.startsWith('stroke rgba(255,214,170,0.5)')).length)
        .toBe(1);
});

test("Sprites never becomes ready without an image loader and tolerates advance", () => {
    // bun test runs without real Image IO: the fallback contract is
    // ready() === false forever and no method throwing.
    const sprites = new Sprites();
    expect(sprites.ready()).toBe(false);
    sprites.advance(0.1);
    sprites.advance(0.1);
    expect(sprites.clock).toBeCloseTo(0.2, 6);
});

// ---------------------------------------------------------------------------
// Visual-overhaul wave 1: biome identity fields + decor placement invariants.
// The scatter is pure data until it draws, so these rules hold headlessly —
// op-log equality like the enemy-draw determinism tests above.
// ---------------------------------------------------------------------------
test("themes carry biome-identity fields with hazard-safe values", () => {
    for (const t of THEMES) {
        for (const key of ['rim', 'mood', 'haze', 'portalGlow', 'ink', 'dust']) {
            expect(typeof t[key], `${key} present`).toBe('string');
            expect(t[key].length).toBeGreaterThan(3);
        }
        // Vignette stays a whisper: the brief caps corner alpha at 0.12.
        expect(t.vignette).toBeLessThanOrEqual(0.12);
        expect(t.vignette).toBeGreaterThan(0);
    }
});

function fakeLevel(levelNumber, spikes = []) {
    const width = 24;
    const height = 12;
    const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
    // Ground band rows 8-11 with a couple of bumps; deterministic shape.
    for (let tx = 0; tx < width; tx++) {
        const top = 8 - ((tx % 5 === 2) ? 1 : 0);
        for (let ty = top; ty < height; ty++) tiles[ty][tx] = 1;
    }
    for (const [sx, sy] of spikes) tiles[sy][sx] = 2;
    return { levelNumber, width, height, tiles, tileSize: 32 };
}

test("decor scatter is deterministic per level instance (two Sprites agree)", () => {
    const a = new Sprites();
    const b = new Sprites();
    const levelA = fakeLevel(6);
    const levelB = fakeLevel(6);
    expect(a._ensureDecor(levelA)).toEqual(b._ensureDecor(levelB));
    // Same instance re-read returns the cached list untouched.
    const first = a._ensureDecor(levelA).slice();
    expect(a._ensureDecor(levelA)).toEqual(first);
});

test("decor never lands on or beside a spike, and signatures keep headroom", () => {
    const sprites = new Sprites();
    for (const levelNumber of [1, 2, 3, 6, 8, 9]) {
        const level = fakeLevel(levelNumber, [[5, 7], [6, 7], [15, 6]]);
        const decor = sprites._ensureDecor(level);
        for (const d of decor) {
            if (d.kind !== 'vine') {
                for (let y = d.ty - 1; y <= d.ty + 1; y++) {
                    for (let x = d.tx - 1; x <= d.tx + 1; x++) {
                        if (y < 0 || y >= level.height || x < 0 || x >= level.width) continue;
                        expect(level.tiles[y][x],
                            `L${levelNumber} ${d.kind} at ${d.tx},${d.ty} near spike`).not.toBe(2);
                    }
                }
            }
            if (['tree', 'bigcactus', 'bamboo'].includes(d.kind)) {
                for (let y = d.ty - 3; y < d.ty; y++) {
                    expect(level.tiles[y][d.tx],
                        `signature ${d.kind} headroom at ${d.tx},${d.ty}`).toBe(0);
                }
            }
            if (d.kind === 'vine') {
                // Vines hang into open air for their whole length.
                for (let s = 0; s < d.len; s++) {
                    const y = d.ty + s;
                    if (y >= level.height) break;
                    expect(level.tiles[y][d.tx]).toBe(0);
                }
            }
        }
    }
});

test("moving platform decks draw deterministic vector art with a speed cue", () => {
    const deck = (vx) => ({ x: 100, y: 200, width: 64, height: 32, vx });
    // Same state -> identical op log across independent Sprites instances.
    const a = recordingCtx();
    new Sprites().drawMovingPlatforms(a, [deck(20)], 9);
    const b = recordingCtx();
    new Sprites().drawMovingPlatforms(b, [deck(20)], 9);
    expect(b.ops).toEqual(a.ops);
    expect(a.ops.filter(o => o.startsWith('fillRect')).length)
        .toBeGreaterThanOrEqual(8); // shadow + plate + straps + bolts

    // Motion cue is state-derived: parked decks show no chevrons, moving
    // ones do, and direction flips the chevron geometry.
    const parked = recordingCtx();
    new Sprites().drawMovingPlatforms(parked, [deck(0)], 9);
    expect(parked.ops.filter(o => o.startsWith('moveTo')).length).toBe(0);
    const left = recordingCtx();
    new Sprites().drawMovingPlatforms(left, [deck(-20)], 9);
    const tipOf = (ops) => {
        const base = Number.parseFloat(ops.find(o => o.startsWith('moveTo')).split(' ')[1]);
        const tip = Number.parseFloat(ops.find(o => o.startsWith('lineTo')).split(' ')[1]);
        return tip - base; // signed horizontal offset of the chevron point
    };
    expect(tipOf(a.ops)).toBeGreaterThan(0);  // pointing right
    expect(tipOf(left.ops)).toBeLessThan(0);  // pointing left

    // Per-band metals: dusk (L8 -> idx 1) and jungle (L9 -> idx 2) differ.
    const dusk = recordingCtx();
    new Sprites().drawMovingPlatforms(dusk, [deck(0)], 8);
    const jungle = recordingCtx();
    new Sprites().drawMovingPlatforms(jungle, [deck(0)], 9);
    expect(dusk.ops).not.toEqual(jungle.ops);
});

// Look-A promoted hanging strands from a jungle-exclusive to an every-band
// stratum (jungle leafy vines, day tendrils, dusk dry ropes — kind stays
// 'vine', art varies per band). The old test pinned the jungle-only rule;
// this adapted version keeps the same strength of guarantee on the new
// contract: deterministic per band, and dense ceilings DO grow strands.
test("hanging strands grow under shelf faces on every band", () => {
    const sprites = new Sprites();
    // A dense ceiling row gives the strand pass plenty of candidate
    // undersides; the roll is fixed-quantity 10% per underside so a 18-cell
    // ceiling lands at least one hit on every band's derived stream.
    const withCeiling = (n) => {
        const level = fakeLevel(n);
        for (let tx = 2; tx < 20; tx++) level.tiles[3][tx] = 1;
        return sprites._ensureDecor(level).some(d => d.kind === 'vine');
    };
    expect(withCeiling(1)).toBe(true);   // day tendrils
    expect(withCeiling(8)).toBe(true);   // dusk dry ropes
    expect(withCeiling(6)).toBe(true);   // jungle vines
});

// ---------------------------------------------------------------------------
// Hero redesign (2026-11-04): indexed pixel-art frames + deterministic pose
// selection. The hero left the Kenney characters sheet, so its art contract
// is now carried entirely by HERO_FRAMES and drawPlayer.
// ---------------------------------------------------------------------------
const HERO_NAMES = ['idle0', 'idle1', 'run0', 'run1', 'run2', 'run3', 'jump', 'fall'];

test("hero frame set is complete: idle x2, run x4, jump, fall", () => {
    expect(Object.keys(HERO_FRAMES).sort()).toEqual([...HERO_NAMES].sort());
});

test("every hero frame is a 20x20 grid of known palette colours", () => {
    const chars = Object.keys(HERO_PALETTE);
    for (const name of HERO_NAMES) {
        const rows = HERO_FRAMES[name];
        expect(rows.length, `${name} row count`).toBe(20);
        for (let y = 0; y < 20; y++) {
            expect(rows[y].length, `${name} row ${y} width`).toBe(20);
            for (const ch of rows[y]) {
                expect(chars, `${name} uses "${ch}"`).toContain(ch);
            }
        }
    }
});

test("grounded hero frames plant feet on the baseline row", () => {
    // Feet must meet the deck honestly: every grounded pose has colour in the
    // bottom content row (row 19), inside the hitbox footprint columns.
    for (const name of ['idle0', 'idle1', 'run0', 'run1', 'run2', 'run3']) {
        const bottom = HERO_FRAMES[name][19];
        const ink = [...bottom].map((c, x) => (c !== '.' ? x : -1)).filter(x => x >= 0);
        expect(ink.length, `${name} has feet pixels`).toBeGreaterThan(0);
        expect(Math.max(...ink) - Math.min(...ink), `${name} foot span within body`)
            .toBeLessThanOrEqual(12);
    }
    // Airborne tuck deliberately lifts off the baseline.
    expect(HERO_FRAMES.jump[19]).toBe('....................');
});

test("_heroPose maps player state + clock to the right frame deterministically", () => {
    const s = new Sprites();
    const at = (clock, vx, vy, grounded) => {
        s.clock = clock;
        return s._heroPose({ vx, vy, grounded });
    };
    // Grounded still -> idle pair alternating every 0.5 s.
    expect(at(0.1, 0, 0, true)).toBe('idle0');
    expect(at(0.6, 0, 0, true)).toBe('idle1');
    expect(at(1.1, 0, 0, true)).toBe('idle0');
    // Grounded moving -> the 4-frame cycle stepping at 20/s (10 footfalls).
    expect([at(0.01, 60, 0, true), at(0.06, 60, 0, true),
        at(0.11, 60, 0, true), at(0.16, 60, 0, true),
        at(0.21, 60, 0, true)]).toEqual(['run0', 'run1', 'run2', 'run3', 'run0']);
    // Airborne rising -> jump; falling (incl. apex vy=0) -> fall.
    expect(at(0.2, 60, -300, false)).toBe('jump');
    expect(at(0.2, 60, 300, false)).toBe('fall');
    expect(at(0.2, 60, 0, false)).toBe('fall');
    // Pure function of state: identical inputs -> identical output.
    expect(at(0.06, -60, 0, true)).toBe(at(0.06, -60, 0, true));
});

// Extended recorder that also captures drawImage geometry (the shared
// recordingCtx ignores args; squash/anchor assertions need them) plus the
// identity of the blitted frame (fake canvases carry their pose name).
function heroCtx() {
    const ops = [];
    const ctx = {
        ops,
        fillStyle: '#000', globalAlpha: 1,
        save: () => ops.push('save'),
        restore: () => ops.push('restore'),
        translate: (x, y) => ops.push(`translate ${x} ${y}`),
        scale: (x, y) => ops.push(`scale ${x} ${y}`),
        beginPath: () => ops.push('beginPath'),
        ellipse: (...a) => ops.push(`ellipse ${a.join(' ')}`),
        closePath: () => ops.push('closePath'),
        fill: () => ops.push(`fill ${ctx.fillStyle}`),
        drawImage: (img, dx, dy, dw, dh) =>
            ops.push(`drawImage ${img && img.pose} ${dx} ${dy} ${dw} ${dh}`)
    };
    return ctx;
}

// Headless environments never rasterise (buildHeroCanvases -> null), so
// geometry/frame-identity tests inject tagged stand-ins past the bake guard.
function withFakeHero(sprites) {
    sprites._hero = Object.fromEntries(HERO_NAMES.map(n => [n, { pose: n }]));
    return sprites;
}

const heroFixture = (extra = {}) => ({
    x: 100, y: 200, width: 32, height: 32, vx: 0, vy: 0, grounded: true, ...extra
});

test("drawPlayer op log is deterministic across every pose path incl. squash", () => {
    const cases = [
        [{}, 1], [{}, 0.75],                                  // idle, squash
        [{ vx: 60 }, 1], [{ vx: -60 }, 1],                    // run L/R facing flip
        [{ vx: 60 }, 0.5],                                    // run + squash
        [{ vy: -300, grounded: false }, 1],                   // jump
        [{ vy: 300, grounded: false }, 1]                     // fall
    ];
    const clocks = [0.01, 0.06, 0.11, 0.16, 0.35];
    for (const extra of cases) {
        for (const clock of clocks) {
            const a = heroCtx(), b = heroCtx();
            const sa = withFakeHero(new Sprites()), sb = withFakeHero(new Sprites());
            sa.clock = sb.clock = clock;
            const pa = heroFixture(extra[0]), pb = heroFixture(extra[0]);
            sa.drawPlayer(a, pa, extra[1]);
            sb.drawPlayer(b, pb, extra[1]);
            expect(b.ops, `clock=${clock} ${JSON.stringify(extra)}`).toEqual(a.ops);
            // And the blitted frame is the pose the selector promised.
            const di = a.ops.find(o => o.startsWith('drawImage'));
            expect(di.split(' ')[1]).toBe(sa._heroPose(pa));
        }
    }
});

test("drawPlayer anchors feet and honours squash via drawImage geometry", () => {
    const s = withFakeHero(new Sprites());
    s.clock = 0.35;
    const plain = heroCtx();
    s.drawPlayer(plain, heroFixture(), 1);
    const di = plain.ops.find(o => o.startsWith('drawImage'));
    expect(di).toBeDefined();
    const [, , dx, dy, dw, dh] = di.split(' ').map((v, i) => (i === 0 ? v : Number(v)));
    expect(dw).toBe(44);
    expect(dh).toBe(44);          // 22px baked grid at exactly 2x
    expect(dy).toBe(-44);         // feet-anchored: sprite sits above the line
    expect(dx).toBe(-22);         // centred on the hitbox

    const squashed = heroCtx();
    s.drawPlayer(squashed, heroFixture(), 0.5);
    const d2 = squashed.ops.find(o => o.startsWith('drawImage')).split(' ');
    expect(Number(d2[5])).toBe(22);   // height compresses with squash...
    expect(Number(d2[4])).toBe(44);   // ...width does not
    expect(Number(d2[3])).toBe(-22);  // still anchored at the feet

    // Facing flip reaches the transform (cached from vx sign).
    const right = heroCtx();
    s.drawPlayer(right, heroFixture({ vx: 60 }), 1);
    expect(right.ops.some(o => o === 'scale 1 1')).toBe(true);
    const left = heroCtx();
    s.drawPlayer(left, heroFixture({ vx: -60 }), 1);
    expect(left.ops.some(o => o === 'scale -1 1')).toBe(true);

    // Translate origin IS the feet line (review follow-up): cx = 100+16,
    // feet = 200+32, bob zero while idle. Without this pin, swapping the
    // origin to player.y (hero floats one hitbox above ground) would pass
    // every drawImage-geometry assertion above.
    expect(plain.ops.some(o => o === 'translate 116 232')).toBe(true);
});

test("hero canvases bake once per instance behind a cache guard", () => {
    const s = new Sprites();
    expect(s._hero).toBeUndefined();               // not attempted yet
    const first = s._ensureHero();
    expect(s._hero).not.toBeUndefined();           // attempt recorded
    expect(s._ensureHero()).toBe(first);           // identity: never rebuilt
    // A second draw call must not re-bake either.
    const before = s._hero;
    const ctx = heroCtx();
    s.clock = 0.1;
    s.drawPlayer(ctx, heroFixture(), 1);
    expect(s._hero).toBe(before);
});

test("bake runs exactly one canvas per frame even with raster available", () => {
    // Headless CI note (review follow-up): without a real 2D context the
    // guard above degrades to null===null. This variant stubs a minimal
    // fillRect-capable canvas so the bake SUCCEEDS, then counts actual
    // createElement calls — a re-bake on repeat calls or draws would trip it.
    const realCreate = document.createElement.bind(document);
    let created = 0;
    document.createElement = (tag) => {
        if (tag === 'canvas') {
            created++;
            return {
                width: 0, height: 0,
                getContext: () => ({ fillStyle: '', fillRect: () => {} })
            };
        }
        return realCreate(tag);
    };
    try {
        const s = new Sprites();
        const baked = s._ensureHero();
        expect(baked).not.toBeNull();              // fake raster succeeded
        expect(created).toBe(Object.keys(HERO_FRAMES).length);
        created = 0;
        expect(s._ensureHero()).toBe(baked);       // identity, no rebuild
        const ctx = heroCtx();
        s.clock = 0.25;
        s.drawPlayer(ctx, heroFixture({ vx: 60 }), 1);
        expect(created).toBe(0);                   // steady state allocates none
    } finally {
        document.createElement = realCreate;
    }
});

test("no exported art references the retired Kenney characters sheet", () => {
    // Hero left the sheet in the 2026-11-04 redesign; enemies followed with
    // the 2026-11-10 baked-art pass (see enemy_art.test.js for the new pins).
    expect(SpritesNS.CHARS).toBeUndefined();
});

// Canyon tune wave (2026-11-04 review): surface growth on an overhead slab
// top sells it as a floating island and kills the corridor read. The sprite
// layer must skip every cell level.exposeCeilingSpans() reports; hanging
// vines stay on purpose (greenery reads as canopy, not walkable ground).
test("canyon canopy rock hosts no surface growth (vines below stay)", () => {
    const sprites = new Sprites();
    let maps = 0;
    for (const lvl of [32, 44, 48, 53, 57, 59]) {
        if (motifForLevel(lvl) !== 'canyon') continue;
        const level = new Level(lvl, 32, lvl * 1000 + 7);
        const spans = level.exposeCeilingSpans();
        expect(spans.length, `L${lvl}: canyon ships canopies`).toBeGreaterThan(0);
        maps++;
        for (const d of sprites._ensureDecor(level)) {
            if (d.kind === 'vine') continue;
            for (const s of spans) {
                const inside = d.tx >= s.x0 && d.tx <= s.x1 &&
                    d.ty >= s.yTop && d.ty <= s.yBot;
                expect(inside,
                    `L${lvl} ${d.kind} at ${d.tx},${d.ty} on canopy rect ` +
                    `${s.x0}..${s.x1}@${s.yTop}..${s.yBot}`).toBe(false);
            }
        }
    }
    expect(maps).toBe(6);
});

// ---------------------------------------------------------------------------
// Look-A (world look): seeded sky/hill backdrop, AO column profile, coin
// life cadence, flower shelf budget. All pure-data contracts — they hold in
// headless runs because the bakers skip pixels but never re-order rng draws.
// ---------------------------------------------------------------------------
test("backdrop placements are deterministic per level seed and differ across seeds", () => {
    const pa = new Sprites()._ensureBackdrop(6, 2, 123456789).placements;
    const pb = new Sprites()._ensureBackdrop(6, 2, 123456789).placements;
    expect(pa).toEqual(pb);
    // Same instance + same key returns the cached object untouched.
    const s = new Sprites();
    const first = s._ensureBackdrop(6, 2, 123456789).placements;
    expect(s._ensureBackdrop(6, 2, 123456789).placements).toBe(first);
    // A different level seed must re-hash the sky: hills, clouds, stars and
    // the disc home all shift.
    const pc = new Sprites()._ensureBackdrop(6, 2, 987654321).placements;
    expect(pc.discPos).not.toEqual(pa.discPos);
    expect(pc.fore).not.toEqual(pa.fore);
});

test("the hashed disc home always sits in the safe upper-sky band", () => {
    const s = new Sprites();
    for (let i = 0; i < 500; i++) {
        const seed = Math.imul(i + 1, 2654435761) >>> 0;
        const levelNumber = (i % 9) + 1;
        const p = s._ensureBackdrop(levelNumber, (levelNumber - 1) % 3, seed)
            .placements.discPos;
        expect(p.x).toBeGreaterThanOrEqual(0.12);
        expect(p.x).toBeLessThan(0.88);
        expect(p.y).toBeGreaterThanOrEqual(0.14);
        expect(p.y).toBeLessThan(0.30);
    }
});

test("_ensureAo counts consecutive solids above each cell (burial depth)", () => {
    const s = new Sprites();
    const level = fakeLevel(4);          // column 0: solid rows 8..11
    const ao = s._ensureAo(level);
    const w = level.width;
    expect(ao[8 * w + 0]).toBe(0);       // exposed cap row
    expect(ao[9 * w + 0]).toBe(1);       // buried: one solid above
    expect(ao[10 * w + 0]).toBe(2);
    expect(ao[11 * w + 0]).toBe(3);
    expect(ao[7 * w + 0]).toBe(0);       // empty cell reads zero
    expect(s._ensureAo(level)).toBe(ao); // cache guard: identity per level
});

test("coin glints fire on a 3 s duty cycle, staggered so coins never blink together", () => {
    const samples = [];
    for (let t = 0; t < 30; t += 0.01) samples.push(t);
    const active = (i) => samples.filter(t => coinGlintAt(t, i)).length;
    const duty = COIN_GLINT_WINDOW / COIN_GLINT_PERIOD;
    expect(active(0) / samples.length).toBeCloseTo(duty, 2);
    expect(active(1) / samples.length).toBeCloseTo(duty, 2);
    // The per-index offset (1.37 s) exceeds the window: windows never overlap.
    for (const t of samples) {
        expect(coinGlintAt(t, 0) && coinGlintAt(t, 1)).toBe(false);
    }
    // Spin period constant shipped at the briefed ~1.2 s.
    expect(COIN_SPIN_PERIOD).toBeCloseTo(1.2, 6);
});

// W1 two-tier economy (owner ruling 2026-11-10): secret coins must read as
// bonus treasure in the sprite path itself — warmer aura hue, static face
// star, FX.pulse-gated orbiting sparkle — while normal coins keep the exact
// pre-ruling render.
test("secret sparkle fires on its own cadence, distinct from the shared glint", () => {
    const samples = [];
    // 22 s = exactly 10 sparkle periods on the 0.01 sample grid (2.2 s each),
    // so the duty-cycle measurement is exact rather than boundary-quantised.
    for (let t = 0; t < 22; t += 0.01) samples.push(t);
    const duty = SECRET_SPARKLE_WINDOW / SECRET_SPARKLE_PERIOD;
    const active = samples.filter(t => secretSparkleAt(t, 0)).length;
    expect(active / samples.length).toBeCloseTo(duty, 2);
    // The premium glow is a warmer amber than the plain coin's #ffd76a.
    expect(SECRET_COIN_GLOW).not.toBe('#ffd76a');
});

test("drawCoins gives secrets the premium look and leaves normal coins untouched", () => {
    // Recording ctx factory: every op stringified; glow sentinels keep
    // _glowSprite off the offscreen-canvas path.
    const makeCtx = () => {
        const ops = [];
        const ctx = {
            ops,
            globalAlpha: 1,
            fillStyle: '',
            save: () => {},
            restore: () => {},
            translate: () => {},
            scale: () => {},
            drawImage: (img) => ops.push(`drawImage ${img}`),
            fillRect: (x, y, w, h) =>
                ops.push(`fillRect ${ctx.fillStyle} ${x} ${y} ${w} ${h}`)
        };
        return ctx;
    };
    const premiumSprites = () => {
        const s = new Sprites();
        s._glows['#ffd76a'] = 'GOLD';
        s._glows[SECRET_COIN_GLOW] = 'AMBER';
        return s;
    };
    const coin = (x, secret) => ({ x, y: 0, width: 16, height: 16,
        collected: false, ...(secret ? { secret: true } : {}) });

    // clock = 1.0: neither the shared glint (indices 0/1) nor the secret's
    // sparkle window is open, so only the identity cues draw.
    const s = premiumSprites();
    s.clock = 1.0;
    const ctx = makeCtx();
    s.drawCoins(ctx, [coin(0, false), coin(100, true)]);

    // Aura hues separate the tiers before any shape detail resolves.
    expect(ctx.ops[0]).toBe('drawImage GOLD');
    expect(ctx.ops).toContain('drawImage AMBER');
    // Static face star: exactly the secret's two cream bars, nothing else.
    const stars = ctx.ops.filter(o => o.startsWith(`fillRect ${SECRET_STAR_COLOR}`));
    expect(stars.length).toBe(2);
    // The normal coin contributes zero fillRects of its own.
    expect(ctx.ops.filter(o => o.startsWith('fillRect')).length).toBe(2);

    // Sparkle window open -> two orbiting sparks ride along.
    s.clock = 0.1; // secretSparkleAt(0.1, 0): window open for index 0
    const sparkleCtx = makeCtx();
    s.drawCoins(sparkleCtx, [coin(0, true)]);
    expect(sparkleCtx.ops.filter(o => o.includes('rgba(255,244,214,0.95)')).length)
        .toBe(2);
    expect(sparkleCtx.ops.filter(o => o.startsWith(`fillRect ${SECRET_STAR_COLOR}`)).length)
        .toBe(2);

    // FX.pulse off (reduced motion): the movement cue drops, the static
    // distinction stays.
    const prevPulse = FX.pulse;
    FX.pulse = false;
    try {
        const rmCtx = makeCtx();
        s.drawCoins(rmCtx, [coin(0, true)]);
        expect(rmCtx.ops.filter(o => o.includes('rgba(255,244,214,0.95)')).length)
            .toBe(0);
        expect(rmCtx.ops.filter(o => o.startsWith(`fillRect ${SECRET_STAR_COLOR}`)).length)
            .toBe(2);
    } finally {
        FX.pulse = prevPulse;
    }
});

test("flowers respect the shelf budget: <=3 per contiguous run, >=4 cells apart", () => {
    const sprites = new Sprites();
    // Wide synthetic shelves (96 cells) so ~20% growth rolls regularly
    // generate >3 flower candidates per run — the budget genuinely engages
    // (mutation-checked: disabling the guard produces cap AND spacing
    // violations across this exact sweep; the old 40-cell fixtures did not).
    const wideShelf = (n) => {
        const width = 96, height = 10;
        const tiles = Array(height).fill(null).map(() => Array(width).fill(0));
        for (let tx = 0; tx < width; tx++) { tiles[8][tx] = 1; tiles[9][tx] = 1; }
        return { levelNumber: n, width, height, tiles, tileSize: 32 };
    };
    let atCap = 0;
    for (let n = 1; n <= 60; n++) {
        const flowers = sprites._ensureDecor(wideShelf(n))
            .filter(d => d.kind === 'flower')
            .map(d => d.tx).sort((a, b) => a - b);
        expect(flowers.length, `L${n}: shelf flower cap`).toBeLessThanOrEqual(3);
        if (flowers.length === 3) atCap++;
        for (let i = 1; i < flowers.length; i++) {
            expect(flowers[i] - flowers[i - 1], `L${n}: flower spacing`)
                .toBeGreaterThanOrEqual(4);
        }
    }
    // Non-vacuity: the cap actually bound real rolls (measured 26/60).
    expect(atCap).toBeGreaterThanOrEqual(10);
});
