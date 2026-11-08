import { test, expect } from "bun:test";
import { Level, motifForLevel, computeReachable } from "../../js/level.js";

// Layout motifs (player ruling 2026-11-04: "A lot of the levels just seem
// same old same old"). The contract under test: selection is a pure function
// of the level number (deterministic replay), adjacent same-direction levels
// never repeat a motif, gates keep early bands pristine — L1..11 horizontal
// and every vertical below L16 stay 'standard', so their byte-identical
// generation holds (pinned here with golden fingerprints captured at HEAD
// 232edce) — and every motif builds valid, fair maps on top of which the
// existing subsystems (spikes/markers/kinds/decks/shafts/coins/portal) run
// UNCHANGED.

const T = 32;

// --- Golden fingerprint pin: L1..7 byte identity -----------------------------
// FNV-1a over the full shipped construction payload (tiles, coins, spikes,
// deployed enemies incl. kind/patrol bounds, portal, spawn point, decks).
// Captured from the pre-motif generator (HEAD 232edce, scratch capture in
// /tmp/opencode/motifs/golden-capture.mjs); ANY change to L1..7 output must
// fail this test — motifs included.
// RECAPTURED at the fairness rulings of 2026-11-04 (ENEMY_MIN_RUN deploy
// filter + coins may coexist with patrols): L1..4 keep their original
// 232edce hashes byte-identically (no markers below level 5, so neither fix
// touches those streams), while ALL 24 L5..7 fingerprints intentionally
// changed — every enemy-bearing map reshuffles its coin candidates (the
// patrol exclusion left extractCoins' pool) and some drop sub-tile-travel
// deployments. Within THIS pinned band (L1..7: no motifs, no bridge/shaft
// clamps) tiles/spikes/portal/decks stay identical and only coins and
// enemy lists move; OUTSIDE the band moving-platform speed/phase also
// drifts (deriveMovingPlatforms draws shift behind the dropped kind rolls
// — see the spawnEnemies stream note in level.js). If this pin fails on
// an L1..4 row, that IS drift.
// RECAPTURED again for the vertical threat-layer restoration of 2026-11-05:
// ALL 8 L7 rows intentionally changed (L7 is the only vertical in the pinned
// band). The marker-time pocket machinery — chain direction flips with forced
// cadence, the unified punch/mid-cell guard, and shaft-clamp prediction in
// isMarkerSite — reshapes every accepted vertical construction so patrols
// exist at MARKER time instead of dying at the ENEMY_MIN_RUN deploy filter
// (96.6% of verticals shipped zero enemies before). L1..6 keep their prior
// hashes byte-identically: horizontals never enter generateVertical, the
// clamp predictor is a provable no-op there (shaftGap is null), and the
// one-marker-per-support-run pass only fires on vertical maps. If this pin
// fails on an L1..6 row, that IS drift.
// RECAPTURED for the soft-lock fairness fix of 2026-11-05 (R1' spike wall in
// computeReachable + generalized routeFair() acceptance gate): 10 of 56 rows
// intentionally changed — six L5 and four L6 maps, the first spike-bearing
// horizontals, where the tightened reachability model reshapes spike sites /
// portal choice or the physics gate rejects an earlier construction and the
// stream replants. L1..4 stay byte-identical (no spikes below L5 and their
// routes pass the gate untouched — verified against HEAD), and L7 too — but
// for an honest reason: L7's verticals carry no spike adjacencies, so the
// shared R1' spike-wall clause is inert there. (The routeFair physics gate IS
// vertical-exempt, yet R1' applies to ALL directions: spiked verticals from
// ~L28 legitimately reshuffle — conservative edge removal, determinism
// intact.) If this pin fails on an L1..4 or L7 row, that IS drift.
// RECAPTURED for the enemy density/grouping fairness rules of 2026-11-08
// (owner ruling: bodies-per-run cap + portal-shelf protection in
// spawnEnemies): 6 of 56 rows intentionally changed — two L5 (seeds 50044,
// 50066) and four L6 (60022, 60033, 60044, 60088) maps where excess bodies
// sharing a walkable patrol run are now SKIPPED PLACEMENTS before any kind
// roll (and the shifted roll stream re-kinds later sites). Tiles/spikes/
// coins stay byte-identical by construction (the filters run after
// extractCoins, consume no draws of their own, write no grid cell — pinned
// terrain-only fingerprints in tests/unit/enemy_density_grouping_fairness.
// test.js). L1..4 keep their prior hashes (no enemies below L5 at all) and
// L7 too (its vertical marker economy ships <=1 body per run, so neither
// rule can bite there — verified against HEAD). If this pin fails on an
// L1..4 or L7 row, that IS drift.
const GOLDEN_L1_7 = [
    [1, 11, "43dc716b"], [1, 22, "e568e737"], [1, 33, "85137246"], [1, 44, "82be8d9a"],
    [1, 55, "49f57ede"], [1, 66, "af5cd10e"], [1, 77, "20272d24"], [1, 88, "adc51e8a"],
    [2, 11, "62731bb3"], [2, 22, "f7fca45c"], [2, 33, "721d516a"], [2, 44, "4c338f6d"],
    [2, 55, "a783dfaf"], [2, 66, "cc8c92f8"], [2, 77, "4f1d2108"], [2, 88, "911d0372"],
    [3, 11, "8a6f826d"], [3, 22, "20a883cd"], [3, 33, "5cad304d"], [3, 44, "909ba303"],
    [3, 55, "638439fd"], [3, 66, "0ec11564"], [3, 77, "52da8cbf"], [3, 88, "aad03405"],
    [4, 11, "bc858548"], [4, 22, "b2dfcd1d"], [4, 33, "59ed6382"], [4, 44, "3a42f034"],
    [4, 55, "53bc22c7"], [4, 66, "1d0aad41"], [4, 77, "92557e86"], [4, 88, "c7657f2a"],
    [5, 11, "126423c7"], [5, 22, "81073b13"], [5, 33, "71505252"], [5, 44, "9b83b8a9"],
    [5, 55, "493c36cc"], [5, 66, "df20e330"], [5, 77, "a8cd5a59"], [5, 88, "b47ed851"],
    [6, 11, "e0bd7866"], [6, 22, "ac39ae9a"], [6, 33, "a9785bb9"], [6, 44, "8351591c"],
    [6, 55, "53d1889d"], [6, 66, "de1e596c"], [6, 77, "703e5856"], [6, 88, "9ab6b777"],
    [7, 11, "f22b14bd"], [7, 22, "f42ccc32"], [7, 33, "333006fe"], [7, 44, "bc32302d"],
    [7, 55, "f136f4c3"], [7, 66, "ef5e92fe"], [7, 77, "285c6abb"], [7, 88, "8f0b1f69"]
];

