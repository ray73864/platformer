// Procedural audio: synthesized SFX + generative ambient music, zero audio
// files, zero dependencies. Everything is built from oscillators and gain
// envelopes on a single lazily-created AudioContext.
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
// presetForLevel, buildMelodyLoop, advanceScheduler, loadMutedPreference,
// getState.

const MUSIC_LEVEL = 0.35;
const SFX_LEVEL = 0.6;
const MUTE_STORAGE_KEY = 'platformerMuted';
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

// Eighth-note grid; one melodic loop spans four bars.
const STEPS_PER_BAR = 8;
const LOOP_STEPS = STEPS_PER_BAR * 4;
// Pad chord rotation per bar within the phrase, expressed as SCALE DEGREES
// (not semitones): every chord tone is drawn from the preset scale, so any
// rotation stays consonant with the melody regardless of mode.
const CHORD_DEGREES = [0, 2, 4, 2];

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

// Map a level number onto its music preset: band from the THEMES cycle,
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
    const index = (levelNumber - 1) % MUSIC_PRESETS.length;
    const preset = MUSIC_PRESETS[index];
    const bpm = preset.bpm + (levelNumber >= TIER_CREEP_FIRST_LEVEL ? TIER_CREEP_BPM : 0);
    return { index, preset, bpm, seed: musicSeedForLevel(levelNumber) };
}

// Build one LOOP_STEPS-step melody for a level: probabilistic placement
// from the preset scale, seeded so the same (presetIndex, levelNumber)
// always yields the identical sequence (the loop repeats verbatim).
// Entries are null (rest) or { deg, oct, len } in scale degrees.
export function buildMelodyLoop(presetIndex, levelNumber) {
    const preset = MUSIC_PRESETS[((presetIndex % MUSIC_PRESETS.length) + MUSIC_PRESETS.length) % MUSIC_PRESETS.length];
    const rng = makeRng(musicSeedForLevel(levelNumber));
    const loop = new Array(LOOP_STEPS).fill(null);
    let degree = Math.floor(rng() * preset.scale.length);
    let i = 0;
    while (i < LOOP_STEPS) {
        // Sparse by design: roughly one note in three steps, held 1-3 steps.
        if (rng() < 0.34) {
            degree = Math.max(-2, Math.min(preset.scale.length + 3,
                degree + Math.floor(rng() * 5) - 2));
            const oct = rng() < 0.25 ? 1 : 0;
            const len = Math.min(1 + Math.floor(rng() * 3), LOOP_STEPS - i);
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
let master = null;   // master volume (mute rides this) -> destination
let sfxBus = null;   // all one-shots
let musicBus = null; // music layer (duck rides this) <- playback gains
let playback = null; // { key, gain, preset, stepDur, melody, delaySend, state:{step,nextStepTime} }
let schedulerId = null;
let cleanupTimers = new Set();
let noiseBuffer = null;
let muted = false;
let muteLoaded = false;
let ducked = false;

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
        master.connect(ctx.destination);
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

function noiseBurst({ dur, peak, bandHz, when }) {
    const t = when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = cachedNoiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = bandHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
}

// One-shot SFX set. Punchy retro blips, each under 0.4 s except the win
// sting. Names are the public contract with main.js.
const SFX = {
    // Quick rising square blip.
    jump() {
        tone({ wave: 'square', freq: 220, endFreq: 600, dur: 0.12, peak: 0.28 });
    },
    // Soft low thud, filtered: touchdown weight without a click.
    land() {
        tone({ wave: 'triangle', freq: 150, endFreq: 65, dur: 0.15, peak: 0.32, filterHz: 400 });
    },
    // Classic two-tone sine ping (B5 -> E6).
    coin() {
        const t = ctx.currentTime;
        tone({ wave: 'sine', freq: 987.77, dur: 0.07, peak: 0.26, when: t });
        tone({ wave: 'sine', freq: 1318.51, dur: 0.16, peak: 0.26, when: t + 0.07 });
    },
    // Downward squish for stomps: falling triangle through a closing filter.
    stomp() {
        tone({ wave: 'triangle', freq: 300, endFreq: 60, dur: 0.18, peak: 0.4, filterHz: 900 });
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

// Render one grid step of the generative loop: soft bass pulse on bar
// starts, a four-bar pad chord rotation, and the seeded sparse melody line.
function playMusicStep(pb, step, when) {
    const preset = pb.preset;
    if (step % LOOP_STEPS === 0) {
        // Pad: three scale-degree voices, each a detuned triangle pair
        // through a lowpass, lasting the full phrase plus release tail.
        const chordRoot = CHORD_DEGREES[0];
        const dur = pb.stepDur * LOOP_STEPS + 2;
        for (const offset of [0, 2, 4]) {
            const freq = scaleNoteHz(preset, chordRoot + offset, 0);
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
    if (step % STEPS_PER_BAR === 0) {
        const bar = (step / STEPS_PER_BAR) % CHORD_DEGREES.length;
        tone({
            wave: 'sine',
            freq: scaleNoteHz(preset, CHORD_DEGREES[bar], -1),
            dur: pb.stepDur * 3.2,
            peak: 0.16,
            attack: 0.02,
            dest: pb.gain,
            when
        });
    }
    const note = pb.melody[step];
    if (note) {
        const dur = Math.min(note.len * pb.stepDur * 0.9, 1.6);
        tone({
            wave: preset.melodyWave,
            freq: scaleNoteHz(preset, note.deg, note.oct + 1),
            dur,
            peak: 0.12,
            attack: 0.03,
            dest: pb.gain,
            when
        });
        if (pb.delaySend) {
            tone({
                wave: preset.melodyWave,
                freq: scaleNoteHz(preset, note.deg, note.oct + 1),
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

function createPlayback(index, bpm, seed) {
    const preset = MUSIC_PRESETS[index];
    const stepDur = 60 / bpm / 2; // eighth notes
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
        delayNode.delayTime.value = stepDur * 3;
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
        key: `${index}:${bpm}:${seed}`,
        gain,
        preset,
        stepDur,
        melody: buildMelodyLoop(index, seed),
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

export function playSfx(name) {
    if (muted) return;
    if (!ensureContext()) return;
    const fn = SFX[name];
    if (!fn) {
        console.warn('Unknown sound effect requested:', name);
        return;
    }
    fn();
}

// Start (or keep) the generative loop for a level. Identical preset+bpm+seed
// = no restart, so replays and retries flow seamlessly; a change crossfades
// over ~0.8 s. Called from publishLevel, i.e. inside the gesture-initiated
// run, never from page load (the menu stays silent by design).
export function startMusic(themeIndex, levelNumber) {
    if (!ensureContext()) return;
    const { index: derivedIndex, bpm, seed } = presetForLevel(levelNumber);
    // The caller's band wins when it is a real THEMES index; an invalid one
    // falls back to the level-derived band rather than corrupting playback.
    const index = Number.isInteger(themeIndex) &&
        themeIndex >= 0 && themeIndex < MUSIC_PRESETS.length ? themeIndex : derivedIndex;
    const key = `${index}:${bpm}:${seed}`;
    if (playback && playback.key === key) return;
    const old = playback;
    playback = createPlayback(index, bpm, seed);
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

// Full teardown: timers out, context closed, module state reset so a later
// init() rebuilds cleanly (test harnesses construct/destroy many Games).
export function shutdown() {
    stopScheduler();
    for (const id of cleanupTimers) clearTimeout(id);
    cleanupTimers.clear();
    playback = null;
    if (ctx) {
        const dying = ctx;
        ctx = null;
        master = null;
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
        musicKey: playback ? playback.key : null
    };
}
