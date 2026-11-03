import { test, expect } from "bun:test";
import { Sprites, SHEETS, SHEET_TILE_COUNTS, TILES, CHARS, THEMES, sheetRect } from "../../js/sprites.js";

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

test("every referenced character frame lives inside characters.png", () => {
    const frames = [];
    for (const [name, value] of Object.entries(CHARS)) {
        const list = Array.isArray(value) ? value : [value];
        for (const f of list) frames.push([name, f]);
    }
    for (const [name, index] of frames) {
        expect(index, `${name} in range`).toBeGreaterThanOrEqual(0);
        expect(index, `${name} in range`).toBeLessThan(SHEET_TILE_COUNTS.characters);
    }
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

test("spiny renders the purple body plus a dark triangular spike row", () => {
    const sprites = new Sprites(); // never ready here; kind art is vector
    const ctx = recordingCtx();
    sprites.drawEnemy(ctx, kindFixture('spiny'), 0);

    const fills = ctx.ops.filter(o => o.startsWith('fill '));
    // Distinct body tint...
    expect(fills.some(o => o.includes('#7d4fa8'))).toBe(true);
    // ...and unmistakable teeth: four dark triangles along the back.
    expect(fills.filter(o => o.includes('#16161d')).length).toBeGreaterThanOrEqual(4);
});

test("charger windup telegraph (squash + flash) is deterministic from state", () => {
    const sprites = new Sprites();
    const early = kindFixture('charger', { vx: 0, state: 'windup', stateTime: 0.1 });
    const a = recordingCtx();
    sprites.drawEnemy(a, early, 0);
    const b = recordingCtx();
    sprites.drawEnemy(b, { ...early }, 0);
    expect(a.ops).toEqual(b.ops); // identical inputs -> identical draws

    // Squash-load: vertical scale sinks below 1 while winding up.
    const scales = a.ops.filter(o => o.startsWith('scale '));
    expect(scales.length).toBeGreaterThan(0);
    expect(Number.parseFloat(scales[0].split(' ')[2])).toBeLessThan(1);

    // The fixed-rate strobe flips phase across the windup (stateTime-driven,
    // never Math.random): off at t=0.1 s, on at t=0.2 s.
    expect(a.ops.filter(o => o.includes('rgba(255,232,170'))).toHaveLength(0);
    const late = recordingCtx();
    sprites.drawEnemy(late, { ...early, stateTime: 0.2 }, 0);
    expect(late.ops.filter(o => o.includes('rgba(255,232,170')).length)
        .toBeGreaterThan(0);
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
