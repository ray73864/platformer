/**
 * Persisted user settings (Wave C).
 *
 * Three surfaces, two storage layers:
 *   Sound         — delegated to js/audio.js, which already persists mute at
 *                   its own established key ('platformerMuted'). This module
 *                   never double-writes it; the settings screen toggles audio
 *                   through audio.setMuted()/isMuted() directly.
 *   Screen shake  — 'platformer.screen-shake'   ('true' | 'false')
 *   Reduced motion— 'platformer.reduced-motion' ('on' | 'off', absent = follow OS)
 *
 * Precedence for reduced motion (documented per the Wave C brief):
 *   explicit user setting > OS prefers-reduced-motion.
 *     'on'  forces the reduced profile even when the OS asks for nothing;
 *     'off' forces full effects even against an OS reduce preference
 *           (the "both directions" override);
 *     unset falls back to the OS media query — the fx.js initFX default.
 * Screen shake composes UNDER reduced motion: FX.shake is only ever true
 * when the user kept it on AND no reduced profile is in force (fx.js owns
 * the large-motion family; a settings toggle must not resurrect what the
 * reduced profile disables).
 *
 * Storage is best-effort (file:// origins and privacy modes throw): a
 * failing store degrades to defaults, never to a broken game.
 */

import { FX, applyReducedMotion } from './fx.js';

export const SETTINGS_KEYS = {
    shake: 'platformer.screen-shake',
    reducedMotion: 'platformer.reduced-motion'
};

function storageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Persistence is a nicety; play must continue without it.
    }
}

// Read the persisted snapshot. Absent/corrupt values fall back to defaults
// (shake on, reduced motion following the OS).
export function loadSettings() {
    return {
        shake: storageGet(SETTINGS_KEYS.shake) !== 'false',
        reducedMotion: storageGet(SETTINGS_KEYS.reducedMotion) === 'on' ||
            storageGet(SETTINGS_KEYS.reducedMotion) === 'off'
            ? storageGet(SETTINGS_KEYS.reducedMotion)
            : null
    };
}

export function saveShake(on) {
    storageSet(SETTINGS_KEYS.shake, on ? 'true' : 'false');
}

// mode: 'on' | 'off' | null (null = stop overriding, follow the OS again).
export function saveReducedMotion(mode) {
    if (mode === null) {
        try {
            localStorage.removeItem(SETTINGS_KEYS.reducedMotion);
        } catch {
            // best-effort, same policy as storageSet
        }
    } else {
        storageSet(SETTINGS_KEYS.reducedMotion, mode);
    }
}

// Current OS preference, tolerant of absent/hostile matchMedia (mirrors the
// fx.js initFX guard).
export function osReducedMotion(win =
    typeof window !== 'undefined' ? window : null) {
    try {
        return !!(win && win.matchMedia &&
            win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
}

// Pure precedence resolution — unit-testable truth table.
export function resolveReducedMotion(userMode, osPref) {
    if (userMode === 'on') return true;
    if (userMode === 'off') return false;
    return !!osPref;
}

// Push the resolved settings into the live FX singleton. Safe to call on
// every boot and after every toggle: applyReducedMotion restores exact
// defaults before the shake composition narrows them again. When NOTHING is
// stored (fresh install), FX is left exactly where the boot profile (fx.js
// initFX reading the media query) put it — the settings layer only ever
// overrides an explicit user voice, never re-derives the default.
export function applySettings(settings, win = undefined) {
    const hasUserVoice = settings.reducedMotion !== null ||
        storageGet(SETTINGS_KEYS.shake) !== null;
    if (!hasUserVoice) {
        return resolveReducedMotion(null, osReducedMotion(win));
    }
    const reduced = resolveReducedMotion(settings.reducedMotion,
        osReducedMotion(win));
    applyReducedMotion(reduced);
    FX.shake = !!settings.shake && !reduced;
    return reduced;
}
