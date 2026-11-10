// W3a WORLDS — generation grammar variation (owner pain: "nothing ever
// changes, the maps are the same every time"). These pins guard the DATA
// half of the wave: the cyclic band layout, the byte-frozen MEADOW onramp
// (every knob equals its pre-W3a constant, so L1..10 stay byte-identical),
// the sub-variant rotation inside each band, and the pure lookups level.js
// / audio.js / sprites.js / ui.js consult. Profiles change generation
// INPUTS only — no validator here, deliberately: gate-chain behavior is
// covered by the survivability battery and the fairness suites.
import { test, expect } from "bun:test";
import {
    WORLDS, WORLD_SPAN, MEADOW_LAST_LEVEL,
    worldOf, profileForLevel, directionForLevel,
    bandIndexForLevel, worldOrdinalForLevel, isWorldEntry
} from "../../js/worlds.js";

// ---------------------------------------------------------------------------
// Band layout: 1..10 MEADOW, then one world per five levels cycling
// CANYON -> CAVERN -> SKYWARD -> RUINS -> MEADOW -> ... worldOf() itself is
// UNBOUNDED (consumers take % WORLDS.length).
// ---------------------------------------------------------------------------
test("worldOf boundaries land exactly on band edges", () => {
    expect(worldOf(1)).toBe(0);
    expect(worldOf(10)).toBe(0);   // last frozen onramp level
    expect(worldOf(11)).toBe(1);   // first CANYONS
    expect(worldOf(15)).toBe(1);
    expect(worldOf(16)).toBe(2);   // first CAVERNS
    expect(worldOf(20)).toBe(2);
    expect(worldOf(21)).toBe(3);   // first SKYWARD
    expect(worldOf(25)).toBe(3);
    expect(worldOf(26)).toBe(4);   // first RUINS
    expect(worldOf(30)).toBe(4);
    expect(worldOf(31)).toBe(5);   // second MEADOW pass (index 5 % 5 === 0)
    expect(worldOf(36)).toBe(6);   // second CANYONS pass
    expect(worldOf(100)).toBe(18); // 1 + floor(89/5)
});

test("worldOf treats invalid input as MEADOW without warning", () => {
    for (const bad of [0, -1, 1.5, NaN, undefined, null, "7"]) {
        expect(worldOf(bad)).toBe(0);
    }
});

test("world names cycle in the documented order", () => {
    const seen = [];
    for (let n = 11; n <= 35; n += WORLD_SPAN) {
        seen.push(profileForLevel(n).name);
    }
    expect(seen).toEqual(["CANYONS", "CAVERNS", "SKYWARD", "RUINS", "MEADOWS"]);
});

// ---------------------------------------------------------------------------
// MEADOW onramp: every knob pinned against the EXACT pre-W3a constant.
// If one of these ever moves, L1..10 stop being byte-identical and the
// shipped goldens break — this test fails FIRST, before that can happen.
// ---------------------------------------------------------------------------
const LEGACY_MEADOW = {
    dirCycle: ["right", "left", "vertical"],
    gapMul: 1,
    downBias: 0.55,
    segHoldMax: 4,
    bridgeChance: 0.6,
    shaftChance: 0.82,
    vFlipMul: 1,
    vExtShift: 0,
    padMul: 1,
    crateMul: 1,
    kindWeights: { spiny: 1, charger: 1, bombardier: 1 },
    spikeMul: 1,
    markerSpikeBan: 4,
    themeBand: null,
    decorScale: 1
};

test("MEADOW profile equals the legacy constants verbatim", () => {
    const m = WORLDS[0];
    expect(m.name).toBe("MEADOWS");
    expect(m.dirCycle).toEqual(LEGACY_MEADOW.dirCycle);
    for (const k of Object.keys(LEGACY_MEADOW)) {
        if (k === "dirCycle") continue;
        expect(m[k], `MEADOW.${k}`).toEqual(LEGACY_MEADOW[k]);
    }
});

test("onramp levels get the frozen MEADOW object by identity", () => {
    for (let n = 1; n <= MEADOW_LAST_LEVEL; n++) {
        expect(profileForLevel(n), `L${n}`).toBe(WORLDS[0]);
    }
    // Second MEADOW pass (no variants defined) also returns the frozen one.
    expect(profileForLevel(31)).toBe(WORLDS[0]);
    expect(profileForLevel(35)).toBe(WORLDS[0]);
});

