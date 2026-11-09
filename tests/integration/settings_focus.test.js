// Integration (review fix round 1, MAJOR-1): settings-dialog focus
// containment, WCAG 2.4.3. Replicates the reviewer's two live repros —
// (a) menu path: Tabbing while the dialog is open must NEVER reach
// #start-btn (Enter there started a run under the open dialog); (b) pause
// path: Tabbing must never reach the HUD #pause-btn (Enter there resumed
// the game underneath). Plus (c) activating Back returns focus to the exact
// invoking control on BOTH paths, and the backdrop containers carry inert +
// aria-hidden while open and shed both on close.
//
// Containment here is enforced by main.js's keydown Tab trap (harness-
// independent; happy-dom implements no inert) plus the inert/aria-hidden
// backdrop attributes for real browsers — both are asserted.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game } from "../../js/main.js";

// The shared fixture predates Wave C; graft on the shipped settings markup
// (ids mirror index.html) before the Game binds its events.
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

function pressTab(shift = false) {
    window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Tab', key: 'Tab', shiftKey: shift, bubbles: true
    }));
}

test("(a) menu path: Tab cannot escape the dialog into #start-btn", () => {
    mountSettingsFixture();
    const game = new Game();
    game.openSettings('menu');
    expect(document.activeElement.id).toBe('sound-toggle-btn');
    // Far more Tabs than the dialog has controls, asserting the exact cycle:
    // containment must be ACTIVE (focus advancing inside the dialog), not
    // merely "focus did not move" — happy-dom never traverses natively, so a
    // removed trap would otherwise pass vacuously while real browsers leak
    // to #start-btn exactly like the reviewer's repro.
    const order = ['shake-toggle-btn', 'motion-toggle-btn', 'settings-back-btn',
        'sound-toggle-btn', 'shake-toggle-btn', 'motion-toggle-btn',
        'settings-back-btn', 'sound-toggle-btn'];
    for (let i = 0; i < 8; i++) {
        pressTab();
        expect(document.activeElement.id).toBe(order[i]);
        expect(document.activeElement.id).not.toBe('start-btn');
    }
    // Shift+Tab wraps backwards through the same active cycle.
    const back = ['settings-back-btn', 'motion-toggle-btn', 'shake-toggle-btn'];
    for (let i = 0; i < 3; i++) {
        pressTab(true);
        expect(document.activeElement.id).toBe(back[i]);
    }
    // Backdrop marked inert + aria-hidden while open.
    expect(document.getElementById('hud').hasAttribute('inert')).toBe(true);
    expect(document.getElementById('hud').getAttribute('aria-hidden')).toBe('true');
    game.destroy();
});

test("(b) pause path: Tab cannot escape the dialog into the HUD #pause-btn", () => {
    mountSettingsFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    game.togglePause();
    expect(game.state).toBe('PAUSED');
    document.getElementById('pause-settings-btn').click();
    expect(game.settingsOpen).toBe(true);
    const order = ['shake-toggle-btn', 'motion-toggle-btn', 'settings-back-btn',
        'sound-toggle-btn', 'shake-toggle-btn', 'motion-toggle-btn',
        'settings-back-btn', 'sound-toggle-btn'];
    for (let i = 0; i < 8; i++) {
        pressTab();
        expect(document.activeElement.id).toBe(order[i]);
        expect(document.activeElement.id).not.toBe('pause-btn');
    }
    // The still-visible pause menu behind the dialog is inert.
    const pause = document.getElementById('pause-screen');
    expect(pause.hasAttribute('inert')).toBe(true);
    expect(pause.getAttribute('aria-hidden')).toBe('true');
    game.destroy();
});

test("(c) activating Back restores focus to the invoking control (both paths)", () => {
    // Menu path: Enter on a focused <button> fires click natively; .click()
    // models that activation in happy-dom.
    mountSettingsFixture();
    let game = new Game();
    game.openSettings('menu');
    document.getElementById('settings-back-btn').click();
    expect(game.settingsOpen).toBe(false);
    expect(document.activeElement.id).toBe('menu-settings-btn');
    expect(document.getElementById('hud').hasAttribute('inert')).toBe(false);
    expect(document.getElementById('hud').hasAttribute('aria-hidden')).toBe(false);
    game.destroy();

    // Pause path: back lands on the pause menu's Settings entry, and the
    // backdrop unlocks so that focus actually sticks.
    mountSettingsFixture();
    game = new Game();
    document.getElementById('start-btn').click();
    game.togglePause();
    document.getElementById('pause-settings-btn').click();
    document.getElementById('settings-back-btn').click();
    expect(game.settingsOpen).toBe(false);
    expect(document.activeElement.id).toBe('pause-settings-btn');
    const pause = document.getElementById('pause-screen');
    expect(pause.hasAttribute('inert')).toBe(false);
    expect(pause.hasAttribute('aria-hidden')).toBe(false);
    game.destroy();
});

test("returnToMenu sheds the backdrop even with the dialog open", () => {
    mountSettingsFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    game.togglePause();
    document.getElementById('pause-settings-btn').click();
    game.returnToMenu();
    expect(game.settingsOpen).toBe(false);
    for (const id of ['pause-screen', 'hud']) {
        expect(document.getElementById(id).hasAttribute('inert')).toBe(false);
    }
    game.destroy();
});
