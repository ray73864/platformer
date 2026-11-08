// Unit: the committed M4 interestingness trend snapshot stays sane. This is
// a REPORT-ONLY artifact (R6) — no CI gate asserts metric VALUES beyond
// structural sanity: scores inside their analytic bounds, integer fork
// counts, prevalences in [0,1], all six tier bands present. If preference
// tuning ever moves these numbers nothing here should break; only corruption
// does. Regenerate with: bun run scripts/interestingness-trend.js
import { test, expect } from "bun:test";

const url = new URL("../reports/interestingness-trend.json", import.meta.url);
const report = await new Response(Bun.file(url)).json();

test("snapshot covers one band per difficulty tier", () => {
    expect(report.bands.length).toBe(6);
    expect(report.bands.map((b) => b.tier)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const b of report.bands) {
        expect(b.maps).toBeGreaterThan(0);
    }
});

test("every metric sits inside its analytic bounds", () => {
    const MAX_SCORE = 1.0 + 0.5 + 0.75 + 1.5; // sum of the named weights
    for (const b of report.bands) {
        expect(b.alcovePrevalence).toBeGreaterThanOrEqual(0);
        expect(b.alcovePrevalence).toBeLessThanOrEqual(1);
        for (const r of b.rows) {
            expect(Number.isInteger(r.forks)).toBe(true);
            expect(r.forks).toBeGreaterThanOrEqual(0);
            expect(r.greed).toBeGreaterThanOrEqual(0);
            expect(r.greed).toBeLessThanOrEqual(1);
            expect(Number.isInteger(r.tool)).toBe(true);
            expect(r.tool).toBeGreaterThanOrEqual(0);
            expect(r.secret === 0 || r.secret === 1).toBe(true);
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(MAX_SCORE);
        }
    }
});

test("at least one band shows genuine route variety (non-vacuity)", () => {
    // Forks >= 2 somewhere across the snapshot proves the disjoint-path
    // counter is not stuck at 1 on real maps (a max-flow bug would flatten
    // every histogram to {1:n}).
    const anyForked = report.bands.some((b) =>
        Object.entries(b.forks.histogram).some(([k, n]) => +k >= 2 && n > 0));
    expect(anyForked).toBe(true);
});
