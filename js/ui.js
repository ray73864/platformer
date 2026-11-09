import { THEMES } from './sprites.js';
import { FX } from './fx.js';

// The clock chip turns urgent below this many seconds (Wave C HUD). Pure
// predicate so the threshold logic is pin-testable without a DOM.
export const TIME_URGENT_THRESHOLD = 10;
export function isTimeUrgent(timeRemaining) {
    return Number.isFinite(timeRemaining) && timeRemaining > 0 &&
        timeRemaining < TIME_URGENT_THRESHOLD;
}

export class UI {
    constructor() {
        this.scoreElement = this.ensureElement('score-display');
        this.levelElement = this.ensureElement('level-display');
        this.coinsElement = this.ensureElement('coins-display');
        this.finalScoreElement = this.ensureElement('final-score');
        this.gameCompleteScoreElement = this.ensureElement('game-complete-score');
        this.highScoreElement = this.ensureElement('high-score');
        this.timerElement = this.ensureElement('timer-display');
        this.hudElement = this.ensureElement('hud');
        for (const id of ['menu-screen', 'game-over-screen', 'level-complete-screen', 'pause-screen', 'game-complete-screen']) {
            this.ensureElement(id, 'overlay');
        }
        // HUD-failure log-once flags (see updateScore).
        this._scoreHudFailed = false;
        this._levelHudFailed = false;
        this._timerHudFailed = false;
    }

    ensureElement(id, className) {
        let element = document.getElementById(id);
        if (!element) {
            element = document.createElement('div');
            element.id = id;
            // Fabricated overlays must carry the `overlay` class: the CSS only
            // hides via `.overlay.hidden`, so an overlay created without it
            // could never be visually hidden.
            if (className) {
                element.className = className;
            }
            document.body.appendChild(element);
        }
        return element;
    }

    showHUD() {
        const hud = document.getElementById('hud');
        if (hud) hud.style.display = 'flex';
    }

    hideHUD() {
        const hud = document.getElementById('hud');
        if (hud) hud.style.display = 'none';
    }

    // Spec §Accessibility: the pause control's accessible name toggles
    // "Pause Game"/"Resume Game" with the game state. Game.togglePause keeps
    // it in sync however the transition happened (button, Escape).
    setPauseLabel(paused) {
        const button = document.getElementById('pause-btn');
        if (!button) return;
        button.setAttribute('aria-label', paused ? 'Resume Game' : 'Pause Game');
        button.textContent = paused ? 'Resume' : 'Pause';
    }

    // Sound chip glyph follows the mute state (M key or click, whichever
    // moved it — Game.toggleSound keeps the label in sync). The accessible
    // name stays "Toggle sound": it describes the action, and the glyph
    // swap is reinforced by the aria-pressed state.
    setMuteLabel(muted) {
        const button = document.getElementById('mute-btn');
        if (!button) return;
        button.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'; // 🔇 / 🔊
        button.setAttribute('aria-pressed', muted ? 'true' : 'false');
    }

    // The pause control is only meaningful in PLAYING/PAUSED. Outside those
    // states it is disabled rather than hidden: a focusable no-op (or worse,
    // an end-screen control that silently navigates) fails WCAG 2.4.6/3.2.2,
    // while `disabled` removes it from the tab order and announces it as such.
    setPauseEnabled(enabled) {
        const button = document.getElementById('pause-btn');
        if (!button) return;
        button.disabled = !enabled;
    }

    // --- Pause menu (owner ruling R29, spec §Accessibility "Arrow keys ...
    // during PAUSED state to select menu options"). The options are native
    // buttons inside #pause-screen: Enter/Space activation and focus styling
    // come free from the platform; Game drives where focus goes.

    focusPauseMenu() {
        const first = document.querySelector('#pause-screen button');
        if (first) first.focus();
    }

