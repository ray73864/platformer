// W5 intensity-layer state machine under a FAKE AudioContext: <10 s arms the
// percussive bed + tempo lift (same predicate as the HUD chip), level clear
// and death disarm, PAUSE holds the arm (clock frozen = urgency paused, not
// cancelled) while the duck silences and the scheduler halts, and mute keeps
// starting zero nodes with the layer armed. Bed density/tempo effects are
// pinned against the fake clock (fully deterministic — no wall timing).
import { test, expect, describe, afterAll } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";
import { Game } from "../../js/main.js";
import { Level } from "../../js/level.js";
import { TIME_URGENT_THRESHOLD } from "../../js/ui.js";
import * as audio from "../../js/audio.js";

installGameTestScaffolding();

// --- instrumentation (same family as audio_lifecycle, +compressor) ---------
const liveIntervals = new Map();
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.setInterval = (fn, ms) => {
    const id = realSetInterval(fn, ms);
    liveIntervals.set(id, fn);
    return id;
};
globalThis.clearInterval = (id) => {
    liveIntervals.delete(id);
    return realClearInterval(id);
};
afterAll(() => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
});
function tickIntervals(n = 1) {
    for (let i = 0; i < n; i++) for (const fn of [...liveIntervals.values()]) fn();
}

class Param {
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v) { this.value = v; return this; }
    linearRampToValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; }
    cancelScheduledValues() { return this; }
}
class Node { connect() {} disconnect() {} }
class GainNode extends Node { constructor() { super(); this.gain = new Param(1); } }
class CompNode extends Node {
    constructor() {
        super();
        this.threshold = new Param(-24); this.knee = new Param(30);
        this.ratio = new Param(12); this.attack = new Param(0.003);
        this.release = new Param(0.25);
    }
}
class OscNode extends Node {
    constructor() { super(); this.frequency = new Param(440); this.detune = new Param(0); }
    start() { nodesStarted++; }
    stop() {}
}
class BiquadNode extends Node { constructor() { super(); this.frequency = new Param(350); } }
class DelayNode extends Node { constructor() { super(); this.delayTime = new Param(0); } }
class BufSrcNode extends Node {
    constructor() { super(); this.buffer = null; }
    start() { nodesStarted++; }
    stop() {}
}
const createdCtxs = [];
class FakeCtx {
    constructor() {
        createdCtxs.push(this);
        this.currentTime = 0;
        this.sampleRate = 48000;
        this.state = "running";
        this.destination = new Node();
    }
    createGain() { return new GainNode(); }
    createOscillator() { return new OscNode(); }
    createBiquadFilter() { return new BiquadNode(); }
    createDynamicsCompressor() { return new CompNode(); }
    createDelay() { return new DelayNode(); }
    createBufferSource() { return new BufSrcNode(); }
    createBuffer(ch, len) {
        const data = new Float32Array(len);
        return { getChannelData: () => data };
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
}
globalThis.AudioContext = FakeCtx;

let nodesStarted = 0;

// Fresh Game published onto a timed level (tier >= PHASE2) with a
// controllable amount of remaining time. currentLevel is pre-set because
// publishLevel reads it for the timer gate but (by design) never writes it —
// level ADVANCE owns that, not the publish seam.
function timedGame(timeRemaining) {
    audio.shutdown();
    audio.setMuted(false);
    mountFixture();
    const g = new Game();
    g.startGame();
    g.currentLevel = 5;
    g.publishLevel(new Level(5, 32, 4242)); // timerActive on tier 2 levels
    expect(g.timerActive).toBe(true);
    g.timer.timeRemaining = timeRemaining;
    return g;
}

describe("W5 intensity state machine", () => {
    afterAll(() => {
        delete globalThis.AudioContext;
        audio.shutdown();
        try { localStorage.setItem("platformerMuted", "false"); } catch { /* best-effort */ }
    });

    test("threshold constant matches the HUD urgent predicate", () => {
        expect(audio.URGENT_THRESHOLD_SEC).toBe(TIME_URGENT_THRESHOLD);
    });

    test("<10s arms on the first PLAYING tick past the threshold; >10s never arms", () => {
        const calm = timedGame(30);
        calm.update(0.016);
        expect(audio.getState().urgent).toBe(false);
        calm.destroy();

        const hot = timedGame(TIME_URGENT_THRESHOLD - 0.5);
        hot.update(0.016);
        expect(audio.getState().urgent).toBe(true);
        hot.destroy();
    });

    test("clear disarms; death disarms; retry re-derives from the fresh clock", () => {
        const g = timedGame(9);
        g.update(0.016);
        expect(audio.getState().urgent).toBe(true);
        g.handleWin();
        expect(audio.getState().urgent).toBe(false);
        g.destroy();

        const g2 = timedGame(9);
        g2.update(0.016);
        expect(audio.getState().urgent).toBe(true);
        g2.handleGameOver("pit");
        expect(audio.getState().urgent).toBe(false);
        g2.destroy();
    });

    // W6 pin (W5 review minor): the retry RESET was correct by reading only.
    // Arm the bed, die, hit Retry: publishLevel's neutral seam must disarm,
    // the refilled clock must not re-arm on the next tick, and the scheduler
    // must emit at the CALM rate afterwards — byte-for-byte the same voice
    // count as an unarmed run of the same seeded level over the same
    // fake-clock budget (a live bed would strictly exceed it, pinned above).
    test("retry disarms the bed and schedules zero urgency nodes post-reset", () => {
        // Identical procedure per mode so loop phase aligns across windows:
        // publish (music starts at step 0), settle state, then walk the fake
        // audio clock in quarter-step slices and count started voices.
        const groveWindow = (mode) => {
            audio.shutdown();
            audio.setMuted(false);
            mountFixture();
            const g = new Game();
            g.startGame();
            g.currentLevel = 5;
            g.publishLevel(new Level(5, 32, 4242));
            g.timer.timeRemaining = 9;
            if (mode !== "calm") audio.setUrgent(true);
            if (mode === "retry") {
                g.handleGameOver("pit");   // stops music + disarms (pinned above)
                g.retryLevel();            // GAME_OVER -> fresh attempt
                expect(audio.getState().urgent).toBe(false);
                g.update(0.016);           // fresh clock: must NOT re-arm
                expect(audio.getState().urgent).toBe(false);
            }
            const ctx = createdCtxs[createdCtxs.length - 1];
            const n0 = nodesStarted;
            for (let i = 0; i < 160; i++) {
                ctx.currentTime += 0.025;
                tickIntervals(1);
            }
            const emitted = nodesStarted - n0;
            g.destroy();
            return emitted;
        };
        const calm = groveWindow("calm");
        const hot = groveWindow("hot");
        const retry = groveWindow("retry");
        // Preconditions: the harness discriminates, and retry ends up calm.
        expect(calm).toBeGreaterThan(0);
        expect(hot).toBeGreaterThan(calm);
        expect(retry).toBe(calm);          // no urgency-scheduled voices live
    });

    test("pause holds the arm but silences the layer; resume restores it in sync", () => {
        const g = timedGame(9);
        g.update(0.016);
        expect(audio.getState().urgent).toBe(true);
        expect(liveIntervals.size).toBe(1);
        g.togglePause();
        tickIntervals(1);
        expect(liveIntervals.size).toBe(0);            // scheduler halted
        expect(audio.getState().ducked).toBe(true);     // bed inaudible
        expect(audio.getState().urgent).toBe(true);     // RULING: held, not cleared
        const before = nodesStarted;
        tickIntervals(5);
        expect(nodesStarted).toBe(before);              // nothing advances out of sync
        g.togglePause();
        expect(liveIntervals.size).toBe(1);             // resumes WITH the bed still armed
        expect(audio.getState().urgent).toBe(true);
        g.destroy();
    });

    test("mute with the layer armed starts zero nodes (single source of truth)", () => {
        const g = timedGame(9);
        g.update(0.016);
        expect(audio.getState().urgent).toBe(true);
        audio.setMuted(true);
        tickIntervals(1);                               // interval self-cancels
        const before = nodesStarted;
        tickIntervals(5);
        expect(nodesStarted).toBe(before);
        audio.setMuted(false);
        expect(liveIntervals.size).toBe(1);
        g.destroy();
    });

    test("armed bed is denser AND faster than the base groove (fake clock)", () => {
        // Same level, same fake-clock budget, unarmed vs armed: the bed adds
        // at least one voice per step and the tempo lift shortens the walk.
        const runWindow = (armed) => {
            audio.shutdown();
            audio.setMuted(false);
            mountFixture();
            const g = new Game();
            g.startGame();
            g.currentLevel = 5;
            g.publishLevel(new Level(5, 32, 4242));
            if (armed) audio.setUrgent(true);
            const ctx = createdCtxs[createdCtxs.length - 1];
            const t0 = ctx.currentTime;
            const n0 = nodesStarted;
            // Advance ~6 s of audio clock in quarter-step slices (deterministic).
            for (let i = 0; i < 240; i++) {
                ctx.currentTime += 0.025;
                tickIntervals(1);
            }
            const emitted = nodesStarted - n0;
            const elapsed = ctx.currentTime - t0;
            g.destroy();
            return { emitted, elapsed };
        };
        const calm = runWindow(false);
        const hot = runWindow(true);
        expect(calm.emitted).toBeGreaterThan(0);   // precondition: music ran
        expect(hot.emitted).toBeGreaterThan(calm.emitted);
        // Tempo lift: equal clock budgets must cover MORE loop work armed —
        // equivalently, armed emits-per-second strictly exceeds calm.
        expect(hot.emitted / hot.elapsed).toBeGreaterThan(calm.emitted / calm.elapsed);
    });
});
