// Unit: M4 secret-alcove geometry predicate (R5) and placement policy.
// The predicate is pure geometry on the PRE-carve grid; the finder layers
// entry reachability and hazard-zone clearance on top. Fixtures swap tiles
// wholesale (the sanctioned seam — same discipline level_capability_objects
// uses) so every conjunct gets an isolated positive AND negative.
import { test, expect } from "bun:test";
import { Level, alcoveGeometryValid } from "../../js/level.js";

const W = 14;
const H = 12;

// Canonical host crag: terrace cols 0..4 standable at row 9 over full ground
// (row 10+ solid); massif cols 5..8 rising to row 6. Site {col:6, entryRow:9,
// h:3, side:-1}: terrace (4,9), tunnel mouth cut at (5,9), shaft cols 6..7
// rows 7..9, flank wall col 5 above the tunnel row, far wall col 8, cap row 6.
const CRAG = [
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "..............",
    "......##......",
    ".....####.....",
    ".....####.....",
    ".....####.....",
    "##############",
    "##############"
];

function grid(rows) {
    return rows.map((r) => [...r].map((ch) => (ch === "#" ? 1 : ch === "^" ? 2 : 0)));
}

function mirror(rows) {
    return rows.map((r) => [...r].reverse().join(""));
}

const SITE = { col: 6, entryRow: 9, h: 3, side: -1 };

test("predicate accepts the canonical tunnel-mouth chimney for h=3..5", () => {
    // Taller massif so h=4/5 fit: rebuild with the cap raised.
    for (const h of [3, 4, 5]) {
        const rows = Array.from({ length: H }, () => ".".repeat(W));
        const e = 9;
        for (let r = e - h + 1; r <= e; r++) {
            rows[r] = ".".repeat(5) + "####" + ".".repeat(W - 9);
        }
        rows[e - h] = ".".repeat(6) + "##" + ".".repeat(W - 8);
        rows[10] = "#".repeat(W);
        rows[11] = "#".repeat(W);
        const tiles = grid(rows);
        expect(alcoveGeometryValid(tiles, W, H, { col: 6, entryRow: e, h, side: -1 }))
            .toBe(true);
        // Mirrored host serves side=+1 identically.
        const mt = grid(mirror(rows));
        expect(alcoveGeometryValid(mt, W, H, { col: W - 1 - 7, entryRow: e, h, side: 1 }))
            .toBe(true);
    }
});

test("predicate rejects every structural violation (isolated negatives)", () => {
    const base = grid(CRAG);
    expect(alcoveGeometryValid(base, W, H, SITE)).toBe(true); // sanity
    const mut = (r, c, v) => {
        const t = CRAG.map((row) => [...row]);
        t[r][c] = v;
        return t.map((row) => row.join("")).map((s) => [...s]).map((cs) => cs.map((ch) => (ch === "#" ? 1 : 0)));
    };
    // Cap removed -> not sealed -> reject.
    expect(alcoveGeometryValid(mut(6, 6, "."), W, H, SITE)).toBe(false);
    expect(alcoveGeometryValid(mut(6, 7, "."), W, H, SITE)).toBe(false);
    // Far wall opened at the BOTTOM row (first kick loses its face) -> reject.
    expect(alcoveGeometryValid(mut(9, 8, "."), W, H, SITE)).toBe(false);
    // Flank above the tunnel opened mid-height -> reject.
    expect(alcoveGeometryValid(mut(8, 5, "."), W, H, SITE)).toBe(false);
    // Tunnel cell already open (a pre-existing cave, nothing to cut) -> reject.
    expect(alcoveGeometryValid(mut(9, 5, "."), W, H, SITE)).toBe(false);
    // Terrace loses its floor -> reject.
    expect(alcoveGeometryValid(mut(10, 4, "."), W, H, SITE)).toBe(false);
    // Shaft floor loses solidity -> reject.
    expect(alcoveGeometryValid(mut(10, 6, "."), W, H, SITE)).toBe(false);
});

test("predicate rejects out-of-band heights, bogus sides and off-grid sites", () => {
    const base = grid(CRAG);
    expect(alcoveGeometryValid(base, W, H, { ...SITE, h: 2 })).toBe(false);
    expect(alcoveGeometryValid(base, W, H, { ...SITE, h: 6 })).toBe(false);
    expect(alcoveGeometryValid(base, W, H, { ...SITE, h: 3.5 })).toBe(false);
    expect(alcoveGeometryValid(base, W, H, { ...SITE, side: 0 })).toBe(false);
    expect(alcoveGeometryValid(base, W, H, { ...SITE, side: 2 })).toBe(false);
    // Same crag mirrored: a side=-1 reading at the mirrored col finds no
    // terrace (it points into the massif) -> reject.
    const mt = grid(mirror(CRAG));
    expect(alcoveGeometryValid(mt, W, H, { col: 7, entryRow: 9, h: 3, side: -1 }))
        .toBe(false);
    // Off-grid entry.
    expect(alcoveGeometryValid(base, W, H, { col: 6, entryRow: 11, h: 3, side: -1 }))
        .toBe(false);
});

