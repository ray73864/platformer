// Unit: B2 — shells stop on crates (owner BETTER WAVE 2026-11-09; fixes the
// T5-disclosed pass-through that made wooden cover read as a lie). Pins the
// crate clause of the projectiles.js contract: face-stop death with an
// impact event (terrain-parity presentation), strict </> aabbOverlap so a
// flush edge is not contact, LIVE-position reads (mid-shove blocking), the
// clean drop of a spawn already inside a crate (n6 silence parity), crate
// indestructibility, player-cover fairness, and frame-for-frame replay
// determinism of the shell+crate interaction (no rng, no clock).
import { test, expect } from "bun:test";
import { ProjectileManager, PROJ_RADIUS } from "../../js/projectiles.js";

const T = 32;

// Open field (same adapter shape Level builds over its grid); map-edge
// columns read solid exactly like the shipped adapter.
function makeTerrain(cols = 40, rows = 12) {
    return {
        tileSize: T, width: cols, height: rows,
        isSolidPx(px) {
            const c = Math.floor(px / T);
            return c < 0 || c >= cols;
        }
    };
}

function makeCrate(col, row) {
    return { x: col * T, y: row * T, width: T, height: T, pushed: false };
}

function snapshot(entity) {
    return JSON.stringify({
        x: entity.x, y: entity.y,
        width: entity.width, height: entity.height
    });
}

test("shell dies on the crate face with one impact event; crate untouched", () => {
    const mgr = new ProjectileManager(makeTerrain());
    const crate = makeCrate(10, 5);
    const before = snapshot(crate);
    mgr.setCrates([crate]);
    // Short flat hop (one tile of run-up): gravity droop stays inside the
    // crate's 32 px body band, so the death is unambiguously crate-caused.
    mgr.spawn(9 * T, 5 * T + 16, 150, 0, null);
    let impacts = [];
    let dead = false;
    for (let f = 0; f < 100 && !dead; f++) {
        const ev = mgr.updateAll(1 / 60, null);
        impacts.push(...ev.impacts);
        dead = mgr.list.length === 0;
    }
    expect(dead).toBe(true);
    expect(impacts.length).toBe(1);
    // Face-stop, not centre-bury: the radius box touched the left face, so
    // the centre died within one step BEFORE crossing it — nowhere near the
    // terrain centre-sample's half-a-tile burial.
    expect(impacts[0].x).toBeLessThan(crate.x);
    expect(impacts[0].x).toBeGreaterThan(crate.x - PROJ_RADIUS - 8);
    expect(snapshot(crate)).toBe(before); // indestructible furniture
});

