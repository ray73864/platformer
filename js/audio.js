// Procedural audio: synthesized SFX + generative ambient music, zero audio
// files, zero dependencies. Everything is built from oscillators and gain
// envelopes on a single lazily-created AudioContext.
import { bandIndexForLevel, worldOf } from './worlds.js';
//
// Lifecycle rules (browser autoplay policy):
//  - NO AudioContext exists until init() runs from a user-gesture path
//    (the Start button → publishLevel chain in main.js). Before that, and
//    forever in environments without AudioContext (bun/happy-dom tests),
//    every exported function is a silent no-op — importing this module and
//    calling anything must never throw.
//  - Scheduling follows the standard "Tale of Two Clocks" pattern: a
//    setInterval (~25 ms) walks ctx.currentTime and schedules notes ~0.1 s
//    ahead. The interval only runs while music is active, unpaused and
//    unmuted; on (re)start the note cursor is rebased so a throttled tab
//    never burst-catches-up.
//
// Pure-logic seams exported for unit tests (no audio hardware needed):
// presetForLevel, musicVariantFor, buildMelodyLoop, advanceScheduler,
// loadMutedPreference, getState, SFX_VOICES, listSfx, WORLD_MUSIC,
// worldArrangementFor.

const MUSIC_LEVEL = 0.35;
const SFX_LEVEL = 0.6;
const MUTE_STORAGE_KEY = 'platformerMuted';
// Pinned by the settings namespace test (literal, not just internal use).
export { MUTE_STORAGE_KEY };
const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_SEC = 0.1;
const CROSSFADE_SEC = 0.8;

// Generative music presets, one per THEMES band in sprites.js
// ((level - 1) % 3 → day/dusk/jungle). Calm tempos, sparse melodies:
// atmospheric pads, not chiptune bangers.
//  - root: pad/bass tonic in Hz; melodies ride the same scale two octaves
//    up for the lead, one down for the bass pulse.
//  - scale: semitone offsets from the tonic (minor pentatonic / dorian /
//    natural minor).
//  - bpm: chill range 66-78; expert-tier-and-above levels creep +6 (§below).
//  - padCutoff: lowpass Hz on the detuned-triangle pad pair.
//  - delayWet: dotted-eighth feedback-delay send for the melody (0 = off);
//    the jungle band leans on it for its darker, damper air.
export const MUSIC_PRESETS = [
    { name: 'day', root: 220.00, scale: [0, 3, 5, 7, 10], bpm: 72, padCutoff: 900, delayWet: 0, melodyWave: 'triangle' },
    { name: 'dusk', root: 146.83, scale: [0, 2, 3, 5, 7, 9, 10], bpm: 66, padCutoff: 700, delayWet: 0.14, melodyWave: 'sine' },
    { name: 'jungle', root: 164.81, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 78, padCutoff: 620, delayWet: 0.28, melodyWave: 'sine' }
];

// Expert/master/legend tiers (level >= 25, matching difficulty.js) creep the
// tempo up slightly — tension without abandoning the calm mood.
const TIER_CREEP_FIRST_LEVEL = 25;
const TIER_CREEP_BPM = 6;

// --- Per-WORLD musical identity (World Program W5) --------------------------
// The band presets above are the PALETTE-synced harmonic base (a world's
// music band follows its visuals through bandIndexForLevel). Each WORLD then
// layers an ARRANGEMENT over that base: its own mode, groove, percussion
// voicing, bass pattern and lead timbre, so MEADOWS bounce, CANYONS lope,
// CAVERNS drone with sparse echoes, SKYWARD floats in high arpeggios and
// RUINS march in phrygian tension. Indexed by WORLDS[] order (worldOf %
// WORLDS.length) — one entry per world profile, kept in lockstep with
// worlds.js by tests/unit/audio.test.js ("one arrangement per WORLD profile").
//  - bpmShift: moves the world's TEMPO character off the band base (the
//    per-level ±4 swing and tier creep still ride on top of it).
//  - scale: null keeps the band scale; an array OVERRIDES the mode (CAVERNS
//    natural minor, RUINS phrygian — the b2 is the tension).
//  - leadWave/leadFilterHz: melody timbre (RUINS sawtooth needs the lowpass
//    or it stings; everything else stays soft).
//  - melodyOctave/padOctave: register lifts (SKYWARD airy-high).
//  - delayBias: extra dotted-eighth send on top of the band's delayWet
//    (CAVERNS echo chambers; clamp keeps it under 0.4).
//  - padDegrees: chord-bed spacing IN SCALE DEGREES ([0,3,5] = open intervals
//    for CANYONS). padForce/bassForce pin a knob the per-level rng would
//    otherwise roll (still inside the declared domains).
//  - densityNames: subset of DENSITY_CHOICES this world draws from.
//  - progressions: world-specific four-bar beds (null = the band's pool).
//  - perc: synthesized noise-band percussion, step indices are eighth notes
//    within a bar (STEPS_PER_BAR=8). Velocities jitter from the level's
//    SEEDED table — never Math.random at schedule time.
//  - percEcho: fraction of the perc voice re-sent through the delay chain
//    (CAVERNS sparse echoes). bassExtra: additional pluck steps per bar.
export const WORLD_MUSIC = Object.freeze([
    {
        tag: 'meadow', bpmShift: 0, scale: null, leadWave: null, leadFilterHz: 0,
        melodyOctave: 0, padOctave: 0, delayBias: 0, padDegrees: [0, 2, 4],
        padForce: null, bassForce: null, densityNames: null, progressions: null,
        perc: { hatSteps: [1, 3, 5, 7], hatPeak: 0.022, hatBandHz: 7800, hatDur: 0.03 },
        percEcho: 0,
        bassExtra: { steps: [4], wave: 'triangle', oct: 0, peak: 0.05, durMul: 1.2 }
    },
    {
        tag: 'canyon', bpmShift: -4, scale: null, leadWave: null, leadFilterHz: 0,
        melodyOctave: 0, padOctave: 0, delayBias: 0, padDegrees: [0, 3, 5],
        padForce: null, bassForce: null, densityNames: null,
        progressions: [[0, 4, 2, 4], [0, 3, 0, 4], [0, 5, 4, 3], [0, 4, 5, 4]],
        // Loping shuffle: hats stumble off the grid, one backbeat rim.
        perc: {
            hatSteps: [2, 3, 6], hatPeak: 0.03, hatBandHz: 5200, hatDur: 0.045,
            snareSteps: [4], snarePeak: 0.05, snareBandHz: 1900
        },
        percEcho: 0,
        bassExtra: { steps: [3], wave: 'sine', oct: -1, peak: 0.09, durMul: 2.2 }
    },
    {
        tag: 'cavern', bpmShift: -6, scale: [0, 2, 3, 5, 7, 8, 10], leadWave: 'sine',
        leadFilterHz: 0, melodyOctave: 0, padOctave: 0, delayBias: 0.1,
        padDegrees: [0, 2, 4], padForce: null, bassForce: 'drone',
        densityNames: ['sparse', 'medium'],
        progressions: [[0, 0, 3, 0], [0, 0, 4, 2], [0, 2, 0, 3], [0, 0, 2, 0]],
        // Every-other-bar boom plus a chance-gated water drip into the echo.
        perc: { kickSteps: [0], kickEveryBars: 2, kickPeak: 0.14, dripStep: 7 },
        percEcho: 0.5, bassExtra: null
    },
    {
        tag: 'skyward', bpmShift: 2, scale: null, leadWave: 'sine', leadFilterHz: 0,
        melodyOctave: 1, padOctave: 1, delayBias: 0.06, padDegrees: [0, 2, 4],
        padForce: 'arp', bassForce: null, densityNames: ['sparse', 'medium'],
        progressions: [[0, 2, 4, 5], [0, 4, 2, 5], [0, 3, 4, 5], [0, 2, 5, 4]],
        // Airy shimmer wash on the downbeat, one soft tick mid-bar.
        perc: { shimmer: true, shimmerPeak: 0.018, tickSteps: [4], tickPeak: 0.02 },
        percEcho: 0,
        bassExtra: { steps: [4], wave: 'sine', oct: -1, peak: 0.07, durMul: 1.2 }
    },
    {
        tag: 'ruins', bpmShift: 8, scale: [0, 1, 3, 5, 7, 8, 10], leadWave: 'sawtooth',
        leadFilterHz: 1400, melodyOctave: 0, padOctave: 0, delayBias: 0,
        padDegrees: [0, 2, 4], padForce: null, bassForce: null, densityNames: null,
        progressions: [[0, 1, 0, 4], [0, 1, 3, 1], [0, 4, 1, 0], [0, 3, 1, 4]],
        // Phrygian tension march: every-step snare mesh, accented downbeats.
        perc: {
            snareSteps: [0, 2, 4, 6], snarePeak: 0.025, snareBandHz: 2100,
            accentSteps: [0, 4], kickSteps: [0], kickPeak: 0.12
        },
        percEcho: 0,
        bassExtra: { steps: [2, 4, 6], wave: 'triangle', oct: -1, peak: 0.06, durMul: 1.4 }
    }
]);

