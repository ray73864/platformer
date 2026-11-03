// Browser-path lifecycle under a FAKE AudioContext (adopted from the audio
// wave's independent review probe). Counts contexts created/closed, live
// intervals, oscillator start/stop, and music-bus-connected playback gains
// across 3 Games + 50 level transitions + retries + simulated tab suspension.
import { test, expect, describe, afterAll } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";
import { Game } from "../../js/main.js";
import { Level } from "../../js/level.js";
import * as audio from "../../js/audio.js";

installGameTestScaffolding();

// --- instrumentation -------------------------------------------------------
let contextsCreated = 0;
let contextsClosed = 0;
let oscsStarted = 0;
let oscsStopped = 0;
let gainsCreated = 0;
const liveIntervals = new Map(); // id -> fn
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
// The shared happy-dom Window outlives this file: hand back the real timer
// functions when done, exactly like the scaffolding restores its globals.
afterAll(() => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
});
function tickIntervals(n = 1) {
    for (let i = 0; i < n; i++) for (const fn of [...liveIntervals.values()]) fn();
}

class Param {
    constructor(v = 0) { this.value = v; }
    _t(t) {
        if (!(t >= 0) || !Number.isFinite(t)) throw new RangeError("bad audio time: " + t);
        return t;
    }
    setValueAtTime(v, t) { this._t(t); this.value = v; return this; }
    linearRampToValueAtTime(v, t) { this._t(t); this.value = v; return this; }
    exponentialRampToValueAtTime(v, t) { this._t(t); this.value = v; return this; }
    cancelScheduledValues(t) { this._t(t); return this; }
}
class Node {
    constructor(ctx) { this.ctx = ctx; this.connected = []; this.disconnects = 0; }
    connect(dest) { this.connected.push(dest); return dest; }
    disconnect() { this.disconnects++; this.connected.length = 0; }
}
class GainNode extends Node { constructor(ctx) { super(ctx); this.gain = new Param(1); gainsCreated++; } }
class OscNode extends Node {
    constructor(ctx) {
        super(ctx);
        this.frequency = new Param(440);
        this.detune = new Param(0);
        this.type = "sine";
        this.started = false; this.stopped = false;
    }
    start(t) { if (t !== undefined) { if (!(t >= 0)) throw new RangeError("neg start"); } this.started = true; oscsStarted++; }
    stop(t) { if (t !== undefined) { if (!(t >= 0)) throw new RangeError("neg stop"); } this.stopped = true; oscsStopped++; }
}
class BiquadNode extends Node { constructor(ctx) { super(ctx); this.frequency = new Param(350); this.type = "lowpass"; } }
class DelayNode extends Node { constructor(ctx) { super(ctx); this.delayTime = new Param(0); } }
class BufSrcNode extends Node {
    constructor(ctx) { super(ctx); this.buffer = null; }
    start(t) { if (!(t >= 0)) throw new RangeError("neg start"); }
    stop(t) { if (!(t >= 0)) throw new RangeError("neg stop"); }
}
const createdCtxs = [];
class FakeCtx {
    constructor() {
        contextsCreated++;
        createdCtxs.push(this);
        this.currentTime = 0;
        this.sampleRate = 48000;
        this.state = "running";
        this.destination = new Node(this);
        this.closed = false;
    }
    createGain() { return new GainNode(this); }
    createOscillator() { return new OscNode(this); }
    createBiquadFilter() { return new BiquadNode(this); }
    createDelay() { return new DelayNode(this); }
    createBufferSource() { return new BufSrcNode(this); }
    createBuffer(ch, len, sr) {
        const data = new Float32Array(len);
        return { getChannelData: () => data };
    }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; this.state = "closed"; contextsClosed++; return Promise.resolve(); }
}
globalThis.AudioContext = FakeCtx;

function livePlaybackGains() {
    // playback gain nodes attached to musicBus: introspect via getState keys
    // plus a proxy count — simplest: count GainNodes whose connected target
    // is the musicBus. We track them through the module state indirectly:
    // musicKey tells us how many playbacks exist (0 or 1 by design).
    return audio.getState().musicKey ? 1 : 0;
}

