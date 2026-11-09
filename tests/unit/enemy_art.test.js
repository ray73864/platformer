// W4 "Real enemy sprites" (2026-11-10 owner request): the baked indexed
// pixel-art contract for all four enemy kinds. Mirrors the hero-redesign
// test conventions: pure-data grid pins hold headlessly; raster pins stub a
// fillRect-capable canvas; blit pins inject tagged fake canvases.
import { test, expect } from "bun:test";
import {
    ENEMY_FRAMES, ENEMY_PALETTES, ENEMY_DIMS, GUN_FRAME, GUN_DIMS,
    ENEMY_BLIT, FLASH_INK, buildEnemyCanvases
} from "../../js/enemyart.js";
import { Sprites } from "../../js/sprites.js";
import { FX } from "../../js/fx.js";

const KINDS = ['walker', 'spiny', 'charger', 'bombardier'];
const FRAME_NAMES = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2'];

// --- bake data integrity -----------------------------------------------------
test("every kind owns the full idle-pair + 3-frame walk inventory", () => {
    expect(Object.keys(ENEMY_FRAMES).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) {
        expect(Object.keys(ENEMY_FRAMES[kind]).sort(), kind)
            .toEqual([...FRAME_NAMES].sort());
    }
});

test("every frame is an exact ENEMY_DIMS grid of known palette colours", () => {
    for (const kind of KINDS) {
        const { w, h } = ENEMY_DIMS[kind];
        const chars = Object.keys(ENEMY_PALETTES[kind]);
        for (const name of FRAME_NAMES) {
            const rows = ENEMY_FRAMES[kind][name];
            expect(rows.length, `${kind}.${name} rows`).toBe(h);
            rows.forEach((r, y) => {
                expect(r.length, `${kind}.${name} row ${y} width`).toBe(w);
                for (const ch of r) expect(chars, `${kind}.${name} "${ch}"`).toContain(ch);
            });
        }
    }
    GUN_FRAME.forEach((r, y) => expect(r.length, `gun row ${y}`).toBe(GUN_DIMS.w));
    expect(GUN_FRAME.length).toBe(GUN_DIMS.h);
});

test("every kind bakes non-empty with feet planted on the baseline", () => {
    for (const kind of KINDS) {
        for (const name of FRAME_NAMES) {
            const rows = ENEMY_FRAMES[kind][name];
            const ink = rows.join('').split('.').join('').length;
            expect(ink, `${kind}.${name} opaque pixels`).toBeGreaterThan(80);
            // Feet meet the deck honestly: colour in the bottom content row.
            const bottom = rows[rows.length - 1];
            expect(bottom.split('.').join(''), `${kind}.${name} feet row`).not.toBe('');
        }
    }
});

test("palettes are distinct across kinds except the shared design-language colours", () => {
    // Shared ink rings every creature (hero harmony); eye-white is a utility
    // colour. Everything else — body, shade, highlight, accents — must be
    // kind-exclusive so silhouettes AND colours separate all four at a glance.
    const SHARED = new Set(['#2a2118', '#ffffff']);
    for (let i = 0; i < KINDS.length; i++) {
        for (let j = i + 1; j < KINDS.length; j++) {
            const a = new Set(Object.values(ENEMY_PALETTES[KINDS[i]]).filter(Boolean));
            const b = new Set(Object.values(ENEMY_PALETTES[KINDS[j]]).filter(Boolean));
            const shared = [...a].filter(hex => b.has(hex) && !SHARED.has(hex));
            expect(shared, `${KINDS[i]} vs ${KINDS[j]}`).toEqual([]);
        }
    }
    // Style bar: 5-7 colours per kind including outline/shade/highlight/eye.
    for (const kind of KINDS) {
        const n = Object.values(ENEMY_PALETTES[kind]).filter(Boolean).length;
        expect(n, kind).toBeGreaterThanOrEqual(5);
        expect(n, kind).toBeLessThanOrEqual(7);
    }
});