// ---------------------------------------------------------------------------
// Schema completeness: every world carries every knob, typed and ranged, so
// level.js can read sites unconditionally. Variants may only override known
// DNA knobs and only exist on non-MEADOW worlds.
// ---------------------------------------------------------------------------
const NUMERIC_KNOBS = ["gapMul", "downBias", "bridgeChance", "shaftChance",
    "vFlipMul", "padMul", "crateMul", "spikeMul", "decorScale", "cragChance"];
const INT_KNOBS = ["segHoldMax", "markerSpikeBan", "vExtShift"];

test("every world carries the full knob set with sane values", () => {
    for (const w of WORLDS) {
        for (const k of NUMERIC_KNOBS) {
            expect(typeof w[k], `${w.name}.${k}`).toBe("number");
            expect(Number.isFinite(w[k]), `${w.name}.${k}`).toBe(true);
            expect(w[k], `${w.name}.${k}`).toBeGreaterThanOrEqual(0);
        }
        for (const k of INT_KNOBS) {
            expect(Number.isInteger(w[k]), `${w.name}.${k}`).toBe(true);
        }
        expect(w.segHoldMax, `${w.name}.segHoldMax`).toBeGreaterThanOrEqual(2);
        expect(w.markerSpikeBan, `${w.name}.markerSpikeBan`).toBeGreaterThanOrEqual(1);
        expect(Object.keys(w.kindWeights).sort(), `${w.name}.kindWeights`)
            .toEqual(["bombardier", "charger", "spiny"]);
        for (const d of w.dirCycle) {
            expect(["right", "left", "vertical"], `${w.name}.dirCycle`).toContain(d);
        }
        expect(w.dirCycle.length).toBeGreaterThanOrEqual(3);
        expect(w.themeBand === null || Number.isInteger(w.themeBand)).toBe(true);
    }
});

test("only non-MEADOW worlds define variants, and variants only touch DNA knobs", () => {
    const dnaKeys = new Set([...NUMERIC_KNOBS, ...INT_KNOBS, "kindWeights", "dirCycle"]);
    for (const w of WORLDS) {
        if (w.name === "MEADOWS") {
            expect(w.variants, "MEADOWS must stay byte-frozen").toBeUndefined();
            continue;
        }
        expect(Array.isArray(w.variants) && w.variants.length > 1, w.name).toBe(true);
        for (const v of w.variants) {
            for (const k of Object.keys(v)) {
                expect(dnaKeys.has(k), `${w.name} variant key ${k}`).toBe(true);
            }
            expect(Object.keys(v).length, `${w.name} variant`).toBeGreaterThan(0);
        }
    }
});

// ---------------------------------------------------------------------------
// Sub-variant rotation: ((level - 11) % variants.length) merges over the
// DNA; unmentioned knobs keep their world value; merging never mutates
// WORLDS. Pins below spell out the rotation for one full pass of each band.
// ---------------------------------------------------------------------------
test("canyon variant rotation merges over the DNA", () => {
    const want = [
        [11, { segHoldMax: 7, bridgeChance: 1.0, gapMul: 1.5 }],
        [12, { segHoldMax: 3, bridgeChance: 0.4, gapMul: 1.0 }],
        [13, { segHoldMax: 4, bridgeChance: 0.85, gapMul: 1.3 }],
        [14, { segHoldMax: 7, bridgeChance: 1.0, gapMul: 1.5 }],
        [15, { segHoldMax: 3, bridgeChance: 0.4, gapMul: 1.0 }]
    ];
    for (const [lvl, v] of want) {
        const p = profileForLevel(lvl);
        expect(p.name).toBe("CANYONS");
        for (const [k, val] of Object.entries(v)) {
            expect(p[k], `L${lvl}.${k}`).toBe(val);
        }
        // untouched DNA stays world-level
        expect(p.themeBand).toBe(1);
        expect(p.markerSpikeBan).toBe(2);
        expect(p.downBias).toBe(0.55);
    }
});