// Urgency intensity layer (W5): under TIME_URGENT_THRESHOLD seconds the loop
// gains a percussive bed and a tempo lift. Multiplier ≈ +7% — audible push,
// not a panic chase; the HUD chip already carries the alarm color.
export const URGENT_THRESHOLD_SEC = 10; // pinned equal to ui.js TIME_URGENT_THRESHOLD
const URGENT_STEP_MUL = 0.93;

// Eighth-note grid; one melodic loop spans four bars.
const STEPS_PER_BAR = 8;
const LOOP_STEPS = STEPS_PER_BAR * 4;
// Chord rotation per bar within the phrase, expressed as SCALE DEGREES
// (not semitones): every chord tone is drawn from the preset scale, so any
// rotation stays consonant with the melody regardless of mode. Player
// ruling: music must vary EVERY level — each band carries several four-bar
// progressions and one is picked per level (see musicVariantFor).
const PROGRESSION_VARIANTS = [
    // day: bright pentatonic turns
    [[0, 2, 4, 2], [0, 3, 2, 4], [0, 4, 5, 4], [0, 2, 3, 2]],
    // dusk: longer drifts off the tonic
    [[0, 2, 4, 2], [0, 5, 4, 2], [0, 2, 5, 4], [0, 3, 4, 2]],
    // jungle: darker suspensions under the delay-dampened lead
    [[0, 2, 4, 2], [0, 4, 2, 2], [0, 5, 2, 4], [0, 2, 4, 5]]
];

// Melody register shifts in semitones above the default lead octave:
// base / a fifth up / a full octave up, picked per level.
const MELODY_SHIFT_CHOICES = [0, 7, 12];

// Melody note density: eighth-step placement probability plus max note
// length, giving roughly one note per 3 / 2 / 1.5 steps. Probabilities are
// tuned so the expected gap (skips + average held length) lands there.
const DENSITY_CHOICES = [
    { name: 'sparse', prob: 0.45, maxLen: 3 },
    { name: 'medium', prob: 0.62, maxLen: 2 },
    { name: 'fluid', prob: 0.78, maxLen: 2 }
];

// Pad character: the triad blooms as one sustained chord, or unfolds one
// tone per bar as a slow arpeggio.
const PAD_MODES = ['sustained', 'arp'];

// Bass: pulse on every bar plus a mid-bar echo, pulse on bar downbeats
// only, or no pulses at all — just a sub-bass drone under the phrase.
const BASS_MODES = ['pulse', 'downbeat', 'drone'];

// Per-level tempo swing around the band base, kept inside the chill range.
const TEMPO_SWING_BPM = 4;

// Local copy of the mulberry32 PRNG (same algorithm as level.js/sprites.js):
// the melody stream derives from the level NUMBER only, so it is
// deterministic per level and never touches the generator's sequences.
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

// Semitone offset of a scale degree, wrapping past the scale length into
// the next octave (degree may be negative).
function degreeSemitones(scale, degree) {
    const len = scale.length;
    const octave = Math.floor(degree / len);
    const idx = ((degree % len) + len) % len;
    return scale[idx] + 12 * octave;
}

// Frequency of a scale degree relative to a preset root. octave shifts in
// whole octaves (+1 melody register, -1 bass pulse).
function scaleNoteHz(preset, degree, octave = 0) {
    return preset.root * Math.pow(2, (degreeSemitones(preset.scale, degree) + 12 * octave) / 12);
}

// Deterministic melody seed for a level number: stable across runs and
// retries, different per level so each level gets its own variation.
function musicSeedForLevel(levelNumber) {
    return (Math.imul(levelNumber, 0x9E3779B1) ^ 0x51a7f2b3) >>> 0;
}

// The WORLD arrangement governing a level's track: same cyclic index as the
// WORLDS profiles themselves (worldOf % length), so terrain grammar and
// musical identity turn over at exactly the same boundary. Invalid input
// reads as world 0 without warning (per-frame-safe contract, like
// worldOf itself). Pure — exported for pins.
export function worldArrangementFor(levelNumber) {
    return WORLD_MUSIC[worldOf(levelNumber) % WORLD_MUSIC.length];
}

// Map a level number onto its music preset: band from the WORLD profile
// (js/worlds.js bandIndexForLevel — MEADOW keeps the legacy THEMES cycle,
// later worlds pin their band so each world has its own musical identity),
// tempo with the expert-tier creep, seed for the melody variation.
// Same validity contract as difficulty.configFor: non-positive-integer
// input warns and falls back to the level-1 preset instead of silently
// landing somewhere through comparison fall-through.
export function presetForLevel(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
        console.warn('Invalid level number for music preset:',
            levelNumber, '- defaulting to level 1 preset');
        levelNumber = 1;
    }
    const index = bandIndexForLevel(levelNumber, MUSIC_PRESETS.length);
    const preset = MUSIC_PRESETS[index];
    const bpm = preset.bpm + (levelNumber >= TIER_CREEP_FIRST_LEVEL ? TIER_CREEP_BPM : 0);
    return { index, preset, bpm, seed: musicSeedForLevel(levelNumber) };
}