test("animation frames differ pairwise per kind (frame0 != frame1 hash)", () => {
    const hash = (rows) => {
        let h = 0x811c9dc5;
        for (const ch of rows.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
        return h >>> 0;
    };
    for (const kind of KINDS) {
        const seen = new Map();
        for (const name of FRAME_NAMES) {
            const hh = hash(ENEMY_FRAMES[kind][name]);
            expect(seen.has(hh), `${kind}: ${name} collides with ${seen.get(hh)}`).toBe(false);
            seen.set(hh, name);
        }
    }
});

test("_enemyPose picks stride when moving and breathes when planted", () => {
    const s = new Sprites();
    const at = (clock, vx) => { s.clock = clock; return s._enemyPose({ vx }, 0); };
    // Walk cadence inherits the legacy sheet-walker clock*6 + index*1.7 rule.
    expect([at(0.0, 40), at(0.17, 40), at(0.34, 40), at(0.51, 40)])
        .toEqual(['walk0', 'walk1', 'walk2', 'walk0']);
    expect(at(0.0, 40)).toBe(at(0.0, -40));           // direction-agnostic
    // The per-entity index staggers the phase so packs never stride in lockstep.
    expect(s._enemyPose({ vx: 40 }, 1)).not.toBe(s._enemyPose({ vx: 40 }, 0));
    // Still -> idle pair alternating every 0.5 s; windup (vx=0) breathes.
    expect(at(0.1, 0)).toBe('idle0');
    expect(at(0.6, 0)).toBe('idle1');
    expect(at(1.1, 0)).toBe('idle0');
    // Pure function of state.
    expect(at(0.35, 40)).toBe(at(0.35, 40));
});

// --- deterministic bake --------------------------------------------------------
test("buildEnemyCanvases degrades to null where rasterisation is unavailable", () => {
    // bun test/happy-dom hands out contexts without fillRect: the guard must
    // return null (drawEnemy then draws shadow-only, never throws).
    expect(buildEnemyCanvases()).toBeNull();
});

test("the bake runs one canvas per frame (+flash masks+gun) behind a cache guard", () => {
    const realCreate = document.createElement.bind(document);
    let created = 0;
    document.createElement = (tag) => {
        if (tag === 'canvas') {
            created++;
            return { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: () => {} }) };
        }
        return realCreate(tag);
    };
    try {
        created = 0;
        const baked = buildEnemyCanvases();
        expect(baked).not.toBeNull();
        // 4 kinds x 5 frames + 5 charger flash silhouettes + 1 gun + 1 probe.
        expect(created).toBe(KINDS.length * FRAME_NAMES.length + FRAME_NAMES.length + 2);
        for (const kind of KINDS) {
            for (const name of FRAME_NAMES) expect(baked[kind][name]).toBeTruthy();
        }
        expect(baked.charger.idle0_flash).toBeTruthy();
        expect(baked.bombardier.gun).toBeTruthy();
        // Sprites caches the bake once per instance and never re-bakes.
        const s = new Sprites();
        expect(s._enemies).toBeUndefined();
        const first = s._ensureEnemies();
        expect(s._enemies).toBeDefined();
        expect(s._ensureEnemies()).toBe(first);
        created = 0;
        expect(s._ensureEnemies()).toBe(first);
        expect(created).toBe(0);
    } finally {
        document.createElement = realCreate;
    }
});

