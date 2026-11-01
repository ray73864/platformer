// Shared integration-test scaffolding.
//
// The Game constructor touches real DOM nodes (#game-canvas, #start-btn,
// #retry-btn, #play-again-btn, #final-score) and a 2d canvas context before
// any state exists, so every integration file installs the same fixture.
// UI-owned ids self-heal via ensureElement; these five do not (see main.js
// bindEvents/handleGameOver).
//
// installGameTestScaffolding() registers an afterAll teardown that restores
// EVERY global it patches — getContext, requestAnimationFrame,
// cancelAnimationFrame — and empties document.body. Without the body reset,
// a leaked #game-canvas poisons later files sharing the one happy-dom Window
// (e.g. main.test.js's "does not auto-construct a Game" guard).
import { afterAll } from "bun:test";

// Captured at module evaluation, before any file patches anything, so two
// importing files can never restore a patched-over "original".
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realRequestAnimationFrame = globalThis.requestAnimationFrame;
const realCancelAnimationFrame = globalThis.cancelAnimationFrame;

export function installGameTestScaffolding() {
    globalThis.requestAnimationFrame = () => {};
    globalThis.cancelAnimationFrame = () => {};

    HTMLCanvasElement.prototype.getContext = function () {
        return {
            fillStyle: null,
            strokeStyle: null,
            lineWidth: null,
            scale: () => {},
            save: () => {},
            restore: () => {},
            translate: () => {},
            fillRect: () => {},
            strokeRect: () => {},
            beginPath: () => {},
            arc: () => {},
            // Spike drawing (Level.draw) strokes triangles via moveTo/lineTo;
            // without these the shared stub only satisfies Level 1's draw
            // path and any Phase-2 draw check would pass vacuously.
            moveTo: () => {},
            lineTo: () => {},
            fill: () => {}
        };
    };

    afterAll(() => {
        globalThis.requestAnimationFrame = realRequestAnimationFrame;
        globalThis.cancelAnimationFrame = realCancelAnimationFrame;
        HTMLCanvasElement.prototype.getContext = realGetContext;
        document.body.innerHTML = "";
    });
}

export function mountFixture() {
    window.innerWidth = 800;
    window.innerHeight = 600;
    document.body.innerHTML = `
        <canvas id="game-canvas"></canvas>
        <button id="start-btn">Start</button>
        <button id="retry-btn">Retry</button>
        <button id="play-again-btn">Play Again</button>
        <div id="final-score"></div>
    `;
}
