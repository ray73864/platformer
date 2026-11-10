// Unit: R5 SOUNDNESS family — the geometric alcove predicate is adjudicated
// against the REAL shipped engine (Player + Physics + wallContactSide, the
// main.js frame order for the wall-jump mechanics), across the parameterized
// shape family h=3..5, using the alternating-kick policy doctrine from the
// wjchimney adjudication (388de44 era). This is the pinned proof that every
// predicate-accepted chimney is climbable; generator NEVER runs this probe
// per generation (R5) — if physics and predicate ever drift, THIS test goes
// red first.
//
// Negatives are pinned at the PREDICATE level exactly as the brief demands:
// a 3-wide shaft is unclimbable-BY-PREDICATE (the wjchimney adjudication
// showed wide shafts physically climb but single-wall ladders stay starved —
// the predicate rejects width != 2 regardless), a 1-wide mouth is rejected,
// an uncapped shaft is rejected.
import { test, expect } from "bun:test";
import { Player, wallContactSide } from "../../js/player.js";
import { Physics } from "../../js/physics.js";
import { alcoveGeometryValid } from "../../js/level.js";

const T = 32;
const DT = 1 / 60;

function tilesToRects(rows) {
    const rects = [];
    rows.forEach((row, ty) => {
        [...row].forEach((ch, tx) => {
            if (ch === "#") rects.push({ x: tx * T, y: ty * T, width: T, height: T });
        });
    });
    return rects;
}

// One sim step in the shipped wall-jump order (press -> update -> gravity ->
// resolve -> wall probe), identical to wall_jump_loop.test.js's harness.
function step(p, physics, platforms, inp) {
    if (inp.press) p.pressJump();
    p.prevX = p.x;
    p.prevY = p.y;
    p.update(DT, !!inp.l, !!inp.r, {});
    physics.applyGravity(p, DT);
    physics.resolveCollisions(p, physics.checkCollisions(p, platforms));
    p.setWallContact(wallContactSide(p, platforms));
}

// Alternating chimney climber (wall_jump_loop doctrine): hop toward a wall
// from the floor, steer FRESH toward the far face mid-air, kick whenever a
// not-yet-used face reports contact and the lock expired.
function climber(p) {
    if (p.grounded) return { press: true, r: true };
    const towardR = p.wallSide !== 1;
    const fresh = p._airFrames > 2;
    const press = p.wallSide !== 0 && p.wallLockTimer <= 0 &&
        p.wallSide !== p.lastKickSide;
    return { press, l: towardR ? false : fresh, r: towardR ? fresh : false };
}

// Plain double-walled chimney (the wjchimney shape), shaft cols 6..7,
// interior rows top..floorRow, cap above.
function plainChimney(h) {
    const H = 12, W = 12;
    const rows = Array.from({ length: H }, () => ".".repeat(W));
    const floorRow = 9; // standable shaft-floor row
    for (let r = floorRow - h + 1; r <= floorRow; r++) {
        rows[r] = "......#..#....".slice(0, W);
    }
    rows[floorRow - h] = "......####....".slice(0, W);
    rows[10] = "#".repeat(W);
    rows[11] = "#".repeat(W);
    return { rows, W, H, floorRow, topRow: floorRow - h + 1 };
}

