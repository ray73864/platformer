// Enemy character art (2026-11-10 owner request: "actual sprites ... right
// now they look like a 6yr old drew them in MS Paint").
//
// Same baked-indexed-pixel-art pattern the 2026-11-04 hero redesign uses in
// sprites.js: every frame is authored as colour-indexed row strings, baked
// ONCE into offscreen canvases with a generated 1px warm-charcoal outline
// ring, then blitted. Deterministic — no RNG anywhere, no per-frame work.
//
// Style bar (shared design language with the redesigned hero):
//   * chunky readable clusters, 2px minimum feature size at shipped scale
//     (spike tips taper through the silhouette, never as isolated pixels);
//   * 5-7 colours per kind INCLUDING outline/shade/highlight/eye;
//   * consistent upper-left sunward light: highlights ride the top-left arc,
//     shades pool bottom-right — matching the THEMES rimSide warm family the
//     terrain rim-light pass uses;
//   * expressive eyes carry intent: walker = wide wary eye, spiny = hooded
//     menace under a bone brow, charger = low greedy slit, bombardier = high
//     round startled eye with a small centred pupil;
//   * silhouette test at shipped size: walker round blob, spiny bristled
//     bone crown, charger low forward-leaning horned boar, bombardier squat
//     wide dome with an external cannon.
// Shared ink #2a2118 (HERO_PALETTE.o) rings every creature so all five
// characters carry identical edge weight against every theme band.
//
// Telegraph contract (Wave B) lives in sprites.js draw paths, NOT here:
// squash/stretch scales, the charger amber flash (built from the exact body
// silhouette), speed streaks, bombardier gun recoil and muzzle glow all
// derive from enemy.state/stateTime exactly as before.

export const FLASH_INK = '#ffe8aa';

export const ENEMY_PALETTES = {
    walker: {
        '.': null,
        o: '#2a2118',     // shared warm-charcoal ink (hero harmony)
        g: '#5cb84a', // body grass-green
        s: '#3c7f33', // shade, pooled bottom-right
        h: '#93dd78', // sunward highlight, top-left arc
        w: '#ffffff'  // eye white (pupil = ink)
    },
    spiny: {
        '.': null,
        o: '#2a2118',
        p: '#8a55c0', // body mid-purple (kept from the vector era)
        d: '#5e3489', // shade + hooded brow over the eye
        l: '#b98ce4', // sunward highlight
        b: '#e6d7ac', // bone crown + brow (THE lethal signal)
        w: '#ffffff'
    },
    charger: {
        '.': null,
        o: '#2a2118',
        r: '#c1553b', // body rust-red
        d: '#8c3524', // shade: belly, jaw, rear flank
        h: '#e5885c', // sunward highlight along the haunch
        n: '#efe0bb', // horn ivory (charge read lives here)
        w: '#ffffff'
    },
    bombardier: {
        '.': null,
        o: '#2a2118',
        t: '#6e4b2c', // body bark-brown (owner: "the brown one")
        d: '#472f1b', // shade under the dome lip
        z: '#b0803a', // bronze: cannon barrel + plate rivets/seams
        k: '#7d5a26', // bronze-dark breech/mount shading
        g: '#ffd23f', // fuse-spark gold + hot brass muzzle ring
        w: '#ffffff'
    }
};

// Content-grid dimensions per kind (px). Feet always sit on the LAST row;
// creatures face RIGHT and drawEnemy mirrors via ctx.scale(face, 1).
export const ENEMY_DIMS = {
    walker: { w: 18, h: 15 },
    spiny: { w: 20, h: 17 },
    charger: { w: 22, h: 14 },
    bombardier: { w: 20, h: 13 }
};

