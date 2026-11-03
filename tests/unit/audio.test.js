// Unit tests for js/audio.js pure-logic seams and no-WebAudio inertness.
// bun/happy-dom provide no AudioContext, which is exactly the environment
// the module must survive silently — these tests pin that contract plus the
// deterministic music maths (preset mapping, seeded melody, scheduler step
// arithmetic against a fake clock) and the storage-throws mute fallback.
import { test, expect, describe } from "bun:test";
import * as audio from "../../js/audio.js";

describe("audio preset mapping", () => {
    test("bands cycle with the THEMES pattern ((level-1) % 3)", () => {
        expect(audio.presetForLevel(1).index).toBe(0);
        expect(audio.presetForLevel(2).index).toBe(1);
        expect(audio.presetForLevel(3).index).toBe(2);
        expect(audio.presetForLevel(4).index).toBe(0);
        expect(audio.presetForLevel(100).index).toBe(0);
    });

    test("base tempos sit in the calm band per preset", () => {
        expect(audio.presetForLevel(1).bpm).toBe(72); // day
        expect(audio.presetForLevel(2).bpm).toBe(66); // dusk
        expect(audio.presetForLevel(3).bpm).toBe(78); // jungle
    });

    test("expert tier and above creep +6 BPM (levels >= 25)", () => {
        expect(audio.presetForLevel(24).bpm).toBe(78); // advanced: no creep
        expect(audio.presetForLevel(25).bpm).toBe(72 + 6);
        expect(audio.presetForLevel(26).bpm).toBe(66 + 6);
        expect(audio.presetForLevel(50).bpm).toBe(66 + 6); // master, dusk band
        expect(audio.presetForLevel(75).bpm).toBe(78 + 6); // legend, jungle
    });

    test("seed is deterministic per level and differs across levels", () => {
        expect(audio.presetForLevel(7).seed).toBe(audio.presetForLevel(7).seed);
        expect(audio.presetForLevel(7).seed).not.toBe(audio.presetForLevel(8).seed);
    });

    test("invalid level numbers warn and fall back to the level-1 preset", () => {
        for (const bad of [0, -3, 2.5, NaN, null, undefined, "5"]) {
            const p = audio.presetForLevel(bad);
            expect(p.index).toBe(0);
            expect(p.bpm).toBe(72);
        }
    });
});

describe("audio melody generation", () => {
    test("the same seed yields an identical loop (deterministic repeat)", () => {
        const a = audio.buildMelodyLoop(0, 7);
        const b = audio.buildMelodyLoop(0, 7);
        expect(a).toEqual(b);
    });

    test("different levels yield different variations", () => {
        expect(audio.buildMelodyLoop(0, 7)).not.toEqual(audio.buildMelodyLoop(0, 8));
    });

    test("loops are one phrase long and never silent", () => {
        for (let level = 1; level <= 12; level++) {
            for (let band = 0; band < 3; band++) {
                const loop = audio.buildMelodyLoop(band, level);
                expect(loop.length).toBe(32); // 4 bars of eighth notes
                expect(loop.some(Boolean)).toBe(true);
            }
        }
    });
});

describe("audio scheduler step math (fake clock)", () => {
    test("emits every step inside the lookahead window and advances the cursor", () => {
        const state = { step: 0, nextStepTime: 0 };
        const emitted = [];
        const count = audio.advanceScheduler(
            state, 0, 1.0, 0.5, (step, when) => emitted.push([step, when]));
        // Strict upper bound: 0 and 0.5 are inside [0, 1.0), 1.0 is not.
        expect(emitted).toEqual([[0, 0], [1, 0.5]]);
        expect(count).toBe(2);
        expect(state.step).toBe(2);
        expect(state.nextStepTime).toBe(1.0);
    });

    test("a far-behind cursor is rebased, never burst-caught-up", () => {
        const state = { step: 5, nextStepTime: -30 };
        const emitted = [];
        audio.advanceScheduler(state, 0, 0.1, 0.5,
            (step, when) => emitted.push([step, when]));
        expect(emitted).toEqual([[5, 0]]); // resumes at now, not at -30
        expect(state.nextStepTime).toBe(0.5);
    });

    test("non-positive step duration emits nothing instead of looping forever", () => {
        const state = { step: 0, nextStepTime: 0 };
        expect(audio.advanceScheduler(state, 0, 1, 0, () => {})).toBe(0);
        expect(audio.advanceScheduler(state, 0, 1, -1, () => {})).toBe(0);
    });

    test("the step counter wraps at the loop length", () => {
        const state = { step: 31, nextStepTime: 0 };
        audio.advanceScheduler(state, 0, 1.0, 0.5, () => {});
        expect(state.step).toBe(1); // 31 -> 0 -> 1
    });
});

describe("audio mute persistence", () => {
    const realStorage = globalThis.localStorage;

    test("storage read failure defaults to unmuted without throwing", () => {
        globalThis.localStorage = {
            getItem() { throw new Error("SecurityError"); },
            setItem() { throw new Error("SecurityError"); }
        };
        try {
            expect(() => audio.loadMutedPreference()).not.toThrow();
            expect(audio.loadMutedPreference()).toBe(false);
            expect(() => audio.setMuted(true)).not.toThrow();
            expect(audio.isMuted()).toBe(true);
            expect(() => audio.toggleMute()).not.toThrow();
            expect(audio.isMuted()).toBe(false);
        } finally {
            globalThis.localStorage = realStorage;
        }
    });

    test("preference round-trips through working storage", () => {
        audio.setMuted(true);
        expect(localStorage.getItem("platformerMuted")).toBe("true");
        expect(audio.loadMutedPreference()).toBe(true);
        audio.setMuted(false);
        expect(audio.loadMutedPreference()).toBe(false);
    });
});

describe("audio inertness without WebAudio", () => {
    test("harness genuinely lacks AudioContext (the inertness precondition)", () => {
        expect(typeof AudioContext).toBe("undefined");
        expect(globalThis.webkitAudioContext).toBeUndefined();
    });

    test("every exported function is a silent no-op with no AudioContext", () => {
        expect(() => {
            audio.init();
            audio.playSfx("jump");
            audio.playSfx("land");
            audio.playSfx("coin");
            audio.playSfx("stomp");
            audio.playSfx("death");
            audio.playSfx("portal_unlock");
            audio.playSfx("level_complete");
            audio.startMusic(0, 1);
            audio.startMusic(1, 2);
            audio.duckMusic(true);
            audio.duckMusic(false);
            audio.stopMusic();
            audio.setMuted(true);
            audio.toggleMute();
            audio.shutdown();
        }).not.toThrow();
        audio.setMuted(false); // leave the singleton neutral for later files
    });

    test("unknown sfx names do not throw", () => {
        expect(() => audio.playSfx("no-such-sound")).not.toThrow();
    });

    test("getState reports an unsupported, context-free singleton", () => {
        const state = audio.getState();
        expect(state.supported).toBe(false);
        expect(state.hasContext).toBe(false);
        expect(state.contextState).toBeNull();
        expect(state.musicKey).toBeNull();
    });
});
