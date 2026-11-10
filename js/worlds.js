// WORLDS — per-band generation grammar profiles (World Program W3a).
//
// Owner pain (2026-11-10): "I play to like level 20 or level 30 then give up
// because it's so boring, nothing ever changes, the maps are the same every
// time." Palettes already cycled (THEMES); STRUCTURE did not. A world is a
// DATA profile feeding the EXISTING generation knobs in level.js — gap rates,
// plateau holds, direction policy, deck/shaft chances, object and enemy-kind
// economies, spike density, the marker/spike ban radius, theme band and decor
// density. No physics, no validator bypasses: every map still walks the
// identical gate chain; profiles change inputs, never checks.
//
// Band layout: levels 1..10 are TWO intro worlds' worth of MEADOW (the exact
// shipped grammar — every knob equals the legacy constant, so L1..10 stay
// byte-identical and the golden pins hold untouched), then one world per five
// levels cycling CANYON -> CAVERN -> SKY -> RUIN -> MEADOW -> ... forever.
// Escalation stays where it always was: the per-level ramps inside level.js
// (gap chance, kind chances, targets) keep running UNDER the profile
// multipliers, so harder tiers get proportionally harder worlds.
//
// A world may list `variants`: small per-level overrides rotating through the
// band ((level - 11) % variants.length). The DNA knobs above never change —
// a canyon stays wide-and-bridgey — but neighbouring levels trade sub-
// flavours (how bridgey, how deep the shafts reach, what swarms), so five
// levels of one place read as five places IN that place instead of five
// copies. MEADOWS has none: the onramp is byte-frozen.

export const WORLD_SPAN = 5;        // levels per world after the onramp
export const MEADOW_LAST_LEVEL = 10; // inclusive end of the byte-frozen onramp