function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}

function fingerprint(level) {
    return fnv1a(JSON.stringify({
        tiles: level.tiles,
        coins: level.getCoins().map(c => [c.x, c.y]),
        spikes: level.getHazards().getSpikes().map(p => [p.x, p.y]),
        enemies: level.getEnemyManager().enemies.map(e =>
            [e.x, e.y, e.minX, e.maxX, e.kind]),
        portal: level.portal,
        spawn: level.spawnPoint,
        decks: level.getMovingPlatforms()
    }));
}

test("L1..7 ship byte-identical maps (golden fingerprint pin)", () => {
    for (const [lvl, s, hash] of GOLDEN_L1_7) {
        const level = new Level(lvl, T, lvl * 1000 + s);
        expect(fingerprint(level), `L${lvl} seed ${lvl * 1000 + s}`)
            .toBe(hash);
    }
}, 30_000); // suite-timeout hygiene 2026-11-06: ~3.6s solo brushes bun's 5s default under parallel load

// --- Selection semantics ------------------------------------------------------

const dirOf = n => n < 5 ? "right"
    : ["right", "left", "vertical"][(n - 5) % 3];

test("motifForLevel is deterministic and side-effect-free", () => {
    for (let n = 1; n <= 200; n++) {
        expect(motifForLevel(n)).toBe(motifForLevel(n));
    }
    // Invalid input reads as standard without throwing or warning.
    for (const bad of [0, -3, 2.5, NaN, null, undefined, "7"]) {
        expect(motifForLevel(bad)).toBe("standard");
    }
});