// Tunnel-mouth chimney AS SHIPPED by placeAlcove (side=-1), POST-carve state:
// terrace left; tunnel cell (5, floorRow) open; shaft cols 6..7 open from the
// floor up to the top interior row; flank col 5 solid ABOVE the tunnel row;
// far wall col 8 solid over the full shaft height; cap closing the top.
function tunnelChimney(h) {
    const H = 12, W = 14;
    const rows = Array.from({ length: H }, () => ".".repeat(W));
    const floorRow = 9;
    const topRow = floorRow - h + 1;
    // Pre-carve grid kept for the predicate sanity check.
    const pre = Array.from({ length: H }, () => ".".repeat(W));
    for (let r = topRow; r <= floorRow; r++) {
        pre[r] = (".....####" + ".....").slice(0, W);
    }
    pre[floorRow - h] = ("......##" + "......").slice(0, W);
    pre[10] = "#".repeat(W);
    pre[11] = "#".repeat(W);
    // Post-carve: flip tunnel + shaft. Interior rows keep flank (col 5) and
    // far wall (col 8); the floor row keeps only the far wall.
    for (let r = topRow; r <= floorRow - 1; r++) {
        rows[r] = ".....#..#.....";
    }
    rows[floorRow] = "........#.....";
    rows[floorRow - h] = ("......##" + "......").slice(0, W);
    rows[10] = "#".repeat(W);
    rows[11] = "#".repeat(W);
    return { rows, pre, W, H, floorRow, topRow };
}

function climb(rows, startX, startY, frames, guide) {
    const platforms = tilesToRects(rows);
    const physics = new Physics(980, 600);
    const p = new Player(startX, startY, 200, 350);
    let bestY = startY + p.height; // feet line
    for (let f = 0; f < frames; f++) {
        const inp = guide ? guide(p, f) : climber(p);
        step(p, physics, platforms, inp);
        bestY = Math.min(bestY, p.y + p.height);
    }
    return { climbedRows: (startY + p.height - bestY) / T, finalX: p.x, finalY: p.y };
}

test("plain 2-wide chimneys climb for every predicate-legal h=3..5", () => {
    for (const h of [3, 4, 5]) {
        const c = plainChimney(h);
        const res = climb(c.rows, 7 * T, (c.floorRow) * T, 900);
        // The kick chain gains >= 1 row per exchange: the body must REACH the
        // top interior cell (feet rise h-1 rows off the shaft floor line).
        expect(res.climbedRows).toBeGreaterThanOrEqual(h - 1 - 0.01);
    }
});

test("tunnel-mouth chimneys (the shipped carve shape) climb for h=3..5", () => {
    for (const h of [3, 4, 5]) {
        const c = tunnelChimney(h);
        // Predicate sanity FIRST: the PRE-carve fixture is exactly what the
        // generator would accept and carve.
        expect(alcoveGeometryValid(
            c.pre.map((r) => [...r].map((ch) => (ch === "#" ? 1 : 0))),
            c.W, c.H, { col: 6, entryRow: c.floorRow, h, side: -1 }
        )).toBe(true);
        // Enter through the mouth (hold right until inside the shaft), then
        // hand over to the alternating climber.
        let entered = false;
        const guide = (p) => {
            if (!entered && p.grounded && p.x >= 6 * T - 4) entered = true;
            if (!entered) return { press: false, r: true };
            return climber(p);
        };
        const res = climb(c.rows, 3 * T, (c.floorRow) * T, 1200, guide);
        expect(res.climbedRows).toBeGreaterThanOrEqual(h - 1 - 0.01);
    }
});

test("predicate negatives: 3-wide, 1-wide and no-cap shapes never ship", () => {
    // 3-wide open slot between walls: nothing solid to carve -> no site.
    const wide = [
        "..............",
        "..#.......#...",
        "..#.......#...",
        "..#.......#...",
        "..#.......#...",
        "..#.......#...",
        "##############",
        "##############",
        "..............",
        "..............",
        "..............",
        ".............."
    ].map((r) => [...r].map((ch) => (ch === "#" ? 1 : 0)));
    let anyWideSite = false;
    for (let e = 1; e <= 10; e++) {
        for (let c = 1; c <= 11; c++) {
            for (const side of [-1, 1]) {
                for (let h = 3; h <= 5; h++) {
                    if (alcoveGeometryValid(wide, 14, 12, { col: c, entryRow: e, h, side })) {
                        anyWideSite = true;
                    }
                }
            }
        }
    }
    expect(anyWideSite).toBe(false);
    // 1-wide crack: the shaft is 2 columns by definition -> reject.
    const narrow = [
        "..............",
        "......#.#.....",
        "......#.#.....",
        "......#.#.....",
        "......###.....",
        "##############",
        "..............",
        "..............",
        "..............",
        "..............",
        "..............",
        ".............."
    ].map((r) => [...r].map((ch) => (ch === "#" ? 1 : 0)));
    expect(alcoveGeometryValid(narrow, 14, 12, { col: 6, entryRow: 4, h: 3, side: -1 }))
        .toBe(false);
    // No cap: rejected even when everything else lines up (CRAG minus cap).
    const noCap = [
        "..............",
        "..............",
        "..............",
        "..............",
        "..............",
        "..............",
        "......#..#....",
        ".....####.....",
        ".....####.....",
        ".....####.....",
        "##############",
        "##############"
    ].map((r) => [...r].map((ch) => (ch === "#" ? 1 : 0)));
    expect(alcoveGeometryValid(noCap, 14, 12, { col: 6, entryRow: 9, h: 3, side: -1 }))
        .toBe(false);
});