// Every knob below is READ BY level.js at exactly the site named in its
// comment. MEADOW's values are the pre-world constants verbatim — do not
// "tidy" them; tests/unit/worlds.test.js pins each against the legacy value
// so a future retune cannot silently drift the onramp.
export const WORLDS = [
    {
        name: 'MEADOWS',
        // Legacy travel cycle (directionForLevel in level.js pre-W3a).
        dirCycle: ['right', 'left', 'vertical'],
        gapMul: 1,          // generatePlatforms: phase-2 gap chance scalar
        downBias: 0.55,     // standard junction chooser: P(step toward floor)
        segHoldMax: 4,      // plateau hold: 1 + floor(rng * segHoldMax)
        bridgeChance: 0.6,  // DECK_BRIDGE slot roll per attempt
        shaftChance: 0.82,  // ELEVATOR shaft slot roll per vertical attempt
        vFlipMul: 1,        // vertical chain flipChance multiplier (clamp .6)
        vExtShift: 0,       // vertical ledge decorative-run shift (clamp >=1)
        padMul: 1,          // PAD_CHANCE multiplier (clamp <=1)
        crateMul: 1,        // CRATE_CHANCE multiplier (clamp <=1)
        kindWeights: { spiny: 1, charger: 1, bombardier: 1 },
        spikeMul: 1,        // placeSpikes target scalar
        markerSpikeBan: 4,  // isMarkerSite spike-proximity veto radius (BW-2)
        themeBand: null,    // null = legacy (level - 1) % bandCount cycle
        decorScale: 1       // sprites._ensureDecor density scale (render-only)
    },
    {
        name: 'CANYONS',
        // Horizontal world: wide terraces read as canyon floors, and the
        // extra climb slots go into deck bridges instead. Two mesa-climbs
        // per five levels keep neighbouring canyons structurally distinct
        // (a vertical rise through rock IS a canyon feature) while three
        // terrace levels hold the world's identity.
        dirCycle: ['right', 'left', 'vertical', 'left', 'vertical'],
        gapMul: 1.35,       // more frequent gaps between terrace shelves
        downBias: 0.55,
        segHoldMax: 4,      // benches, but not monotony (6 measured WARM:
                            // consecutive canyon maps read statistically
                            // identical — variety metric caught it)
        bridgeChance: 1.0,  // every feasible map gets its deck crossing
        shaftChance: 0.7,   // rare relevance (no verticals here)
        vFlipMul: 1,
        vExtShift: 0,
        padMul: 1,          // pad-friendly terraces: full launch economy
        crateMul: 1,
        // Open benches reward dashers: chargers read as canyon runners.
        kindWeights: { spiny: 1, charger: 1.5, bombardier: 1 },
        spikeMul: 1,
        markerSpikeBan: 2,  // BW-2 dial (see CHECKPOINTS ruling note)
        themeBand: 1,       // DUSK: stratified sandstone band
        decorScale: 1.15,
        // Sub-flavours: every-canyon has terraces, but how bridgey and how
        // long the benches run rotates level to level.
        variants: [
            { segHoldMax: 7, bridgeChance: 1.0, gapMul: 1.5 },
            { segHoldMax: 3, bridgeChance: 0.4, gapMul: 1.0 },
            { segHoldMax: 4, bridgeChance: 0.85, gapMul: 1.3 }
        ]
    },
    {
        name: 'CAVERNS',
        // Vertical-heavy world: three climbs in five levels, denser shelf
        // switchbacks, and the elevator ships whenever geometry allows.
        dirCycle: ['vertical', 'right', 'vertical', 'vertical'],
        gapMul: 0.9,        // horizontal entries read as solid rock floors
        downBias: 0.45,     // UP-biased walk: taller mesa stacks, less floor-hugging
        segHoldMax: 3,      // shorter holds = cramped ledges
        bridgeChance: 0.45,
        shaftChance: 1.0,   // every feasible climb carries a chimney lift
        vFlipMul: 1.5,      // snake reverses often: pocketed cavern walls
        vExtShift: -1,      // shorter decorative runs (min 1): tight shelves
        padMul: 0.6,        // launch pads read wrong in sealed rock
        crateMul: 2.0,      // crates welcomed: 1.0 chance, stacking routes
        kindWeights: { spiny: 1, charger: 0.8, bombardier: 1.2 },
        spikeMul: 0.75,     // tighter surfaces already threaten enough
        markerSpikeBan: 2,
        themeBand: 2,       // JUNGLE: dark mossy-earth material band
        decorScale: 0.6,
        // Sub-flavours: some caverns snake hard and tall, others are low
        // cramped crawlways with more ground life.
        variants: [
            { vFlipMul: 1.5, vExtShift: -1, spikeMul: 1.15 },
            { vFlipMul: 0.8, vExtShift: 0, spikeMul: 0.75, downBias: 0.7 },
            { vFlipMul: 1.3, vExtShift: -2, spikeMul: 1.3 }
        ]
    },
    {
        name: 'SKYWARD',
        // Floating-chain world: gap-heavy surfaces plus near-guaranteed deck
        // corridors read as island chains over open void.
        dirCycle: ['right', 'vertical', 'left'],
        gapMul: 1.3,        // capped by GAP_CHANCE_CAP upstream
        downBias: 0.55,
        segHoldMax: 3,
        bridgeChance: 0.85, // big void crossings are the world's signature
        shaftChance: 0.9,
        vFlipMul: 1,
        vExtShift: 0,
        padMul: 1,
        crateMul: 1,
        kindWeights: { spiny: 1, charger: 1.2, bombardier: 1 },
        spikeMul: 1,
        markerSpikeBan: 2,
        themeBand: 0,       // DAY: open-sky band
        decorScale: 0.85,
        // Sub-flavours: long-haul island chains alternate with tighter
        // stepping-stone fields and lift-rich ascents.
        variants: [
            { gapMul: 1.35, shaftChance: 0.9, padMul: 1.2 },
            { gapMul: 1.1, shaftChance: 0.3, padMul: 1 },
            { gapMul: 1.45, shaftChance: 0.6, padMul: 1.4 }
        ]
    },
    {
        name: 'RUINS',
        // Spike-garnished ledge maze: short tight platforms, broken ground,
        // the densest hazard economy the spacing rules allow.
        dirCycle: ['right', 'left', 'vertical'],
        gapMul: 1.1,
        downBias: 0.55,
        segHoldMax: 3,      // short holds = cramped ledges (2 threw on
                            // L53/53041: rubble too fine for the portal
                            // shelf within the 200-attempt budget)
        bridgeChance: 0.5,
        shaftChance: 0.82,
        vFlipMul: 1.2,
        vExtShift: -1,
        padMul: 1,
        crateMul: 1,
        // Ruins guard their thresholds: gunners and spinies on the rubble.
        kindWeights: { spiny: 1, charger: 0.9, bombardier: 1.3 },
        spikeMul: 1.5,      // THREAT_SPACING still caps realized counts
        markerSpikeBan: 2,
        themeBand: 1,       // DUSK again: ruined light
        decorScale: 1.1,
        // Sub-flavours: garrisoned rubble (gunners), supply caches (crates)
        // and launch-pad courtyards rotate through the band.
        variants: [
            { kindWeights: { spiny: 1, charger: 0.9, bombardier: 1.5 }, crateMul: 1 },
            { kindWeights: { spiny: 1.3, charger: 1.1, bombardier: 0.8 }, crateMul: 1.6 },
            { kindWeights: { spiny: 0.9, charger: 0.9, bombardier: 1.2 }, padMul: 1.4, gapMul: 1.25 }
        ]
    }
];