test("adjacent same-direction levels never repeat a motif", () => {
    let checked = 0;
    for (let n = 2; n <= 200; n++) {
        for (let p = n - 1; p >= 1; p--) {
            if (dirOf(p) !== dirOf(n)) continue;
            // The pool must differ once it actually offers > 1 name; while
            // only 'standard' is gated in, repetition is the whole point.
            const distinct = new Set();
            for (let k = 1; k <= n; k++) {
                if (dirOf(k) === dirOf(n)) distinct.add(motifForLevel(k));
            }
            if (distinct.size > 1) {
                expect(motifForLevel(n), `L${n} vs L${p}`)
                    .not.toBe(motifForLevel(p));
                checked++;
            }
            break;
        }
    }
    expect(checked).toBeGreaterThan(100);
});

test("gate table: no motif before its gate; standard owns the early bands", () => {
    for (let n = 1; n <= 100; n++) {
        const m = motifForLevel(n);
        if (n <= 11) expect(m, `L${n}`).toBe("standard");
        if (dirOf(n) === "vertical") {
            if (n < 16) expect(m, `vertical L${n}`).toBe("standard");
            expect(["standard", "atrium", "zigzag"], `vertical L${n}`)
                .toContain(m);
            expect(["hills", "terraces", "archipelago", "canyon", "pillars"],
                `vertical L${n}`).not.toContain(m);
        } else {
            expect(m === "atrium" || m === "zigzag", `horizontal L${n} ${m}`)
                .toBe(false);
            if (n < 12) expect(m, `L${n}`).toBe("standard");
            if (n < 16) expect(m, `L${n}`).not.toBe("terraces");
            if (n < 20) expect(m, `L${n}`).not.toBe("archipelago");
            if (n < 25) expect(m, `L${n}`).not.toBe("canyon");
            if (n < 30) expect(m, `L${n}`).not.toBe("pillars");
        }
    }
});

test("availability liveness: every motif actually ships soon after its gate", () => {
    // Horizontal motifs: seen within 20 levels past the gate...
    const horizon = { hills: 12, terraces: 16, archipelago: 20, canyon: 25, pillars: 30 };
    for (const [name, gate] of Object.entries(horizon)) {
        let seen = false;
        for (let n = gate; n <= gate + 20; n++) {
            if (dirOf(n) !== "vertical" && motifForLevel(n) === name) seen = true;
        }
        expect(seen, `${name} within 20 levels of gate ${gate}`).toBe(true);
    }
    // ...and vertical motifs within 9 (three verticals per 9 levels).
    for (const [name, gate] of [["atrium", 16], ["zigzag", 19]]) {
        let seen = false;
        for (let n = gate; n <= gate + 9; n++) {
            if (dirOf(n) === "vertical" && motifForLevel(n) === name) seen = true;
        }
        expect(seen, `${name} right at gate ${gate}`).toBe(true);
    }
    // Mid-tiers weight toward the complex motifs: from the expert tier up,
    // non-standard picks dominate.
    let complex = 0, total = 0;
    for (let n = 25; n <= 100; n++) {
        total++;
        if (motifForLevel(n) !== "standard") complex++;
    }
    expect(complex / total).toBeGreaterThan(0.7);
});

// --- Per-motif generation validity smoke --------------------------------------

function levelsWithMotif(name, count) {
    // Motif keys off the level number alone, so collect debut-band levels
    // that resolve to the motif, then take several seeds of each.
    const out = [];
    for (let n = 1; n <= 100 && out.length < count; n++) {
        if (motifForLevel(n) !== name) continue;
        for (const s of [3, 17, 41, 58, 73]) {
            out.push([n, n * 1000 + s]);
            if (out.length >= count) break;
        }
    }
    return out;
}

