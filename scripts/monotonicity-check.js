// monotonicity-check.js — owner-visible MONOTONIC ADDITION guard.
//
// Replays every recorded witness in tests/reports/monotonicity-corpus.json
// through the CURRENT engine headlessly: happy-dom + the shipped Game class
// (same seam the integration tests use), synthetic KeyboardEvents dispatched
// before each fixed-dt (1/60) game.update() call, player teleported to the
// entry's staged standing cell pre-frame-0. Each frame hashes
// x,y,vx,vy,grounded + that frame's input edges into an FNV-1a accumulator
// (the established mono convention); a witness passes only when BOTH the
// trajectory hash AND the portal-touch win reproduce. Any physics, ordering
// or generation drift that moves a validated route turns this red — which is
// exactly when a human should look at it. Deliberately NOT wired into
// test:all: intentional future waves may legitimately evolve maps, so this
// is an owner-run command, not flaky CI. Run it after ANY change touching
// physics, player feel, enemies/projectiles, pads/crates/decks, or level
// generation.
//
// Usage (from repo root OR game/):   bun run mono
// Corpus regeneration lives OUTSIDE the repo (search scratch); regenerate
// the corpus deliberately when a wave intentionally changes trajectories.
import { Window } from 'happy-dom';

// --- Headless DOM (mirrors tests/setup/happy-dom-preload.js + setup.js) ----
const domWindow = new Window({ url: 'http://localhost/' });
globalThis.window = domWindow;
globalThis.document = domWindow.document;
for (const name of [
    'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
    'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia',
    'getComputedStyle', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement',
    'HTMLImageElement', 'Element', 'Node', 'Event', 'CustomEvent',
    'MouseEvent', 'KeyboardEvent', 'Image', 'Audio', 'Path2D', 'ImageData'
]) {
    if (name in domWindow) globalThis[name] = domWindow[name];
}
globalThis.requestAnimationFrame = () => {};
globalThis.cancelAnimationFrame = () => {};
HTMLCanvasElement.prototype.getContext = function () {
    return {
        fillStyle: null, strokeStyle: null, lineWidth: null,
        scale: () => {}, save: () => {}, restore: () => {}, translate: () => {},
        fillRect: () => {}, strokeRect: () => {}, beginPath: () => {}, arc: () => {},
        moveTo: () => {}, lineTo: () => {}, fill: () => {}, fillText: () => {},
        measureText: (text) => ({ width: String(text).length * 7 })
    };
};

// Engine imports resolve relative to THIS file — cwd-independent.
const HERE = import.meta.dirname;
const { destroyAllGames, Game, STATE } = await import(`${HERE}/../js/main.js`);

const DT = 1 / 60;
const FIXTURE = `
    <canvas id="game-canvas"></canvas>
    <button id="start-btn">Start</button>
    <button id="retry-btn">Retry</button>
    <button id="play-again-btn">Play Again</button>
    <button id="pause-btn" aria-label="Pause Game">Pause</button>
    <button id="mute-btn" aria-label="Toggle sound" aria-pressed="false">\u{1F50A}</button>
    <div id="pause-screen" class="overlay hidden">
        <h2>Game Paused</h2>
        <button id="resume-btn" aria-label="Resume Game">Resume Game</button>
        <button id="restart-level-btn" aria-label="Restart Level">Restart Level</button>
        <button id="quit-menu-btn" aria-label="Quit to Menu">Quit to Menu</button>
    </div>
    <div id="error-message" class="hidden" role="alert"></div>
    <p id="score-penalty" aria-live="polite" hidden></p>
    <p id="death-cause" hidden></p>
    <div id="final-score"></div>
    <p id="clear-bonus" aria-live="polite" hidden></p>
    <p id="enemies-bested" aria-live="polite" hidden></p>
    <p id="no-damage-bonus" aria-live="polite" hidden></p>
    <p id="secrets-found" aria-live="polite" hidden></p>
`;

