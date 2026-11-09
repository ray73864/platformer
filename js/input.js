// keydown targets the focused element (body when nothing is). tagName over
// instanceof: harnesses may deliver events whose target comes from another
// DOM realm than this module's globals.
function isButtonTarget(event) {
    return !!event.target && event.target.tagName === 'BUTTON';
}

// Wave D touch controls: virtual action -> synthetic key code. Distinct
// spellings (not ArrowLeft/Space/KeyX) so releasing a virtual button can
// never clear a physically-held key and vice versa, while every consumer
// below treats each pair as ONE logical input. Lives here rather than in
// main.js because InputHandler owns the keys set.
const TOUCH_CODES = {
    left: 'TouchLeft',
    right: 'TouchRight',
    jump: 'TouchSpace',
    dash: 'TouchDash'
};

export class InputHandler {
    constructor() {
        this.keys = new Set();

        // Callbacks for movement events
        this.onMoveLeftCallback = null;
        this.onMoveRightCallback = null;
        this.onJumpCallback = null;
        this.onReleaseLeftCallback = null;
        this.onReleaseRightCallback = null;
        this.onReleaseJumpCallback = null;
        this.onDashCallback = null;

        // One controller for every listener registered below; destroy()
        // detaches them all (owner: Game).
        this._abort = new AbortController();

        this.bindEvents();
    }

    destroy() {
        this._abort.abort();
    }