// Full per-level arrangement: everything that makes one level's track its
// own, derived deterministically from the level number through the same
// mulberry32 convention as the melody (a seed-mixed stream, so variant and
// melody are independent draws of one level). Retrying a level re-derives
// the identical variant; every new level crossfades to a fresh one because
// the running-key guard below compares the variant signature too. Pure —
// unit tests pin determinism and variety without any AudioContext.
//
// W5: the WORLD arrangement layers over the band base. Every rng draw still
// happens in the ORIGINAL order (then gets overridden), so MEADOWS — which
// overrides nothing — reproduces the pre-W5 variants byte-for-byte, and the
// other worlds shift deterministically. The effective scale/lead timbre/
// delay/register ride on the variant itself for buildMelodyLoop + playback.
export function musicVariantFor(levelNumber) {
    const { index, preset, bpm: baseBpm, seed } = presetForLevel(levelNumber);
    const arr = worldArrangementFor(levelNumber);
    const rng = makeRng((seed ^ 0x7a5731a9) >>> 0);
    const progressions = arr.progressions ?? PROGRESSION_VARIANTS[index];
    const progIndex = Math.floor(rng() * progressions.length);
    const melodyShift = MELODY_SHIFT_CHOICES[Math.floor(rng() * MELODY_SHIFT_CHOICES.length)];
    const densityPool = arr.densityNames
        ? DENSITY_CHOICES.filter(d => arr.densityNames.includes(d.name))
        : DENSITY_CHOICES;
    const density = densityPool[Math.floor(rng() * densityPool.length)];
    const padMode = arr.padForce ?? PAD_MODES[Math.floor(rng() * PAD_MODES.length)];
    const bassMode = arr.bassForce ?? BASS_MODES[Math.floor(rng() * BASS_MODES.length)];
    const bpmOffset = Math.floor(rng() * (2 * TEMPO_SWING_BPM + 1)) - TEMPO_SWING_BPM;
    return {
        index,
        preset,
        seed,
        bpm: baseBpm + arr.bpmShift + bpmOffset,
        progression: progressions[progIndex],
        progIndex,
        melodyShift,
        density: density.name,
        densityProb: density.prob,
        densityMaxLen: density.maxLen,
        padMode,
        bassMode,
        bpmOffset,
        // --- W5 world-identity fields (effective values for playback) -----
        tag: arr.tag,
        scale: arr.scale ?? preset.scale,
        leadWave: arr.leadWave ?? preset.melodyWave,
        leadFilterHz: arr.leadFilterHz,
        melodyOctave: arr.melodyOctave,
        padOctave: arr.padOctave,
        padDegrees: arr.padDegrees,
        perc: arr.perc,
        percEcho: arr.percEcho,
        bassExtra: arr.bassExtra,
        delayWetEff: Math.min(0.4, preset.delayWet + arr.delayBias),
        // Compact identity for the running-key guard: two levels sharing it
        // would sound identical (their seeds still differ inside the full
        // playback key, so the melody never repeats either). W5: the world
        // tag rides along so a boundary swap is keyed even if every rolled
        // knob happened to coincide.
        signature: `${arr.tag}+${progIndex}+${melodyShift}+${density.name}+${padMode}+${bassMode}+${bpmOffset}`
    };
}

// Build one LOOP_STEPS-step melody for a level: probabilistic placement
// from the preset scale at the level's variant density, seeded so the same
// (presetIndex, levelNumber) always yields the identical sequence (the loop
// repeats verbatim).
export function buildMelodyLoop(presetIndex, levelNumber) {
    const preset = MUSIC_PRESETS[((presetIndex % MUSIC_PRESETS.length) + MUSIC_PRESETS.length) % MUSIC_PRESETS.length];
    const variant = musicVariantFor(levelNumber);
    // W5: the melody rides the WORLD's effective mode (variant.scale), which
    // equals the band scale for MEADOWS — so meadow loops stay byte-identical
    // while RUINS melodies pick up the phrygian b2 etc. for free.
    const scale = variant.scale ?? preset.scale;
    const rng = makeRng(musicSeedForLevel(levelNumber));
    const loop = new Array(LOOP_STEPS).fill(null);
    let degree = Math.floor(rng() * scale.length);
    let i = 0;
    while (i < LOOP_STEPS) {
        // Density comes from the level variant: sparse (~1 note per 3
        // steps) through fluid (~1 per 1.5), held 1-maxLen steps.
        if (rng() < variant.densityProb) {
            degree = Math.max(-2, Math.min(scale.length + 3,
                degree + Math.floor(rng() * 5) - 2));
            const oct = rng() < 0.25 ? 1 : 0;
            const len = Math.min(1 + Math.floor(rng() * variant.densityMaxLen), LOOP_STEPS - i);
            loop[i] = { deg: degree, oct, len };
            i += len;
        } else {
            i++;
        }
    }
    return loop;
}

// Scheduler core, pure against an injected clock: walk the note cursor from
// state.nextStepTime forward while it sits inside [now, now + lookahead),
// emitting (step, time) pairs. A cursor left far behind `now` (backgrounded
// tab, paused timer) is REBASED instead of burst-scheduled — the standard
// cure for the catch-up strobe. Returns the number of steps emitted.
export function advanceScheduler(state, nowSec, lookaheadSec, stepDurSec, emit) {
    if (!(stepDurSec > 0)) return 0;
    if (state.nextStepTime < nowSec - stepDurSec) state.nextStepTime = nowSec;
    let count = 0;
    while (state.nextStepTime < nowSec + lookaheadSec) {
        emit(state.step, state.nextStepTime);
        state.step = (state.step + 1) % LOOP_STEPS;
        state.nextStepTime += stepDurSec;
        count++;
    }
    return count;
}

// --- Module state (lazy singleton) ---------------------------------------

let ctx = null;
let master = null;   // master volume (mute rides this) -> limiter -> soft-clip -> destination
let limiter = null;  // headphone-safe stage 1 (DynamicsCompressor, W5)
let softClip = null; // headphone-safe stage 2 (tanh WaveShaper, W5)
let sfxBus = null;   // all one-shots
let musicBus = null; // music layer (duck rides this) <- playback gains
let playback = null; // { key, gain, preset, variant, stepDur, melody, delaySend, state:{step,nextStepTime} }
let schedulerId = null;
let cleanupTimers = new Set();
let noiseBuffer = null;
let muted = false;
let muteLoaded = false;
let ducked = false;
// W5 intensity layer: armed by Game when the run clock drops under the HUD
// urgency threshold; adds a percussive bed + tempo lift to the running loop.
let urgent = false;

function storageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        // file:// origins and privacy modes vary; storage is best-effort.
        return null;
    }
}

function storageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Persisted mute is a nicety; a throwing store must not break play.
    }
}

// Read the persisted mute preference into module state (also the test seam
// for the storage-throws fallback). Absent/unreadable storage defaults to
// unmuted.
export function loadMutedPreference() {
    muted = storageGet(MUTE_STORAGE_KEY) === 'true';
    muteLoaded = true;
    return muted;
}

// Feature-detect without tripping no-undef: older webkit spelling lives on
// globalThis if it exists at all.
function audioConstructor() {
    if (typeof AudioContext !== 'undefined') return AudioContext;
    if (typeof globalThis.webkitAudioContext !== 'undefined') return globalThis.webkitAudioContext;
    return null;
}

