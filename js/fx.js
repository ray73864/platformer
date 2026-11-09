/**
 * Central game-feel (juice) configuration + pure effect helpers (Wave B).
 *
 * Everything in this module is RENDER/PRESENTATION state: the simulation
 * never reads any of it, and nothing here writes into player/enemy/physics
 * state. Wave C settings wiring flips the flags on the exported FX object —
 * every effect site reads FX fresh at use time (never a cached copy), so a
 * toggle takes effect on the very next frame with no refactor.
 *
 * Flags:
 *   shake     — camera-space screen shake (death, stomps, shell impacts)
 *   punch     — zoom punch + death white flash (impact "hit-stop" feel)
 *   pulse     — one-shot celebration pulses (portal unlock ring)
 *   squash    — player squash & stretch draw transform
 *   dust      — footstep / run / land / skid dust pool (particles.js)
 *   popups    — floating score popups ('+10', '+25 STOMP!', …)
 *   trails    — motion embellishments: projectile glow trail ghosts, spiny
 *               proximity rattle, bombardier muzzle recoil kick
 *   lookahead — eased camera render-offset lead toward travel direction
 *   intensity — global magnitude multiplier applied to visual amplitudes
 *
 * Reduced-motion boot: initFX() reads matchMedia once and disables the
 * large/moving families (shake/punch/pulse/lookahead) while keeping the
 * gentle ones (squash/dust/popups/trails) at half intensity. Gameplay-
 * critical telegraphs (charger windup flash etc.) are NEVER gated off —
 * they only scale by intensity, because removing a hazard tell would
 * change what the player can fairly read.
 */

export const FX = {
    shake: true,
    punch: true,
    pulse: true,
    squash: true,
    dust: true,
    popups: true,
    trails: true,
    lookahead: true,
    intensity: 1
};

// Full-strength defaults, kept so applyReducedMotion(false) restores exactly.
const FX_DEFAULTS = Object.assign({}, FX);

let _initialized = false;

// Apply (or lift) the reduced-motion profile. Kept separate from initFX so
// tests and Wave C can drive it directly without a real media query.
export function applyReducedMotion(on) {
    if (on) {
        FX.shake = false;
        FX.punch = false;
        FX.pulse = false;
        FX.lookahead = false;
        FX.intensity = 0.5;
        // squash/dust/popups/trails stay ON but read FX.intensity for gentler
        // amplitudes; telegraph existence is never tied to these flags.
    } else {
        Object.assign(FX, FX_DEFAULTS);
    }
}

// One-shot boot initialisation from the page's prefers-reduced-motion.
// Returns whether reduced motion was detected. Repeat calls are inert
// (unless force) so later user toggles are never overwritten by a second
// Game construction.
export function initFX(win = typeof window !== 'undefined' ? window : null,
    force = false) {
    if (_initialized && !force) return FX.shake === false;
    _initialized = true;
    let rm;
    try {
        rm = !!(win && win.matchMedia &&
            win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
        rm = false; // hostile/absent matchMedia: ship the full-fx default
    }
    applyReducedMotion(rm);
    return rm;
}

// Test seam: forget the once-guard (unit tests exercise both boot paths).
export function _resetFXInitForTests() {
    _initialized = false;
    Object.assign(FX, FX_DEFAULTS);
}

// --- Screen shake -----------------------------------------------------------
// Deterministic decaying sine offset — deliberately NOT random (the pre-
// Wave-B death shake consumed Math.random inside draw(), which broke the
// "render code never consumes Math.random" rule and made frame captures
// unreproducible). Two incommensurate frequencies keep it organic-ish.
// t is the REMAINING shake time (counts down with the caller's clock).
export function shakeOffset(t, mag = 1, duration = 1) {
    if (!FX.shake || !(t > 0)) return { x: 0, y: 0 };
    const k = Math.min(1, t / (duration || 1)) * mag * FX.intensity;
    return {
        x: Math.sin(t * 160) * k,
        y: Math.sin(t * 212 + 1.7) * k * 0.75
    };
}

// --- Impact zoom punch ------------------------------------------------------
// 1 -> peak -> 1 over PUNCH_TIME via a half-sine envelope; callers advance an
// age clock (PUNCH_TIME - remaining) and multiply their ctx transform around
// the viewport centre. Gated by FX.punch (reduced-motion-off).
export const PUNCH_TIME = 0.12;
export const PUNCH_PEAK = 1.03;
export function punchScale(age, peak = PUNCH_PEAK) {
    if (!FX.punch) return 1;
    const p = age / PUNCH_TIME;
    if (p <= 0 || p >= 1) return 1;
    return 1 + (peak - 1) * FX.intensity * Math.sin(Math.PI * p);
}

// --- Floating score popups --------------------------------------------------
// Canvas-space text layer (screen coords captured at spawn): rise + fade
// over POPUP_LIFE. Pooled with a hard cap; duplicate same-text spawns at
// (nearly) the same spot within the same instant are dropped so a multi-hit
// frame can never stack unreadable text.
export const MAX_POPUPS = 12;
export const POPUP_LIFE = 0.7;
export const POPUP_RISE = 26; // px travelled upward across its life

export function spawnPopup(list, x, y, text, color, big = false) {
    // Same-frame/same-spot dedupe: entries younger than one step that share
    // the text within 4px are the same event double-reported — keep the first.
    for (const p of list) {
        if (p.text === text && p.age < 0.05 &&
            Math.abs(p.x - x) < 4 && Math.abs(p.y - y) < 4) return null;
    }
    const entry = { x, y, text, color, big, age: 0, life: POPUP_LIFE };
    list.push(entry);
    if (list.length > MAX_POPUPS) list.splice(0, list.length - MAX_POPUPS);
    return entry;
}

export function stepPopups(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
        list[i].age += dt;
        if (list[i].age >= list[i].life) list.splice(i, 1);
    }
    return list;
}

