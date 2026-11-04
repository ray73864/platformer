// Bombardier state machine (player request 2026-11-04: "enemies that charge
// and shoot :)"). Pure-unit level: hand-built terrain adapters, a stub
// projectile sink, and scripted player poses pin —
//  * the ranged trigger zone (3..8 cols, ±1.5 rows, facing, arc-clear) and
//    every boundary where it must NOT arm;
//  * the 0.6 s visible windup before any shot exists (fairness floor);
//  * the one-live-shot cap (no suppression barrages);
//  * the close leg reusing charger semantics EXACTLY (windup -> dash at
//    2.2x, bounds clamp, cooldown);
//  * the documented ranged->close abort switch when the player closes into
//    the muzzle mid-windup;
//  * dt extremes and the no-player patrol contract.
import { test, expect } from "bun:test";
import { Enemy, ENEMY_STATES } from "../../js/enemies.js";

const T = 32;
const DT = 1 / 60;

function makeTerrain(cols = 40, rows = 12, solids = []) {
    const tiles = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const [c, r] of solids) tiles[r][c] = 1;
    return {
        tileSize: T, width: cols, height: rows,
        isSolidPx(px, py) {
            const c = Math.floor(px / T), r = Math.floor(py / T);
            if (c < 0 || c >= cols) return true;
            if (r < 0 || r >= rows) return false;
            return tiles[r][c] === 1;
        }
    };
}

// Recording stand-in for ProjectileManager: spawn() returns a live object
// whose .dead flag the gun reads for its one-shot cap.
function stubProjectiles() {
    return {
        shots: [],
        spawn(x, y, vx, vy, owner) {
            const p = { x, y, vx, vy, dead: false, owner };
            this.shots.push(p);
            return p;
        }
    };
}

// Player standing with CENTRE `cols` tile-columns from the gun's centre
// (the zone math is centre-to-centre), feet `rows` rows below the gun's.
function targetAt(e, cols, rows = 0) {
    const cx = e.x + e.width / 2 + cols * T;
    const feet = e.y + e.height + rows * T;
    return { x: cx - 16, y: feet - 48, width: 32, height: 48, vy: 0, prevY: feet - 48 };
}

// Bombardier centred at tile column `col`, row 8, patrolling a wide-open
// span, initially facing RIGHT.
function bombardier(col = 5, opts = {}) {
    const terrain = opts.terrain || makeTerrain();
    const projectiles = opts.projectiles || stubProjectiles();
    const e = new Enemy(col * T, 8 * T, (col - 2) * T, (col + 8) * T,
        'bombardier', { projectiles, terrain });
    return { e, projectiles, terrain };
}

function step(e, player, seconds, dt = DT) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) e.update(dt, player);
}

test("in-zone target: 0.6 s telegraph FIRST, then exactly one shot", () => {
    const { e, projectiles } = bombardier(5);
    const player = targetAt(e, 5);
    e.update(DT, player);
    expect(e.state).toBe('windup_ranged');
    expect(projectiles.shots.length).toBe(0); // NOTHING pre-telegraph

    // Mid-windup still nothing at ~0.4 s (fairness floor is >= 0.5 s).
    step(e, player, 0.4);
    expect(e.state).toBe('windup_ranged');
    expect(projectiles.shots.length).toBe(0);

    step(e, player, 0.25);                     // crosses 0.6 s with margin
    expect(e.state).toBe('cooldown_ranged');
    expect(projectiles.shots.length).toBe(1);
    const shot = projectiles.shots[0];
    expect(shot.vx).toBeGreaterThan(0);         // fired toward the player
    expect(Math.abs(shot.vx)).toBeLessThanOrEqual(150 + 1e-9);
    expect(shot.owner).toBe(e);
});

test("trigger zone boundaries: 2.5 cols charges, 3..8 fires, 9 waits", () => {
    // 10 columns away and ONE second of observation: the gun walks 40 px
    // (1.25 cols) toward the target, so the gap never drops under the 8-col
    // ranged ceiling — stays patrolling.
    let g = bombardier(5);
    step(g.e, targetAt(g.e, 10), 1.0);
    expect(g.e.state).toBe('patrol');
    expect(g.projectiles.shots.length).toBe(0);

    // 2.5 columns: CLOSE leg wins — charger-style windup, never a volley.
    g = bombardier(5);
    g.e.update(DT, targetAt(g.e, 2.5));
    expect(g.e.state).toBe('windup');
    expect(g.projectiles.shots.length).toBe(0);

    // Just inside 3 cols: ranged arms.
    g = bombardier(5);
    g.e.update(DT, targetAt(g.e, 3.1));
    expect(g.e.state).toBe('windup_ranged');

    // Two rows off the feet line: neither leg cares.
    g = bombardier(5);
    step(g.e, targetAt(g.e, 5, 2), 1.0);
    expect(g.e.state).toBe('patrol');

    // Behind the muzzle: facing veto holds for both legs.
    g = bombardier(5);
    step(g.e, targetAt(g.e, -5), 1.0);
    expect(g.e.state).toBe('patrol');
    expect(g.projectiles.shots.length).toBe(0);
});