test("cavern variant rotation merges over the DNA", () => {
    // Rotation indexes off (level - 11), so each band starts mid-rotation.
    const want = [
        [16, { vFlipMul: 1.3, vExtShift: -2, spikeMul: 1.3 }],
        [17, { vFlipMul: 1.5, vExtShift: -1, spikeMul: 1.15 }],
        [18, { vFlipMul: 0.8, vExtShift: 0, spikeMul: 0.75, downBias: 0.7 }],
        [19, { vFlipMul: 1.3, vExtShift: -2, spikeMul: 1.3 }],
        [20, { vFlipMul: 1.5, vExtShift: -1, spikeMul: 1.15 }]
    ];
    for (const [lvl, v] of want) {
        const p = profileForLevel(lvl);
        expect(p.name).toBe("CAVERNS");
        for (const [k, val] of Object.entries(v)) {
            expect(p[k], `L${lvl}.${k}`).toBe(val);
        }
        expect(p.shaftChance).toBe(1.0); // signature knob never varies
    }
});

test("skyward and ruins variant rotations merge over the DNA", () => {
    expect(profileForLevel(21).gapMul).toBe(1.1);   // band starts mid-rotation
    expect(profileForLevel(21).shaftChance).toBe(0.3);
    expect(profileForLevel(22).gapMul).toBe(1.45);
    expect(profileForLevel(22).padMul).toBe(1.4);
    expect(profileForLevel(23).gapMul).toBe(1.35);
    expect(profileForLevel(23).padMul).toBe(1.2);
    expect(profileForLevel(24).gapMul).toBe(1.1);   // wraps

    expect(profileForLevel(26).kindWeights.bombardier).toBe(1.5);
    expect(profileForLevel(27).crateMul).toBe(1.6);
    expect(profileForLevel(27).kindWeights.spiny).toBe(1.3);
    expect(profileForLevel(28).padMul).toBe(1.4);
    expect(profileForLevel(28).gapMul).toBe(1.25);
    expect(profileForLevel(29).kindWeights.bombardier).toBe(1.5); // wraps
});

test("profile lookup is pure: repeated calls agree and never mutate WORLDS", () => {
    const before = JSON.stringify(WORLDS);
    for (let n = 1; n <= 60; n++) {
        const a = profileForLevel(n);
        const b = profileForLevel(n);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        if (a !== WORLDS[0]) { // merged lookups are fresh objects per call
            a.gapMul = -999;   // caller-side tampering must not leak
            expect(profileForLevel(n).gapMul).not.toBe(-999);
        }
    }
    expect(JSON.stringify(WORLDS)).toBe(before);
});

// ---------------------------------------------------------------------------
// Direction policy: below level 5 always right-facing; above it the profile
// cycle indexes off the ABSOLUTE level, which reproduces the shipped
// ['right','left','vertical'][(n-5)%3] exactly on every MEADOW pass.
// ---------------------------------------------------------------------------
test("directionForLevel reproduces the legacy onramp cycle on MEADOW passes", () => {
    const legacy = ["right", "left", "vertical"];
    for (let n = 1; n < 5; n++) expect(directionForLevel(n)).toBe("right");
    for (const n of [...Array(6).keys()].map(i => i + 5)) { // 5..10
        expect(directionForLevel(n), `L${n}`).toBe(legacy[(n - 5) % 3]);
    }
    for (let n = 31; n <= 35; n++) { // second MEADOW pass
        expect(directionForLevel(n), `L${n}`).toBe(legacy[(n - 5) % 3]);
    }
});

test("one full world cycle produces the pinned direction sequence", () => {
    const want = {
        // CANYONS: terraces with exactly two mesa-climbs per band
        11: "left", 12: "vertical", 13: "left", 14: "vertical", 15: "right",
        // CAVERNS: climb-heavy (four of five on this alignment)
        16: "vertical", 17: "vertical", 18: "right", 19: "vertical", 20: "vertical",
        // SKYWARD: alternating island chains
        21: "vertical", 22: "left", 23: "right", 24: "vertical", 25: "left",
        // RUINS: legacy-shaped cycle, different everything else
        26: "right", 27: "left", 28: "vertical", 29: "right", 30: "left"
    };
    for (const [n, dir] of Object.entries(want)) {
        expect(directionForLevel(Number(n)), `L${n}`).toBe(dir);
    }
    const canyonVerticals = [11, 12, 13, 14, 15]
        .filter(n => directionForLevel(n) === "vertical").length;
    expect(canyonVerticals, "canyon keeps its horizontal identity")
        .toBe(2);
});

