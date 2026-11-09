// Wave D SFX pins: the event→voice registry contract (delete a mapping or
// a voice and this file goes red) plus trigger-time behaviour under a
// counting FAKE AudioContext — muted at trigger time must start ZERO nodes
// (oscillators AND buffer sources), and the parameterised voices (land
// depth, stomp chain step) must actually move the synthesis parameters.
import { test, expect, describe, afterAll } from "bun:test";
import * as audio from "../../js/audio.js";

// --- counting fake ----------------------------------------------------------
let oscStarts = 0;
let srcStarts = 0;
const oscLog = []; // frequency.value at osc.start() (ramps never mutate .value)

class Param {
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v) { this.value = v; return this; }
    // Faithful-enough: scheduling a ramp never changes the synchronous
    // .value reading, so oscLog captures the START frequency.
    linearRampToValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; }
    cancelScheduledValues() { return this; }
}
class Node {
    connect() {}
    disconnect() {}
}
class GainNode extends Node { constructor() { super(); this.gain = new Param(1); } }
class OscNode extends Node {
    constructor() {
        super();
        this.frequency = new Param(440);
        this.detune = new Param(0);
        this.type = "sine";
    }
    start() { oscStarts++; oscLog.push(this.frequency.value); }
    stop() {}
}
class BiquadNode extends Node {
    constructor() { super(); this.frequency = new Param(350); this.type = "lowpass"; }
}
class BufSrcNode extends Node {
    constructor() { super(); this.buffer = null; }
    start() { srcStarts++; }
    stop() {}
}
class SpyCtx {
    constructor() {
        this.currentTime = 0;
        this.sampleRate = 48000;
        this.state = "running";
        this.destination = new Node();
    }
    createGain() { return new GainNode(); }
    createOscillator() { return new OscNode(); }
    createBiquadFilter() { return new BiquadNode(); }
    createBufferSource() { return new BufSrcNode(); }
    createBuffer(ch, len) {
        const data = new Float32Array(len);
        return { getChannelData: () => data };
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
}
const realAudioContext = globalThis.AudioContext;
globalThis.AudioContext = SpyCtx;

const startedCount = () => oscStarts + srcStarts;

afterAll(() => {
    // Leave the shared module singleton and the shared global exactly as
    // found: later files (audio_lifecycle especially) build their own fakes.
    audio.shutdown();
    if (realAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = realAudioContext;
    try { localStorage.setItem("platformerMuted", "false"); } catch { /* best-effort */ }
});

describe("Wave D voice registry", () => {
    test("registry maps every event family to its pinned voice name", () => {
        expect({ ...audio.SFX_VOICES }).toEqual({
            JUMP: "jump",
            LAND: "land",
            COIN: "coin",
            COIN_SECRET: "coin_secret",
            STOMP: "stomp",
            BOMBARD_FIRE: "bombard_fire",
            DEATH: "death",
            PORTAL_UNLOCK: "portal_unlock",
            LEVEL_COMPLETE: "level_complete",
            DASH: "dash",
            WALL_SLIDE: "wall_slide",
            PAD_BOUNCE: "pad_bounce",
            CRATE_PUSH: "crate_push"
        });
    });

    test("registry and implementation cover each other exactly", () => {
        // Deleting a registry mapping OR an SFX voice breaks one direction.
        expect([...audio.listSfx()].sort())
            .toEqual(Object.values(audio.SFX_VOICES).sort());
    });

    test("registry is frozen against runtime edits", () => {
        expect(Object.isFrozen(audio.SFX_VOICES)).toBe(true);
    });
});

describe("Wave D voice triggering under a counting fake context", () => {
    test("every registered voice starts at least one node when unmuted", () => {
        audio.shutdown(); // fresh singleton regardless of earlier files
        audio.setMuted(false);
        audio.init();
        expect(audio.getState().hasContext).toBe(true);
        for (const name of audio.listSfx()) {
            const before = startedCount();
            audio.playSfx(name, 1);
            expect(startedCount(), `voice ${name} produced nothing`)
                .toBeGreaterThan(before);
        }
    });

    test("muted at trigger time starts zero nodes (spy count, all voices)", () => {
        audio.setMuted(true);
        const before = startedCount();
        for (const name of audio.listSfx()) audio.playSfx(name, 1);
        expect(startedCount()).toBe(before);
        audio.setMuted(false);
        // And unmuting makes them fire again (the guard is per-trigger, not
        // a dead voice table).
        const mid = startedCount();
        audio.playSfx(audio.SFX_VOICES.JUMP);
        expect(startedCount()).toBeGreaterThan(mid);
    });

    test("stomp chain step raises the pitch a minor third per step, capped", () => {
        oscLog.length = 0;
        audio.playSfx(audio.SFX_VOICES.STOMP, 0);
        const base = oscLog[0];
        oscLog.length = 0;
        audio.playSfx(audio.SFX_VOICES.STOMP, 2);
        expect(oscLog[0]).toBeCloseTo(base * Math.pow(2, 6 / 12), 1);
        oscLog.length = 0;
        audio.playSfx(audio.SFX_VOICES.STOMP, 99); // cap at 4 steps
        expect(oscLog[0]).toBeCloseTo(base * Math.pow(2, 12 / 12), 1);
    });

    test("land depth scales the thud; default matches the historical voice", () => {
        oscLog.length = 0;
        audio.playSfx(audio.SFX_VOICES.LAND); // no param → d=0.5
        expect(oscLog[0]).toBeCloseTo(150, 1);
        oscLog.length = 0;
        audio.playSfx(audio.SFX_VOICES.LAND, 0.25); // soft tap
        expect(oscLog[0]).toBeCloseTo(135, 1);
        oscLog.length = 0;
        audio.playSfx(audio.SFX_VOICES.LAND, 1); // slam
        expect(oscLog[0]).toBeCloseTo(180, 1);
    });
});
