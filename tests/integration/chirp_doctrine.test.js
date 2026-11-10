// W6 fix round (m-3): the exactly-one-chirp doctrine under the keyboard-only
// focus tick. Pinning surface here is what happy-dom CAN emulate:
//   - the suppression flag around deliberate focus dances (programmatic
//     focus inside a suppressed window must yield ZERO ticks),
//   - each transition's single owned blip (settings open/close, pause chip,
//     Escape, Resume),
//   - try/finally leak-proofing of the suppression flag.
// HONEST GAP: happy-dom has no input-modality heuristic — matches(
// ':focus-visible') returns true for ANY focused element there, while real
// Chrome answers false for pointer-driven focus. The pointer-silent half of
// the gate therefore cannot be unit-pinned in this harness; it is evidenced
// by the live agent-browser tour (W6 report: mouse round trip exactly one
// per transition, keyboard round trip exactly one per transition).
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";

function mountSettingsFixture() {
    mountFixture();
    document.getElementById('pause-screen').insertAdjacentHTML(
        'beforeend',
        '<button id="pause-settings-btn" aria-label="Open Settings">Settings</button>'
    );
    document.body.insertAdjacentHTML('beforeend', `
        <div id="menu-screen" class="overlay">
            <button id="menu-settings-btn" aria-label="Open Settings">Settings</button>
        </div>
        <div id="hud"><span id="hud-score">Score: 0</span></div>
        <div id="settings-screen" class="overlay hidden" role="dialog" aria-hidden="true" aria-label="Settings">
            <button id="sound-toggle-btn" role="switch" aria-checked="true">On</button>
            <button id="shake-toggle-btn" role="switch" aria-checked="true">On</button>
            <button id="motion-toggle-btn" role="switch" aria-checked="false">Off</button>
            <button id="settings-back-btn" aria-label="Back">Back</button>
        </div>
    `);
}

// Spy on the instance seam every chirp routes through (_uiBlip is looked up
// per call, so wrapping catches the focusin listener AND the transitions).
function spy(game) {
    const calls = [];
    const orig = game._uiBlip.bind(game);
    game._uiBlip = (...a) => { calls.push(String(a[0])); return orig(...a); };
    return calls;
}

test("suppression window mutes the cursor tick; outside it, button focus ticks once", () => {
    mountSettingsFixture();
    const game = new Game();
    const calls = spy(game);
    document.body.insertAdjacentHTML('beforeend', '<button id="tick-probe">t</button>');
    const probe = document.getElementById('tick-probe');

    game._suppressFocusTick = true;
    probe.focus();
    expect(calls.length).toBe(0); // suppressed dance: silent even though
                                  // happy-dom reports :focus-visible true
    game._suppressFocusTick = false;
    probe.blur();
    probe.focus();
    expect(calls).toEqual(['ui_move']); // unsuppressed landing: exactly one
    game.destroy();
});

test("settings open/close each sound EXACTLY ONE ui_move, including their focus dances", () => {
    mountSettingsFixture();
    const game = new Game();
    const calls = spy(game);
    game.openSettings('menu');
    expect(document.activeElement.id).toBe('sound-toggle-btn');
    expect(calls).toEqual(['ui_move']); // transition-owned; landing muted
    calls.length = 0;
    game.closeSettings();
    expect(calls).toEqual(['ui_move']); // restore-focus muted, one owned tick
    game.destroy();
});

test("pause chip click sounds exactly one ui_confirm (fix round M-1)", () => {
    mountSettingsFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    expect(game.state).toBe('PLAYING');
    const calls = spy(game);
    document.getElementById('pause-btn').click();
    expect(game.state).toBe('PAUSED');
    // Exactly the click-site confirm: the pause-menu focus landing is a
    // deliberate dance (suppressed), NOT a second cursor tick.
    expect(calls.filter(c => c === 'ui_move')).toEqual([]);
    expect(calls.filter(c => c === 'ui_confirm')).toEqual(['ui_confirm']);
    game.destroy();
});

test("Escape pause/resume owns exactly one ui_confirm; Resume button keeps its own", () => {
    mountSettingsFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    const calls = spy(game);
    window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Escape', key: 'Escape', bubbles: true
    }));
    expect(game.state).toBe('PAUSED');
    expect(calls).toEqual(['ui_confirm']);
    calls.length = 0;
    document.getElementById('resume-btn').click();
    expect(game.state).toBe('PLAYING');
    expect(calls).toEqual(['ui_confirm']); // resume button's own, no extras
    game.destroy();
});

test("a throw mid-dance cannot leave the tick gate stuck shut (m-1)", () => {
    mountSettingsFixture();
    const game = new Game();
    const calls = spy(game);
    const good = game.ui.focusSettingsMenu.bind(game.ui);
    game.ui.focusSettingsMenu = () => { throw new Error('boom'); };
    expect(() => game.openSettings('menu')).toThrow('boom');
    expect(game._suppressFocusTick).toBe(false); // finally released the gate
    game.ui.focusSettingsMenu = good;
    // Gate demonstrably REOPENED: a later button focus still ticks.
    document.body.insertAdjacentHTML('beforeend', '<button id="after-boom">a</button>');
    document.getElementById('after-boom').focus();
    expect(calls[calls.length - 1]).toBe('ui_move');
    game.destroy();
});
