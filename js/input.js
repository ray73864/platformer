export class InputHandler {
    constructor() {
        this.keys = new Set();

        // Callbacks for movement events
        this.onMoveLeftCallback = null;
        this.onMoveRightCallback = null;
        this.onJumpCallback = null;
        this.onReleaseLeftCallback = null;
        this.onReleaseRightCallback = null;

        this.bindEvents();
    }

    bindEvents() {
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // Browsers drop the keyup of a held key when the window loses focus,
        // which would leave the key latched in `keys` forever: alt-tab while
        // holding a direction and the player drives on until that exact key
        // is pressed-and-released again. Clearing the set is enough — held
        // speed is re-derived from isLeft()/isRight() every frame.
        window.addEventListener('blur', () => this.keys.clear());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.keys.clear();
        });
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
            } else if (code === 'Space') {
                this.onJumpCallback?.();
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
}
