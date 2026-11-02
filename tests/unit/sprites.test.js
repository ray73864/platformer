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

test("Sprites never becomes ready without an image loader and tolerates advance", () => {
    // bun test runs without real Image IO: the fallback contract is
    // ready() === false forever and no method throwing.
    const sprites = new Sprites();
    expect(sprites.ready()).toBe(false);
    sprites.advance(0.1);
    sprites.advance(0.1);
    expect(sprites.clock).toBeCloseTo(0.2, 6);
});
