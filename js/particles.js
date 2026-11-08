// Minimal particle system for game feel (coin bursts, death shake sparks).
// Pure data + step function so the simulation is unit-testable without a
// canvas; drawing is a dumb rect pass with alpha from remaining life.

export const MAX_PARTICLES = 120;

// Push a radial burst of `count` sparks at (x, y). The list is capped at
// MAX_PARTICLES: oldest particles are dropped first so sustained effects
// can never grow unbounded.
export function spawnBurst(list, x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const speed = 60 + Math.random() * 90;
        list.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 40, // slight upward bias reads as sparkle
            life: 0.5 + Math.random() * 0.3,
            maxLife: 0.8,
            size: 3 + Math.random() * 3,
            color
        });
    }
    if (list.length > MAX_PARTICLES) {
        list.splice(0, list.length - MAX_PARTICLES);
    }
    return list;
}

// Advance every particle; dead ones are removed in place. Gravity keeps
// bursts falling — coins spark up then rain down.
export function stepParticles(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) {
            list.splice(i, 1);
            continue;
        }
        p.vy += 260 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
    return list;
}

// Optional per-particle `alpha` multiplier (Wave B dust rides a low value so
// it never fogs the playfield); absent means fully opaque at full life.
export function drawParticles(ctx, list) {
    const mult = p => (p.alpha === undefined ? 1 : p.alpha);
    for (const p of list) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife)) * mult(p);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Gameplay dust (Wave B): footstep/run puffs, landing thuds, skid sprays.
// A SEPARATE capped pool from the burst list AND from the ambient motes —
// bursts must never evict dust and vice versa, and the mote field keeps its
// own MAX_MOTES headroom. Jitter comes from an integer hash of the spawn
// position + index (never Math.random), so two boots of one seed render
// identical frames, matching the walking-dust determinism ruling.
// ---------------------------------------------------------------------------

export const MAX_DUST = 48;

