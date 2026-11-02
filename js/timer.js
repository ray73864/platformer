// Run clock: one instance for the whole game; carryover between levels is
// realised by Game never resetting it mid-run. Pause handling lives in Game's
// state machine (update() only ticks while PLAYING), so the Timer itself has
// no paused/setPaused/startNextLevel surface.
const DEFAULT_BASE_TIME = 60;

export class Timer {
    constructor(baseTime = DEFAULT_BASE_TIME) {
        this.baseTime = baseTime;
        this.timeRemaining = baseTime;
    }

    // Spec §Error Handling (timer integrity): validate before each tick and
    // clamp to the valid range, 0–9999 seconds. A corrupt value (NaN from a
    // bad carryover, etc.) falls back to the default rather than silently
    // never expiring; additions clamp too so coin bonuses cannot overflow
    // past the ceiling. The fallback validates baseTime itself (S5): a
    // corrupt base must not reinstate the corruption it is repairing, or
    // timeRemaining stays NaN forever and isTimeUp() is false forever.
    update(dt) {
        if (!Number.isFinite(this.timeRemaining)) {
            this.timeRemaining = Number.isFinite(this.baseTime)
                ? this.baseTime
                : DEFAULT_BASE_TIME;
        }
        this.timeRemaining = Math.min(9999, Math.max(0, this.timeRemaining - dt));
    }

    getTimeRemaining() {
        return this.timeRemaining;
    }

    isTimeUp() {
        return this.timeRemaining <= 0;
    }

    addCoinBonus() {
        this.timeRemaining = Math.min(9999, this.timeRemaining + 2); // +2 seconds per coin
    }
}
