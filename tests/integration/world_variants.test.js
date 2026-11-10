// W3a WORLDS integration — pinned full-map folds for one trio of seeds in
// each post-onramp world (CANYONS / CAVERNS / SKYWARD / RUINS), captured
// from the final W3a tree (2026-11-10, post markerSpikeBan dial). These are
// regression locks on the WORLD GRAMMAR: every knob feeds the shared rng
// stream, so any profile edit moves terrain/coins/spikes/enemies/attempts
// here — an honest rebaseline needs a deliberate re-capture plus a note in
// w3a-report.md, not a silent hash swap. Companion unit coverage lives in
// tests/unit/worlds.test.js; MEADOW byte-fidelity is guarded by the shipped
// goldens and BYTE_IDENTITY_PINS elsewhere.
import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { Level } from "../../js/level.js";
import { profileForLevel, directionForLevel, bandIndexForLevel } from "../../js/worlds.js";

const T = 32;
const sha = o => createHash("sha256").update(JSON.stringify(o)).digest("hex")
    .slice(0, 16);
const FULL_FOLD = lv => ({
    terrain: sha(lv.tiles.map(r => r.map(t => (t === 4 ? 0 : t))).join("|")),
    coins: sha(lv.coins.map(c => [c.x, c.y])),
    decks: sha(lv.movingPlatforms.map(p => [p.x, p.y, p.min, p.max, p.speed,
        p.phase])),
    pads: sha(lv.pads.map(p => [p.col, p.row])),
    crates: sha(lv.crates.map(c => [c.channelLeft, c.channelRight, c.row])),
    spikes: sha(lv.hazards.getSpikes().map(s => [Math.round(s.x),
        Math.round(s.y)])),
    enemies: sha(lv.enemyManager.enemies.map(e => [Math.round(e.x),
        Math.round(e.y), e.kind])),
    attempts: lv.generationAttempts,
    dir: lv.direction
});

// [world, level, seed, expected fold]
const WORLD_PINS = [
    ["CANYONS", 11, 20261111, {
        terrain: "9eeff5487bca6cbc", coins: "0546341acb55b274",
        decks: "4f53cda18c2baa0c", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "2cb45ece95df0f86",
        enemies: "4783e0b207dd2ed6", attempts: 1, dir: "left"
    }],
    ["CANYONS", 12, 20261112, {
        terrain: "3bf916630edca206", coins: "f60c5605e49be8fe",
        decks: "4f53cda18c2baa0c", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "e47f318263fdd930",
        enemies: "0203c38e59aeebd3", attempts: 1, dir: "vertical"
    }],
    ["CANYONS", 14, 20261114, {
        terrain: "1577c43098e743f4", coins: "414deaf4842fd771",
        decks: "4f53cda18c2baa0c", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "4f53cda18c2baa0c",
        enemies: "04558ba7386cbac9", attempts: 5, dir: "vertical"
    }],
    ["CAVERNS", 16, 20261116, {
        terrain: "efb5faafce8c4a3e", coins: "1f263dc344fdebfa",
        decks: "6fdbee0eceaba2e6", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "2219895746585f54",
        enemies: "bd99cba5203b329a", attempts: 4, dir: "vertical"
    }],
    ["CAVERNS", 18, 20261118, {
        terrain: "00d2dd3fc5ab8b54", coins: "93c2e56723a88189",
        decks: "4f53cda18c2baa0c", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "794b3df6b1198322",
        enemies: "45d1e6bd67869d78", attempts: 2, dir: "right"
    }],
    ["CAVERNS", 20, 20261120, {
        terrain: "8c5012162366bc76", coins: "2a275cbd65dd36b4",
        decks: "1544dcaa69f1dd3c", pads: "4f53cda18c2baa0c",
        crates: "5005c7682823b86e", spikes: "3ecf43364950be15",
        enemies: "f6b1fa47dd1d4eed", attempts: 38, dir: "vertical"
    }],
    ["SKYWARD", 21, 20261121, {
        terrain: "abdbe63e9e52e3df", coins: "6944fc90fb73933e",
        decks: "4f53cda18c2baa0c", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "2219895746585f54",
        enemies: "e9e2fdaa6e0f63da", attempts: 2, dir: "vertical"
    }],
    ["SKYWARD", 23, 20261123, {
        terrain: "a32bdbd5b2ee2ead", coins: "5205d42e15407442",
        decks: "4f53cda18c2baa0c", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "a58749a27ad00b40",
        enemies: "f33c4c1c9ce3a0ec", attempts: 4, dir: "right"
    }],
    ["SKYWARD", 25, 20261125, {
        terrain: "30d770e80a405002", coins: "bd1a970650f984fb",
        decks: "0521f8ee9416dd99", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "75f020e3b6a73384",
        enemies: "591fd96b9ad3c05a", attempts: 2, dir: "left"
    }],
    // W6 RE-PINNED (RUINS retune, see worlds.js note + w6-report.md): the
    // variant roles rotated (courts/stairwells/rubble), so L26/L29 re-rolled
    // through the shared rng stream (L26 gains its signature deck crossing —
    // garrisoned-court bridgeChance .95; L27 keeps terrain and only swaps
    // its roster to the DNA mix). Captured from the W6 tree 2026-11-10;
    // delta attribution vs a3c6811 lives in the W6 report.
    ["RUINS", 26, 20261126, {
        terrain: "e9d5155d6994bb11", coins: "92a6c2ceab56091d",
        decks: "e1eaf7eb9bfec8e2", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "751a20dbe4973f8c",
        enemies: "4f53cda18c2baa0c", attempts: 16, dir: "right"
    }],
    ["RUINS", 27, 20261127, {
        terrain: "57f5d526a004a241", coins: "3b2c7a1de6b6bc36",
        decks: "4f53cda18c2baa0c", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "8ae08decf1d6eb43",
        enemies: "a7748f0d3e816ff4", attempts: 1, dir: "left"
    }],
    ["RUINS", 29, 20261129, {
        terrain: "8b70d8f7e6c7f880", coins: "a12bc58ef272e24e",
        decks: "0ec2e7b23c67d6ce", pads: "4f53cda18c2baa0c",
        crates: "4f53cda18c2baa0c", spikes: "0f7fe009db5df517",
        enemies: "912f446d9e4b9b35", attempts: 8, dir: "right"
    }]
];