// Pixel-font pass matching the HUD chips (ink outline + bright fill). Size
// rides the world zoom so popups sit at chip scale on every display.
export function drawPopups(ctx, list, zoom = 1) {
    if (!FX.popups || !list.length) return;
    const px = Math.max(10, Math.round(9 * zoom));
    ctx.font = `${px}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const p of list) {
        const k = Math.min(1, p.age / p.life);
        const rise = POPUP_RISE * (1 - (1 - k) * (1 - k)); // ease-out
        const alpha = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#35231a';                    // --ink
        ctx.strokeText(p.text, p.x, p.y - rise);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y - rise);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
}

// --- Portal-unlock ring pulses ----------------------------------------------
// World-space expanding rings drawn under FX.pulse (celebration family).
export const MAX_RINGS = 4;
export const RING_LIFE = 0.6;

export function spawnRing(list, x, y, color, r0 = 8, r1 = 54) {
    const entry = { x, y, color, r0, r1, age: 0, life: RING_LIFE };
    list.push(entry);
    if (list.length > MAX_RINGS) list.splice(0, list.length - MAX_RINGS);
    return entry;
}

export function stepRings(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
        list[i].age += dt;
        if (list[i].age >= list[i].life) list.splice(i, 1);
    }
    return list;
}

export function drawRings(ctx, list) {
    if (!FX.pulse) return;
    for (const r of list) {
        const k = Math.min(1, r.age / r.life);
        const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
        ctx.globalAlpha = (1 - k) * 0.85 * FX.intensity;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 1 + 2.5 * (1 - k);
        ctx.beginPath();
        ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

// --- Victory confetti (Wave C) ----------------------------------------------
// FINAL_LEVEL celebration layer: one pooled burst, hard-capped at
// MAX_CONFETTI, drawn in screen space on its own canvas above the DOM
// overlays. Placement uses a seeded mulberry32 (the render-no-Math.random
// rule particles.js established), so the burst is identical every time and
// no UI code introduces fresh RNG. `animated` is the caller's FX.pulse read:
// reduced motion gets the SAME composition as a single static burst that
// fades in place (no travel), per the Wave C brief.
export const MAX_CONFETTI = 60;
export const CONFETTI_LIFE = 2.4;      // animated fall
export const CONFETTI_STATIC_LIFE = 1.4; // reduced-motion hold-and-fade

// Kenney-palette confetti hues (gold, grass, cream, amber, portal violet).
export const CONFETTI_COLORS = ['#ffd23f', '#3ecf6a', '#fdf6e8', '#f4a460', '#b06cf0'];

function confettiRng(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Replace the pool with one celebration burst across a viewW×viewH screen.
 * animated=true: pieces rain from above the top edge with a lazy sway.
 * animated=false (reduced motion): pieces hang mid-screen, motionless, and
 * simply fade — a single static burst, never a moving one.
 */
export function spawnConfetti(list, viewW, viewH, animated = true, seed = 0xC0FFEE) {
    list.length = 0;
    const rng = confettiRng(seed);
    for (let i = 0; i < MAX_CONFETTI; i++) {
        const x = rng() * viewW;
        list.push({
            x,
            y: animated ? -(rng() * viewH * 0.6) : viewH * (0.12 + rng() * 0.62),
            vx: animated ? (rng() - 0.5) * 30 : 0,
            vy: animated ? 90 + rng() * 140 : 0,
            size: 3 + Math.round(rng() * 3),
            color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            phase: rng() * Math.PI * 2,
            sway: animated ? 18 + rng() * 26 : 0,
            age: 0,
            life: animated ? CONFETTI_LIFE : CONFETTI_STATIC_LIFE
        });
    }
    return list;
}

export function stepConfetti(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        if (p.age >= p.life) {
            list.splice(i, 1);
            continue;
        }
        p.x += (p.vx + Math.sin(p.phase + p.age * 3) * p.sway) * dt;
        p.y += p.vy * dt;
    }
    return list;
}

// Pixel-cut rects (no rotation transforms): alpha holds, then fades out over
// the last third of life so both variants read as a punctuation beat.
export function drawConfetti(ctx, list) {
    for (const p of list) {
        const k = p.age / p.life;
        ctx.globalAlpha = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size + 1);
    }
    ctx.globalAlpha = 1;
}