// --- telegraph states survive on the new art ------------------------------------
function enemyCtx() {
    const ops = [];
    const ctx = {
        ops,
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
        save: () => ops.push('save'),
        restore: () => ops.push('restore'),
        translate: (x, y) => ops.push(`translate ${x} ${y}`),
        scale: (x, y) => ops.push(`scale ${x} ${y}`),
        beginPath: () => ops.push('beginPath'),
        moveTo: (x, y) => ops.push(`moveTo ${x} ${y}`),
        lineTo: (x, y) => ops.push(`lineTo ${x} ${y}`),
        arc: (x, y, r) => ops.push(`arc ${x} ${y} ${r}`),
        closePath: () => ops.push('closePath'),
        fill: () => ops.push(`fill ${ctx.fillStyle}`),
        fillRect: (x, y, w, h) => ops.push(`fillRect ${ctx.fillStyle} ${x} ${y} ${w} ${h}`),
        stroke: () => ops.push(`stroke ${ctx.strokeStyle}`),
        ellipse: () => ops.push('ellipse'),
        drawImage: (img, dx, dy, dw, dh) =>
            ops.push(`drawImage ${img && img.tag} ${dx} ${dy} ${dw} ${dh} a=${ctx.globalAlpha}`)
    };
    return ctx;
}
function withFakeEnemies(sprites) {
    const kindArt = (kind, extra = []) => Object.fromEntries(
        [...FRAME_NAMES, ...extra].map(n => [n, { tag: `${kind}.${n}` }]));
    sprites._enemies = {
        walker: kindArt('walker'),
        spiny: kindArt('spiny'),
        charger: kindArt('charger', FRAME_NAMES.map(n => `${n}_flash`)),
        bombardier: kindArt('bombardier', ['gun'])
    };
    return sprites;
}
const fixture = (kind, extra = {}) => ({
    x: 100, y: 200, width: 32, height: 32, vx: 40,
    kind, state: 'patrol', stateTime: 0, dead: false, ...extra
});

test("telegraph state toggles change rendered output (charger windup vs normal)", () => {
    const s = withFakeEnemies(new Sprites());
    s.clock = 0.1;
    const normal = enemyCtx();
    s.drawEnemy(normal, fixture('charger', { vx: 0 }), 0);          // planted patrol: breathes
    const windup = enemyCtx();
    s.drawEnemy(windup, fixture('charger', { vx: 0, state: 'windup', stateTime: 0.2 }), 0);
    // Different rendered output...
    expect(windup.ops).not.toEqual(normal.ops);
    // ...and specifically extra silhouette pixels: the amber flash blit covers
    // the body footprint at alpha > 0 (pixel-diff > 0 guaranteed — no charger
    // palette colour equals FLASH_INK, so every covered pixel changes colour).
    const geom = (op) => op.split(' ').slice(2, 6);
    const body = normal.ops.find(o => o.startsWith('drawImage charger.'));
    const flash = windup.ops.find(o => o.includes('_flash'));
    expect(flash).toBeDefined();
    expect(Number(flash.match(/a=([\d.]+)/)[1])).toBeGreaterThan(0);
    expect(normal.ops.some(o => o.includes('_flash'))).toBe(false);
    expect(FLASH_INK).not.toContain('#c1553b');
    // The flash geometry matches the body blit exactly (mask, not rectangle),
    // on the same pose frame.
    expect(flash.split(' ')[1]).toBe(`${body.split(' ')[1]}_flash`);
    expect(geom(flash)).toEqual(geom(body));
});