test("directionForLevel treats invalid input as right", () => {
    for (const bad of [0, -3, 2.5, NaN, undefined]) {
        expect(directionForLevel(bad)).toBe("right");
    }
});

// ---------------------------------------------------------------------------
// Presentation band: MEADOW keeps the legacy (n-1)%count cycle; later worlds
// pin their band so each world looks and sounds distinct.
// ---------------------------------------------------------------------------
test("bandIndexForLevel pins world bands and keeps the legacy onramp cycle", () => {
    for (let n = 1; n <= 10; n++) {
        expect(bandIndexForLevel(n, 3), `L${n}`).toBe((n - 1) % 3);
    }
    for (let n = 11; n <= 15; n++) expect(bandIndexForLevel(n, 3)).toBe(1); // DUSK
    for (let n = 16; n <= 20; n++) expect(bandIndexForLevel(n, 3)).toBe(2); // JUNGLE
    for (let n = 21; n <= 25; n++) expect(bandIndexForLevel(n, 3)).toBe(0); // DAY
    for (let n = 26; n <= 30; n++) expect(bandIndexForLevel(n, 3)).toBe(1); // DUSK
    for (let n = 31; n <= 35; n++) { // MEADOW pass again: legacy
        expect(bandIndexForLevel(n, 3), `L${n}`).toBe((n - 1) % 3);
    }
    expect(bandIndexForLevel(16, 2)).toBe(0); // modulo wrap for smaller tables
    expect(bandIndexForLevel(0, 3)).toBe(0);
});

// ---------------------------------------------------------------------------
// Title-card helpers: ordinal grows monotonically across cycles; entry fires
// on level 1 and exactly at each band edge.
// ---------------------------------------------------------------------------
test("worldOrdinalForLevel grows monotonically across cycles", () => {
    expect(worldOrdinalForLevel(1)).toBe(1);
    expect(worldOrdinalForLevel(10)).toBe(1);
    expect(worldOrdinalForLevel(11)).toBe(2);
    expect(worldOrdinalForLevel(16)).toBe(3);
    expect(worldOrdinalForLevel(26)).toBe(5);
    expect(worldOrdinalForLevel(31)).toBe(6); // second MEADOW pass is WORLD 6
    expect(worldOrdinalForLevel(36)).toBe(7);
    expect(worldOrdinalForLevel(100)).toBe(19);
});

test("isWorldEntry fires on level 1 and every band edge only", () => {
    const entries = [];
    for (let n = 1; n <= 40; n++) if (isWorldEntry(n)) entries.push(n);
    expect(entries).toEqual([1, 11, 16, 21, 26, 31, 36]);
    for (const bad of [0, -1, 3.5, NaN, undefined, null]) {
        expect(isWorldEntry(bad)).toBe(false);
    }
});

// ---------------------------------------------------------------------------
// W3b cragChance (owner ruling "RAISE alcove prevalence"): per-world secret
// concentration. MEADOWS stays 0 (open meadow semantics + byte-frozen
// onramp); CAVERNS hosts everything it can ("secrets belong underground");
// the shipped point sits on the W3b prevalence frontier (report) with the
// ordering CAVERNS > CANYONS > RUINS > SKYWARD > MEADOWS.
// ---------------------------------------------------------------------------
test("cragChance follows the W3b concentration ruling", () => {
    const byName = Object.fromEntries(WORLDS.map((w) => [w.name, w]));
    expect(byName.MEADOWS.cragChance).toBe(0);
    expect(byName.CAVERNS.cragChance).toBe(1);
    for (const w of WORLDS) {
        expect(w.cragChance, `${w.name}.cragChance`).toBeGreaterThanOrEqual(0);
        expect(w.cragChance, `${w.name}.cragChance`).toBeLessThanOrEqual(1);
    }
    expect(byName.CAVERNS.cragChance)
        .toBeGreaterThan(byName.CANYONS.cragChance);
    expect(byName.CANYONS.cragChance)
        .toBeGreaterThan(byName.RUINS.cragChance);
    expect(byName.RUINS.cragChance)
        .toBeGreaterThan(byName.SKYWARD.cragChance);
    expect(byName.SKYWARD.cragChance).toBeGreaterThan(0);
});
