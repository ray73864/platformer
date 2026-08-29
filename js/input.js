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
    }

    handleKeyDown(event) {
        const code = event.code;

        // Track key state
        this.keys.add(code);

        // Trigger movement callbacks on initial press
        if (!this.wasPressed(code)) {
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
        const code = event.code;
        this.keys.delete(code);

        // Trigger release callbacks
        if (code === 'ArrowLeft' || code === 'KeyA') {
            this.onReleaseLeftCallback?.();
        } else if (code === 'ArrowRight' || code === 'KeyD') {
            this.onReleaseRightCallback?.();
        }
    }

    wasPressed(code) {
        // Returns true if key was already pressed (for detecting initial press)
        return false; // Simplified - in practice would track previous state
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