// Create the context graph on first call (must happen inside a user gesture
// for autoplay policy to allow running). Returns false — silently — when
// WebAudio is unavailable or refuses to construct, which is what keeps
// every caller below inert under bun/happy-dom.
function ensureContext() {
    if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return true;
    }
    const Ctor = audioConstructor();
    if (!Ctor) return false;
    try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        // W5 headphone-safe ceiling, two stages: a hard-knee compressor as
        // a cheap limiter (threshold -6 dBFS, ratio 12:1, fast attack) plus
        // a tanh soft-clip WaveShaper that MATHEMATICALLY bounds output
        // below |1.0| (linear to 0.7, smooth saturation above — see
        // softClipCurve). Offline worst-case render: raw 1.72 -> shaped
        // <1.0 (w5-peak-probe.json). Environments missing either node type
        // fall through to the historical direct connection.
        let tail = ctx.destination;
        if (typeof ctx.createDynamicsCompressor === 'function') {
            limiter = ctx.createDynamicsCompressor();
            limiter.threshold.value = -6;
            limiter.knee.value = 0;
            limiter.ratio.value = 12;
            limiter.attack.value = 0.003;
            limiter.release.value = 0.12;
            limiter.connect(tail);
            tail = limiter;
        } else {
            limiter = null;
        }
        if (typeof ctx.createWaveShaper === 'function') {
            softClip = ctx.createWaveShaper();
            softClip.curve = softClipCurve();
            softClip.oversample = '2x';
            softClip.connect(tail);
            tail = softClip;
        } else {
            softClip = null;
        }
        master.connect(tail);
        sfxBus = ctx.createGain();
        sfxBus.gain.value = SFX_LEVEL;
        sfxBus.connect(master);
        musicBus = ctx.createGain();
        musicBus.gain.value = ducked || muted ? 0 : MUSIC_LEVEL;
        musicBus.connect(master);
    } catch {
        ctx = null;
        return false;
    }
    return true;
}

function cachedNoiseBuffer() {
    if (!noiseBuffer) {
        const len = Math.floor(ctx.sampleRate * 0.3);
        noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
}

// Soft-clip curve for the master safety stage: identity up to |x| = KNEE,
// then tanh saturation whose asymptote is exactly 1 — so ANY input sum maps
// strictly inside [-1, 1] and headphones can never see a clipped transient.
// Normal program levels (< ~0.7 bus peaks, see w5-report gain table) ride
// the linear region untouched; only pathological stacks feel the bend.
function softClipCurve() {
    const N = 1024;
    const knee = 0.7;
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        const ax = Math.abs(x);
        curve[i] = ax <= knee
            ? x
            : Math.sign(x) * (knee + (1 - knee) * Math.tanh((ax - knee) / (1 - knee)));
    }
    return curve;
}

// --- Voice helpers ---------------------------------------------------------

// Percussive oscillator voice: optional pitch sweep, optional lowpass,
// linear attack then exponential decay to silence. Always self-stopping so
// nodes are collectable after they finish.
function tone({ wave = 'sine', freq, endFreq = 0, dur, peak, attack = 0.005, filterHz = 0, dest, when }) {
    const t = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq > 0) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (filterHz > 0) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = filterHz;
        osc.connect(lp);
        node = lp;
    }
    node.connect(g);
    g.connect(dest || sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
}

