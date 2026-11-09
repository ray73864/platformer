// Wave C settings pins: localStorage round-trip (seam), reduced-motion
// override precedence (explicit user setting > OS media query, both
// directions), and the shake composition under the reduced profile.
import { test, expect, beforeEach, afterAll } from "bun:test";
import {
    SETTINGS_KEYS, loadSettings, saveShake, saveReducedMotion,
    resolveReducedMotion, applySettings, osReducedMotion
} from "../../js/settings.js";
import { FX, applyReducedMotion, _resetFXInitForTests } from "../../js/fx.js";
import { MUTE_STORAGE_KEY } from "../../js/audio.js";

// Namespace convention (review fix round 1, MINOR-1): every persisted
// setting lives under its documented literal key. The rest of the suite
// references SETTINGS_KEYS symbolically, so without THIS literal pin a
// rename would ride through green. Assert exact strings.
test("persisted storage keys are pinned literals", () => {
    expect(SETTINGS_KEYS.shake).toBe('platformer.screen-shake');
    expect(SETTINGS_KEYS.reducedMotion).toBe('platformer.reduced-motion');
    expect(MUTE_STORAGE_KEY).toBe('platformerMuted');
});

// The shared happy-dom Window outlives this file: never leak persisted keys
// or a mutated FX singleton into later suites (fx_state boots Games too).
function clearStored() {
    localStorage.removeItem(SETTINGS_KEYS.shake);
    localStorage.removeItem(SETTINGS_KEYS.reducedMotion);
}
beforeEach(clearStored);
afterAll(() => {
    clearStored();
    applyReducedMotion(false);
    _resetFXInitForTests();
});

const winOs = (reduce) => ({
    matchMedia: () => ({ matches: reduce })
});

test("persistence round-trip: saved values reload exactly", () => {
    saveShake(false);
    saveReducedMotion('on');
    const s = loadSettings();
    expect(s.shake).toBe(false);
    expect(s.reducedMotion).toBe('on');

    saveShake(true);
    saveReducedMotion('off');
    const t = loadSettings();
    expect(t.shake).toBe(true);
    expect(t.reducedMotion).toBe('off');

    // null mode clears the key: back to "follow the OS".
    saveReducedMotion(null);
    expect(loadSettings().reducedMotion).toBeNull();
});

test("absent/corrupt storage defaults: shake on, reduced motion follows OS", () => {
    localStorage.setItem(SETTINGS_KEYS.shake, 'nonsense');
    localStorage.setItem(SETTINGS_KEYS.reducedMotion, 'maybe');
    const s = loadSettings();
    expect(s.shake).toBe(true);          // only literal 'false' disables
    expect(s.reducedMotion).toBeNull();  // only 'on'/'off' are choices
});

test("resolveReducedMotion precedence: explicit choice beats the OS", () => {
    // 'on' forces reduced even without an OS preference.
    expect(resolveReducedMotion('on', false)).toBe(true);
    // 'off' forces full effects even against an OS reduce preference
    // (the documented both-directions override).
    expect(resolveReducedMotion('off', true)).toBe(false);
    // Unset falls back to the OS media query.
    expect(resolveReducedMotion(null, true)).toBe(true);
    expect(resolveReducedMotion(null, false)).toBe(false);
});

test("applySettings: 'on' reduces FX without any OS preference", () => {
    applySettings({ shake: true, reducedMotion: 'on' }, winOs(false));
    expect(FX.shake).toBe(false);
    expect(FX.punch).toBe(false);
    expect(FX.intensity).toBe(0.5);
});

test("applySettings: 'off' keeps full FX against an OS reduce preference", () => {
    applySettings({ shake: true, reducedMotion: 'off' }, winOs(true));
    expect(FX.shake).toBe(true);
    expect(FX.punch).toBe(true);
    expect(FX.intensity).toBe(1);
});

test("applySettings: shake-off composes under either profile", () => {
    applySettings({ shake: false, reducedMotion: 'off' }, winOs(false));
    expect(FX.shake).toBe(false);
    expect(FX.punch).toBe(true); // only the shake family narrows
    applySettings({ shake: false, reducedMotion: 'on' }, winOs(false));
    expect(FX.shake).toBe(false);
});

test("applySettings is inert with no stored voice (boot profile owns FX)", () => {
    // Mirrors the fx_state priming pattern: whatever initFX left standing
    // must survive a construction with zero user settings.
    applyReducedMotion(true);
    applySettings({ shake: true, reducedMotion: null }, winOs(false));
    expect(FX.shake).toBe(false);
    expect(FX.intensity).toBe(0.5);
});

test("osReducedMotion tolerates missing/hostile matchMedia", () => {
    expect(osReducedMotion(null)).toBe(false);
    expect(osReducedMotion({
        matchMedia: () => { throw new Error('nope'); }
    })).toBe(false);
});