test("a pre-existing 3-wide cave hosts NO site (width is exactly 2, R5)", () => {
    // Walls flanking an OPEN 3-wide slot: shaft columns are not solid rock,
    // so no site enumerates anywhere along it.
    const rows = [
        "..............",
        "..#.....#.....",
        "..#.....#.....",
        "..#.....#.....",
        "..#.....#.....",
        "..#.....#.....",
        "..#.....#.....",
        "..#.....#.....",
        "##############",
        "##############",
        "..............",
        ".............."
    ];
    const tiles = grid(rows);
    for (let e = 1; e <= H - 2; e++) {
        for (let c = 1; c <= W - 3; c++) {
            for (const side of [-1, 1]) {
                for (let h = 3; h <= 5; h++) {
                    expect(alcoveGeometryValid(tiles, W, H, { col: c, entryRow: e, h, side }))
                        .toBe(false);
                }
            }
        }
    }
});

// ── Finder policy layers (reachability + hazard zones) ─────────────────────

function hostLevel() {
    // A real Level provides the object graph the finder methods read; the
    // grid, reachable set and coin list are swapped to the crafted crag.
    const lvl = new Level(10, 32, 1234);
    lvl.tiles = grid(CRAG);
    lvl.width = W;
    lvl.height = H;
    lvl.coins.length = 0;
    lvl.pads.length = 0;
    lvl.crates.length = 0;
    lvl.enemyManager.enemies.length = 0;
    lvl.portalTile = { x: 12, y: 9 };
    lvl.spawnTile = { x: 1, y: 9 };
    // Only the terrace strip is base-reachable.
    lvl.reachableTiles = new Set();
    for (let x = 0; x <= 4; x++) lvl.reachableTiles.add(9 * W + x);
    return lvl;
}

test("finder requires a base-reachable terrace cell at the mouth", () => {
    const lvl = hostLevel();
    const cands = lvl._findAlcoveCandidates(new Set());
    expect(cands.some((s) => s.col === 6 && s.entryRow === 9 && s.h === 3 && s.side === -1))
        .toBe(true);
    // Strip reachability -> the very same geometry yields nothing.
    lvl.reachableTiles = new Set();
    expect(lvl._findAlcoveCandidates(new Set()).length).toBe(0);
});

test("finder keeps the footprint >= ALCOVE_FORBID_MARGIN clear of spikes", () => {
    // Footprint rect spans cols 4..8 rows 6..9 for the canonical site.
    const near = hostLevel();
    near.tiles[9][3] = 2; // spike 1 col off the terrace: zone reaches col 5
    expect(near._findAlcoveCandidates(near._alcoveForbiddenCells())
        .some((s) => s.col === 6 && s.entryRow === 9)).toBe(false);
    const far = hostLevel();
    far.tiles[9][1] = 2; // spike zone covers cols 0..3 only: footprint clears
    expect(far._findAlcoveCandidates(far._alcoveForbiddenCells())
        .some((s) => s.col === 6 && s.entryRow === 9)).toBe(true);
});

test("carve flips exactly the footprint, re-derives platforms, seeds 1..3 secrets", () => {
    const lvl = hostLevel();
    const before = lvl.tiles.map((r) => r.slice());
    lvl._carveAlcove(SITE);
    const a = lvl.getAlcove();
    expect(a).not.toBe(null);
    // Every flipped cell is air now; NOTHING else changed.
    const seen = new Set(a.flipped.map((f) => f.r * W + f.x));
    for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
            if (seen.has(r * W + c)) expect(lvl.tiles[r][c]).toBe(0);
            else expect(lvl.tiles[r][c]).toBe(before[r][c]);
        }
    }
    // Flipped set = tunnel + shaft (h rows x 2 cols + 1 tunnel) = 7 here.
    expect(a.flipped.length).toBe(SITE.h * 2 + 1);
    // Platforms match the carved grid cell-for-cell (no ghost rock).
    const solidCount = lvl.tiles.flat().filter((v) => v === 1).length;
    expect(lvl.platforms.length).toBe(solidCount);
    // Secret coins: 1..3, all inside INTERIOR cells (above the shaft floor).
    const secrets = lvl.coins.filter((c) => c.secret);
    expect(secrets.length).toBeGreaterThanOrEqual(1);
    expect(secrets.length).toBeLessThanOrEqual(3);
    for (const c of secrets) {
        const cx = Math.floor((c.x + c.width / 2) / 32);
        const cy = Math.floor((c.y + c.height / 2) / 32);
        expect(cy).toBeLessThan(a.entryRow);
        expect(cx === a.col || cx === a.col + 1).toBe(true);
    }
});

test("retry-exact: the same seed carves the identical alcove and coins", () => {
    // Deterministic end-to-end: two constructions of one seed agree byte-wise
    // on tiles, alcove descriptor and secret coin layout whenever one ships
    // (fixture-proven below for the carve path itself).
    const mk = () => {
        const lvl = hostLevel();
        lvl._carveAlcove(SITE);
        return JSON.stringify({
            tiles: lvl.tiles,
            alcove: lvl.getAlcove(),
            coins: lvl.coins
        });
    };
    expect(mk()).toBe(mk());
});