function dustHash(a, b, i) {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^
        Math.imul(i + 1, 0x9E3779B1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

/**
 * Push a small ground-hugging puff at (x, y). opts:
 *   count   — particles (default 3)
 *   dir     — horizontal bias (+1/-1; 0 = symmetric fan)
 *   speed   — magnitude multiplier (default 1)
 *   life    — base seconds (default 0.28)
 *   size    — pixel size (default 2)
 *   alpha   — opacity multiplier (default 0.5)
 *   up      — upward launch speed (default 26)
 */
export function spawnDust(list, x, y, color, opts = {}) {
    const count = opts.count ?? 3;
    const dir = opts.dir ?? 0;
    const speed = opts.speed ?? 1;
    const life = opts.life ?? 0.28;
    const size = opts.size ?? 2;
    const alpha = opts.alpha ?? 0.5;
    const up = opts.up ?? 26;
    for (let i = 0; i < count; i++) {
        const h1 = dustHash(x, y, i);
        const h2 = dustHash(y, x, i + 7);
        // Symmetric fan when dir === 0; biased behind travel otherwise.
        const spread = dir === 0 ? (h1 * 2 - 1) : dir * (0.35 + h1 * 0.9);
        list.push({
            x: x + (h2 - 0.5) * 6,
            y: y - h1 * 3,
            vx: spread * 55 * speed,
            vy: -(up * (0.6 + h2 * 0.8)) * speed,
            life: life * (0.8 + h1 * 0.4),
            maxLife: life,
            size: size + (h2 > 0.6 ? 1 : 0),
            color,
            alpha
        });
    }
    if (list.length > MAX_DUST) list.splice(0, list.length - MAX_DUST);
    return list;
}

// ---------------------------------------------------------------------------
// Ambient motes: slow-drifting dust (day themes) or fireflies (dusk/jungle).
// These live in SCREEN space (not world), so they never collide with gameplay,
// and their positions wrap at the viewport edges. Spawns are seeded (a local
// mulberry32 copy — render code must never consume Math.random) so a level
// always gets the same mote field, and each mote carries its own parallax
// depth applied against cameraX at draw time.
//
// Look-A additions: `fireflies` concentrates spawns into a ground-hugging
// band with a SLOW sine blink (night-life read, not TV static); `flecks`
// adds falling streaks that only render while the camera is aloft on a
// vertical map — the height cue for climbs. Total live count stays hard-
// capped at MAX_MOTES.
// ---------------------------------------------------------------------------

export const MAX_MOTES = 40;

function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Build a capped mote field across a viewW×viewH screen from `seed`.
// opts.fireflies → ground band + slow blink; opts.flecks → N falling
// streaks (drawn only while climbing, see drawMotes).
export function createMotes(count, seed, viewW, viewH, opts = {}) {
    const rng = makeRng(seed);
    const motes = [];
    const n = Math.min(count, MAX_MOTES - (opts.flecks || 0));
    for (let i = 0; i < n; i++) {
        const fly = !!opts.fireflies;
        motes.push({
            x: rng() * viewW,
            // Fireflies hover low (bottom ~40% of the screen, above the very
            // edge where foreground silhouettes live); day dust fills the air.
            y: fly ? viewH * (0.58 + rng() * 0.34) : rng() * viewH,
            vx: 4 + rng() * 10,       // lazy horizontal drift, px/s
            vy: fly ? -(1 + rng() * 3) : -(2 + rng() * 6),
            size: 1.5 + rng() * 2,
            phase: rng() * Math.PI * 2,
            // Slow blink for night life; day dust keeps the quicker shimmer.
            wobble: fly ? 0.25 + rng() * 0.3 : 0.4 + rng() * 0.8,
            par: 0.1 + rng() * 0.3    // per-mote parallax depth factor
        });
    }
    const fleckRoom = Math.min(opts.flecks || 0, MAX_MOTES - motes.length);
    for (let i = 0; i < fleckRoom; i++) {
        motes.push({
            x: rng() * viewW,
            y: rng() * viewH,
            vx: -2 + rng() * 4,
            vy: 26 + rng() * 30,      // gentle FALL: reads as rising past it
            size: 1,
            phase: rng() * Math.PI * 2,
            wobble: 0.5 + rng() * 0.5,
            par: 0.15 + rng() * 0.25,
            fleck: true
        });
    }
    return motes;
}

// Advance every mote; sway comes from the phase so motion never dead-reckons
// in straight lines. Positions wrap into [0, viewW/H) — resize-safe, since
// an out-of-range coordinate simply wraps on the next tick.
export function stepMotes(list, dt, viewW, viewH) {
    for (const m of list) {
        m.phase += dt * m.wobble;
        m.x += (m.vx + Math.sin(m.phase) * 4) * dt;
        m.y += m.vy * dt;
        m.x = ((m.x % viewW) + viewW) % viewW;
        m.y = ((m.y % viewH) + viewH) % viewH;
    }
    return list;
}

// Draw in screen space with camera parallax. `fireflies` bumps brightness
// and radius for night themes and slows the blink to a life-like pulse;
// day dust stays faint so it can never compete with hazards for attention.
// Falling flecks render ONLY while `climbing` (vertical maps mid-ascent).
export function drawMotes(ctx, list, cameraX, viewW, color,
    fireflies = false, climbing = false) {
    for (const m of list) {
        if (m.fleck) {
            if (!climbing) continue;
            const fx = (((m.x - cameraX * m.par) % viewW) + viewW) % viewW;
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = color;
            ctx.fillRect(fx, m.y, 1, 3);
            continue;
        }
        const sx = (((m.x - cameraX * m.par) % viewW) + viewW) % viewW;
        const twinkle = fireflies
            ? 0.5 + 0.5 * Math.sin(m.phase * 1.1)
            : 0.55 + 0.45 * Math.sin(m.phase * 2.3);
        ctx.globalAlpha = twinkle * (fireflies ? 0.85 : 0.45);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, m.y, m.size * (fireflies ? 1.4 : 1), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}