// ---------------------------------------------------------------------------
// W3b CLASS B — face chambers embedded in mesa-step relief (the new host
// shape the fill planner manufactures on horizontal maps). The post-carve
// interior is the SAME proven chimney family, but the doctrine demands an
// explicit sim over the new host's parameterized shape: deep entry row,
// NATURAL cap inside the massif body, flank/far walls carried by the step's
// own rock. Fixture geometry mirrors measured shipped layouts (e.g. L11
// seed 191841: massif pillar rising above the walk line, mouth at the
// standable row, chamber fully sub-surface under the pillar cap).
// ---------------------------------------------------------------------------
function faceChamber(h, side = -1) {
    const H = 14, W = 16;
    const pre = Array.from({ length: H }, () => ".".repeat(W));
    const e = 10;                       // entry row == walk-line row
    const topRow = e - h;               // natural cap row (pillar top)
    // Walk-line ground under rows 11..13, full width.
    for (let r = 11; r < H; r++) pre[r] = "#".repeat(W);
    // Massif pillar: cols 5..8; cap row carries cols 6..7 only.
    for (let r = topRow + 1; r <= 10; r++) {
        for (const x of [5, 6, 7, 8]) pre[r] = slice(pre[r], x, "#");
    }
    for (const x of [6, 7]) pre[topRow] = slice(pre[topRow], x, "#");
    // Mirror for side +1 (terrace on the right).
    const rows = side === -1 ? pre : pre.map((r) => [...r].reverse().join(""));
    const c = side === -1 ? 6 : W - 1 - 7;   // shaft left column
    const grid = rows.map((r) => [...r].map((ch) => (ch === "#" ? 1 : 0)));
    return { grid, W, H, e, c, topRow, side };
}
function slice(row, x, ch) {
    return row.slice(0, x) + ch + row.slice(x + 1);
}

test("class-B face chambers pass the predicate pre-carve for h=3..5, both sides", () => {
    for (const side of [-1, 1]) {
        for (const h of [3, 4, 5]) {
            const f = faceChamber(h, side);
            expect(alcoveGeometryValid(f.grid, f.W, f.H,
                { col: f.c, entryRow: f.e, h, side }), `h=${h} side=${side}`)
                .toBe(true);
        }
    }
});

test("class-B face chambers climb through the mouth for h=3..5 (real engine)", () => {
    for (const h of [3, 4, 5]) {
        const f = faceChamber(h, -1);
        // Carve exactly like _carveAlcove: mouth + shaft columns.
        const post = f.grid.map((r) => r.slice());
        post[f.e][f.c - 1] = 0;
        for (let r = f.e - h + 1; r <= f.e; r++) { post[r][f.c] = 0; post[r][f.c + 1] = 0; }
        const rowsStr = post.map((r) => r.map((t) => (t === 1 ? "#" : ".")).join(""));
        // Walk in from the terrace (hold right until inside the shaft),
        // then hand over to the alternating climber (tunnel-mouth doctrine).
        let entered = false;
        const guide = (p) => {
            if (!entered && p.grounded && p.x >= f.c * T - 4) entered = true;
            if (!entered) return { press: false, r: true };
            return climber(p);
        };
        const res = climb(rowsStr, 2 * T, f.e * T, 1500, guide);
        expect(entered, `enter h=${h}`).toBe(true);
        expect(res.climbedRows, `climb h=${h}`)
            .toBeGreaterThanOrEqual(h - 1 - 0.01);
    }
});