// Bandpass noise one-shot. endBandHz > 0 sweeps the band across the burst
// (Wave D dash whoosh); absent, the band holds steady like every older call.
// W5: optional dest routes world percussion onto the music playback gain —
// SFX callers keep the default sfxBus.
function noiseBurst({ dur, peak, bandHz, endBandHz = 0, when, dest }) {
    const t = when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = cachedNoiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(bandHz, t);
    if (endBandHz > 0) bp.frequency.exponentialRampToValueAtTime(endBandHz, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest || sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
}

// Voice registry: the public event→voice contract with main.js. Every
// gameplay event site plays through one of these constants (no bare string
// literals at call sites), and the suite pins the mapping both ways against
// the implemented SFX table below — deleting a mapping or a voice goes red.
export const SFX_VOICES = Object.freeze({
    JUMP: 'jump',
    LAND: 'land',
    COIN: 'coin',
    COIN_SECRET: 'coin_secret',
    STOMP: 'stomp',
    BOMBARD_FIRE: 'bombard_fire',
    DEATH: 'death',
    PORTAL_UNLOCK: 'portal_unlock',
    LEVEL_COMPLETE: 'level_complete',
    DASH: 'dash',
    WALL_SLIDE: 'wall_slide',
    PAD_BOUNCE: 'pad_bounce',
    CRATE_PUSH: 'crate_push',
    // W5 UI family: subtle non-diegetic confirmation blips. They only ever
    // fire once a run has booted the AudioContext (autoplay doctrine: the
    // pre-first-run menu stays silent — nothing would be audible anyway).
    UI_MOVE: 'ui_move',
    UI_TOGGLE: 'ui_toggle',
    UI_CONFIRM: 'ui_confirm'
});

// Implemented voice names (registry-completeness seam; order = SFX table).
export function listSfx() {
    return Object.keys(SFX);
}

// Wave D tuning constants — every new/parameterised voice reads its
// frequencies and waveforms from named values here.
const SECRET_COIN_WAVE = 'sine';
const SECRET_COIN_LOW_HZ = 987.77;   // B5 — the plain ping's first tone
const SECRET_COIN_MID_HZ = 1318.51;  // E6 — the plain ping's second tone
const SECRET_COIN_HIGH_HZ = 1975.53; // B6 — the richer tail only secrets play
const STOMP_BASE_HZ = 300;
const STOMP_END_HZ = 60;
const STOMP_CHAIN_SEMITONE_STEP = 3; // minor third per chain step: clearly rising
const STOMP_CHAIN_MAX_STEPS = 4;     // pitch caps there (chain spam stays sane)
const LAND_WAVE = 'triangle';
const LAND_END_HZ = 65;
const LAND_FILTER_HZ = 400;
const DASH_NOISE_DUR = 0.16;
const DASH_NOISE_PEAK = 0.2;
const DASH_BAND_START_HZ = 500;      // whoosh: band sweeps up through the burst
const DASH_BAND_END_HZ = 2400;
const DASH_BODY_WAVE = 'square';
const DASH_BODY_HZ = 480;
const DASH_BODY_END_HZ = 160;
const WALL_SLIDE_NOISE_DUR = 0.07;   // subtle by spec: a tick, not a loop
const WALL_SLIDE_NOISE_PEAK = 0.05;
const WALL_SLIDE_BAND_HZ = 1500;
const PAD_BOUNCE_WAVE = 'triangle';
const PAD_BOUNCE_LOW_HZ = 170;       // boing: fast upward bend...
const PAD_BOUNCE_HIGH_HZ = 560;
const PAD_BOUNCE_SHEEN_HZ = 340;     // ...plus an octave sine sheen
const PAD_BOUNCE_SHEEN_END_HZ = 1120;
const CRATE_PUSH_NOISE_DUR = 0.05;
const CRATE_PUSH_NOISE_PEAK = 0.045; // very quiet strain scuff under everything
const CRATE_PUSH_BAND_HZ = 260;

// W5 SFX-depth tuning — landing buckets, coin streak ladder, jump air, UI.
// Landing buckets (depth d is the impact fall speed / LAND_DEPTH_REF_VY,
// clamped 0.25..1 by Game): soft taps (< SOFT_BUCKET) stay primary-tone +
// a whisper of scuff; mid landings get the full scuff sweep; slams
// (>= HEAVY_BUCKET) additionally hit the 55 Hz sub. The PRIMARY thud's
// pitch/dur/peak curve is untouched (Wave D pins hold).
const LAND_SOFT_BUCKET_D = 0.45;
const LAND_HEAVY_BUCKET_D = 0.75;
const LAND_SCUFF_PEAK = 0.025;   // scaled by depth on top of this floor
const LAND_SUB_HZ = 55;
const LAND_SUB_PEAK = 0.16;
// Coin streak: consecutive pickups WITHOUT touching ground (Game tracks it,
// resets on the air-to-ground edge — airborne chains read as skill, per-level
// totals would just ramp every level identically). One whole tone per pickup
// up a 6-step ladder (+12 semitones max), so a full-air chain rings up like
// a combo without ever leaving the ping's timbre. Streak 0 = the classic
// two-tone ping verbatim (backward-compatible default).
const COIN_STREAK_SEMITONE_STEP = 2;
const COIN_STREAK_MAX_STEPS = 6;
// Secret fanfare grace notes: the plain B5→E6 DNA plus a bright E7→G7
// micro-fanfare tail — the alcove find REWARDS differently by ear.
const FANFARE_E7_HZ = 2637.02;   // E7
const FANFARE_G7_HZ = 3135.96;   // G7

// One-shot SFX set. Punchy retro blips, each under 0.4 s except the win
// sting. Names are the public contract with main.js (see SFX_VOICES).
const SFX = {
    // Rising blip, W5 airier: the square body now rides a 1.8 kHz lowpass at
    // lower peak (less clicky edge) with a sine sheen an octave up gliding
    // with it — breath on top of the blip instead of a pure buzz cut.
    jump() {
        const t = ctx.currentTime;
        tone({ wave: 'square', freq: 220, endFreq: 560, dur: 0.13, peak: 0.16,
            attack: 0.012, filterHz: 1800, when: t });
        tone({ wave: 'sine', freq: 440, endFreq: 1180, dur: 0.16, peak: 0.09,
            attack: 0.02, when: t });
    },
    // Soft low thud, filtered: touchdown weight without a click. Wave D:
    // magnitude rides the fall-speed bucket (Game passes its _landDepth,
    // 0.25..1) — soft taps stay shallow, big drops slam. Default matches
    // the historical fixed voice (d=0.5 reproduces 150 Hz / 0.32 / 0.15 s).
    // W5 depth pass: a bandpass scuff under every landing (band opens with
    // impact speed) and a 55 Hz sub thump for the slam bucket (d >= 0.75).
    // The primary tone stays FIRST so its pinned start frequency is first
    // in any osc log.
    land(depth = 0.5) {
        const d = Math.min(1, Math.max(0.25, depth));
        tone({ wave: LAND_WAVE, freq: 120 + 60 * d, endFreq: LAND_END_HZ,
            dur: 0.12 + 0.06 * d, peak: 0.22 + 0.2 * d, filterHz: LAND_FILTER_HZ });
        noiseBurst({ dur: 0.05 + 0.05 * d,
            peak: (d < LAND_SOFT_BUCKET_D ? LAND_SCUFF_PEAK * 0.5 : LAND_SCUFF_PEAK) + 0.045 * d,
            bandHz: 280 + 520 * d });
        if (d >= LAND_HEAVY_BUCKET_D) {
            tone({ wave: 'sine', freq: LAND_SUB_HZ, endFreq: 38, dur: 0.18,
                peak: LAND_SUB_PEAK, attack: 0.008, filterHz: 140 });
        }
    },
    // Classic two-tone sine ping (B5 -> E6). W5: the airborne pickup streak
    // (Game passes pickups since last ground contact) lifts the whole ping a
    // whole tone per pickup up the ladder — chains ring UP; 0/invalid keeps
    // the classic frequencies verbatim.
    coin(streak = 0) {
        const s = Math.min(COIN_STREAK_MAX_STEPS,
            Math.max(0, Number.isFinite(streak) ? Math.floor(streak) : 0));
        const mul = Math.pow(2, s * COIN_STREAK_SEMITONE_STEP / 12);
        const t = ctx.currentTime;
        tone({ wave: 'sine', freq: 987.77 * mul, dur: 0.07, peak: 0.26, when: t });
        tone({ wave: 'sine', freq: 1318.51 * mul, dur: 0.16, peak: 0.26, when: t + 0.07 });
    },
    // Downward squish for stomps: falling triangle through a closing filter.
    // Wave D: the chain step (Game passes its airborne kill streak BEFORE
    // this hit's increment — 0 = normal stomp) raises the pitch one minor
    // third per step so chains climb audibly; the sweep shape is untouched.
    stomp(step = 0) {
        const s = Math.min(STOMP_CHAIN_MAX_STEPS,
            Math.max(0, Number.isFinite(step) ? Math.floor(step) : 0));
        const mul = Math.pow(2, s * STOMP_CHAIN_SEMITONE_STEP / 12);
        tone({ wave: 'triangle', freq: STOMP_BASE_HZ * mul, endFreq: STOMP_END_HZ * mul,
            dur: 0.18, peak: 0.4, filterHz: 900 });
    },
    // Bombardier FIRE: low thump + short plosive noise — a cannon, not a
    // laser. Same helpers as every other one-shot; stays under 0.4 s.
    bombard_fire() {
        tone({ wave: 'triangle', freq: 110, endFreq: 45, dur: 0.22, peak: 0.4, filterHz: 320 });
        noiseBurst({ dur: 0.12, peak: 0.18, bandHz: 240 });
    },
    // Falling saw plus a short noise burst: unmistakable bad news.
    death() {
        tone({ wave: 'sawtooth', freq: 380, endFreq: 50, dur: 0.35, peak: 0.32, attack: 0.01 });
        noiseBurst({ dur: 0.15, peak: 0.22, bandHz: 900 });
    },
    // Bright three-note ascending arpeggio: the portal gate just opened.
    portal_unlock() {
        const t = ctx.currentTime;
        [523.25, 659.25, 783.99].forEach((f, i) =>
            tone({ wave: 'sine', freq: f, dur: 0.12, peak: 0.24, when: t + i * 0.08 }));
    },
    // Warm four-note chord rise (the one long sting, ~0.95 s).
    level_complete() {
        const t = ctx.currentTime;
        [220, 261.63, 329.63, 440].forEach((f, i) =>
            tone({ wave: 'triangle', freq: f, dur: 0.55, peak: 0.2, attack: 0.02,
                filterHz: 1600, when: t + i * 0.12 }));
    },
    // --- Wave D additions ---------------------------------------------------
    // Secret-alcove payout: the plain ping's two-tone DNA (B5 → E6) with a
    // high B6 triangle tail, W5-expanded into a micro-fanfare: the tail now
    // climbs E7 → G7 so the lateral-thinking find REWARDS differently by
    // ear, not just score. Still under half a second.
    coin_secret() {
        const t = ctx.currentTime;
        tone({ wave: SECRET_COIN_WAVE, freq: SECRET_COIN_LOW_HZ, dur: 0.09,
            peak: 0.24, when: t });
        tone({ wave: SECRET_COIN_WAVE, freq: SECRET_COIN_MID_HZ, dur: 0.12,
            peak: 0.24, when: t + 0.08 });
        tone({ wave: 'triangle', freq: SECRET_COIN_HIGH_HZ, dur: 0.24,
            peak: 0.12, when: t + 0.16 });
        tone({ wave: 'triangle', freq: FANFARE_E7_HZ, dur: 0.09,
            peak: 0.07, when: t + 0.24 });
        tone({ wave: 'triangle', freq: FANFARE_G7_HZ, dur: 0.14,
            peak: 0.06, when: t + 0.3 });
    },
    // Whoosh: bandpass noise sweeping upward through the burst plus a faint
    // square body falling the other way — motion in both channels, <0.2 s.
    dash() {
        noiseBurst({ dur: DASH_NOISE_DUR, peak: DASH_NOISE_PEAK,
            bandHz: DASH_BAND_START_HZ, endBandHz: DASH_BAND_END_HZ });
        tone({ wave: DASH_BODY_WAVE, freq: DASH_BODY_HZ, endFreq: DASH_BODY_END_HZ,
            dur: 0.1, peak: 0.1 });
    },
    // Wall-slide START only (Game edge-detects): one quiet filtered-noise
    // tick marking the contact. Deliberately subtle — a continuous scrape
    // would drown the music bed on every chimney.
    wall_slide() {
        noiseBurst({ dur: WALL_SLIDE_NOISE_DUR, peak: WALL_SLIDE_NOISE_PEAK,
            bandHz: WALL_SLIDE_BAND_HZ });
    },
    // Launch-pad boing: fast upward triangle bend with an octave sine sheen
    // riding half a beat behind — springs read as bends, not blips.
    pad_bounce() {
        const t = ctx.currentTime;
        tone({ wave: PAD_BOUNCE_WAVE, freq: PAD_BOUNCE_LOW_HZ,
            endFreq: PAD_BOUNCE_HIGH_HZ, dur: 0.24, peak: 0.32, attack: 0.012,
            when: t });
        tone({ wave: 'sine', freq: PAD_BOUNCE_SHEEN_HZ, endFreq: PAD_BOUNCE_SHEEN_END_HZ,
            dur: 0.16, peak: 0.1, when: t + 0.03 });
    },
    // Crate-push strain: a very quiet low scuff on a capped cadence (the
    // caller rate-limits; this is one grain of it, ~0.05 s).
    crate_push() {
        noiseBurst({ dur: CRATE_PUSH_NOISE_DUR, peak: CRATE_PUSH_NOISE_PEAK,
            bandHz: CRATE_PUSH_BAND_HZ });
    },
    // --- W5 UI family -------------------------------------------------------
    // Focus/nav tick: barely-there sine chip. Fires on button focus moves so
    // keyboard AND tap navigation confirm without ever competing with music.
    ui_move() {
        tone({ wave: 'sine', freq: 1180, dur: 0.035, peak: 0.05, attack: 0.004 });
    },
    // Settings/mute toggle flip: rising perfect fifth, short and soft — the
    // ascending pair reads as "on/changed" in either direction.
    ui_toggle() {
        const t = ctx.currentTime;
        tone({ wave: 'sine', freq: 523.25, dur: 0.05, peak: 0.09, when: t });
        tone({ wave: 'sine', freq: 783.99, dur: 0.08, peak: 0.09, when: t + 0.05 });
    },
    // Primary action commit (start/retry/resume): warm triangle third-up,
    // slightly fuller than the toggle so pressing PLAY feels like pressing
    // something. The portal chime stays the bigger sibling.
    ui_confirm() {
        const t = ctx.currentTime;
        tone({ wave: 'triangle', freq: 587.33, dur: 0.07, peak: 0.14, when: t });
        tone({ wave: 'triangle', freq: 880, dur: 0.12, peak: 0.14,
            attack: 0.008, when: t + 0.06 });
    }
};

// --- Music engine ----------------------------------------------------------

function stopScheduler() {
    if (schedulerId !== null) {
        clearInterval(schedulerId);
        schedulerId = null;
    }
}

function schedulerShouldRun() {
    return !!ctx && !!playback && !muted && !ducked;
}

function startScheduler() {
    if (schedulerId !== null || !schedulerShouldRun()) return;
    // Rebase the cursor to now: whatever time passed while paused/muted is
    // skipped, not replayed as a machine-gun catch-up.
    if (playback.state.nextStepTime < ctx.currentTime) {
        playback.state.nextStepTime = ctx.currentTime;
    }
    schedulerId = setInterval(() => {
        if (!schedulerShouldRun()) {
            stopScheduler();
            return;
        }
        advanceScheduler(playback.state, ctx.currentTime, LOOKAHEAD_SEC,
            playback.stepDur, (step, when) => playMusicStep(playback, step, when));
    }, SCHEDULER_INTERVAL_MS);
}

// World percussion + W5 intensity bed for one grid step. Every pattern is a
// deterministic step table from the level's WORLD arrangement; velocities
// jitter off the playback's SEEDED table (never Math.random at schedule
// time). Peaks are deliberately tiny next to SFX hits — the bed sits UNDER
// gameplay, and the whole music layer already rides MUSIC_LEVEL on the bus.
function playPercussion(pb, step, when) {
    const p = pb.variant.perc;
    if (!p) return;
    const s = step % STEPS_PER_BAR;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const jit = 0.75 + 0.5 * pb.vel[step];
    const dest = pb.gain;
    const echo = pb.delaySend && pb.variant.percEcho > 0;
    if (p.hatSteps && p.hatSteps.includes(s)) {
        noiseBurst({ dur: p.hatDur, peak: p.hatPeak * jit, bandHz: p.hatBandHz, dest });
    }
    if (p.shimmer && s === 0) {
        noiseBurst({ dur: 0.3, peak: p.shimmerPeak * jit, bandHz: 9500, dest });
    }
    if (p.tickSteps && p.tickSteps.includes(s)) {
        noiseBurst({ dur: 0.02, peak: p.tickPeak * jit, bandHz: 6800, dest });
    }
    if (p.snareSteps && p.snareSteps.includes(s)) {
        const accent = p.accentSteps && p.accentSteps.includes(s);
        noiseBurst({ dur: accent ? 0.06 : 0.035,
            peak: (accent ? p.snarePeak * 2 : p.snarePeak) * jit,
            bandHz: p.snareBandHz, dest });
        tone({ wave: 'triangle', freq: 170, endFreq: 120, dur: 0.06,
            peak: 0.045 * jit, dest, when });
    }
    if (p.kickSteps && p.kickSteps.includes(s) &&
        (!p.kickEveryBars || bar % p.kickEveryBars === 0)) {
        tone({ wave: 'sine', freq: 95, endFreq: 45, dur: 0.22,
            peak: p.kickPeak * jit, attack: 0.006, dest, when });
        // CAVERNS signature: the boom spills into the dotted-eighth echo.
        if (echo) {
            tone({ wave: 'sine', freq: 95, endFreq: 45, dur: 0.22,
                peak: p.kickPeak * pb.variant.percEcho * jit, attack: 0.006,
                dest: pb.delaySend, when });
        }
    }
    if (p.dripStep !== undefined && s === p.dripStep && pb.vel[step] > 0.6) {
        // Chance-gated water drip (seeded velocity roll): sparse echoes are
        // the world's punctuation, not a metronome.
        tone({ wave: 'sine', freq: 2400, endFreq: 2100, dur: 0.12,
            peak: 0.05 * jit, dest, when });
        if (echo) {
            tone({ wave: 'sine', freq: 2400, endFreq: 2100, dur: 0.12,
                peak: 0.05 * pb.variant.percEcho * jit, dest: pb.delaySend, when });
        }
    }
}

// Render one grid step of the generative loop against the level's variant:
// bass per bassMode, pad chord rotation per padMode, and the seeded melody
// line at its variant register.
function playMusicStep(pb, step, when) {
    const preset = pb.preset;
    const v = pb.variant;
    if (step % LOOP_STEPS === 0 && v.padMode === 'sustained') {
        // Pad: three scale-degree voices, each a detuned triangle pair
        // through a lowpass, lasting the full phrase plus release tail.
        const chordRoot = v.progression[0];
        const dur = pb.stepDur * LOOP_STEPS + 2;
        for (const offset of v.padDegrees) {
            const freq = scaleNoteHz(preset, chordRoot + offset, v.padOctave);
            for (const detune of [-6, 6]) {
                const osc = ctx.createOscillator();
                osc.type = 'triangle';
                osc.frequency.value = freq;
                osc.detune.value = detune;
                const lp = ctx.createBiquadFilter();
                lp.type = 'lowpass';
                lp.frequency.value = preset.padCutoff;
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.0001, when);
                g.gain.linearRampToValueAtTime(0.05, when + 1.5);
                g.gain.setValueAtTime(0.05, when + dur - 1.8);
                g.gain.linearRampToValueAtTime(0.0001, when + dur);
                osc.connect(lp);
                lp.connect(g);
                g.connect(pb.gain);
                osc.start(when);
                osc.stop(when + dur + 0.05);
            }
        }
    }
    if (step % LOOP_STEPS === 0 && v.bassMode === 'drone') {
        // No pulses at all: one sub-bass fundamental under the whole phrase.
        tone({
            wave: 'sine',
            freq: scaleNoteHz(preset, v.progression[0], -2),
            dur: pb.stepDur * LOOP_STEPS + 1,
            peak: 0.13,
            attack: 0.5,
            dest: pb.gain,
            when
        });
    }
    if (step % STEPS_PER_BAR === 0) {
        const bar = (step / STEPS_PER_BAR) % v.progression.length;
        const chordRoot = v.progression[bar];
        if (v.padMode === 'arp') {
            // Slow arpeggio alternation: one chord tone per bar cycling
            // through the world's pad degrees across the phrase, so the
            // triad unfolds instead of blooming all at once. Filtered like
            // the sustained pad.
            tone({
                wave: 'triangle',
                freq: scaleNoteHz(preset, chordRoot +
                    v.padDegrees[bar % v.padDegrees.length], v.padOctave),
                dur: pb.stepDur * STEPS_PER_BAR + 0.6,
                peak: 0.07,
                attack: 0.3,
                filterHz: preset.padCutoff,
                dest: pb.gain,
                when
            });
        }
        if (v.bassMode !== 'drone') {
            tone({
                wave: 'sine',
                freq: scaleNoteHz(preset, chordRoot, -1),
                dur: pb.stepDur * 3.2,
                peak: 0.16,
                attack: 0.02,
                dest: pb.gain,
                when
            });
        }
    }
    if (v.bassMode === 'pulse' && step % STEPS_PER_BAR === 4) {
        // Mid-bar echo distinguishes 'pulse' from downbeats-only 'downbeat'.
        const bar = ((step - 4) / STEPS_PER_BAR) % v.progression.length;
        tone({
            wave: 'sine',
            freq: scaleNoteHz(preset, v.progression[bar], -1),
            dur: pb.stepDur * 2,
            peak: 0.1,
            attack: 0.02,
            dest: pb.gain,
            when
        });
    }
    // World bass character: extra pluck steps (meadow bounce, canyon lope,
    // skyward hop, ruins march) on top of whatever mode rolled.
    const extra = v.bassExtra;
    if (extra && v.bassMode !== 'drone' && extra.steps.includes(step % STEPS_PER_BAR)) {
        const bar = Math.floor(step / STEPS_PER_BAR) % v.progression.length;
        tone({
            wave: extra.wave,
            freq: scaleNoteHz(preset, v.progression[bar], extra.oct),
            dur: pb.stepDur * extra.durMul,
            peak: extra.peak * (0.75 + 0.5 * pb.vel[step]),
            attack: 0.008,
            dest: pb.gain,
            when
        });
    }
    playPercussion(pb, step, when);
    // W5 intensity bed: while the run clock is urgent, every step gains a
    // driving tick and every bar downbeat a kick. Armed/disarmed by Game
    // through setUrgent; mute/duck already stop the scheduler entirely, so
    // this can never sound against the single mute source of truth.
    if (urgent) {
        const jit = 0.75 + 0.5 * pb.vel[step];
        noiseBurst({ dur: 0.025, peak: 0.03 * jit, bandHz: 6500, dest: pb.gain });
        if (step % STEPS_PER_BAR === 0) {
            tone({ wave: 'sine', freq: 150, endFreq: 50, dur: 0.14,
                peak: 0.12 * jit, attack: 0.005, dest: pb.gain, when });
        }
    }
    const note = pb.melody[step];
    if (note) {
        const dur = Math.min(note.len * pb.stepDur * 0.9, 1.6);
        // Variant register shift (semitones above the default lead octave)
        // plus the world's standing octave lift (SKYWARD airy-high) and its
        // timbre/filter (RUINS filtered sawtooth etc.).
        const freq = scaleNoteHz(preset, note.deg, note.oct + 1 + v.melodyOctave) *
            Math.pow(2, v.melodyShift / 12);
        tone({
            wave: preset.melodyWave,
            freq,
            dur,
            peak: 0.12,
            attack: 0.03,
            filterHz: v.leadFilterHz,
            dest: pb.gain,
            when
        });
        if (pb.delaySend) {
            tone({
                wave: preset.melodyWave,
                freq,
                dur,
                peak: 0.12,
                attack: 0.03,
                dest: pb.delaySend,
                when
            });
        }
    }
}