function fnvMix(h, str) {
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

// One witness replay: returns { outcome, frames, hash }.
function replay(entry) {
    destroyAllGames();
    window.innerWidth = 800;
    window.innerHeight = 600;
    document.body.innerHTML = FIXTURE;
    const game = new Game();
    document.getElementById('start-btn').click();
    game.levelSeeds.set(entry.levelNumber, entry.seed);
    game.currentLevel = entry.levelNumber;
    game.startLevel();
    const p = game.player;
    p.x = entry.stage[0] * 32;
    p.y = entry.stage[1] * 32;
    const byFrame = new Map();
    for (const [f, code, kind] of entry.events) {
        if (!byFrame.has(f)) byFrame.set(f, []);
        byFrame.get(f).push([code, kind]);
    }
    const held = { ArrowLeft: false, ArrowRight: false };
    let h = 0x811c9dc5;
    let outcome = 'TIMEOUT';
    let f = 0;
    const maxFrames = entry.frames + 30;
    for (; f < maxFrames; f++) {
        let jumpDown = false, dashDown = false;
        for (const [code, kind] of byFrame.get(f) || []) {
            if (kind === 'down') {
                if (code === 'Space') jumpDown = true;
                if (code === 'KeyX') dashDown = true;
                if (code in held) held[code] = true;
                window.dispatchEvent(new KeyboardEvent('keydown', { code }));
            } else {
                if (code in held) held[code] = false;
                window.dispatchEvent(new KeyboardEvent('keyup', { code }));
            }
        }
        game.update(DT);
        h = fnvMix(h, `${p.x},${p.y},${p.vx},${p.vy},${p.grounded ? 1 : 0}|${held.ArrowLeft ? 1 : 0}${held.ArrowRight ? 1 : 0}${jumpDown ? 1 : 0}${dashDown ? 1 : 0};`);
        if (game.state === STATE.LEVEL_COMPLETE) { outcome = 'WIN'; f++; break; }
        if (game.state === STATE.GAME_OVER) {
            outcome = `DEAD:${document.getElementById('death-cause')?.textContent?.trim() || '?'}`;
            f++; break;
        }
        const pt = game.level && game.level.getPortal();
        if (pt && p.x < pt.x + pt.width && p.x + p.width > pt.x &&
            p.y < pt.y + pt.height && p.y + p.height > pt.y) {
            outcome = 'WIN'; f++; break;
        }
    }
    return { outcome, frames: f, hash: h.toString(16) };
}

const corpusPath = `${HERE}/../tests/reports/monotonicity-corpus.json`;
const corpus = await Bun.file(corpusPath).json();
if (corpus.format !== 'mono-corpus-v1') {
    console.error(`unsupported corpus format: ${corpus.format}`);
    process.exit(2);
}

console.log(`monotonicity check — ${corpus.entries.length} witnesses vs HEAD corpus ` +
    `(generated ${corpus.generatedAtHead})\n`);
const failures = [];
const rows = [];
for (const entry of corpus.entries) {
    const r = replay(entry);
    const ok = r.outcome === 'WIN' && r.hash === entry.hash;
    if (!ok) {
        failures.push({ entry, r });
    }
    rows.push(`L${String(entry.levelNumber).padStart(2)} t${entry.tier} seed=${String(entry.seed).padEnd(10)} ` +
        `${ok ? 'PASS' : 'FAIL'} frames=${String(r.frames).padStart(4)} hash=${r.hash}` +
        (ok ? '' : ` expected hash=${entry.hash} outcome=${entry.outcome}, got outcome=${r.outcome}`));
}
destroyAllGames();
console.log(rows.join('\n'));
if (failures.length) {
    console.error(`\nDIVERGED (${failures.length}/${corpus.entries.length}):`);
    for (const { entry, r } of failures) {
        console.error(`  L${entry.levelNumber} seed=${entry.seed}: expected ${entry.outcome} ` +
            `hash=${entry.hash} @${entry.frames}f, got ${r.outcome} hash=${r.hash} @${r.frames}f`);
    }
    console.error('\nA validated route moved. If this wave INTENTIONALLY changed');
    console.error('physics/generation, regenerate the corpus deliberately; otherwise fix.');
    process.exit(1);
}
console.log(`\nALL ${corpus.entries.length} WITNESSES PASS — monotonic addition intact.`);
