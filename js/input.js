// STUB — replaced by Task 2
export class InputHandler {
    constructor() {
        this.jumpCallbacks = [];
        this.moveLeftCallbacks = [];
        this.moveRightCallbacks = [];
        this.releaseLeftCallbacks = [];
        this.releaseRightCallbacks = [];
    }

    onJump(callback) {
        this.jumpCallbacks.push(callback);
    }

    onMoveLeft(callback) {
        this.moveLeftCallbacks.push(callback);
    }

    onMoveRight(callback) {
        this.moveRightCallbacks.push(callback);
    }

    onReleaseLeft(callback) {
        this.releaseLeftCallbacks.push(callback);
    }

    onReleaseRight(callback) {
        this.releaseRightCallbacks.push(callback);
    }

    isLeft() {
        return false;
    }

    isRight() {
        return false;
    }
}