for (const name of ["hills", "terraces", "archipelago", "canyon", "pillars",
    "atrium", "zigzag"]) {
    test(`motif '${name}' builds valid maps at its debut band (zero throws)`, () => {
        const picks = levelsWithMotif(name, 15);
        expect(picks.length).toBe(15);
        for (const [lvl, seed] of picks) {
            const level = new Level(lvl, T, seed); // throws on exhaustion
            expect(level.hasValidPath(), `L${lvl} seed ${seed}`)
                .toBe(true);
            expect(level.generationAttempts, `L${lvl} seed ${seed}: budget`)
                .toBeLessThan(200);
            expect(level.getCoins().length, `L${lvl} seed ${seed}: coins`)
                .toBeGreaterThanOrEqual(5);
            // Phase-2 presence guards ran on motif terrain too. Ruling
            // 2026-11-04 (ENEMY_MIN_RUN) moved the enemy floor from "every
            // map deploys" to "every map DERIVES a site" (the constructor's
            // own validity guard): maps whose only marker sites are cramped
            // (single-column support or sub-tile final travel) now
            // legitimately ship zero enemies instead of a body that
            // clamp-flips every frame. Aggregate deployment health is
            // pinned in enemy_narrow_shelf_ban.test.js (sweep + nonvacuity).
            if (lvl >= 5) {
                expect(level.deriveEnemySpawns().length,
                    `L${lvl} seed ${seed}: enemy sites`).toBeGreaterThan(0);
                // Vertical threat-layer restoration (2026-11-05): marker-time
                // pocket seating means verticals now DEPLOY, not merely hold
                // sites — the constructor guard's derive-only floor is no
                // longer the operative bound there. Horizontals keep the
                // sites-only floor above (cramped-site maps may legitimately
                // ship zero under ENEMY_MIN_RUN).
                if (level.direction === "vertical") {
                    expect(level.getEnemyManager().enemies.length,
                        `L${lvl} seed ${seed}: deployed enemies`)
                        .toBeGreaterThan(0);
                }
                if (level.direction !== "vertical") {
                    expect(level.countTilesOfType(2),
                        `L${lvl} seed ${seed}: spikes`).toBeGreaterThan(0);
                }
            }
        }
    });
}

// --- Fairness geometry under motifs -------------------------------------------

test("no standable cell gains a ceiling within two rows (all horizontal motifs)", { timeout: 60000 }, () => {
    // The horizontal movement model does NOT run requireOpenHead, so the
    // generator owns this clearance (32px body + ~62.5px jump needs two free
    // rows). Canyon ceilings are the new threat: they must respect it, and
    // every other motif keeps the heightmap property that guarantees it.
    for (let lvl = 12; lvl <= 100; lvl += 1) {
        for (const s of [5, 29]) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            if (level.direction === "vertical") continue;
            for (let y = 1; y < level.height - 1; y++) {
                for (let x = 0; x < level.width; x++) {
                    if (level.tiles[y][x] !== 0 ||
                        level.tiles[y + 1][x] !== 1) continue; // standable
                    expect(level.tiles[y - 1][x],
                        `L${lvl} s${lvl * 1000 + s}: cap at ${x},${y - 1} ` +
                        `over standable ${x},${y} (${level.motif})`).toBe(0);
                    expect(level.tiles[y - 2][x],
                        `L${lvl} s${lvl * 1000 + s}: near-cap at ${x},${y - 2} ` +
                        `over standable ${x},${y} (${level.motif})`).toBe(0);
                }
            }
        }
    }
});

test("canyon maps actually ship overhead rock (motif is not a no-op)", () => {
    let canyons = 0, withRock = 0;
    for (let lvl = 25; lvl <= 100; lvl++) {
        if (motifForLevel(lvl) !== "canyon" || dirOf(lvl) === "vertical") continue;
        canyons++;
        const level = new Level(lvl, T, lvl * 1000 + 7);
        // A ceiling cell: solid whose column has ANOTHER solid >= 3 rows below.
        let found = false;
        for (let y = 0; y < level.height - 4 && !found; y++) {
            for (let x = 0; x < level.width && !found; x++) {
                if (level.tiles[y][x] !== 1) continue;
                for (let r = y + 3; r < level.height; r++) {
                    if (level.tiles[r][x] === 1) { found = true; break; }
                }
            }
        }
        if (found) withRock++;
    }
    expect(canyons).toBeGreaterThan(5);
    expect(withRock / canyons).toBeGreaterThan(0.8);
});