test("bombardier keeps gun layer, recoil and muzzle tells; walker stays plain", () => {
    const s = withFakeEnemies(new Sprites());
    s.clock = 0.1;
    const calm = enemyCtx();
    s.drawEnemy(calm, fixture('bombardier'), 0);
    expect(calm.ops.some(o => o.startsWith('drawImage bombardier.gun'))).toBe(true);
    expect(calm.ops.some(o => o.includes('_flash'))).toBe(false);
    // Recoil kicks the GUN group only: during the kick window the gun's
    // translate shifts back while the body's does not.
    const fired = enemyCtx();
    s.drawEnemy(fired, fixture('bombardier', {
        vx: 0, state: 'cooldown_ranged', stateTime: 0.02
    }), 0);
    const gunT = (ops) => {
        const gi = ops.findIndex(o => o.includes('bombardier.gun'));
        return ops.slice(Math.max(0, gi - 3), gi).find(o => o.startsWith('translate '));
    };
    expect(gunT(fired.ops)).not.toBe(gunT(calm.ops));
    // Body anchor identical between the two (creature stays planted): the
    // FIRST translate in the log is always the body's feet anchor.
    expect(fired.ops.find(o => o.startsWith('translate ')))
        .toBe(calm.ops.find(o => o.startsWith('translate ')));
    // Muzzle glow rides windup_ranged; FIRE flash rides cooldown start.
    const aim = enemyCtx();
    s.drawEnemy(aim, fixture('bombardier', { vx: 0, state: 'windup_ranged', stateTime: 0.3 }), 0);
    expect(aim.ops.some(o => o.includes('rgba(255,180,80'))).toBe(true);
    expect(fired.ops.some(o => o.includes('rgba(255,232,170,0.9)'))).toBe(true);
    // Walker contributes no telegraph decorations at all.
    const wk = enemyCtx();
    s.drawEnemy(wk, fixture('walker'), 0);
    expect(wk.ops.filter(o => o.startsWith('drawImage')).length).toBe(1);
});

test("reduced motion drops motion extras but never changes sprite identity", () => {
    const prev = FX.trails;
    const mk = () => {
        const s = withFakeEnemies(new Sprites());
        s.clock = 0.1;
        return s;
    };
    const nearPlayer = fixture('spiny', { vx: 0 });
    const player = { x: 110, y: 200, width: 32, height: 32 };
    try {
        FX.trails = true;
        const on = enemyCtx();
        mk().drawEnemy(on, nearPlayer, 0, player);
        FX.trails = false;
        const off = enemyCtx();
        mk().drawEnemy(off, nearPlayer, 0, player);
        // Sprite identity: same frames, same geometry, same alphas.
        const blits = (ctx) => ctx.ops.filter(o => o.startsWith('drawImage'));
        expect(blits(off)).toEqual(blits(on));
        // Only the rattle jitter translate differs (motion extra dropped).
        expect(off.ops).not.toEqual(on.ops);
        // Charger windup flash is fairness-critical: intensity-scaled, NEVER
        // flag-gated — it survives with trails off unchanged.
        const flashOn = enemyCtx(); const flashOff = enemyCtx();
        const wf = fixture('charger', { vx: 0, state: 'windup', stateTime: 0.2 });
        FX.trails = true; mk().drawEnemy(flashOn, wf, 0);
        FX.trails = false; mk().drawEnemy(flashOff, wf, 0);
        expect(flashOff.ops.filter(o => o.includes('_flash')))
            .toEqual(flashOn.ops.filter(o => o.includes('_flash')));
    } finally {
        FX.trails = prev;
    }
});

test("drawEnemy anchors baked bodies feet-centred like the hero convention", () => {
    const s = withFakeEnemies(new Sprites());
    s.clock = 0.1;
    const ctx = enemyCtx();
    s.drawEnemy(ctx, fixture('walker', { vx: 0 }), 0);
    expect(ctx.ops.some(o => o === 'translate 116 232')).toBe(true);
    const di = ctx.ops.find(o => o.startsWith('drawImage'));
    const parts = di.split(' ');
    const bw = (ENEMY_DIMS.walker.w + 2) * ENEMY_BLIT.walker.z;
    const bh = (ENEMY_DIMS.walker.h + 2) * ENEMY_BLIT.walker.z;
    expect(Number(parts[2])).toBe(-bw / 2);   // centred on the hitbox
    expect(Number(parts[3])).toBe(-bh);       // feet-anchored above the line
    expect(Number(parts[4])).toBe(bw);
    expect(Number(parts[5])).toBe(bh);
    // Facing flip reaches the transform.
    const left = enemyCtx();
    s.drawEnemy(left, fixture('walker', { vx: -40 }), 0);
    expect(left.ops.some(o => o === 'scale -1 1')).toBe(true);
});