// Frame inventory per kind: idle0/idle1 breathe (dome sinks one row, flanks
// bulge); walk0/1/2 plant-squeeze-stride through the foot positions. The
// bombardier additionally owns a static 'gun' layer (18x10) so Wave B recoil
// kicks the CANNON off its trunnions, not the whole creature.
export const ENEMY_FRAMES = {
    walker: {
        idle0: [
            '..................',
            '.......hhgg.......',
            '.....hhgggggg.....',
            '....hhgggggggg....',
            '...hggggggggggg...',
            '..hggggggwwwwwwg..',
            '..hggggggwwwwoos..',
            '..hggggggwwwwoos..',
            '..gggggggwwwwwws..',
            '..gggggggggggggs..',
            '..gggggggggggggs..',
            '..gggggggggggggs..',
            '...gggggggggggs...',
            '...gssssssssssg...',
            '....ggg....ggg....'
        ],
        idle1: [
            '..................',
            '..................',
            '.....gggggggg.....',
            '....gghhgggggg....',
            '...hghhgggggggg...',
            '..hghhgggggggggg..',
            '..hggggggwwwwwwg..',
            '..hggggggwwwwoos..',
            '..hggggggwwwwoos..',
            '..gggggggwwwwwws..',
            '..gggggggggggggs..',
            '..gggggggggggggs..',
            '...gggggggggggs...',
            '...gsssssssssss...',
            '....ggg....ggg....'
        ],
        walk0: [
            '..................',
            '.......hhgg.......',
            '.....hhgggggg.....',
            '....hhgggggggg....',
            '...hggggggggggg...',
            '..hggggggwwwwwwg..',
            '..hggggggwwwwoos..',
            '..hggggggwwwwoos..',
            '..gggggggwwwwwws..',
            '..gggggggggggggs..',
            '..gggggggggggggs..',
            '..gggggggggggggs..',
            '...gggggggggggs...',
            '...gssssssssssg...',
            '...ggg......ggg...'
        ],
        walk1: [
            '..................',
            '..................',
            '.....gggggggg.....',
            '....gghhgggggg....',
            '...hghhgggggggg...',
            '..hghhgggggggggg..',
            '..hggggggwwwwwwg..',
            '..hggggggwwwwoos..',
            '..hggggggwwwwoos..',
            '..gggggggwwwwwws..',
            '..gggggggggggggs..',
            '..gggggggggggggs..',
            '...gggggggggggs...',
            '...gsssssssssss...',
            '......gggggg......'
        ],
        walk2: [
            '..................',
            '.......hhgg.......',
            '.....hhgggggg.....',
            '....hhgggggggg....',
            '...hggggggggggg...',
            '..hggggggwwwwwwg..',
            '..hggggggwwwwoos..',
            '..hggggggwwwwoos..',
            '..gggggggwwwwwws..',
            '..gggggggggggggs..',
            '..gggggggggggggs..',
            '..gggggggggggggs..',
            '...gggggggggggs...',
            '...gssssssssssg...',
            '.....ggg.gggg.....'
        ]
    },
    spiny: {
        idle0: [
            '...bbb..bbb..bbb....',
            '...bbb..bbb..bbb.b..',
            '..bbbbbbbbbbbbbbbbb.',
            '..bbbbbbbbbbbbbbbb..',
            '......pppppppp......',
            '....lppppppppppp....',
            '...lpppppppdddddd...',
            '..lppppppppppddddp..',
            '.lpppppppppwwwwwwpd.',
            '.lpppppppppwwwwoopd.',
            '.ppppppppppwwwwoopd.',
            '.ppppppppppwwwwwwpd.',
            '.pppppppppppppppppd.',
            '.pppppppppppppppppd.',
            '..pppppppppppppppd..',
            '..pddddddddddddddd..',
            '....ppp......ppp....'
        ],
        idle1: [
            '.........b....b.....',
            '...bbb..bbb..bbb....',
            '...bbb..bbb..bbb.b..',
            '..bbbbbbbbbbbbbbbbb.',
            '..bbbbbbbbbbbbbbbb..',
            '....pppppppppppp....',
            '...lppppppppppppp...',
            '..lppppppppddddddp..',
            '.lpppppppppppddddpp.',
            '.lpppppppppwwwwwwpd.',
            '.lpppppppppwwwwoopd.',
            '.ppppppppppwwwwoopd.',
            '.ppppppppppwwwwwwpd.',
            '.pppppppppppppppppd.',
            '..pppppppppppppppd..',
            '..pddddddddddddddd..',
            '....ppp......ppp....'
        ],
        walk0: [
            '...bbb..bbb..bbb....',
            '...bbb..bbb..bbb.b..',
            '..bbbbbbbbbbbbbbbbb.',
            '..bbbbbbbbbbbbbbbb..',
            '......pppppppp......',
            '....lppppppppppp....',
            '...lpppppppdddddd...',
            '..lppppppppppddddp..',
            '.lpppppppppwwwwwwpd.',
            '.lpppppppppwwwwoopd.',
            '.ppppppppppwwwwoopd.',
            '.ppppppppppwwwwwwpd.',
            '.pppppppppppppppppd.',
            '.pppppppppppppppppd.',
            '..pppppppppppppppd..',
            '..pddddddddddddddd..',
            '...ppp........ppp...'
        ],
        walk1: [
            '.........b....b.....',
            '...bbb..bbb..bbb....',
            '...bbb..bbb..bbb.b..',
            '..bbbbbbbbbbbbbbbbb.',
            '..bbbbbbbbbbbbbbbb..',
            '....pppppppppppp....',
            '...lppppppppppppp...',
            '..lppppppppddddddp..',
            '.lpppppppppppddddpp.',
            '.lpppppppppwwwwwwpd.',
            '.lpppppppppwwwwoopd.',
            '.ppppppppppwwwwoopd.',
            '.ppppppppppwwwwwwpd.',
            '.pppppppppppppppppd.',
            '..pppppppppppppppd..',
            '..pddddddddddddddd..',
            '......pppppppp......'
        ],
        walk2: [
            '...bbb..bbb..bbb....',
            '...bbb..bbb..bbb.b..',
            '..bbbbbbbbbbbbbbbbb.',
            '..bbbbbbbbbbbbbbbb..',
            '......pppppppp......',
            '....lppppppppppp....',
            '...lpppppppdddddd...',
            '..lppppppppppddddp..',
            '.lpppppppppwwwwwwpd.',
            '.lpppppppppwwwwoopd.',
            '.ppppppppppwwwwoopd.',
            '.ppppppppppwwwwwwpd.',
            '.pppppppppppppppppd.',
            '.pppppppppppppppppd.',
            '..pppppppppppppppd..',
            '..pddddddddddddddd..',
            '.....pppp..pppp.....'
        ]
    },
    charger: {
        idle0: [
            '......................',
            '....hhhhrr............',
            '..hrrrrrrrrr..........',
            '.hrrrrrrrrrrrr.rrrrr..',
            '.hrrrrrrrrrrrrrddddrr.',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrrrrrrnn',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '..rddddddddddddr......',
            '......................',
            '..rr..rr.....rr..rr...',
            '..rr..rr.....rr..rr...'
        ],
        idle1: [
            '......................',
            '......................',
            '.....hhhhr............',
            '..hrrrrrrrrr..........',
            '.hrrrrrrrrrrrr.rrrrr..',
            '.hrrrrrrrrrrrrrddddrr.',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrrrrrrnn',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '..rddddddddddddr......',
            '..rr..rr.....rr..rr...',
            '..rr..rr.....rr..rr...'
        ],
        walk0: [
            '......................',
            '....hhhhrr............',
            '..hrrrrrrrrr..........',
            '.hrrrrrrrrrrrr.rrrrr..',
            '.hrrrrrrrrrrrrrddddrr.',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrrrrrrnn',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '..rddddddddddddr......',
            '......................',
            '.rr...rr.......rr.rr..',
            '.rr...rr.......rr.rr..'
        ],
        walk1: [
            '......................',
            '......................',
            '.....hhhhr............',
            '..hrrrrrrrrr..........',
            '.hrrrrrrrrrrrr.rrrrr..',
            '.hrrrrrrrrrrrrrddddrr.',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrrrrrrnn',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '..rddddddddddddr......',
            '....rr..rr..rr..rr....',
            '....rr..rr..rr..rr....'
        ],
        walk2: [
            '......................',
            '....hhhhrr............',
            '..hrrrrrrrrr..........',
            '.hrrrrrrrrrrrr.rrrrr..',
            '.hrrrrrrrrrrrrrddddrr.',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrwwoonnn',
            '.rrrrrrrrrrrrrrrrrrrnn',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '.rrrrrrrrrrrrrrrrrrdd.',
            '..rddddddddddddr......',
            '......................',
            '...rr..rr....rr..rr...',
            '...rr..rr....rr..rr...'
        ]
    },
    bombardier: {
        idle0: [
            '....................',
            '.....tttttttttt.....',
            '...zztttttttttttt...',
            '..zzttttwwwwwwtttt..',
            '.tttttttwwoowwttttt.',
            'ttttttttwwoowwtttttd',
            'ttttttttwwwwwwtttttd',
            'tttttttttttttttttttd',
            'tttttttttttttttttttd',
            '.tzzzzzzzzzzzzzzzzd.',
            '.tttttttttttttttttd.',
            '..tddddddddddddddd..',
            '....ttt......ttt....'
        ],
        idle1: [
            '....................',
            '....................',
            '...tttttttttttttt...',
            '..tzzttttttttttttt..',
            '.tzzttttwwwwwwttttt.',
            'ttttttttwwoowwtttttt',
            'ttttttttwwoowwtttttd',
            'ttttttttwwwwwwtttttd',
            'tttttttttttttttttttd',
            '.tttttttttttttttttd.',
            '.tzzzzzzzzzzzzzzzzd.',
            '..tddddddddddddddd..',
            '....ttt......ttt....'
        ],
        walk0: [
            '....................',
            '.....tttttttttt.....',
            '...zztttttttttttt...',
            '..zzttttwwwwwwtttt..',
            '.tttttttwwoowwttttt.',
            'ttttttttwwoowwtttttd',
            'ttttttttwwwwwwtttttd',
            'tttttttttttttttttttd',
            'tttttttttttttttttttd',
            '.tzzzzzzzzzzzzzzzzd.',
            '.tttttttttttttttttd.',
            '..tddddddddddddddd..',
            '...ttt........ttt...'
        ],
        walk1: [
            '....................',
            '....................',
            '...tttttttttttttt...',
            '..tzzttttttttttttt..',
            '.tzzttttwwwwwwttttt.',
            'ttttttttwwoowwtttttt',
            'ttttttttwwoowwtttttd',
            'ttttttttwwwwwwtttttd',
            'tttttttttttttttttttd',
            '.tttttttttttttttttd.',
            '.tzzzzzzzzzzzzzzzzd.',
            '..tddddddddddddddd..',
            '......tttttttt......'
        ],
        walk2: [
            '....................',
            '.....tttttttttt.....',
            '...zztttttttttttt...',
            '..zzttttwwwwwwtttt..',
            '.tttttttwwoowwttttt.',
            'ttttttttwwoowwtttttd',
            'ttttttttwwwwwwtttttd',
            'tttttttttttttttttttd',
            'tttttttttttttttttttd',
            '.tzzzzzzzzzzzzzzzzd.',
            '.tttttttttttttttttd.',
            '..tddddddddddddddd..',
            '.....tttt..tttt.....'
        ]
    }
};