test("blocked firing arc vetoes the shot (same pose without cover fires)", () => {
    // Wall column between gun (col 5) and player (col 10): the predicted
    // arc runs straight into it.
    const walled = makeTerrain(40, 12, [[8, 5], [8, 6], [8, 7], [8, 8]]);
    const g = bombardier(5, { terrain: walled });
    step(g.e, targetAt(g.e, 5), 1.2);
    expect(g.e.state).toBe('patrol');
    expect(g.projectiles.shots.length).toBe(0);

    // Control: identical everything, wall removed -> shot goes off.
    const open = bombardier(5);
    step(open.e, targetAt(open.e, 5), 1.2);
    expect(open.projectiles.shots.length).toBe(1);
});

test("one live shot caps re-fire until it dies", () => {
    // 7 columns keeps the walking gun OUTSIDE the 2.5-col close band for
    // the whole observation window (patrol eats ~40 px/s of the gap).
    const { e, projectiles } = bombardier(5);
    const player = targetAt(e, 7);
    step(e, player, 0.7);                      // first shot away
    expect(projectiles.shots.length).toBe(1);

    // Cooldown expires, target still standing in the open: NO second shot
    // while the first ball is alive (no suppression barrages, ruling).
    step(e, player, 2.2);
    expect(projectiles.shots.length).toBe(1);
    expect(e.state).not.toBe('cooldown_ranged');

    // Ball lands -> barrel frees -> it re-arms and fires again.
    projectiles.shots[0].dead = true;
    step(e, player, 1.0);
    expect(projectiles.shots.length).toBe(2);
});

test("close leg IS the charger leg: windup -> 2.2x dash -> bound clamp", () => {
    const { e } = bombardier(5);
    const player = targetAt(e, 2);
    e.update(DT, player);
    expect(e.state).toBe('windup');
    expect(e.vx).toBe(0); // planted telegraph

    step(e, player, 0.5);
    expect(e.state).toBe('dash');
    expect(e.vx).toBeCloseTo(40 * 2.2); // charger multiplier, toward player

    // Dash can NEVER leave [minX, maxX]: run it long and check the clamp.
    for (let i = 0; i < 180; i++) {
        e.update(DT, player);
        expect(e.x).toBeGreaterThanOrEqual(e.minX);
        expect(e.x + e.width).toBeLessThanOrEqual(e.maxX);
    }
});

test("player CLOSING mid-ranged-windup aborts the shot into a charge", () => {
    const { e, projectiles } = bombardier(5);
    const player = targetAt(e, 5);
    e.update(DT, player);
    expect(e.state).toBe('windup_ranged');

    // Walk into the muzzle before the telegraph completes...
    step(e, player, 0.3);
    const close = targetAt(e, 1.5);
    e.update(DT, close);
    expect(e.state).toBe('windup');            // switched to the close leg
    expect(projectiles.shots.length).toBe(0);  // and NOTHING was fired

    // ...and the committed charge resolves with charger semantics.
    step(e, close, 0.5);
    expect(e.state).toBe('dash');
});

test("leaving the ranged band aborts back to patrol unpaid by a shot", () => {
    const { e, projectiles } = bombardier(5);
    const player = targetAt(e, 5);
    e.update(DT, player);
    expect(e.state).toBe('windup_ranged');
    step(e, player, 0.3);

    // Sprint out past max range mid-telegraph -> stand down.
    e.update(DT, targetAt(e, 12));
    expect(e.state).toBe('patrol');
    expect(projectiles.shots.length).toBe(0);
});

test("dt extremes: huge and zero steps never crash or skip states illegally", () => {
    const { e, projectiles } = bombardier(5);
    const player = targetAt(e, 5);

    e.update(0, player);                       // frozen tick
    expect(e.state).toBe('windup_ranged');     // armed but time did not pass
    expect(projectiles.shots.length).toBe(0);

    // Monster frames (dt-cap overshoot scenario): transitions stay legal,
    // the one-live-shot cap holds (the stub ball never dies, so AT MOST
    // one shot may exist across all 30 five-second frames), and every
    // visited state is a declared ENEMY_STATE.
    for (let i = 0; i < 30; i++) {
        e.update(5, player);
        expect(ENEMY_STATES).toContain(e.state);
    }
    expect(projectiles.shots.length).toBe(1);
});

test("no player reference: bombardiers patrol forever and never fire", () => {
    const { e, projectiles } = bombardier(5);
    step(e, null, 5.0);
    expect(e.state).toBe('patrol');
    expect(projectiles.shots.length).toBe(0);
});

test("a dead bombardier stops simulating (its live ball keeps flying)", () => {
    const { e, projectiles } = bombardier(5);
    step(e, targetAt(e, 5), 0.7);
    expect(projectiles.shots.length).toBe(1);
    const ball = projectiles.shots[0];
    e.die();
    const x = e.x;
    step(e, targetAt(e, 5), 1.0);
    expect(e.x).toBe(x);             // corpse frozen
    expect(ball.dead).toBe(false);   // documented: fired shots outlive the gun
});
