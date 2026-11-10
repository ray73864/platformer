// Shaft-blind gauntlet exposure pin (fairness wave 2026-11-06). The shipped
// gauntlet filter skips vertical maps because routeModelEdges cannot see
// SHAFT RIDES — the elevator cabin's virtual corridor (js/level.js header at
// GAUNTLET_MIN_BODIES). This test measures the exemption with a scratch
// mirror of routeModelEdges extended by VIRTUAL SHAFT EDGES, mirroring
// computeReachable's rider conventions verbatim: cabin cells = columns
// sx..ex x rows A-1..B-1; riders expand ONLY along the cabin plus FLUSH onto
// standable stop-ledges at rows A-1 / B-1; zero launch authority; boarding
// from terrain only at stop rows. Wave measurement (886 fresh-seed shaft maps
// L13..100, seeds lvl*10000+1000+i): blind must-pass is null on 886/886 —
// shafts are LOAD-BEARING, so the exempt filter currently sees no mandatory
// traverse on any shaft map — while the shaft-aware graph finds 12..17
// must-pass cells per map and 627/886 maps host an enemy neighborhood
// touching one. Flags: ZERO (max crossing group 2 bodies, min pockets 2 vs
// the >=3-bodies-zero-pockets bar): the vertical marker economy ships <=2
// bodies on 881/886 maps, so the residual exposure is bounded by threat
// DENSITY, not model blindness. Pinned below on a fresh slice of the same
// disjoint seed family. If this test ever fails, vertical density drifted
// toward the horizontal norm and shaft edges must be wired into
// routeModelEdges for the gauntlet metric (decision record: wave report).
import { test, expect } from "bun:test";
import {
    Level, computeMustPassCells, gauntletViolations
} from "../../js/level.js";
import { directionForLevel } from "../../js/worlds.js";

const T = 32;
const MAX_H_JUMP = 4; // mirrors the module constant in js/level.js

// Scratch mirror of routeModelEdges (js/level.js @66b56c0) + shaft edges.
// NOT shipped code: kept local so the measurement cannot perturb generation.
// Drift guard: the blind-null and lift-articulation assertions below fail
// loudly if the generator or the mirrored scan semantics move apart.
function routeModelEdgesShaft(level, blocked = null) {
    const tiles = level.tiles;
    const w = level.width, h = level.height;
    const blk = (x, y) => blocked !== null && blocked.has(y * w + x);
    const solid = (x, y) => {
        if (x < 0 || x >= w) return true;
        if (y < 0 || y >= h) return false;
        return tiles[y][x] === 1;
    };
    const hazard = (x, y) => {
        if (x < 0 || x >= w || y < 0 || y >= h) return false;
        return tiles[y][x] === 2;
    };
    const freeCell = (x, y) => !solid(x, y) && !hazard(x, y);
    const standable = (x, y) => freeCell(x, y) && solid(x, y + 1) && !blk(x, y);
    const corr = level.bridgeGap;
    const isCorr = (x, y) => corr !== null && corr !== undefined &&
        y === corr.S - 1 && x >= corr.a && x <= corr.b && !blk(x, y);
    const shaft = level.shaftGap || null;
    const isShaft = (x, y) => shaft !== null && x >= shaft.sx &&
        x <= shaft.ex && y >= shaft.A - 1 && y <= shaft.B - 1 && !blk(x, y);
    const isShaftStopRow = (y) =>
        shaft !== null && (y === shaft.A - 1 || y === shaft.B - 1);
    const key = (x, y) => y * w + x;
    const edges = [];
    if (!standable(level.spawnTile.x, level.spawnTile.y)) return edges;
    const seen = new Set([key(level.spawnTile.x, level.spawnTile.y)]);
    const queue = [[level.spawnTile.x, level.spawnTile.y]];
    while (queue.length) {
        const [x, y] = queue.shift();
        if (isCorr(x, y)) {
            for (const dir of [-1, 1]) {
                const nx = x + dir;
                if (isCorr(nx, y)) {
                    edges.push({ ax: x, ay: y, bx: nx, by: y });
                    if (!seen.has(key(nx, y))) { seen.add(key(nx, y)); queue.push([nx, y]); }
                    continue;
                }
                for (const ny of [y, y - 1]) {
                    if (standable(nx, ny)) {
                        edges.push({ ax: x, ay: y, bx: nx, by: ny });
                        if (!seen.has(key(nx, ny))) { seen.add(key(nx, ny)); queue.push([nx, ny]); }
                    }
                }
            }
            continue;
        }
        if (isShaft(x, y)) {
            // Rider-cell expansion: cabin-internal + flush stop-ledge step,
            // verbatim convention of computeReachable's shaft block.
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (isShaft(nx, ny)) {
                    edges.push({ ax: x, ay: y, bx: nx, by: ny });
                    if (!seen.has(key(nx, ny))) { seen.add(key(nx, ny)); queue.push([nx, ny]); }
                } else if (isShaftStopRow(y) && ny === y && standable(nx, ny)) {
                    edges.push({ ax: x, ay: y, bx: nx, by: ny });
                    if (!seen.has(key(nx, ny))) { seen.add(key(nx, ny)); queue.push([nx, ny]); }
                }
            }
            continue;
        }
        for (const dir of [-1, 1]) {
            for (let dist = 1; dist <= MAX_H_JUMP; dist++) {
                let blockedMid = false, hazardRun = 0;
                for (let m = 1; m < dist; m++) {
                    const midX = x + dir * m;
                    if (solid(midX, y) || blk(midX, y)) { blockedMid = true; break; }
                    if (hazard(midX, y)) {
                        hazardRun++;
                        if (m === 1 || hazardRun >= 3) { blockedMid = true; break; }
                    } else hazardRun = 0;
                }
                if (blockedMid) continue;
                const c = x + dir * dist;
                for (let ly = y; ly < h; ly++) {
                    if (hazard(c, ly)) break;
                    if (standable(c, ly)) {
                        edges.push({ ax: x, ay: y, bx: c, by: ly });
                        if (!seen.has(key(c, ly))) { seen.add(key(c, ly)); queue.push([c, ly]); }
                    }
                    if (solid(c, ly)) break;
                }
            }
            for (const dist of [1, 2]) {
                const c = x + dir * dist;
                const ty = y - 1;
                if (!standable(c, ty)) continue;
                let clear = true;
                if (dist === 2) {
                    const midX = x + dir;
                    if (solid(midX, ty) || hazard(midX, ty) || blk(midX, ty)) clear = false;
                }
                if (clear) {
                    edges.push({ ax: x, ay: y, bx: c, by: ty });
                    if (!seen.has(key(c, ty))) { seen.add(key(c, ty)); queue.push([c, ty]); }
                }
            }
        }
        if (corr !== null && corr !== undefined) {
            for (const nx of [x - 1, x + 1]) {
                const ny = isCorr(nx, y) ? y : (isCorr(nx, y + 1) ? y + 1 : -1);
                if (ny >= 0) {
                    edges.push({ ax: x, ay: y, bx: nx, by: ny });
                    if (!seen.has(key(nx, ny))) { seen.add(key(nx, ny)); queue.push([nx, ny]); }
                }
            }
        }
        // Boarding edge (shaft): terrain cell -> stop-row shaft cell, flush.
        if (shaft !== null && isShaftStopRow(y)) {
            for (const nx of [x - 1, x + 1]) {
                if (isShaft(nx, y)) {
                    edges.push({ ax: x, ay: y, bx: nx, by: y });
                    if (!seen.has(key(nx, y))) { seen.add(key(nx, y)); queue.push([nx, y]); }
                }
            }
        }
    }
    return edges;
}

