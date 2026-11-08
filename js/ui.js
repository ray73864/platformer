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
            }
            // Gold while the gate is still shut, green once the portal is
            // unlocked: readable at a glance without reading the numbers.
            this.coinsElement.classList.toggle('coins-done', collected >= total);
        }
    }

    updateScore(score) {
        if (this.scoreElement && this.scoreElement.isConnected) {
            this.scoreElement.textContent = `Score: ${score}`;
            this._scoreHudFailed = false;
        } else if (!this._scoreHudFailed) {
            this._scoreHudFailed = true;
            console.error('HUD score display unavailable; score:', score);
        }
    }

    updateLevel(level) {
        if (this.levelElement && this.levelElement.isConnected) {
            this.levelElement.textContent = `Level: ${level}`;
            this._levelHudFailed = false;
        } else if (!this._levelHudFailed) {
            this._levelHudFailed = true;
            console.error('HUD level display unavailable; level:', level);
        }
    }

    // The run clock is timed-tiers-only: the HUD node starts hidden and is
    // revealed exactly when a level's difficulty tier enables the clock.
    setTimerVisible(visible) {
        if (this.timerElement) {
            this.timerElement.classList.toggle('hidden', !visible);
        }
    }

    updateTimer(timeRemaining) {
        // Same isConnected + log-once discipline as updateScore/updateLevel
        // (S3): this writer also runs every frame, and a detached node must
        // not fail silently while the clock still kills the player.
        if (this.timerElement && this.timerElement.isConnected) {
            const minutes = Math.floor(timeRemaining / 60);
            const seconds = Math.floor(timeRemaining % 60);
            this.timerElement.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, '0')}`;
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
        const penaltyEl = document.getElementById('score-penalty');
        if (penaltyEl) {
            penaltyEl.textContent = penalty > 0 ? `-${penalty} points` : '';
            penaltyEl.hidden = !(penalty > 0);
        }
        this.showOverlay('game-over-screen');
    }

    showGameComplete(score, highScore) {
        // #final-score belongs to the game-over overlay; this screen has its
        // own score node plus the persisted high score.
        if (this.gameCompleteScoreElement) {
            this.gameCompleteScoreElement.textContent = `Score: ${score}`;
        }
        if (this.highScoreElement) {
            this.highScoreElement.textContent = `High Score: ${highScore}`;
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