// Static cannon layer (does not walk): breech + mount in bronze-dark 'k',
// barrel in bronze 'z', hot brass muzzle ring 'g'. Mounted by sprites.drawEnemy
// so the barrel points forward below the eye; Wave B recoil translates THIS
// layer only.
export const GUN_DIMS = { w: 18, h: 10 };
export const GUN_FRAME = [
    '..................',
    '..................',
    '..................',
    '..kkk.........zgg.',
    '..kkkzzzzzzzzzzgg.',
    '..kkkzzzzzzzzzzgg.',
    '..kkkzzzzzzzzzzgg.',
    '..kkk.........zgg.',
    '..kkkk............',
    '..................'
];

// Blit geometry (shipped px, Z=2 like the hero): body anchored feet-centre;
// gun anchored so the barrel centre sits at muzzle height just below the eye
// with the tip past the hitbox edge; (mx, my) is the muzzle point for the
// glow/FIRE arcs; (fx, fy) is the fuse tip for the micro-spark. All local to
// the translate(cx, feet) + scale(face*sx, sy) frame.
export const ENEMY_BLIT = {
    walker: { z: 2 },
    spiny: { z: 2 },
    charger: { z: 2 },
    bombardier: {
        z: 2,
        gun: { dx: -10, dy: -23, mx: 26, my: -11, fx: -3, fy: -21 }
    }
};