test("terraces maps show real elevation bands (regression: floor-pin)", () => {
    // The atTop/atFloor bounces used to run BEFORE motif choosers and pinned
    // every terraces map to a single flat row (measured spread 1 across 400
    // seeds pre-fix). Terraces must now walk between its elevation bands.
    let levels = 0, banded = 0;
    for (let lvl = 16; lvl <= 100; lvl++) {
        if (motifForLevel(lvl) !== "terraces" || dirOf(lvl) === "vertical") continue;
        const level = new Level(lvl, T, lvl * 1000 + 13);
        levels++;
        const tops = new Set();
        for (let x = 5; x < level.width - 5; x++) {
            for (let y = 0; y < level.height; y++) {
                if (level.tiles[y][x] === 1) { tops.add(y); break; }
            }
        }
        if (tops.size >= 3) banded++;
    }
    expect(levels).toBeGreaterThan(4);
    expect(banded / levels).toBeGreaterThan(0.8);
});

test("atrium ledges are wider than zigzag shelves (shape knob bites)", () => {
    const runWidth = (level) => {
        // Mean contiguous-solid run length across mid-map rows.
        let runs = 0, cells = 0;
        for (let y = 6; y < level.height - 5; y++) {
            let run = 0;
            for (let x = 0; x < level.width; x++) {
                if (level.tiles[y][x] === 1) { run++; }
                else { if (run) { runs++; cells += run; } run = 0; }
            }
            if (run) { runs++; cells += run; }
        }
        return runs ? cells / runs : 0;
    };
    const atriumRuns = [], zigzagRuns = [];
    for (let lvl = 16; lvl <= 100; lvl += 3) {
        if (motifForLevel(lvl) === "atrium") {
            atriumRuns.push(runWidth(new Level(lvl, T, lvl * 1000 + 9)));
        } else if (motifForLevel(lvl) === "zigzag") {
            zigzagRuns.push(runWidth(new Level(lvl, T, lvl * 1000 + 9)));
        }
    }
    expect(atriumRuns.length).toBeGreaterThan(3);
    expect(zigzagRuns.length).toBeGreaterThan(3);
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(atriumRuns)).toBeGreaterThan(mean(zigzagRuns) * 1.3);
});

// --- Tune wave pins (2026-11-04 verification review) -------------------------
// Deterministic fixed-seed assertions for the retuned emission rules. The
// statistical distributions (void fractions over hundreds of seeds, density
// censuses) live in scratch harnesses (/tmp/opencode/review-motifs/); these
// pins lock the CONTRACTS those measurements proved, on seeds that replay
// identically forever.

test("archipelago islands float where the route walks (void-under-route floor)", () => {
    // Pre-tune median was 40% of route stand-tiles floating (force-step-down
    // after wide gaps ratcheted the walk line to the floor). Post-tune the
    // fixed seed set measures 65..77% per map; pin with margin.
    let sum = 0, n = 0;
    for (const lvl of [26, 30, 39, 45, 54]) {
        for (const s of [3, 17, 41]) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            expect(level.motif, `L${lvl}`).toBe("archipelago");
            const { tiles, width: w, height: h } = level;
            let stand = 0, floating = 0;
            for (const key of level.reachableTiles) {
                const x = key % w, y = Math.floor(key / w);
                if (tiles[y][x] !== 0 || tiles[y + 1]?.[x] !== 1) continue;
                let yy = y + 1;
                while (yy < h && tiles[yy][x] === 1) yy++;
                stand++;
                if (h - yy >= 3) floating++;
            }
            const frac = floating / Math.max(1, stand);
            expect(frac, `L${lvl} seed ${lvl * 1000 + s}: ${(frac * 100).toFixed(1)}%`)
                .toBeGreaterThanOrEqual(0.5);
            sum += frac; n++;
        }
    }
    expect(sum / n).toBeGreaterThanOrEqual(0.62);
});