test("pinned world trios reproduce their captured maps exactly", () => {
    for (const [world, lvl, seed, want] of WORLD_PINS) {
        const got = FULL_FOLD(new Level(lvl, T, seed));
        expect(got.dir, `L${lvl} s${seed} world`).toBe(want.dir);
        expect(profileForLevel(lvl).name, `L${lvl} profile`).toBe(world);
        for (const k of Object.keys(want)) {
            expect(got[k], `L${lvl} s${seed} ${k}`).toBe(want[k]);
        }
    }
});

test("pinned maps agree with the worlds module contracts", () => {
    for (const [, lvl, seed] of WORLD_PINS) {
        const lv = new Level(lvl, T, seed);
        expect(lv.direction, `L${lvl} direction`).toBe(directionForLevel(lvl));
        // Presentation band the renderer/audio would pick for this level.
        expect(bandIndexForLevel(lvl, 3)).not.toBe(-1);
        // Every map still walks the gate chain to a playable end state.
        expect(lv.spawnPoint, `L${lvl} spawn`).toBeTruthy();
        expect(lv.portal, `L${lvl} portal`).toBeTruthy();
    }
});

test("world-level generation is replay-deterministic across bands", () => {
    for (let i = 0; i < 30; i++) {
        const lvl = 11 + ((i * 7) % 90);           // sweep all five worlds
        const seed = (20261200 + i * 104_729) >>> 0;
        const a = JSON.stringify(FULL_FOLD(new Level(lvl, T, seed)));
        const b = JSON.stringify(FULL_FOLD(new Level(lvl, T, seed)));
        expect(a, `L${lvl} s${seed} replay`).toBe(b);
    }
}, 240_000);

test("every world generates cleanly over a small seed fan", () => {
    const bands = [[11, 15], [16, 20], [21, 25], [26, 30], [31, 35]];
    for (const [lo, hi] of bands) {
        for (let lvl = lo; lvl <= hi; lvl++) {
            for (const seed of [424242, 987654321, 13579]) {
                const lv = new Level(lvl, T, seed);
                expect(lv.spawnPoint, `L${lvl} s${seed} spawn`).toBeTruthy();
                expect(lv.portal, `L${lvl} s${seed} portal`).toBeTruthy();
                expect(lv.generationAttempts, `L${lvl} s${seed} attempts`)
                    .toBeGreaterThanOrEqual(1);
            }
        }
    }
}, 240_000);
