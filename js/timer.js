export class Timer {
    constructor(baseTime = 60) {
        this.baseTime = baseTime;
        this.timeRemaining = baseTime;
        // `paused`, not `isPaused`: an instance field of that name would shadow a same-named method.
        this.paused = false;
    }

    update(dt, isPaused) {
        if (isPaused || this.paused) return;

        this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    }

    getTimeRemaining() {
        return this.timeRemaining;
    }

    isTimeUp() {
        return this.timeRemaining <= 0;
    }

    addCoinBonus() {
        this.timeRemaining += 2; // +2 seconds per coin
    }

    startNextLevel() {
        // Time carries over between levels: no reset.
    }

    setPaused(paused) {
        this.paused = paused;
    }
}
