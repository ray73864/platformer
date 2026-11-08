// Wave B juice layer: the FX config contract Wave C settings will wire, the
// reduced-motion boot profile, and the pooled-effect caps. Pure logic — no
// canvas, no Game; every helper here is deterministic by construction.
import { test, expect, afterAll } from "bun:test";
import {
    FX, initFX, applyReducedMotion, _resetFXInitForTests,
    shakeOffset, punchScale, PUNCH_TIME,
    spawnPopup, stepPopups, MAX_POPUPS, POPUP_LIFE,
    spawnRing, stepRings, MAX_RINGS, RING_LIFE
} from "../../js/fx.js";

afterAll(() => {
    // Never leak a mutated singleton into later files.
    applyReducedMotion(false);
    _resetFXInitForTests();
});

test("FX ships full-strength defaults", () => {
    _resetFXInitForTests();
    expect(FX.shake).toBe(true);
    expect(FX.punch).toBe(true);
    expect(FX.pulse).toBe(true);
    expect(FX.squash).toBe(true);
    expect(FX.dust).toBe(true);
    expect(FX.popups).toBe(true);
    expect(FX.trails).toBe(true);
    expect(FX.lookahead).toBe(true);
    expect(FX.intensity).toBe(1);
});

test("reduced-motion boot disables shake/punch/pulse/lookahead, keeps gentle fx soft", () => {
    _resetFXInitForTests();
    const win = { matchMedia: (q) => ({ matches: q.includes('reduce'), addEventListener() {} }) };
    expect(initFX(win)).toBe(true);
    expect(FX.shake).toBe(false);
    expect(FX.punch).toBe(false);
    expect(FX.pulse).toBe(false);
    expect(FX.lookahead).toBe(false);
    // Gentle families stay ON at half amplitude (particles/squash ruling).
    expect(FX.squash).toBe(true);
    expect(FX.dust).toBe(true);
    expect(FX.popups).toBe(true);
    expect(FX.trails).toBe(true);
    expect(FX.intensity).toBe(0.5);
});

test("initFX is once-only: a later boot cannot overwrite user toggles", () => {
    _resetFXInitForTests();
    initFX({ matchMedia: () => ({ matches: true }) });
    expect(FX.shake).toBe(false);
    // A second Game construction (no-preference media) must NOT re-enable.
    initFX({ matchMedia: () => ({ matches: false }) });
    expect(FX.shake).toBe(false);
    // Explicit restore path still works for Wave C settings wiring.
    applyReducedMotion(false);
    expect(FX.shake).toBe(true);
    expect(FX.intensity).toBe(1);
});

test("initFX tolerates a missing/hostile matchMedia", () => {
    _resetFXInitForTests();
    expect(initFX(null)).toBe(false);
    expect(FX.shake).toBe(true);
    _resetFXInitForTests();
    expect(initFX({ matchMedia: () => { throw new Error('nope'); } })).toBe(false);
    expect(FX.shake).toBe(true);
});

test("shakeOffset: gated, bounded by magnitude, decaying, zero at rest", () => {
    _resetFXInitForTests();
    expect(shakeOffset(0, 9, 0.35)).toEqual({ x: 0, y: 0 });
    let maxSeen = 0;
    for (let t = 0.35; t > 0; t -= 0.005) {
        const s = shakeOffset(t, 9, 0.35);
        expect(Math.abs(s.x)).toBeLessThanOrEqual(9 + 1e-9);
        expect(Math.abs(s.y)).toBeLessThanOrEqual(9 + 1e-9);
        maxSeen = Math.max(maxSeen, Math.abs(s.x));
    }
    expect(maxSeen).toBeGreaterThan(1); // it actually moves when enabled
    // Envelope: late-window amplitude strictly smaller than early-window.
    let lateMax = 0;
    for (let t = 0.05; t > 0; t -= 0.002) {
        lateMax = Math.max(lateMax, Math.abs(shakeOffset(t, 9, 0.35).x));
    }
    expect(lateMax).toBeLessThan(maxSeen);
    // Deterministic: same inputs -> same offset (frame captures replay).
    expect(shakeOffset(0.2, 9, 0.35)).toEqual(shakeOffset(0.2, 9, 0.35));
    // Disabled: dead zero even mid-shake.
    FX.shake = false;
    expect(shakeOffset(0.2, 9, 0.35)).toEqual({ x: 0, y: 0 });
    FX.shake = true;
});

test("punchScale: 1 -> peak -> 1, gated by FX.punch", () => {
    _resetFXInitForTests();
    expect(punchScale(0)).toBe(1);
    expect(punchScale(PUNCH_TIME)).toBe(1);
    expect(punchScale(-0.01)).toBe(1);
    expect(punchScale(PUNCH_TIME * 0.5)).toBeCloseTo(1.03, 6);
    const mid = punchScale(PUNCH_TIME * 0.5);
    expect(mid).toBeGreaterThan(1);
    FX.punch = false;
    expect(punchScale(PUNCH_TIME * 0.5)).toBe(1);
    FX.punch = true;
    // Intensity scales the excursion without breaking the endpoints.
    FX.intensity = 0.5;
    expect(punchScale(PUNCH_TIME * 0.5)).toBeCloseTo(1.015, 6);
    FX.intensity = 1;
});

test("popup pool is hard-capped at MAX_POPUPS (oldest evicted)", () => {
    _resetFXInitForTests();
    const list = [];
    for (let i = 0; i < MAX_POPUPS + 8; i++) {
        spawnPopup(list, 50 + i * 40, 200, `+${i}`, '#ffd23f');
    }
    expect(list.length).toBe(MAX_POPUPS);
    // Oldest-first eviction: the freshest entry survived.
    expect(list[list.length - 1].text).toBe(`+${MAX_POPUPS + 7}`);
    expect(list.some(p => p.text === '+0')).toBe(false);
});

test("popups dedupe same text at same spot within one instant", () => {
    _resetFXInitForTests();
    const list = [];
    spawnPopup(list, 100, 100, '+10', '#ffd23f');
    spawnPopup(list, 102, 101, '+10', '#ffd23f'); // same-frame twin -> dropped
    expect(list.length).toBe(1);
    // Different text or far-apart spot still spawns alongside.
    spawnPopup(list, 100, 100, '+25 STOMP!', '#c96bf5');
    spawnPopup(list, 400, 100, '+10', '#ffd23f');
    expect(list.length).toBe(3);
});

test("popups expire after their rise-and-fade life", () => {
    _resetFXInitForTests();
    const list = [];
    spawnPopup(list, 10, 10, '+10', '#ffd23f');
    stepPopups(list, POPUP_LIFE - 0.05);
    expect(list.length).toBe(1);
    stepPopups(list, 0.1);
    expect(list.length).toBe(0);
});

test("ring pool is capped and expires", () => {
    _resetFXInitForTests();
    const list = [];
    for (let i = 0; i < MAX_RINGS + 3; i++) {
        spawnRing(list, i * 10, 0, '#b06cf0');
    }
    expect(list.length).toBe(MAX_RINGS);
    stepRings(list, RING_LIFE + 0.01);
    expect(list.length).toBe(0);
});