function later(ms, fn) {
    const id = setTimeout(() => {
        cleanupTimers.delete(id);
        fn();
    }, ms);
    cleanupTimers.add(id);
}

// Tear down a finished playback's nodes once its fade-out has elapsed.
function retirePlayback(pb) {
    later(CROSSFADE_SEC * 1000 + 150, () => disconnectPlayback(pb));
}

function createPlayback(index, variant, levelNumber) {
    // Effective preset: band base with the world's mode/timbre/delay merged
    // over it (MUSIC_PRESETS itself stays untouched — it is the palette-
    // synced table other pins read).
    const preset = {
        ...MUSIC_PRESETS[index],
        scale: variant.scale,
        melodyWave: variant.leadWave,
        delayWet: variant.delayWetEff
    };
    const stepDurBase = 60 / variant.bpm / 2; // eighth notes
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + CROSSFADE_SEC);
    gain.connect(musicBus);
    // Optional dotted-eighth feedback delay chain (the damper bands route
    // melody voices through delaySend): send -> delay -> feedback -> delay,
    // delay -> gain. All three nodes are kept for teardown.
    let delaySend = null;
    let delayNode = null;
    let feedback = null;
    if (preset.delayWet > 0) {
        delayNode = ctx.createDelay(2);
        delayNode.delayTime.value = stepDurBase * 3;
        feedback = ctx.createGain();
        feedback.gain.value = 0.32;
        delaySend = ctx.createGain();
        delaySend.gain.value = preset.delayWet;
        delaySend.connect(delayNode);
        delayNode.connect(feedback);
        feedback.connect(delayNode);
        delayNode.connect(gain);
    }
    return {
        // Running key: band + world tag + tempo + per-level seed + variant
        // signature, so a new level always crossfades to its own track while
        // a retry of the same level (identical everything) restarts nothing.
        key: `${index}:${variant.bpm}:${variant.seed}:${variant.signature}`,
        gain,
        preset,
        variant,
        stepDurBase,
        // Urgency tempo lift rides the effective cursor length only; the
        // base tempo re-derives cleanly on the next (re)start.
        stepDur: urgent ? stepDurBase * URGENT_STEP_MUL : stepDurBase,
        // Seeded per-step velocity jitter (musical variation ONLY — never
        // Math.random at schedule time, so layers can never desync).
        vel: (() => {
            const vrng = makeRng((variant.seed ^ 0x9e3779b9) >>> 0);
            const arr = new Float32Array(LOOP_STEPS);
            for (let i = 0; i < LOOP_STEPS; i++) arr[i] = vrng();
            return arr;
        })(),
        melody: buildMelodyLoop(index, levelNumber),
        delaySend,
        delayNode,
        feedback,
        state: { step: 0, nextStepTime: ctx.currentTime }
    };
}