test("canyon canopies: rock on every map, corridor headroom 2..3, clean rock", () => {
    for (const lvl of [32, 44, 48, 53, 57, 59]) {
        if (motifForLevel(lvl) !== "canyon") continue;
        for (const s of [7, 23]) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            const where = `L${lvl} seed ${lvl * 1000 + s}`;
            const spans = level.exposeCeilingSpans();
            // Zero-ceiling maps are a shipped bug class (was 5%): kill it.
            expect(spans.length, `${where}: spans`).toBeGreaterThan(0);
            const { tiles, width: w, height: h } = level;
            const inSpan = (x, y) => spans.some((sp) =>
                x >= sp.x0 && x <= sp.x1 && y >= sp.yTop && y <= sp.yBot);
            // No hazard or marker stands on canopy rock (density economy:
            // roof-perched spikes un-vetoed the floor patrol pool, +55%).
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                if (tiles[y][x] !== 2 && tiles[y][x] !== 4) continue;
                expect(inSpan(x, y + 1),
                    `${where}: type-${tiles[y][x]} on canopy at ${x},${y}`)
                    .toBe(false);
            }
            // True corridor headroom under the lowest detached run: 2..3.
            for (let x = 0; x < w; x++) {
                let y = h - 1, low = null;
                while (y >= 0) {
                    if (tiles[y][x] === 1) {
                        let t = y;
                        while (t > 0 && tiles[t - 1][x] === 1) t--;
                        let g = 0, yy = y + 1;
                        while (yy < h && tiles[yy][x] !== 1) { g++; yy++; }
                        if (g >= 2 && y < h - 1 && yy < h && !low) {
                            low = { end: y, next: yy };
                        }
                        y = t - 1;
                    } else y--;
                }
                if (!low) continue;
                const standRow = low.next - 1;
                if (tiles[standRow][x] !== 0) continue; // spike/marker cell
                const hr = standRow - low.end - 1;
                expect(hr, `${where}: headroom col ${x} = ${hr}`)
                    .toBeGreaterThanOrEqual(2);
                expect(hr, `${where}: headroom col ${x} = ${hr}`)
                    .toBeLessThanOrEqual(3);
            }
        }
    }
}, 30_000); // suite-timeout hygiene 2026-11-06: ~3.1s solo brushes bun's 5s default under parallel load

test("pillar maps always ship tower flanks (pre-seeded cluster bites)", () => {
    // Pre-tune: 43.8% of pillar maps flat (spread ≤1), 50% without a single
    // monotone flank. One pre-seeded cluster per map now guarantees both.
    for (const lvl of [33, 35, 56]) {
        for (const s of [3, 17, 41]) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            expect(level.motif, `L${lvl}`).toBe("pillars");
            const tops = [];
            for (let x = 0; x < level.width; x++) {
                for (let y = 0; y < level.height; y++) {
                    if (level.tiles[y][x] === 1) { tops.push(y); break; }
                }
            }
            const spread = Math.max(...tops) - Math.min(...tops);
            expect(spread, `L${lvl} s${lvl * 1000 + s}: spread`)
                .toBeGreaterThanOrEqual(2);
            let runs = 0, cur = 1, prev = 0;
            for (let i = 1; i < tops.length; i++) {
                const d = Math.sign(tops[i] - tops[i - 1]);
                if (d !== 0 && d === prev) cur++;
                else { if (cur >= 2) runs++; cur = 1; prev = d; }
            }
            if (cur >= 2) runs++;
            expect(runs, `L${lvl} s${lvl * 1000 + s}: stair flanks`)
                .toBeGreaterThanOrEqual(1);
        }
    }
});


