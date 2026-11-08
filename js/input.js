// keydown targets the focused element (body when nothing is). tagName over
// instanceof: harnesses may deliver events whose target comes from another
// DOM realm than this module's globals.
function isButtonTarget(event) {
    return !!event.target && event.target.tagName === 'BUTTON';
}

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

    // Key state queries
    isLeft() {
        return this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    }

    isRight() {
        return this.keys.has('ArrowRight') || this.keys.has('KeyD');
    }

    isJump() {
        return this.keys.has('Space');
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
        return this.keys.has('KeyX') || this.keys.has('KeyC');
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