// Bake one indexed frame into an outlined canvas (hero convention: colour
// pixels first, then a generated 1px ink ring from the transparent border so
// every pose carries identical edge weight). `flat` paints every opaque cell
// with one colour instead of the palette (charger flash silhouette).
function bakeFrame(rows, palette, w, h, flat = null) {
    const c = document.createElement('canvas');
    c.width = w + 2;
    c.height = h + 2;
    const g = c.getContext('2d');
    if (!g || typeof g.fillRect !== 'function') return null;
    const opaque = rows.map(r => [...r].map(ch => ch !== '.'));
    rows.forEach((row, y) => {
        [...row].forEach((ch, x) => {
            if (ch === '.') return;
            const hex = palette[ch];
            if (!hex) throw new Error(`enemy frame: unknown palette char "${ch}"`);
            g.fillStyle = flat ?? hex;
            g.fillRect(x + 1, y + 1, 1, 1);
        });
    });
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h && opaque[y][x]);
    g.fillStyle = palette.o;
    for (let y = -1; y <= h; y++) {
        for (let x = -1; x <= w; x++) {
            if (at(x, y)) continue;
            if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
                g.fillRect(x + 1, y + 1, 1, 1);
            }
        }
    }
    return c;
}

// Bake every enemy frame once. Returns { kind: { frameName: canvas, ... } }
// with the charger also carrying `${frame}_flash` amber silhouettes and the
// bombardier a 'gun' canvas; null where 2D rasterisation is unavailable
// (bun test/happy-dom), letting drawEnemy fall back to shadow-only without
// throwing — the same guard contract as buildHeroCanvases().
export function buildEnemyCanvases() {
    if (typeof document === 'undefined') return null;
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe || typeof probe.fillRect !== 'function') return null;
    const out = {};
    for (const [kind, frames] of Object.entries(ENEMY_FRAMES)) {
        const pal = ENEMY_PALETTES[kind];
        const { w, h } = ENEMY_DIMS[kind];
        const baked = {};
        for (const [name, rows] of Object.entries(frames)) {
            baked[name] = bakeFrame(rows, pal, w, h);
            if (kind === 'charger') {
                baked[`${name}_flash`] = bakeFrame(rows, pal, w, h, FLASH_INK);
            }
        }
        if (kind === 'bombardier') {
            baked.gun = bakeFrame(GUN_FRAME, pal, GUN_DIMS.w, GUN_DIMS.h);
        }
        out[kind] = baked;
    }
    return out;
}