// World index for a level number: pure function, invalid input reads as 0
// WITHOUT warning (same per-frame-safe contract as tierIndexFor). The result
// is UNBOUNDED; consumers index with `% WORLDS.length` (cyclic worlds).
export function worldOf(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) return 0;
    if (levelNumber <= MEADOW_LAST_LEVEL) return 0;
    return 1 + Math.floor((levelNumber - (MEADOW_LAST_LEVEL + 1)) / WORLD_SPAN);
}

// The profile governing one level (cyclic lookup into WORLDS, with the
// world's sub-variant for this position in the band merged over the DNA).
// Pure function of the level number; MEADOW levels get the frozen object
// itself, so identity checks on the onramp profile keep working.
export function profileForLevel(levelNumber) {
    const world = WORLDS[worldOf(levelNumber) % WORLDS.length];
    if (!world.variants || levelNumber <= MEADOW_LAST_LEVEL) return world;
    const variant = world.variants[(levelNumber - (MEADOW_LAST_LEVEL + 1)) % world.variants.length];
    return { ...world, ...variant };
}

// Travel direction, deterministic from the level number (was a private
// cycle in level.js; W3a moved it behind the profile so worlds can bias
// verticality). Below PHASE2_FIRST_LEVEL every world keeps the right-facing
// onramp; above it the profile's cycle indexes off the ABSOLUTE level so
// MEADOW reproduces the shipped ['right','left','vertical'][(n-5)%3] exactly
// wherever it recurs in the rotation.
export function directionForLevel(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) return 'right';
    if (levelNumber < 5) return 'right';
    const cycle = profileForLevel(levelNumber).dirCycle;
    return cycle[(levelNumber - 5) % cycle.length];
}

// Presentation band (THEMES index / MUSIC_PRESETS index) for a level.
// MEADOW keeps the legacy (level - 1) % bandCount cycle byte-for-byte on the
// experience; later worlds pin their band so each world LOOKS and SOUNDS
// distinct beyond palette luck. bandCount comes from the caller's table
// (sprites THEMES length / audio MUSIC_PRESETS length) so this module stays
// free of render/audio imports.
export function bandIndexForLevel(levelNumber, bandCount) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) return 0;
    const band = profileForLevel(levelNumber).themeBand;
    if (band === null) return (levelNumber - 1) % bandCount;
    return ((band % bandCount) + bandCount) % bandCount;
}

// Sequential world ordinal for the title card ("WORLD 3 · CAVERNS"): grows
// monotonically across cycles so a player always knows how deep they are.
export function worldOrdinalForLevel(levelNumber) {
    return worldOf(levelNumber) + 1;
}

// True when `levelNumber` ENTERS a new world (drives the title card line).
// Level 1 counts as an entry (the run opens on WORLD 1 · MEADOWS).
export function isWorldEntry(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) return false;
    if (levelNumber === 1) return true;
    return worldOf(levelNumber) !== worldOf(levelNumber - 1);
}
