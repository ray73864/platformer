// interestingness-trend.mjs — M4 trend report (R6: REPORT-ONLY). Emits the
// per-tier distribution of every interestingness metric over a FIXED seed
// band, plus alcove prevalence, as JSON. No CI gate reads the VALUES beyond
// the sanity ranges asserted in tests/unit/interestingness_trend.test.js —
// preference lives in the candidate chain (main.js seedFor), not here.
//
// Usage: bun run scripts/interestingness-trend.mjs [outPath]
// Default out: tests/reports/interestingness-trend.json
import { mkdir } from 'node:fs/promises';
import { Level } from '../js/level.js';
import { interestingnessProfile } from '../js/metrics.js';

const T = 32;
const SEEDS_PER_BAND = +(process.env.TREND_SEEDS || 40);
// One representative level per difficulty tier (tierIndexFor boundaries
// [5,10,25,50,75]): basic, intermediate, advanced, expert, master, legend.
const BANDS = [
    { level: 3, tier: 0 },
    { level: 7, tier: 1 },
    { level: 12, tier: 2 },
    { level: 30, tier: 3 },
    { level: 60, tier: 4 },
    { level: 90, tier: 5 }
];

// Fixed deterministic seed band: same list on every machine/run.
const bandSeeds = (level) =>
    Array.from({ length: SEEDS_PER_BAND },
        (_, i) => (Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(level, 0x85EBCA6B)) >>> 0);

const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return {
        mean: +mean.toFixed(4),
        min: sorted[0],
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p90: sorted[Math.floor(sorted.length * 0.9)],
        max: sorted[sorted.length - 1]
    };
};

const hist = (values) => {
    const h = {};
    for (const v of values) h[v] = (h[v] || 0) + 1;
    return h;
};

const report = {
    generatedBy: 'scripts/interestingness-trend.mjs',
    seedsPerBand: SEEDS_PER_BAND,
    weights: { forks: 1.0, greed: 0.5, tool: 0.75, secret: 1.5, forkCap: 3 },
    bands: []
};

for (const band of BANDS) {
    const rows = [];
    for (const seed of bandSeeds(band.level)) {
        const L = new Level(band.level, T, seed);
        const p = interestingnessProfile(L);
        rows.push({
            seed,
            forks: p.forks,
            greed: +p.greed.score.toFixed(4),
            tool: p.tool.count,
            secret: p.secret ? 1 : 0,
            score: +p.score.toFixed(4)
        });
    }
    report.bands.push({
        level: band.level,
        tier: band.tier,
        maps: rows.length,
        alcovePrevalence: +(rows.reduce((a, r) => a + r.secret, 0) / rows.length).toFixed(4),
        forks: { summary: summarize(rows.map((r) => r.forks)), histogram: hist(rows.map((r) => r.forks)) },
        greed: { summary: summarize(rows.map((r) => r.greed)) },
        tool: { summary: summarize(rows.map((r) => r.tool)) },
        score: { summary: summarize(rows.map((r) => r.score)) },
        rows
    });
}

const out = process.argv[2] || 'tests/reports/interestingness-trend.json';
await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true });
await Bun.write(out, JSON.stringify(report, null, 1) + '\n');
console.log(`wrote ${out}: ${report.bands.length} bands x ${SEEDS_PER_BAND} seeds`);
for (const b of report.bands) {
    console.log(`L${String(b.level).padStart(2)} t${b.tier}: score mean ${b.score.summary.mean}` +
        ` forks ${JSON.stringify(b.forks.histogram)} alcoves ${(b.alcovePrevalence * 100).toFixed(1)}%`);
}