// Articulation set over the shaft-aware graph (mirror of
// computeMustPassCells' algorithm with routeModelEdgesShaft).
function computeMustPassCellsShaft(level) {
    const { width, spawnTile, portalTile } = level;
    if (!portalTile) return null;
    const key = (x, y) => y * width + x;
    const startK = key(spawnTile.x, spawnTile.y);
    const goalK = key(portalTile.x, portalTile.y);
    const reach = (blocked) => {
        const adj = new Map();
        for (const e of routeModelEdgesShaft(level, blocked)) {
            const a = key(e.ax, e.ay);
            const b = key(e.bx, e.by);
            if (!adj.has(a)) adj.set(a, new Set());
            adj.get(a).add(b);
        }
        const prev = new Map([[startK, null]]);
        const q = [startK];
        while (q.length) {
            const k = q.shift();
            if (k === goalK) break;
            for (const n of adj.get(k) || []) {
                if (!prev.has(n)) { prev.set(n, k); q.push(n); }
            }
        }
        return prev.has(goalK) ? prev : null;
    };
    const first = reach(null);
    if (!first) return null;
    const path = [];
    for (let k = goalK; k !== null; k = first.get(k)) path.push(k);
    const mustPass = new Set();
    for (const k of path) {
        if (k === startK || k === goalK) continue;
        if (!reach(new Set([k]))) mustPass.add(k);
    }
    return mustPass;
}

function deployedBodies(level) {
    return level.getEnemyManager().enemies.map(e => ({
        col: Math.round(e.x / T),
        row: Math.round(e.y / T),
        left: Math.round(e.minX / T),
        right: Math.ceil(e.maxX / T) - 1
    }));
}

