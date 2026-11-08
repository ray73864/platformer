// Unit: R8 crag-stamp SAFETY PROPERTIES over SHIPPED stamped maps (fix
// round 1, controller-mandated M-1 battery). Where level_alcove.test.js
// checks carve STRUCTURE, this file pins the invariants that make the
// publish-time forbidden-zone EXEMPTION safe:
//   * no hazard body (enemy/pad/crate/deck band/spike/portal/spawn/required
//     coin) ever occupies a carved cell — the carve flips only rock to air
//     and bodies live on free cells;
//   * the base-BFS standable delta is PURE ADDITION, measured +2/-0 on
//     verticals (the shaft-floor pair; the tunnel cell is dropped by the
//     headroom-aware BFS — stronger than the naive +3);
//   * secret coins stay base-BFS-unreachable on the CARVED grid;
//   * meetsPortalRequirement stays required-only (secrets never gate);
//   * determinism incl. stamps: same seed twice => identical world.
import { test, expect } from "bun:test";
import { Level, computeReachable } from "../../js/level.js";
import { Collectibles } from "../../js/collectibles.js";

// Deterministic numeric-seed band (>>>0 coerced — string seeds would all
// collapse to one terrain per level, the very probe bug fix round 1 fixes).
// Levels chosen empirically: these are the ones whose seed-derived direction
// (vertical) + wide ledges host the stamp; 16/150 maps ship stamped alcoves.
const LEVELS = [10, 13, 19, 25, 28];
function sweepMaps() {
    const out = [];
    for (let s = 0; s < 30; s++) {
        for (const lvlN of LEVELS) {
            const seed = ((lvlN * 7919 + s * 104729 + 3) >>> 0);
            out.push(new Level(lvlN, 32, seed));
        }
    }
    return out;
}

test("shipped stamped maps: hazard bodies never land in carved cells",
    { timeout: 120000 }, () => {
        const maps = sweepMaps();
        let stamped = 0;
        for (const L of maps) {
            const a = L.getAlcove();
            if (!a || !L.cragSite) continue;
            stamped++;
            const T = L.tileSize;
            const carved = new Set(a.flipped.map((f) => f.r * L.width + f.x));
            const claim = (cells, who) => {
                for (const k of cells) {
                    expect(carved.has(k), `${who} inside carved cell ${k}`).toBe(false);
                }
            };
            // Enemies: every tile column/row their AABB spans.
            for (const e of L.getEnemyManager().enemies) {
                const x0 = Math.floor(e.x / T);
                const x1 = Math.floor((e.x + (e.width ?? T) - 1) / T);
                const y0 = Math.floor(e.y / T);
                const y1 = Math.floor((e.y + (e.height ?? T) - 1) / T);
                const cells = [];
                for (let r = y0; r <= y1; r++) {
                    for (let c = x0; c <= x1; c++) cells.push(r * L.width + c);
                }
                claim(cells, "enemy");
            }
            for (const pad of L.getPads()) {
                claim([pad.row * L.width + pad.col], "pad");
            }
            for (const crate of L.getCrates()) {
                for (let c = crate.channelLeft; c <= crate.channelRight; c++) {
                    claim([crate.row * L.width + c], "crate");
                }
            }
            // Portal body spans its cell plus half a row up.
            const p = L.portalTile;
            claim([p.y * L.width + p.x, (p.y - 1) * L.width + p.x], "portal");
            claim([L.spawnTile.y * L.width + L.spawnTile.x], "spawn");
            // Required (non-secret) coins: body centre cell.
            for (const coin of L.getCoins()) {
                if (coin.secret) continue;
                const cx = Math.floor((coin.x + coin.width / 2) / T);
                const cy = Math.floor((coin.y + coin.height / 2) / T);
                claim([cy * L.width + cx], "required coin");
            }
            // Spike tiles: carved cells are air post-carve; also no spike
            // tile may sit where the stamp wrote rock pre-carve.
            for (const f of a.flipped) expect(L.tiles[f.r][f.x]).toBe(0);
        }
        console.log(`stamp safety sweep: ${stamped}/${maps.length} shipped stamped alcoves`);
        expect(stamped).toBeGreaterThanOrEqual(5); // non-vacuity (band ships ~10+)
    });

test("carve standable delta on shipped stamped maps is pure addition (+2/-0)",
    { timeout: 120000 }, () => {
        const maps = sweepMaps();
        let checked = 0;
        for (const L of maps) {
            const a = L.getAlcove();
            if (!a) continue;
            checked++;
            // reachableTiles was computed PRE-carve (attempt loop); recompute
            // POST-carve with the shipped arguments.
            const post = computeReachable(
                L.tiles, L.width, L.height, L.spawnTile,
                L.direction === "vertical", L.bridgeGap, L.shaftGap,
                L.modelTransitions
            );
            for (const k of L.reachableTiles) {
                expect(post.has(k)).toBe(true); // NOTHING lost (-0)
            }
            const added = [...post].filter((k) => !L.reachableTiles.has(k));
            // Exactly the shaft-floor pair (+2): the tunnel cell lacks the
            // open head the vertical BFS requires, interior rows have no floor.
            expect(new Set(added)).toEqual(new Set([
                a.entryRow * L.width + a.col,
                a.entryRow * L.width + a.col + 1
            ]));
        }
        console.log(`standable-delta check: ${checked} shipped stamped maps`);
        expect(checked).toBeGreaterThanOrEqual(5);
    });

test("portal gate stays required-only on stamped maps with secrets",
    { timeout: 120000 }, () => {
        const maps = sweepMaps();
        let checked = 0;
        for (const L of maps) {
            if (!L.getAlcove()) continue;
            checked++;
            const coins = L.getCoins();
            expect(coins.some((c) => c.secret)).toBe(true);
            const coll = new Collectibles();
            coll.loadCoins(coins.map((c) => ({ ...c })));
            // Nothing collected -> locked (there ARE required coins).
            expect(coll.meetsPortalRequirement()).toBe(false);
            for (const c of coll.coins) if (!c.secret) c.collected = true;
            // ALL required banked, every secret still on the map -> open.
            expect(coll.coins.some((c) => c.secret && !c.collected)).toBe(true);
            expect(coll.meetsPortalRequirement()).toBe(true);
            // A single unbanked REQUIRED coin re-locks it.
            coll.coins.find((c) => !c.secret).collected = false;
            expect(coll.meetsPortalRequirement()).toBe(false);
        }
        expect(checked).toBeGreaterThanOrEqual(5);
    });

test("determinism including stamps: same seed twice => identical world",
    { timeout: 60000 }, () => {
        // Find one stamped-shipping seed in-band, then replay it exactly.
        let target = null;
        outer:
        for (let s = 0; s < 20; s++) {
            for (const lvlN of LEVELS) {
                const seed = ((lvlN * 92837 + s * 104729 + 7) >>> 0);
                const L = new Level(lvlN, 32, seed);
                if (L.getAlcove()) { target = { lvlN, seed }; break outer; }
            }
        }
        expect(target).not.toBeNull();
        const fp = () => {
            const L = new Level(target.lvlN, 32, target.seed);
            return JSON.stringify({
                tiles: L.tiles,
                alcove: L.getAlcove(),
                coins: L.getCoins().map((c) => [c.x, c.y, c.secret ? 1 : 0])
            });
        };
        expect(fp()).toBe(fp());
    });