    cyclePauseFocus(forward) {
        const buttons = [...document.querySelectorAll('#pause-screen button')];
        if (buttons.length === 0) return;
        const current = buttons.indexOf(document.activeElement);
        // Off-menu (fresh pause, Tab elsewhere): Up/Down both land on the
        // first option rather than wrapping to a half-visible last one.
        const next = current === -1
            ? 0
            : (current + (forward ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
    }

    // Resuming or navigating away must not leave focus on a now-hidden
    // control: Space would stay swallowed by the focused button (see the
    // I1 note in input.js), and assistive tech would announce nothing.
    blurPauseControls() {
        const active = document.activeElement;
        if (!active || typeof active.closest !== 'function') return;
        if (active.closest('#pause-screen') || active.id === 'pause-btn') {
            active.blur();
        }
    }

    // --- Loop-error notice (spec §General Error Handling: state recovery
    // "with error message displayed"). Self-healing display element; the
    // role attribute is re-asserted for fabricated nodes.
    showErrorMessage(text, durationMs = 3000) {
        const element = this.ensureElement('error-message', 'hidden');
        if (!element.getAttribute('role')) element.setAttribute('role', 'alert');
        element.textContent = text;
        element.classList.remove('hidden');
        clearTimeout(this._errorToastTimer);
        this._errorToastTimer = setTimeout(() => this.hideErrorMessage(), durationMs);
    }

    hideErrorMessage() {
        clearTimeout(this._errorToastTimer);
        const element = document.getElementById('error-message');
        if (element) element.classList.add('hidden');
    }

    // Spec §Error Handling (Score Tracking): "If HUD rendering fails, display
    // score in console for debugging." These writers run every frame, so a
    // missing/detached node logs once per failure episode — never per frame
    // (the R26 flood lesson). isConnected catches nodes removed from the
    // document after construction; the flag re-arms on the next success.
    updateCoins(collected, total) {
        if (this.coinsElement && this.coinsElement.isConnected) {
            const text = `Coins: ${collected}/${total}`;
            if (this.coinsElement.textContent !== text) {
                this.coinsElement.textContent = text;
                // Change-gated announcement (Wave C WCAG sweep): only real
                // progress reaches the polite live region, throttled so a
                // rapid coin sweep coalesces into one reading.
                this._queueAnnouncement('coins', `coins ${collected} of ${total}`);
            }
            // Gold while the gate is still shut, green once the portal is
            // unlocked: readable at a glance without reading the numbers.
            this.coinsElement.classList.toggle('coins-done', collected >= total);
        }
    }

    updateScore(score) {
        if (this.scoreElement && this.scoreElement.isConnected) {
            const text = `Score: ${score}`;
            // Change-gated (Wave C): this writer runs every frame; skipping
            // identical writes keeps the busy-map HUD cost negligible AND
            // stops aria-live churn on no-op frames.
            if (this.scoreElement.textContent !== text) {
                this.scoreElement.textContent = text;
                this._queueAnnouncement('score', `score ${score}`);
            }
            this._scoreHudFailed = false;
        } else if (!this._scoreHudFailed) {
            this._scoreHudFailed = true;
            console.error('HUD score display unavailable; score:', score);
        }
    }

    updateLevel(level) {
        if (this.levelElement && this.levelElement.isConnected) {
            const text = `Level: ${level}`;
            if (this.levelElement.textContent !== text) {
                this.levelElement.textContent = text;
                this._queueAnnouncement('level', `level ${level}`);
            }
            this._levelHudFailed = false;
        } else if (!this._levelHudFailed) {
            this._levelHudFailed = true;
            console.error('HUD level display unavailable; level:', level);
        }
    }

    // Polite live-region announcements for HUD changes (Wave C). A trailing
    // throttle coalesces rapid events — a full coin sweep announces once,
    // not six times — while still reading out within ~1 s of the action.
    // The region is a dedicated sr-only node so chip restyling (urgent timer
    // rewrites every second) never touches it.
    _queueAnnouncement(kind, text) {
        const element = this.ensureElement('hud-announce', 'sr-only');
        if (!element.getAttribute('aria-live')) {
            element.setAttribute('aria-live', 'polite');
        }
        (this._announceParts ??= {})[kind] = text;
        if (this._announceTimer) return;
        this._announceTimer = setTimeout(() => {
            this._announceTimer = null;
            const parts = this._announceParts;
            this._announceParts = {};
            const line = Object.keys(parts).sort().map(k => parts[k]).join(', ');
            if (line) element.textContent = line;
        }, 1000);
    }

    // The run clock is timed-tiers-only: the HUD node starts hidden and is
    // revealed exactly when a level's difficulty tier enables the clock.
    // Wave C wraps the readout in an icon chip; hiding must take the whole
    // chip (icon included), so the class rides both nodes when present.
    setTimerVisible(visible) {
        if (this.timerElement) {
            this.timerElement.classList.toggle('hidden', !visible);
            const chip = typeof this.timerElement.closest === 'function' &&
                this.timerElement.closest('.hud-chip');
            if (chip) chip.classList.toggle('hidden', !visible);
        }
    }

    updateTimer(timeRemaining) {
        // Same isConnected + log-once discipline as updateScore/updateLevel
        // (S3): this writer also runs every frame, and a detached node must
        // not fail silently while the clock still kills the player.
        if (this.timerElement && this.timerElement.isConnected) {
            const minutes = Math.floor(timeRemaining / 60);
            const seconds = Math.floor(timeRemaining % 60);
            const text = `Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            if (this.timerElement.textContent !== text) {
                this.timerElement.textContent = text;
            }
            // Urgent state (Wave C): red under TIME_URGENT_THRESHOLD. The
            // static color change always applies; the pulsing animation only
            // rides along while FX.pulse is on (reduced motion keeps the
            // readable color without the movement). Classes ride the chip
            // wrapper so the icon turns with the number; fixtures without a
            // chip fall back to the bare span.
            const urgent = isTimeUrgent(timeRemaining);
            const target = (typeof this.timerElement.closest === 'function' &&
                this.timerElement.closest('.hud-chip')) || this.timerElement;
            target.classList.toggle('time-urgent', urgent);
            target.classList.toggle('time-pulse', urgent && FX.pulse);
            this._timerHudFailed = false;
        } else if (!this._timerHudFailed) {
            this._timerHudFailed = true;
            console.error('HUD timer display unavailable; time remaining:',
                timeRemaining);
        }
    }

    showOverlay(id) {
        const overlay = document.getElementById(id);
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    }

    hideOverlay(id) {
        const overlay = document.getElementById(id);
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    // Deaths name themselves on the game-over screen: "got near something and
    // died" is not feedback. Unknown/absent causes fall back to silence.
    static DEATH_CAUSE_TEXT = {
        time: 'Time ran out',
        enemy: 'Touched a patrol',
        spiny: 'A spiny\u2019s back is spiked — no stomping',
        spike: 'Landed on spikes',
        pit: 'Fell into the void',
        projectile: 'Took a bombardier shot'
    };

    // One respectful, teachable line per cause (Wave C). Tone rule (no-mans-
    // splaining): state the mechanic and the move, never narrate what the
    // player just did wrong. Deterministic by cause — no RNG, no variety
    // spam; every key in DEATH_CAUSE_TEXT must have a tip (pinned in tests).
    static DEATH_TIP = {
        time: 'The clock rewards momentum — take the direct line and bank coins early.',
        enemy: 'Patrols keep steady lines — read the rhythm, then cross behind them.',
        spiny: 'Spiky backs can\u2019t be stomped — go around, not over.',
        spike: 'Spikes mark the flat routes — jump early and land on clean ground.',
        pit: 'Landings commit you — tap jump early when brushing ledges.',
        projectile: 'Shells arc — wait for the muzzle flash, then slip past on the far side.'
    };

    // Theme label for the level-intro card ("LEVEL 23 · DUSK"). Single source
    // is the THEMES table's `name`; unknown shapes degrade to no suffix.
    static themeNameFor(levelNumber) {
        const theme = THEMES[(Math.max(1, levelNumber) - 1) % THEMES.length];
        return theme && typeof theme.name === 'string' ? theme.name : '';
    }

    // Between-levels card shown while the freshly published level plays
    // underneath (Wave C). Presentation-only: it never pauses or extends the
    // transition, carries aria-hidden (the HUD already announces the level),
    // and hides itself via the CSS animation's end state.
    showLevelIntro(levelNumber) {
        const element = this.ensureElement('level-intro-card');
        const name = UI.themeNameFor(levelNumber);
        element.textContent = name
            ? `LEVEL ${levelNumber} \u00b7 ${name}`
            : `LEVEL ${levelNumber}`;
        // Restart the CSS animation even on back-to-back shows: removing the
        // class, forcing a style flush, then re-adding is the standard trick.
        element.classList.remove('show');
        void element.offsetWidth;
        element.classList.add('show');
    }

    // Settings screen render pass (Wave C). Reflects live state into the
    // three role=switch toggles; main.js owns the click handlers.
    renderSettings({ soundOn, shakeOn, reducedMotion }) {
        const setSwitch = (id, on, onText = 'On', offText = 'Off') => {
            const button = document.getElementById(id);
            if (!button) return;
            button.setAttribute('aria-checked', on ? 'true' : 'false');
            button.textContent = on ? onText : offText;
        };
        setSwitch('sound-toggle-btn', soundOn);
        setSwitch('shake-toggle-btn', shakeOn);
        // The motion switch reads "Reduced motion": checked == effects
        // reduced. 'on' -> checked; 'off'/null (follow OS) -> unchecked.
        setSwitch('motion-toggle-btn', reducedMotion === 'on');
    }

    focusSettingsMenu() {
        const first = document.querySelector('#settings-screen button');
        if (first) first.focus();
    }

    // Tab containment for the settings dialog (WCAG 2.4.3, review fix):
    // cycles ONLY the dialog's buttons, wrapping at both ends. Called from
    // main.js's keydown trap while settingsOpen; complements the inert
    // backdrop (which real browsers honour and happy-dom does not implement).
    cycleSettingsFocus(forward = true) {
        const nodes = [...document.querySelectorAll('#settings-screen button')];
        if (!nodes.length) return;
        const i = nodes.indexOf(document.activeElement);
        const next = i < 0
            ? (forward ? nodes[0] : nodes[nodes.length - 1])
            : nodes[(i + (forward ? 1 : -1) + nodes.length) % nodes.length];
        if (next && typeof next.focus === 'function') next.focus();
    }

    // Drop any pending coalesced announcement so a destroyed Game can never
    // fire a late timer into a torn-down DOM (review nit).
    destroyAnnouncements() {
        if (this._announceTimer) {
            clearTimeout(this._announceTimer);
            this._announceTimer = null;
        }
    }

    // score is the POST-penalty total; penalty (default 0 keeps old call
    // sites working) renders the cause-and-effect loss line next to the
    // cause. Hidden when nothing was lost.
    showGameOver(score, cause, penalty = 0) {
        // The game-over overlay reads its score from #final-score, not the
        // HUD counter (the HUD is hidden behind the overlay).
        if (this.finalScoreElement) {
            this.finalScoreElement.textContent = `Score: ${score}`;
        }
        const causeEl = document.getElementById('death-cause');
        if (causeEl) {
            const text = UI.DEATH_CAUSE_TEXT[cause] || '';
            causeEl.textContent = text;
            causeEl.hidden = !text;
        }
        // Cause-linked tip (Wave C): same node conventions as the cause line
        // (hidden when the cause is unknown), announced politely with it.
        const tipEl = document.getElementById('death-tip');
        if (tipEl) {
            const tip = UI.DEATH_TIP[cause] || '';
            tipEl.textContent = tip;
            tipEl.hidden = !tip;
        }
        const penaltyEl = document.getElementById('score-penalty');
        if (penaltyEl) {
            penaltyEl.textContent = penalty > 0 ? `-${penalty} points` : '';
            penaltyEl.hidden = !(penalty > 0);
        }
        this.showOverlay('game-over-screen');
    }

    showGameComplete(score, highScore, runStats = {}) {
        // #final-score belongs to the game-over overlay; this screen has its
        // own score node plus the persisted high score.
        if (this.gameCompleteScoreElement) {
            this.gameCompleteScoreElement.textContent = `Score: ${score}`;
        }
        if (this.highScoreElement) {
            this.highScoreElement.textContent = `High Score: ${highScore}`;
        }
        // Wave C run stat: secrets banked across the whole run (the M5
        // session counter). Same dynamic-copy conventions as the level-
        // complete breakdown — hidden when there is nothing to report.
        const secretsEl = document.getElementById('run-secrets');
        if (secretsEl) {
            const n = Number.isFinite(runStats.secrets) && runStats.secrets > 0
                ? runStats.secrets : 0;
            secretsEl.textContent = n > 0 ? `Secrets found: ${n}` : '';
            secretsEl.hidden = !(n > 0);
        }
        this.showOverlay('game-complete-screen');
    }

    showLevelComplete() {
        this.showOverlay('level-complete-screen');
    }

    // Level-complete cause-and-effect lines (owner ruling 2026-11-04). Same
    // conventions as #score-penalty in showGameOver: text written here, the
    // node hidden whenever there is nothing to report, aria-live polite in
    // the markup announces the dynamic copy. Copy:
    //   flawless → "Flawless clear +100"
    //   issues   → "Cleared after 2 deaths +40"
    //   combat   → "Enemies bested +N" only when N > 0.
    // M5 additions ride the same node conventions (aria-live polite, hidden
    // with nothing to report):
    //   no damage → "No-damage bonus +50" (zero-death clears only)
    //   secrets   → "Secrets: 1/2" on levels that shipped alcove coins.
    setLevelCompleteBreakdown(breakdown) {
        const { clearBonus = 0, enemiesBested = 0, deaths = 0,
            flawless = false, noDamageBonus = 0, secretsFound = 0,
            secretsTotal = 0 } = breakdown || {};
        const bonusEl = document.getElementById('clear-bonus');
        if (bonusEl) {
            const text = clearBonus > 0
                ? (flawless
                    ? `Flawless clear +${clearBonus}`
                    : `Cleared after ${deaths} death${deaths === 1 ? '' : 's'} +${clearBonus}`)
                : '';
            bonusEl.textContent = text;
            bonusEl.hidden = !text;
        }
        const bestedEl = document.getElementById('enemies-bested');
        if (bestedEl) {
            bestedEl.textContent = enemiesBested > 0 ? `Enemies bested +${enemiesBested}` : '';
            bestedEl.hidden = !(enemiesBested > 0);
        }
        const noDamageEl = document.getElementById('no-damage-bonus');
        if (noDamageEl) {
            noDamageEl.textContent = noDamageBonus > 0
                ? `No-damage bonus +${noDamageBonus}` : '';
            noDamageEl.hidden = !(noDamageBonus > 0);
        }
        const secretsEl = document.getElementById('secrets-found');
        if (secretsEl) {
            // Only meaningful when the level actually hid secrets; a plain
            // level shows no line rather than a hollow "Secrets: 0/0".
            secretsEl.textContent = secretsTotal > 0
                ? `Secrets: ${secretsFound}/${secretsTotal}` : '';
            secretsEl.hidden = !(secretsTotal > 0);
        }
    }

    getScore() {
        if (this.scoreElement) {
            return parseInt(this.scoreElement.textContent.replace('Score: ', '')) || 0;
        }
        return 0;
    }

    getLevel() {
        if (this.levelElement) {
            return parseInt(this.levelElement.textContent.replace('Level: ', '')) || 1;
        }
        return 1;
    }
}