test("deck bridges still host legally on motif terrain (L25+ horizontal)", () => {
    let horiz = 0, bridged = 0;
    for (let lvl = 25; lvl <= 100; lvl++) {
        for (const s of [12, 34, 56, 78]) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            if (level.direction === "vertical") continue;
            horiz++;
            const decks = level.getMovingPlatforms();
            expect(decks.length, `L${lvl} s${lvl * 1000 + s}: cap`).toBeLessThanOrEqual(1);
            if (!decks.length) continue;
            bridged++;
            const g = level.bridgeGap;
            expect(g).toBeTruthy();
            // Flush flanks and pure void hold regardless of motif shape.
            expect(level.columnTopRow(g.a - 1)).toBe(g.S);
            expect(level.columnTopRow(g.b + 1)).toBe(g.S);
            for (let x = g.a; x <= g.b; x++) {
                for (let y = 0; y < level.height; y++) {
                    expect(level.tiles[y][x],
                        `L${lvl}: corridor cell ${x},${y} (${level.motif})`).toBe(0);
                }
            }
            // The deck carries the route: plain BFS refuses, corridor accepts.
            const plain = computeReachable(level.tiles, level.width,
                level.height, level.spawnTile, false, null, null);
            expect(plain.has(level.portalTile.y * level.width + level.portalTile.x),
                `L${lvl}: plain BFS crosses (${level.motif})`).toBe(false);
        }
    }
    // Protected band: realized L25+ coverage stays in its measured zone.
    const frac = bridged / horiz;
    expect(frac).toBeGreaterThan(0.3);
    expect(frac).toBeLessThan(0.65);
}, 60_000);

test("elevator shafts still host legally on atrium/zigzag maps (L13+ vertical)", () => {
    let vert = 0, shafted = 0;
    for (let lvl = 16; lvl <= 100; lvl += 3) {
        for (const s of [4, 21, 63]) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            if (level.direction !== "vertical") continue;
            vert++;
            const decks = level.getMovingPlatforms();
            expect(decks.length, `L${lvl}: cabin cap`).toBeLessThanOrEqual(1);
            if (!level.shaftGap) { expect(decks.length).toBe(0); continue; }
            shafted++;
            const g = level.shaftGap;
            // Barrier slab seals row A except the chimney; chimney pure air.
            for (let cx = 0; cx < level.width; cx++) {
                if (cx >= g.sx && cx <= g.ex) continue;
                expect(level.tiles[g.A][cx], `L${lvl} slab`).toBe(1);
            }
            for (let y = 0; y <= g.B + 1; y++) {
                for (let cx = g.sx; cx <= g.ex; cx++) {
                    expect(level.tiles[y][cx], `L${lvl} chimney`).toBe(0);
                }
            }
        }
    }
    expect(vert).toBeGreaterThan(10);
    const frac = shafted / vert;
    // RE-PINNED 2026-11-05 (M1 fix): the old >0.35 floor was an ACCIDENTAL
    // pass. The uncommitted vertical wave had collapsed realized hosting to
    // 0.334 across an 870-map population (this pinned probe read 0.356 on
    // these exact seeds by luck — a random same-size seed set failed it ~62%
    // of the time), against HEAD da8c8c9's measured 0.540. SHAFT_CHANCE was
    // retuned 0.7 -> 0.82 (see the constant's comment in level.js for the
    // acceptance economics): this pinned probe now measures 0.540 and the
    // fresh-seed population below 0.513 (0.529 over 3000 maps). Floor 0.40
    // keeps honest margin under the population rate while still catching a
    // collapse of the size that just happened.
    expect(frac).toBeGreaterThan(0.4);
    expect(frac).toBeLessThan(0.7);
});

test("shaft hosting holds its band across a fresh-seed population", () => {
    // The pinned probe above is only 87 maps — seed luck moved it ±0.02 last
    // wave and hid the collapse. Same hosting definition (accepted
    // construction carries a truthy shaftGap), 300 fresh-seed verticals
    // (seeds s=100..109, disjoint from every pinned seed set in this file):
    // measured 0.513 at SHAFT_CHANCE 0.82. Band brackets ~±3.8 binomial
    // sigma so any future attempt-cost or chance shift trips THIS test even
    // when the pinned one gets lucky.
    let vert = 0, shafted = 0;
    for (let lvl = 13; lvl <= 100; lvl++) {
        if ((lvl - 5) % 3 !== 2) continue; // directionForLevel's vertical stream
        for (let s = 100; s <= 109; s++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            vert++;
            if (level.shaftGap) shafted++;
        }
    }
    expect(vert).toBe(300);
    const frac = shafted / vert;
    expect(frac).toBeGreaterThan(0.42);
    expect(frac).toBeLessThan(0.64);
});