describe("audio lifecycle under fake AudioContext", () => {
    afterAll(() => {
        globalThis.setInterval = realSetInterval;
        globalThis.clearInterval = realClearInterval;
        delete globalThis.AudioContext;
        audio.shutdown();
    });

    test("context boots lazily from startGame, one scheduler interval max", () => {
        mountFixture();
        const g = new Game();
        expect(contextsCreated).toBe(0); // constructor must NOT build a context
        expect(liveIntervals.size).toBe(0);
        g.startGame();
        expect(contextsCreated).toBe(1);
        expect(audio.getState().contextState).toBe("running");
        expect(liveIntervals.size).toBe(1);
        g.destroy();
        expect(contextsClosed).toBe(1);
        expect(liveIntervals.size).toBe(0);
    });

    test("retry keeps the same track (no restart); band change crossfades; 50 transitions leak nothing", async () => {
        mountFixture();
        const ctxBase = contextsCreated;
        const g = new Game();
        g.startGame(); // level 1, band 0
        const key1 = audio.getState().musicKey;
        const gainsBefore = gainsCreated;
        g.retryLevel(); // same level -> identical key -> NO new playback
        expect(audio.getState().musicKey).toBe(key1);
        // A crossfade-restart would build a fresh playback master gain; the
        // identical-key guard must prevent it entirely.
        expect(gainsCreated).toBe(gainsBefore);
        expect(contextsCreated).toBe(ctxBase + 1);

        // Walk 50 level publishes (band flips every level -> crossfade each time)
        for (let lvl = 2; lvl <= 51; lvl++) {
            g.publishLevel(new Level(lvl, 32, lvl * 7919));
            tickIntervals(2);   // let the scheduler emit some steps
        }
        // Exactly one scheduler interval may exist at any moment
        expect(liveIntervals.size).toBeLessThanOrEqual(1);
        expect(livePlaybackGains()).toBe(1);
        // Every oscillator ever started must have a scheduled stop
        expect(oscsStopped).toBe(oscsStarted);
        // Let retire timers (CROSSFADE+150ms) elapse, then tear down
        await Bun.sleep(1000);
        g.destroy();
        expect(contextsClosed).toBe(contextsCreated); // nothing left open
        expect(liveIntervals.size).toBe(0);
    });

    test("long tab suspension rebases instead of burst-scheduling", () => {
        mountFixture();
        const g = new Game();
        g.startGame();
        const ctx = createdCtxs[createdCtxs.length - 1];
        tickIntervals(3); // normal operation: cursor tracks ahead of now
        // Simulate a backgrounded tab: 30 s of audio-clock time passes with
        // zero scheduler ticks (setInterval fully throttled away).
        ctx.currentTime += 30;
        const before = oscsStarted;
        tickIntervals(1); // one resumed tick must NOT replay ~75 past notes
        const emitted = oscsStarted - before;
        expect(emitted).toBeLessThanOrEqual(4); // rebase: only lookahead-window notes
        // And nothing was scheduled in the past: no RangeError thrown by the
        // fake's negative-time guard means all `when` values were >= 0.
        g.destroy();
    });

    test("mute stops the scheduler entirely (no silent CPU burn)", async () => {
        mountFixture();
        const g = new Game();
        g.startGame();
        expect(liveIntervals.size).toBe(1);
        audio.setMuted(true);
        tickIntervals(1); // the running interval self-cancels on its next tick
        expect(liveIntervals.size).toBe(0);
        const before = oscsStarted;
        tickIntervals(5);
        expect(oscsStarted).toBe(before); // no nodes produced while muted
        audio.setMuted(false);
        expect(liveIntervals.size).toBe(1); // resumes
        g.destroy();
        expect(liveIntervals.size).toBe(0);
    });

    test("pause stops scheduler, resume restarts it; three full Game cycles stack nothing", async () => {
        for (let cycle = 1; cycle <= 3; cycle++) {
            mountFixture();
            const g = new Game();
            g.startGame();
            expect(liveIntervals.size).toBe(1);
            g.togglePause();
            tickIntervals(1);
            expect(liveIntervals.size).toBe(0); // ducked -> scheduler halted
            g.togglePause();
            expect(liveIntervals.size).toBe(1);
            g.destroy();
            expect(liveIntervals.size).toBe(0);
        }
        expect(contextsClosed).toBe(contextsCreated); // every cycle's context closed — no stacking
    });
});
