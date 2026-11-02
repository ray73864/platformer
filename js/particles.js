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

export function drawParticles(ctx, list) {
    for (const p of list) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}