test("class-B face chambers climb for h=3..5 on BOTH sides (away-mouth doctrine)", () => {
    // The W3b natural-loop finding, pinned at sim level: a grounded hop
    // toward the OPEN mouth lets the bottom-row wall kick slide the player
    // straight back out through the tunnel cell. Grounded hops must steer
    // DEEP (away from the mouth); mid-air steering stays face-toward-wall.
    const deepClimber = (p, deepRight) => {
        if (p.grounded) return deepRight
            ? { press: true, r: true }
            : { press: true, l: true };
        const towardR = p.wallSide !== 1;
        const fresh = p._airFrames > 2;
        const press = p.wallSide !== 0 && p.wallLockTimer <= 0 &&
            p.wallSide !== p.lastKickSide;
        return { press, l: towardR ? false : fresh, r: towardR ? fresh : false };
    };
    for (const side of [-1, 1]) {
        for (const h of [3, 4, 5]) {
            const f = faceChamber(h, side);
            const post = f.grid.map((r) => r.slice());
            const tunnelX = side === -1 ? f.c - 1 : f.c + 2;
            post[f.e][tunnelX] = 0;
            for (let r = f.e - h + 1; r <= f.e; r++) {
                post[r][f.c] = 0; post[r][f.c + 1] = 0;
            }
            const rowsStr = post.map((r) =>
                r.map((t) => (t === 1 ? "#" : ".")).join(""));
            let entered = false;
            const deepRight = side === -1;
            // Shaft-centre entry (edge thresholds start the climb half in
            // the tunnel cell, where the first kick escapes outward).
            const inside = (p) => side === -1
                ? p.x >= (f.c + 1) * T - 6
                : p.x <= (f.c + 1) * T + 6;
            const guide = (p) => {
                if (!entered && p.grounded && inside(p)) entered = true;
                if (!entered) return { press: false, r: deepRight, l: !deepRight };
                return deepClimber(p, deepRight);
            };
            const startX = side === -1 ? 2 * T : (f.W - 3) * T;
            const res = climb(rowsStr, startX, f.e * T, 1500, guide);
            expect(entered, `enter h=${h} side=${side}`).toBe(true);
            expect(res.climbedRows, `climb h=${h} side=${side}`)
                .toBeGreaterThanOrEqual(h - 1 - 0.01);
        }
    }
});

test("class-B negatives: no cap, no terrace floor, hazard in the shaft", () => {
    const h = 3;
    const f = faceChamber(h, -1);
    const noCap = f.grid.map((r) => r.slice());
    noCap[f.e - h][f.c] = 0; noCap[f.e - h][f.c + 1] = 0;
    expect(alcoveGeometryValid(noCap, f.W, f.H,
        { col: f.c, entryRow: f.e, h, side: -1 })).toBe(false);
    const noTerraceFloor = f.grid.map((r) => r.slice());
    noTerraceFloor[f.e + 1][f.c - 2] = 0;
    expect(alcoveGeometryValid(noTerraceFloor, f.W, f.H,
        { col: f.c, entryRow: f.e, h, side: -1 })).toBe(false);
    const spiked = f.grid.map((r) => r.slice());
    spiked[f.e - 1][f.c] = 2; // spike where the stamp would need rock
    expect(alcoveGeometryValid(spiked, f.W, f.H,
        { col: f.c, entryRow: f.e, h, side: -1 })).toBe(false);
});