test("mirror sanity on a real shaft map: ride edges exist, blind graph has no route", () => {
    // Fidelity guard for the mirror above (a broken mirror would make the
    // pin below pass vacuously): the shaft-aware graph must contain the
    // cabin corridor as articulation cells, while the SHIPPED blind
    // computation finds no mandatory cell at all (load-bearing shaft).
    let checked = 0;
    for (let i = 0; i < 10 && checked < 3; i++) {
        // W3a re-pin: the probe moved L13 -> L16. L13 now lives in CANYONS
        // whose dirCycle reads horizontal there (no shafts exist); L16 is a
        // CAVERNS vertical with shaftChance 1.0 — the same load-bearing
        // shaft geometry the mirror assertions model.
        const level = new Level(16, T, 16 * 10000 + 1000 + i);
        if (!level.shaftGap) continue;
        checked++;
        const g = level.shaftGap;
        const blind = computeMustPassCells(level.tiles, level.width,
            level.height, level.spawnTile, level.portalTile, level.bridgeGap);
        expect(blind, `L16 s${160000 + 1000 + i}: shaft not load-bearing?`)
            .toBe(null);
        const mp = computeMustPassCellsShaft(level);
        expect(mp).not.toBe(null);
        expect(mp.size).toBeGreaterThan(0);
        // The mirror really models the RIDE: a horizontal rung across the
        // cabin at a rider row, a column-travel edge inside the chimney,
        // and a flush boarding edge from a stop ledge onto the cabin.
        const edges = routeModelEdgesShaft(level);
        const midRow = g.A - 1 + Math.floor((g.B - g.A) / 2);
        expect(edges.some(e => e.ax === g.sx && e.ay === midRow &&
            e.bx === g.ex && e.by === midRow)).toBe(true);
        expect(edges.some(e => e.ax === e.bx && e.ax >= g.sx && e.ax <= g.ex &&
            Math.abs(e.ay - e.by) === 1 && e.ay >= g.A - 1 &&
            e.ay <= g.B - 1 && e.by >= g.A - 1 && e.by <= g.B - 1)).toBe(true);
        expect(edges.some(e => (e.ax === g.sx - 1 || e.ax === g.ex + 1) &&
            e.ay === g.B - 1 && e.bx >= g.sx && e.bx <= g.ex &&
            e.by === g.B - 1)).toBe(true);
    }
    expect(checked).toBeGreaterThanOrEqual(1);
}, 60_000);

test("structural pin L13..L100 x 10 seeds: ZERO shaft-blind gauntlet configurations", () => {
    // Fresh disjoint seed family (seed = lvl*10000 + 1000 + i; prior waves
    // used lvl*1000+s bands only). Pinned outcome of the 2026-11-06
    // measurement: with shaft rides modeled, no vertical map hosts a
    // >=3-body zero-pocket stack on a must-pass neighborhood.
    let shaftMaps = 0, touchedMaps = 0, violMaps = 0, totalBodies = 0;
    for (let lvl = 13; lvl <= 100; lvl++) {
        // W3a: the legacy (lvl-5)%3 vertical stream is gone — take every
        // level whose PROFILE ships vertical (same disjoint seed family).
        if (directionForLevel(lvl) !== 'vertical') continue;
        for (let i = 0; i < 10; i++) {
            const seed = lvl * 10000 + 1000 + i;
            const level = new Level(lvl, T, seed);
            if (!level.shaftGap) continue;
            shaftMaps++;
            const mp = computeMustPassCellsShaft(level);
            expect(mp, `L${lvl} s${seed}: shaft-aware route vanished`).not.toBe(null);
            expect(mp.size).toBeGreaterThan(0);
            const bodies = deployedBodies(level);
            totalBodies += bodies.length;
            // Non-vacuity: does any body's neighborhood box touch a
            // shaft-aware must-pass cell at all? (Wave: 627/886 maps.)
            const key = (x, y) => y * level.width + x;
            let touched = false;
            for (const b of bodies) {
                for (let r = b.row - 1; r <= b.row + 1 && !touched; r++) {
                    for (let c = b.left - 2; c <= b.right + 2 && !touched; c++) {
                        if (mp.has(key(c, r))) touched = true;
                    }
                }
            }
            if (touched) touchedMaps++;
            const viol = gauntletViolations(level.tiles, level.width,
                level.height, bodies, mp, level.reachableTiles);
            if (viol.length) {
                violMaps++;
                console.log('FLAG', lvl, seed, JSON.stringify(
                    viol.map(v => ({ row: v.row, lo: v.lo, hi: v.hi, n: v.members.length }))));
            }
        }
    }
    // THE PIN: no shaft-blind gauntlet configuration in the sampled band.
    expect(violMaps).toBe(0);
    // Non-vacuous sampling: plenty of shaft maps, plenty of must-pass
    // contact, patrols still deploy.
    expect(shaftMaps).toBeGreaterThanOrEqual(100);
    expect(touchedMaps).toBeGreaterThanOrEqual(100);
    expect(totalBodies).toBeGreaterThan(100);
}, 60_000);
