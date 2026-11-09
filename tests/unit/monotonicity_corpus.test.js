// Unit: the committed monotonicity corpus stays structurally sound. The
// replay itself is the owner-run `bun run mono` command (scripts/
// monotonicity-check.js) — deliberately NOT part of test:all, because an
// intentional wave may legitimately evolve maps. What CI MUST catch here is
// CORRUPTION: unparseable JSON, missing schema fields, a shrunken entry set,
// or the loss of the fresh L75/1946133786 witness. Regenerate out-of-band
// (search scratch) only when trajectories intentionally move.
import { test, expect } from "bun:test";
import { tierIndexFor } from "../../js/difficulty.js";

const url = new URL("../reports/monotonicity-corpus.json", import.meta.url);
const corpus = await new Response(Bun.file(url)).json();

const KEY_CODES = new Set(["ArrowLeft", "ArrowRight", "Space"]);

test("corpus declares the v1 format and carries >= 12 entries", () => {
    expect(corpus.format).toBe("mono-corpus-v1");
    expect(typeof corpus.hashConvention).toBe("string");
    expect(corpus.entries.length).toBeGreaterThanOrEqual(12);
});

test("every entry has the full schema and a WIN outcome", () => {
    for (const e of corpus.entries) {
        expect(Number.isInteger(e.levelNumber)).toBe(true);
        expect(Number.isInteger(e.seed)).toBe(true);
        expect(e.tier).toBe(tierIndexFor(e.levelNumber));
        expect(Array.isArray(e.stage)).toBe(true);
        expect(e.stage.length).toBe(2);
        expect(Number.isInteger(e.phase)).toBe(true);
        expect(e.outcome).toBe("WIN");
        expect(e.frames).toBeGreaterThan(0);
        expect(e.hash).toMatch(/^[0-9a-f]+$/);
        expect(typeof e.provenance?.generatedAtHead).toBe("string");
        expect(e.provenance.generatedAtHead.length).toBeGreaterThan(0);
    }
});

test("events are frame-sorted key edges with known codes", () => {
    for (const e of corpus.entries) {
        expect(Array.isArray(e.events)).toBe(true);
        expect(e.events.length).toBeGreaterThan(0);
        let prev = -1;
        for (const ev of e.events) {
            const [frame, code, kind] = ev;
            expect(Number.isInteger(frame)).toBe(true);
            expect(frame).toBeGreaterThanOrEqual(prev);
            prev = frame;
            expect(KEY_CODES.has(code)).toBe(true);
            expect(kind === "down" || kind === "up").toBe(true);
        }
    }
});

test("coverage spans tiers 1-3 and pins the fresh L75 witness", () => {
    const tiers = new Set(corpus.entries.map((e) => e.tier));
    for (const t of [1, 2, 3]) expect(tiers.has(t)).toBe(true);
    const l75 = corpus.entries.find(
        (e) => e.levelNumber === 75 && e.seed === 1946133786);
    expect(l75).toBeDefined();
    expect(l75.outcome).toBe("WIN");
});
