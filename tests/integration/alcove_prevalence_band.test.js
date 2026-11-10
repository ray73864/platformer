// W3b: secret-alcove prevalence follows the concentration ruling.
//
// Worlds rotate off the level number (worldOf), so the sweep walks a
// fixed level window and buckets by world. Levels 10..49 keep every
// sample at tier>=2 (tier<2 stamps nothing by design); the seed formula
// matches the rest of the W3b harnesses: ((level*7919 + s*104729 + 3) >>> 0).
//
// A "stamped" map carries a carved alcove and/or a crag bump; class-B
// face chambers live inside solid rock and are counted through the
// level's exposed audit surface (getAlcove / cragSite).
'use strict';
import { test, expect } from 'bun:test';
import { Level } from '../../js/level.js';
import { profileForLevel, WORLDS } from '../../js/worlds.js';

const LEVELS = [];
for (let n = 10; n <= 49; n++) LEVELS.push(n);
const SEEDS = 20; // ~160-200 maps per world

function countsByWorld() {
    const by = {};
    for (const w of WORLDS) by[w.name] = { stamped: 0, total: 0, exhausted: 0 };
    for (const lvlN of LEVELS) {
        const world = profileForLevel(lvlN).name;
        for (let s = 0; s < SEEDS; s++) {
            const seed = ((lvlN * 7919 + s * 104729 + 3) >>> 0);
            const L = new Level(lvlN, 32, seed);
            const b = by[world];
            b.total++;
            if (L.exhausted) b.exhausted++;
            if (L.getAlcove() || L.cragSite) b.stamped++;
        }
    }
    return by;
}
const by = countsByWorld(); // one build sweep shared by both pins

test('MEADOWS never raises a secret alcove', () => {
    expect(by.MEADOWS.exhausted).toBe(0);
    expect(by.MEADOWS.stamped).toBe(0);
});

test('secret-alcove prevalence concentrates where caves belong, in order', () => {
    for (const w of ['CAVERNS', 'CANYONS', 'RUINS', 'SKYWARD']) {
        expect(by[w].exhausted).toBe(0);
    }
    // The mandated chain (owner directive): CAVERNS highest, then
    // CANYONS, then SKYWARD low-but-present. RUINS sits between by
    // band below — its level span is thin in this window, so a strict
    // count comparison against SKYWARD would ride on single-map noise.
    expect(by.CAVERNS.stamped).toBeGreaterThan(by.CANYONS.stamped);
    expect(by.CANYONS.stamped).toBeGreaterThan(by.SKYWARD.stamped);
    expect(by.SKYWARD.stamped).toBeGreaterThan(0);
    // Bands around the tuned profile (cragChance 1 / .6 / .3 / .2):
    // roomy enough for harmless generation drift, tight enough to catch
    // a regression back toward BASE (~4.5% overall) or a runaway past 35%.
    const pct = (r) => (100 * r.stamped) / r.total;
    expect(pct(by.CAVERNS)).toBeGreaterThanOrEqual(8);
    expect(pct(by.CAVERNS)).toBeLessThanOrEqual(35);
    expect(pct(by.CANYONS)).toBeGreaterThanOrEqual(6);
    expect(pct(by.CANYONS)).toBeLessThanOrEqual(35);
    expect(pct(by.RUINS)).toBeGreaterThanOrEqual(2);
    expect(pct(by.RUINS)).toBeLessThanOrEqual(30);
    expect(pct(by.SKYWARD)).toBeGreaterThanOrEqual(0.5);
    expect(pct(by.SKYWARD)).toBeLessThanOrEqual(20);
});