// Disconnect a retired playback's delay chain alongside its bus gain.
function disconnectPlayback(pb) {
    try {
        pb.gain.disconnect();
        if (pb.delaySend) {
            pb.delaySend.disconnect();
            pb.feedback.disconnect();
            pb.delayNode.disconnect();
        }
    } catch {
        // Already disconnected (or the context closed mid-fade): done.
    }
}

// --- Public API --------------------------------------------------------------

// Must be called from a user-gesture path (Start button). Idempotent; safe
// everywhere else too (no-op where WebAudio is missing).
export function init() {
    if (!muteLoaded) loadMutedPreference();
    ensureContext();
}

export function setMuted(value) {
    muted = !!value;
    muteLoaded = true;
    storageSet(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
    if (ctx) {
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(muted ? 0 : 1, t + 0.08);
        if (!muted) startScheduler();
    }
}

// Returns the new muted state so callers (HUD label, tests) stay in sync.
export function toggleMute() {
    setMuted(!muted);
    return muted;
}

export function isMuted() {
    return muted;
}

// Fire a registered voice. `param` is the optional per-event modifier the
// parameterised voices read (land depth, stomp chain step, coin pickup
// streak); plain voices ignore it. The muted check runs BEFORE anything
// else: muting at trigger time must start zero nodes, not silent ones
// (pinned by spy count).
export function playSfx(name, param) {
    if (muted) return;
    if (!ensureContext()) return;
    const fn = SFX[name];
    if (!fn) {
        console.warn('Unknown sound effect requested:', name);
        return;
    }
    fn(param);
}

// Start (or keep) the generative loop for a level. Identical preset+bpm+seed
// +variant = no restart, so retries flow seamlessly; any change — including
// the per-level variation from musicVariantFor and the per-WORLD identity
// riding on its tag — crossfades over ~0.8 s. World-boundary transitions are
// therefore smooth by construction: publishLevel lands inside the 2-second
// LEVEL_COMPLETE beat, both loops overlap during the fade, and nothing ever
// cuts mid-step. Called from publishLevel, i.e. inside the gesture-initiated
// run, never from page load (the menu stays silent by design).
export function startMusic(themeIndex, levelNumber) {
    if (!ensureContext()) return;
    const variant = musicVariantFor(levelNumber);
    // The caller's band wins when it is a real THEMES index; an invalid one
    // falls back to the level-derived band rather than corrupting playback.
    const index = Number.isInteger(themeIndex) &&
        themeIndex >= 0 && themeIndex < MUSIC_PRESETS.length ? themeIndex : variant.index;
    const key = `${index}:${variant.bpm}:${variant.seed}:${variant.signature}`;
    if (playback && playback.key === key) return;
    const old = playback;
    playback = createPlayback(index, variant, levelNumber);
    if (old) {
        const t = ctx.currentTime;
        old.gain.gain.cancelScheduledValues(t);
        old.gain.gain.setValueAtTime(old.gain.gain.value, t);
        old.gain.gain.linearRampToValueAtTime(0.0001, t + CROSSFADE_SEC);
        retirePlayback(old);
    }
    startScheduler();
}

export function stopMusic() {
    if (!ctx || !playback) return;
    stopScheduler();
    const old = playback;
    playback = null;
    const t = ctx.currentTime;
    old.gain.gain.cancelScheduledValues(t);
    old.gain.gain.setValueAtTime(old.gain.gain.value, t);
    old.gain.gain.linearRampToValueAtTime(0.0001, t + 0.25);
    later(400, () => disconnectPlayback(old));
}

// Pause ducking: silences the music layer with a short ramp (SFX stay live
// so UI clicks still confirm) and halts the scheduler meanwhile.
export function duckMusic(on) {
    ducked = !!on;
    if (ctx) {
        const t = ctx.currentTime;
        musicBus.gain.cancelScheduledValues(t);
        musicBus.gain.setValueAtTime(musicBus.gain.value, t);
        musicBus.gain.linearRampToValueAtTime(ducked || muted ? 0 : MUSIC_LEVEL, t + 0.15);
        if (!ducked) startScheduler();
    }
}

// W5 intensity layer arm/disarm (idempotent — safe to call from an edge-
// detecting Game each frame it changes). Arming shortens the effective step
// cursor (~+7% tempo) and switches on the percussive bed inside
// playMusicStep; disarming restores the base groove. The flag is INDEPENDENT
// of mute/duck: while either holds, the scheduler itself is stopped, so the
// layer can never sound against the mute source of truth, and re-basing on
// resume means pause never lets music run out of sync behind the overlay.
// Ruling: pausing does NOT disarm — the run clock freezes too, so urgency
// legitimately continues where it left off.
export function setUrgent(on) {
    const next = !!on;
    if (next === urgent) return;
    urgent = next;
    if (playback) {
        playback.stepDur = playback.stepDurBase * (urgent ? URGENT_STEP_MUL : 1);
    }
}

// True once the AudioContext singleton exists. UI blip callers gate on this
// so menu navigation before the first run stays silent instead of dragging
// a suspended context into existence outside a gesture.
export function hasContext() {
    return !!ctx;
}

// Full teardown: timers out, context closed, module state reset so a later
// init() rebuilds cleanly (test harnesses construct/destroy many Games).
export function shutdown() {
    stopScheduler();
    for (const id of cleanupTimers) clearTimeout(id);
    cleanupTimers.clear();
    playback = null;
    urgent = false;
    if (ctx) {
        const dying = ctx;
        ctx = null;
        master = null;
        limiter = null;
        softClip = null;
        sfxBus = null;
        musicBus = null;
        noiseBuffer = null;
        dying.close().catch(() => {});
    }
}

// Read-only debug/e2e view of the singleton.
export function getState() {
    return {
        supported: audioConstructor() !== null,
        hasContext: !!ctx,
        contextState: ctx ? ctx.state : null,
        muted,
        ducked,
        urgent,
        musicKey: playback ? playback.key : null
    };
}
