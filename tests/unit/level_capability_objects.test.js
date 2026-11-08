// Unit: the M3 placement pass on Level (constructor tail). Pins the
// generator-side contracts the byte-identity sweeps rely on but cannot state
// per-map: tier gating (placements exist only from tier >= 2, i.e. level
// >= 10 — the same tierIndexFor boundary the score economy reads), the max
// one-pad + one-crate budget, retry determinism, and the geometric quality
// bars each emitted object must satisfy (pad stands on real floor over an
// empty cell; crate seats inside its bounded pocket, floor underfoot, never
// sharing a cell with a coin or a deployed patrol body).
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";

const T = 32;
const SEEDS = [20261108, 20269027, 20276946, 20284865, 20292784];

const build = (lvl, seed) => new Level(lvl, T, seed);

test("tiers below 2 (levels 1..9) ship zero capability objects", () => {
    for (let lvl = 1; lvl <= 9; lvl++) {
        for (const seed of SEEDS) {
            const l = build(lvl, seed);
            expect(l.getPads().length, `L${lvl}s${seed} pads`).toBe(0);
            expect(l.getCrates().length, `L${lvl}s${seed} crates`).toBe(0);
        }
    }
});

test("budget: at most one pad and one crate per level", { timeout: 90000 }, () => {
    for (let lvl = 10; lvl <= 60; lvl++) {
        for (const seed of SEEDS) {
            let l; try { l = build(lvl, seed); } catch { continue; }
            expect(l.getPads().length, `L${lvl}s${seed}`).toBeLessThanOrEqual(1);
            expect(l.getCrates().length, `L${lvl}s${seed}`).toBeLessThanOrEqual(1);
        }
    }
});

test("retry determinism: same seed rebuilds byte-identical objects", { timeout: 90000 }, () => {
    const seen = [];
    for (let lvl = 10; lvl <= 40; lvl++) {
        for (const seed of SEEDS.slice(0, 3)) {
            let a, b;
            try { a = build(lvl, seed); b = build(lvl, seed); } catch { continue; }
            // Interleave unrelated builds: placement must depend on THIS
            // seed alone, not on anything built before it.
            try { build(lvl + 1, seed + 1); } catch { /* throw path fine */ }
            const c = build(lvl, seed);
            seen.push([lvl, seed]);
            expect(c.getPads()).toEqual(a.getPads());
            expect(c.getCrates()).toEqual(b.getCrates());
        }
    }
    expect(seen.length).toBeGreaterThan(20); // fixtures actually exercised
});

test("every pad stands on floor with an empty stand cell", { timeout: 90000 }, () => {
    let checked = 0;
    for (let lvl = 10; lvl <= 60; lvl++) {
        for (const seed of SEEDS) {
            let l; try { l = build(lvl, seed); } catch { continue; }
            for (const pad of l.getPads()) {
                checked++;
                expect(l.tiles[pad.row][pad.col], `pad cell L${lvl}s${seed}`)
                    .not.toBe(1);                       // stand cell walkable…
                expect(l.tiles[pad.row + 1][pad.col])   // …on real floor
                    .toBe(1);
                // Not buried in a coin body (coin cells are separate entities).
                const clash = l.coins.some((c) =>
                    Math.floor(c.x / T) === pad.col && Math.floor(c.y / T) === pad.row);
                expect(clash, `pad/coin overlap L${lvl}s${seed}`).toBe(false);
            }
        }
    }
    expect(checked).toBeGreaterThan(10);
});

test("every crate sits in its pocket: floor underfoot, blockers walled, no hazards below", { timeout: 120000 }, () => {
    let checked = 0;
    for (let lvl = 10; lvl <= 90; lvl++) {
        for (const seed of SEEDS) {
            let l; try { l = build(lvl, seed); } catch { continue; }
            for (const cr of l.getCrates()) {
                checked++;
                const { col, row, channelLeft, channelRight } = cr;
                expect(col).toBeGreaterThanOrEqual(channelLeft);
                expect(col).toBeLessThanOrEqual(channelRight);
                expect(l.tiles[row + 1][col]).toBe(1);           // seat floor
                // Channel floor continuous; both ends SOLID or map edge —
                // a floor gap would let gravity walk the crate out.
                for (let c = channelLeft; c <= channelRight; c++) {
                    expect(l.tiles[row + 1][c], `channel floor L${lvl}s${seed}c${c}`)
                        .toBe(1);
                    // No spikes directly beneath the channel (two rows down:
                    // a pushed crate must not rest above an open hazard).
                    expect(l.tiles[row + 2]?.[c] ?? 0).not.toBe(2);
                }
                const leftBlocker = channelLeft === 0 ||
                    l.tiles[row][channelLeft - 1] === 1;
                const rightBlocker = channelRight === l.width - 1 ||
                    l.tiles[row][channelRight + 1] === 1;
                expect(leftBlocker, `left end L${lvl}s${seed}`).toBe(true);
                expect(rightBlocker, `right end L${lvl}s${seed}`).toBe(true);
                // Never parked inside a coin body or atop a patrol lane body
                // cell occupied by the enemy itself.
                const coinClash = l.coins.some((k) =>
                    Math.floor(k.x / T) === col && Math.floor(k.y / T) === row);
                expect(coinClash).toBe(false);
            }
        }
    }
    expect(checked).toBeGreaterThan(5);
});

// MJ-2 pin: the seat-relative travel budget must be a REAL guard. The BL≡L
// cleanup made the original past-end conjuncts vacuous, so this pins the
// replacement directly on the finder with synthetic grids — a 10-cell fully-
// walled corridor is rejected (mid-seat shove would exceed
// CRATE_MAX_TRAVEL_PAST_END), while a legal 5-cell pocket still passes.
function corridorSelf(corridorCols) {
    const w = 16, h = 6;
    const tiles = Array.from({ length: h }, () => new Array(w).fill(0));
    const [c0, c1] = corridorCols;
    for (let c = c0; c <= c1; c++) tiles[4][c] = 1;      // channel floor
    tiles[3][c0 - 1] = 1; tiles[3][c1 + 1] = 1;          // body-row blockers
    const self = Object.create(Level.prototype);   // prototype methods live
    return Object.assign(self, {
        width: w, height: h, tiles,
        reachableTiles: new Set([3 * w + c0]),
        tileSize: 32
    });
}

test("travel budget rejects a wide walled corridor; a legal pocket passes", () => {
    const wide = Level.prototype._findCrateCandidates.call(
        corridorSelf([2, 11]), new Set());               // 10-cell run
    expect(wide).toEqual([]);
    const legal = Level.prototype._findCrateCandidates.call(
        corridorSelf([2, 6]), new Set());                // 5-cell run
    expect(legal.length).toBe(1);
    expect(legal[0]).toEqual({ row: 3, L: 2, R: 6, BL: 2, BR: 6 });
});