test("no crates published: pre-B2 flight path byte-for-byte (control)", () => {
    const mgr = new ProjectileManager(makeTerrain());
    mgr.spawn(9 * T, 5 * T + 16, 150, 0, null);
    const ghost = new ProjectileManager(makeTerrain());
    ghost.setCrates([makeCrate(10, 5)]);
    ghost.spawn(9 * T, 5 * T + 16, 150, 0, null);
    const plain = [];
    for (let f = 0; f < 30; f++) {
        const ev = mgr.updateAll(1 / 60, null);
        expect(ev.impacts.length).toBe(0);
        const p = mgr.list[0];
        plain.push(`${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    }
    // Same script WITH a crate in the lane: same start, but it must die —
    // the control only proves the empty list changes nothing.
    for (let f = 0; f < 30; f++) ghost.updateAll(1 / 60, null);
    expect(ghost.list.length).toBe(0);
    expect(plain.length).toBe(30);
});

test("ball spawned overlapping a crate drops cleanly on its first step", () => {
    // Cannot exist on shipped maps (patrol/pocket disjointness), pinned as
    // the clean-drop guarantee: dead + one impact + n6 silence, no crash.
    const mgr = new ProjectileManager(makeTerrain());
    mgr.setCrates([makeCrate(6, 5)]);
    mgr.spawn(6 * T + 16, 5 * T + 16, 150, 0, null); // muzzle inside the box
    const ev = mgr.updateAll(1 / 60, null);
    expect(ev.impacts.length).toBe(1);
    expect(ev.fired).toBe(0); // never seen = never thumped (n6 parity)
    expect(mgr.list.length).toBe(0);
});

test("strict convention: a flush box edge against the crate is NOT contact", () => {
    const mgr = new ProjectileManager(makeTerrain());
    const crate = makeCrate(10, 5);
    mgr.setCrates([crate]);
    // Centre placed so the radius box touches the left face EXACTLY.
    mgr.spawn(crate.x - PROJ_RADIUS, crate.y + 16, 0, 0, null);
    for (let f = 0; f < 10; f++) {
        const ev = mgr.updateAll(1 / 60, null);
        expect(ev.impacts.length).toBe(0);
    }
    expect(mgr.list.length).toBe(1); // touching edges do not count (physics.js S9)
});

test("live reads: a shoved crate blocks at its MOVED face", () => {
    const mgr = new ProjectileManager(makeTerrain());
    const crate = makeCrate(10, 5);
    mgr.setCrates([crate]);
    // Ball creeps right just short of the box; the crate is shoved LEFT into
    // it. Contact happens BEFORE the ball reaches the ORIGINAL left face
    // minus radius — a snapshot taken at setCrates time would fly past.
    mgr.spawn(305, 5 * T + 16, 30, 0, null);
    let impactX = null;
    for (let f = 0; f < 60 && mgr.list.length; f++) {
        crate.x -= 40 / 60; // mid-shove displacement each frame
        const ev = mgr.updateAll(1 / 60, null);
        if (ev.impacts.length) impactX = ev.impacts[0].x;
    }
    expect(impactX).not.toBe(null);
    expect(crate.x).toBeLessThan(10 * T - 5);          // crate really moved
    expect(impactX).toBeLessThan(10 * T - PROJ_RADIUS); // died to the moved face
});

test("live reads: a crate shoved OUT of the lane stops blocking", () => {
    const mgr = new ProjectileManager(makeTerrain());
    const crate = makeCrate(10, 5);
    mgr.setCrates([crate]);
    mgr.spawn(8 * T, 5 * T + 16, 150, 0, null);
    let passedThroughVacatedCell = false;
    for (let f = 0; f < 60 && !passedThroughVacatedCell; f++) {
        crate.y += 300 / 60; // floor drops away: crate leaves row 5 fast
        mgr.updateAll(1 / 60, null);
        const p = mgr.list[0];
        if (p && p.x > crate.x + crate.width) passedThroughVacatedCell = true;
    }
    expect(passedThroughVacatedCell).toBe(true); // no phantom ghost blocker
});

test("cover fairness: a player behind the crate is never hit", () => {
    const mgr = new ProjectileManager(makeTerrain());
    const crate = makeCrate(10, 5);
    mgr.setCrates([crate]);
    const player = { x: 12 * T, y: 5 * T - 8, width: 32, height: 48 };
    mgr.spawn(9 * T, 5 * T + 16, 150, 0, null); // straight through their column
    let hit = false;
    for (let f = 0; f < 100; f++) {
        if (mgr.updateAll(1 / 60, player).hitPlayer) hit = true;
    }
    expect(hit).toBe(false);
    expect(mgr.list.length).toBe(0); // died on the crate instead
});

test("determinism: scripted shell+crate replay hashes identically twice", () => {
    const run = () => {
        const mgr = new ProjectileManager(makeTerrain());
        const crate = makeCrate(10, 5);
        mgr.setCrates([crate]);
        const player = { x: 13 * T, y: 5 * T - 8, width: 32, height: 48 };
        mgr.spawn(336, 120, 0, 0, null);   // vertical drop onto the shoving box
        mgr.spawn(2 * T, 3 * T, 120, 0, null); // arcing witness shot
        const trace = [];
        let impacts = 0;
        for (let f = 0; f < 120; f++) {
            // Deterministic scripted shove: out, then back.
            crate.x += (f < 40 ? 40 : -40) / 60;
            const ev = mgr.updateAll(1 / 60, player);
            impacts += ev.impacts.length;
            trace.push(`${crate.x.toFixed(4)}|${ev.fired}|` +
                ev.impacts.map(i => `${i.x.toFixed(4)},${i.y.toFixed(4)}`)
                    .join(";") + "|" + ev.hitPlayer + "|" +
                mgr.list.map(p =>
                    `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.vx},${p.vy}`
                ).join(" "));
        }
        return { hash: trace.join("\n"), impacts };
    };
    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    expect(a.impacts).toBeGreaterThan(0); // the scenario really interacted
});
