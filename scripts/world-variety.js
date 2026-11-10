// world-variety.js — W3a owner-facing variety metric (the boredom-cure proof).
// Consecutive-level STRUCTURAL distance over a fixed level band, averaged:
// each map becomes a feature vector (tile histogram, void-run width
// histogram, elevation-profile stats, upper-mass fraction, entity mix by
// kind, object counts); distance is mean absolute per-feature difference.
// High distance = the next level genuinely reads differently. Worlds raise
// this by shifting the GRAMMAR every five levels, not just the palette.
//
// Usage: bun run scripts/world-variety.js [lvlLo lvlHi seedCount]
// Defaults: 11 40 30. Run from any tree to compare BEFORE vs AFTER.
import { Level } from '../js/level.js';
import { profileForLevel, worldOf, WORLDS } from '../js/worlds.js';

const T = 32;
const [lo, hi, seedsN] = [+(process.argv[2] || 11), +(process.argv[3] || 40),
    +(process.argv[4] || 30)];

// Fixed deterministic seed family (same list on every machine/run/tree).
const seedAt = (lvl, i) => (Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(lvl, 0x85EBCA6B)) >>> 0;

function features(L) {
    const w = L.width, h = L.height;
    let solid = 0;
    const top = [];
    const colEmpty = [];
    for (let x = 0; x < w; x++) {
        let t = -1, any = false;
        for (let y = 0; y < h; y++) {
            if (L.tiles[y][x] === 1) { solid++; if (t < 0) t = y; any = true; }
        }
        top.push(t); colEmpty.push(any ? 0 : 1);
    }
    const voidRuns = [0, 0, 0, 0, 0, 0, 0];
    let run = 0;
    for (let x = 0; x < w; x++) {
        if (colEmpty[x]) run++;
        else if (run) { voidRuns[Math.min(6, run - 1)]++; run = 0; }
    }
    if (run) voidRuns[Math.min(6, run - 1)]++;
    const tops = top.filter((t) => t >= 0);
    const meanT = tops.reduce((a, b) => a + b, 0) / Math.max(1, tops.length);
    const sdTop = Math.sqrt(tops.reduce((a, b) => a + (b - meanT) ** 2, 0) /
        Math.max(1, tops.length));
    const spreadTop = tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
    let upper = 0;
    for (let y = 0; y < Math.floor(h / 2); y++)
        for (let x = 0; x < w; x++) if (L.tiles[y][x] === 1) upper++;
    const kinds = {};
    for (const e of L.enemyManager.enemies) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    return [
        solid / (w * h),                       // mass fraction
        L.getHazards().getSpikes().length / (w * h) * 10,
        colEmpty.reduce((a, b) => a + b, 0) / w, // full-void columns
        sdTop / 5, spreadTop / 20, new Set(tops).size / 8,
        upper / Math.max(1, solid),            // verticality
        ...voidRuns.map((v) => Math.min(1, v / 4)), // gap-width histogram
        Math.min(1, L.enemyManager.enemies.length / 8),
        Math.min(1, (kinds.walker || 0) / 8), Math.min(1, (kinds.spiny || 0) / 4),
        Math.min(1, (kinds.charger || 0) / 4), Math.min(1, (kinds.bombardier || 0) / 4),
        Math.min(1, L.getCoins().length / 30),
        Math.min(1, L.getCoins().filter((c) => c.secret).length / 3),
        L.getPads().length ? 1 : 0, L.getCrates().length ? 1 : 0,
        L.getMovingPlatforms().length ? 1 : 0, L.shaftGap ? 1 : 0,
        L.bridgeGap ? 1 : 0, L.getAlcove() ? 1 : 0
    ];
}

const dist = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
};

let sum = 0, n = 0;
const perPair = [];
for (let s = 0; s < seedsN; s++) {
    let prev = null, prevLvl = -1;
    for (let lvl = lo; lvl <= hi; lvl++) {
        const L = new Level(lvl, T, seedAt(lvl, s));
        const f = features(L);
        if (prev) {
            const d = dist(prev, f);
            sum += d; n++;
            perPair.push({ from: prevLvl, to: lvl, d });
        }
        prev = f; prevLvl = lvl;
    }
}
console.log(`world-variety: L${lo}..${hi} x ${seedsN} seeds, ${n} consecutive pairs`);
console.log(`mean consecutive-level structural distance: ${(sum / n).toFixed(4)}`);
// Per world-boundary breakdown: distance across the entry boundary vs inside
// a world (entries should spike — that is the "new place" moment).
const atBoundary = [], inside = [];
for (const p of perPair) {
    (worldOf(p.to) % WORLDS.length !== worldOf(p.from) % WORLDS.length
        ? atBoundary : inside).push(p.d);
}
const mean = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(4) : 'n/a';
console.log(`  inside a world: ${mean(inside)} (${inside.length} pairs)`);
console.log(`  world entries : ${mean(atBoundary)} (${atBoundary.length} pairs)`);
for (let lvl = lo; lvl <= hi; lvl++) {
    const p = profileForLevel(lvl);
    if (lvl === lo || profileForLevel(lvl - 1) !== p) {
        console.log(`  L${lvl}: WORLD ${worldOf(lvl) + 1} · ${p.name}`);
    }
}