    bindEvents() {
        const signal = this._abort.signal;
        window.addEventListener('keydown', (e) => this.handleKeyDown(e), { signal });
        window.addEventListener('keyup', (e) => this.handleKeyUp(e), { signal });

        // Browsers drop the keyup of a held key when the window loses focus,
        // which would leave the key latched in `keys` forever: alt-tab while
        // holding a direction and the player drives on until that exact key
        // is pressed-and-released again. Clearing the set is enough — held
        // speed is re-derived from isLeft()/isRight() every frame.
        window.addEventListener('blur', () => this.keys.clear(), { signal });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.keys.clear();
        }, { signal });
    }

    resolveCode(event) {
        // Some harnesses (e.g. CDP raw key events) deliver `key` with an empty
        // `code`; fall back to the equivalent physical-code spelling. Letters
        // must map to 'KeyX' explicitly: consumers compare against code
        // spellings, and a bare 'a' would never match 'KeyA'.
        if (event.code) return event.code;
        const key = event.key;
        if (!key) return '';
        if (key === ' ') return 'Space';
        if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
        return key;
    }

    handleKeyDown(event) {
        const code = this.resolveCode(event);

        // Capture prior state BEFORE adding: OS autorepeat re-fires keydown
        // without an intervening keyup, so checking after keys.add would
        // report every repeat as an initial press.
        const wasDown = this.keys.has(code);

        // Track key state
        this.keys.add(code);

        // Trigger movement callbacks on initial press only
        if (!wasDown) {
            if (code === 'ArrowLeft' || code === 'KeyA') {
                this.onMoveLeftCallback?.();
            } else if (code === 'ArrowRight' || code === 'KeyD') {
                this.onMoveRightCallback?.();
            } else if (code === 'Space' && !isButtonTarget(event)) {
                // A focused <button> activates on Space at keyup (UI Events
                // spec). Firing the jump callback as well would make one press
                // both jump and click the button. While a control holds focus,
                // Space belongs to that control; Enter still reaches buttons
                // untouched, and gameplay resumes once focus leaves it.
                this.onJumpCallback?.();
            } else if (code === 'KeyX' || code === 'KeyC') {
                // Dash (M2): KeyX primary, KeyC alias — neither collides with
                // anything existing (gameplay keys are arrows/WASD/Space/Shift,
                // pause nav is Escape+arrows, mute is KeyM). Wave D touch will
                // mirror KeyX. Autorepeat filtered by the wasDown check above.
                this.onDashCallback?.();
            }
        }
    }

    handleKeyUp(event) {
        const code = this.resolveCode(event);
        this.keys.delete(code);

        // Trigger release callbacks
        if (code === 'ArrowLeft' || code === 'KeyA') {
            this.onReleaseLeftCallback?.();
        } else if (code === 'ArrowRight' || code === 'KeyD') {
            this.onReleaseRightCallback?.();
        } else if (code === 'Space') {
            // Variable jump height (see Player.releaseJump): fires on every
            // Space keyup, including one a focused <button> also activates
            // on — cutting a rising jump is strictly arc-shortening, so the
            // overlap is harmless where the keydown half was not.
            this.onReleaseJumpCallback?.();
        }
    }

    // Key state queries. Each pairs the physical spellings with the Wave D
    // synthetic touch code (TOUCH_CODES) — one logical input per direction
    // regardless of which hardware drove it.
    isLeft() {
        return this.keys.has('ArrowLeft') || this.keys.has('KeyA') ||
            this.keys.has(TOUCH_CODES.left);
    }

    isRight() {
        return this.keys.has('ArrowRight') || this.keys.has('KeyD') ||
            this.keys.has(TOUCH_CODES.right);
    }

    isJump() {
        return this.keys.has('Space') || this.keys.has(TOUCH_CODES.jump);
    }

    // Walk modifier (Shift, either side): no existing binding uses it —
    // gameplay keys are arrows/WASD/Space, pause navigation is Escape plus
    // arrows while PAUSED, so Shift is free. Blur/visibilitychange already
    // clears the set, so a focus loss can never latch walk mode on.
    isWalk() {
        return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    }

    // Dash key state (M2): KeyX primary, KeyC alias. No release callback —
    // the burst is fire-and-forget in Player.pressDash(), nothing reads a
    // held dash key per frame. Blur/visibilitychange clear it like every key.
    isDash() {
        return this.keys.has('KeyX') || this.keys.has('KeyC') ||
            this.keys.has(TOUCH_CODES.dash);
    }

    // --- Touch API (Wave D) --------------------------------------------------
    // Drive the SAME logical paths as keydown/keyup without synthesizing
    // KeyboardEvents: the press fires the initial-press callbacks behind the
    // same wasDown-before-add filter handleKeyDown uses (a held finger whose
    // pointerdown re-fires can never double-jump), and the release fires the
    // release callbacks exactly like keyup. Callbacks themselves keep their
    // PLAYING gates — these methods only mirror the keyboard plumbing.
    // Returns true when the action name is known (test/debug seam).
    touchPress(action) {
        const code = TOUCH_CODES[action];
        if (!code) return false;
        const wasDown = this.keys.has(code);
        this.keys.add(code);
        if (!wasDown) {
            if (action === 'left') {
                this.onMoveLeftCallback?.();
            } else if (action === 'right') {
                this.onMoveRightCallback?.();
            } else if (action === 'jump') {
                this.onJumpCallback?.();
            } else if (action === 'dash') {
                this.onDashCallback?.();
            }
        }
        return true;
    }

    touchRelease(action) {
        const code = TOUCH_CODES[action];
        if (!code) return false;
        this.keys.delete(code);
        if (action === 'left') {
            this.onReleaseLeftCallback?.();
        } else if (action === 'right') {
            this.onReleaseRightCallback?.();
        } else if (action === 'jump') {
            // Variable jump height applies to pad-launched arcs too (main.js
            // routes releaseJump through the same Player contract).
            this.onReleaseJumpCallback?.();
        }
        return true;
    }

    // Callback setters
    onMoveLeft(callback) {
        this.onMoveLeftCallback = callback;
    }

    onMoveRight(callback) {
        this.onMoveRightCallback = callback;
    }

    onJump(callback) {
        this.onJumpCallback = callback;
    }

    onReleaseLeft(callback) {
        this.onReleaseLeftCallback = callback;
    }

    onReleaseRight(callback) {
        this.onReleaseRightCallback = callback;
    }

    onReleaseJump(callback) {
        this.onReleaseJumpCallback = callback;
    }

    onDash(callback) {
        this.onDashCallback = callback;
    }
}
