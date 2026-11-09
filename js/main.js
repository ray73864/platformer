import { InputHandler } from './input.js';
import { Physics } from './physics.js';
import { Player, wallContactSide } from './player.js';
import { Level } from './level.js';
import { Camera } from './camera.js';
import { UI } from './ui.js';
import { COIN_POINTS, SECRET_COIN_SCORE } from './collectibles.js';
import { Difficulty, tierIndexFor } from './difficulty.js';
import { Timer } from './timer.js';
import { Sprites, THEMES } from './sprites.js';
import { MovingPlatformManager, applyJumpBoost } from './movingplatforms.js';
import { LaunchPad, padUnderFeet, applyPadLaunch, drawPads, PAD_SQUASH_TIME } from './pads.js';
import { Crate, cratePushDirection, stepCrate, drawCrates, crateContainmentWalls } from './crates.js';
import { interestingnessScore } from './metrics.js';
import { spawnBurst, spawnDust, stepParticles, drawParticles, createMotes, stepMotes, drawMotes } from './particles.js';
import {
    FX, initFX, shakeOffset, punchScale, PUNCH_TIME,
    spawnPopup, stepPopups, drawPopups, spawnRing, stepRings, drawRings,
    spawnConfetti, stepConfetti, drawConfetti
} from './fx.js';
import {
    loadSettings, saveShake, saveReducedMotion, applySettings,
    resolveReducedMotion, osReducedMotion
} from './settings.js';
import * as audio from './audio.js';

// Game constants
export const TILE_SIZE = 32;

// Ambient drifting motes per level (dust/fireflies by theme). Deliberately
// far below MAX_MOTES: ambience should never read as noise.
// Ambient field size (look-A): 22 drifting motes plus, on maps tall enough
// to climb, 14 falling flecks — 36 live, under the hard MAX_MOTES cap of 40.
const MOTE_COUNT = 22;
const CLIMB_FLECKS = 14;
// Collection sparkle inherits the coin's own gold, sampled from tiles.png
// cell 151 (the dominant opaque hue) rather than an invented yellow.
const COIN_BURST_COLOR = '#f4b41b';

// Integer world zoom: on large displays the pixel art scales up to fill the
// viewport instead of sitting small in the top-left. Target ~540 CSS px of
// visible world height per zoom step (1080p -> 2x, 1440p+ -> 3x, laptops
// stay 1x so generation geometry stays legible).
export function computeZoom(viewportHeight) {
    return Math.max(1, Math.min(3, Math.round(viewportHeight / 540)));
}

// --- Per-run seed derivation (randomness wave 2026-11-05) --------------------
// Player report 2026-11-04: levels felt "partially repeated". Attribution
// (scratch sweep, 20 runs x 100 levels, /tmp/opencode/randomness): the OLD
// additive mix (runSeed + imul(L, K)) already produced decorrelated mulberry32
// streams (mean |draw correlation| between adjacent levels 0.040 — identical
// to fully independent seeds), BUT it is structurally fragile: addition only
// carries upward, so flipping bit 31 of runSeed flips ONLY bit 31 of the
// level seed, and any future mixing constant that landed near a small
// multiple of mulberry32's 0x6D2B79F5 step would turn adjacent-level streams
// into literal shifted copies of each other. A bijective avalanche finalizer
// (lowbias32, Chris Wellons) removes that whole class: every input bit reaches
// every output bit, and the (runSeed, level, candidate) triple still maps to
// exactly one seed forever — the retry contract is untouched.
function avalanche32(x) {
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
}

// Candidate chain for one level: index 0 is the primary seed, indices 1.. give
// deterministic ALTERNATIVES for the anti-repeat guard below. Pure function of
// (runSeed, levelNumber, index) — same triple, same seed, always.
export function seedCandidate(runSeed, levelNumber, index) {
    const base = avalanche32((runSeed + Math.imul(levelNumber, 0x9E3779B1)) >>> 0);
    return index === 0 ? base : avalanche32((base + Math.imul(index, 0x85EBCA6B)) >>> 0);
}

// Terrain silhouette fingerprint for the in-run anti-repeat guard: the EXPOSED
// surface cells (solid with air above) of the shipped grid. The full bitmap
// inflates every pair (heightmaps fill to the bottom); the surface is what the
// eye reads as "that level again". Spikes/markers/coins ride fairness passes
// on top and deliberately stay out of the signature.
export function layoutSignature(level) {
    const w = level.width, h = level.height;
    const surface = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            if (level.tiles[y][x] === 1 && (y === 0 || level.tiles[y - 1][x] !== 1)) {
                surface[y * w + x] = 1;
            }
        }
    }
    return { w, h, surface, dir: level.direction };
}

// Surface overlap between two signatures: IoU on matching dimensions (different
// dims read as dissimilar — the player sees a differently-shaped arena). A
// right-facing and a left-facing map are compared MIRRORED too and the worse
// (higher) overlap wins: a mirrored twin IS the same silhouette to the eye.
export function layoutSimilarity(a, b) {
    if (a.w !== b.w || a.h !== b.h) return 0;
    let inter = 0, uni = 0;
    for (let i = 0; i < a.surface.length; i++) {
        if (a.surface[i] | b.surface[i]) {
            uni++;
            if (a.surface[i] & b.surface[i]) inter++;
        }
    }
    let best = uni ? inter / uni : 1;
    if (a.dir !== b.dir && a.dir !== 'vertical' && b.dir !== 'vertical') {
        let mInter = 0, mUni = 0;
        for (let y = 0; y < a.h; y++) {
            for (let x = 0; x < a.w; x++) {
                const av = a.surface[y * a.w + x];
                const bv = b.surface[y * b.w + (b.w - 1 - x)];
                if (av | bv) { mUni++; if (av & bv) mInter++; }
            }
        }
        best = Math.max(best, mUni ? mInter / mUni : 1);
    }
    return best;
}

// Guard tuning, measured on the scratch harness (20 runs x 100 levels):
// worst-pair-per-run surface IoU fell 0.815 -> 0.496 mean (max 0.565) with
// 1.27 level constructions per published level and a 0.25% accept-the-best
// fallback rate. tau 0.6 leaves visible twins alive; 0.45 doubles the cost
// for +0.03. Six candidates bound the worst-case extra generations (each a
// few ms behind the LEVEL_COMPLETE transition screen).
const SEED_CANDIDATES = 6;
// R7 lazy-scan acceptance bar + continuation cap (controller ruling, Task 6
// follow-up). Candidates build SEQUENTIALLY in BASE chain order; the first
// guard-passer reaching the bar ships IMMEDIATELY. A sub-bar first passer at
// index f keeps the scan alive for indices < f + LAZY_SCAN_EXTRA — with the
// shipped EXTRA = 2 that is ONE extra construction (index f+1) — then the
// highest-scoring passer so far ships (ties -> earlier index) —
// prefer, never reject, zero new retry loops. Tuned by measurement over
// 1499 transitions x 6 candidates (Task 6 report R7 table): score output is
// BIMODAL (~0.47 low cluster, ~0.80 fork-rich cluster, empty between), so
// no bar delivers both the +0.5-builds target and meaningful upgrades;
// (0.49, extra=2) costs +0.59 mean candidate builds/transition (2.70 vs
// 2.12 incl publish) and upgrades 23% of levels above the first passer —
// both numbers disclosed as instructed.
export const INTERESTING_OK = 0.49;
const LAZY_SCAN_EXTRA = 2;
const LAYOUT_SIMILARITY_MAX = 0.5;


const GRAVITY = 980;
const PLAYER_SPEED = 200;
const JUMP_FORCE = 350;
const MAX_FALL_SPEED = 600;
// Upward velocity after squashing an enemy (stomp bounce): a bit under a
// full jump so chained stomps stay skillful.
const STOMP_BOUNCE = 260;
// The landing thud fires only on falls into contact at least this fast
// (px/s): stepping off a low ledge stays silent so the SFX marks genuine
// landings instead of spamming every ground transition (~h = v²/2g puts the
// threshold at a ~35 px drop).
const LANDING_SFX_MIN_FALL = 260;
// --- Wave B juice constants (render-only; every effect gated via js/fx.js) --
// Launch stretch / landing thud / skid + dust / impact punch + shake /
// popups / look-ahead magnitudes. None of these feed the simulation: they
// describe how the frozen physics READS, never what it does.
const LAUNCH_STRETCH_TIME = 0.14;   // s of tall-stretch after a jump launch
const STOMP_SHAKE_TIME = 0.12;
const STOMP_SHAKE_MAG = 4;          // px peak offset at trigger instant
const SHELL_SHAKE_TIME = 0.15;
const SHELL_SHAKE_MAG = 3;
const DEATH_SHAKE_TIME = 0.35;      // legacy value kept verbatim
const DEATH_SHAKE_MAG = 9;
const LAND_DEPTH_REF_VY = 520;      // px/s fall speed that reads as a FULL thud
const SKID_MIN_SPEED = 150;         // px/s pre-reversal speed for a skid puff
// Wall-slide dust cadence (M1): one small puff every interval while sliding.
// Timer-driven (fixed-dt deterministic) rather than position-event because a
// slide barely moves — tile-crossing would never fire.
const WALL_SLIDE_DUST_INTERVAL = 0.12;
// Cadence for the M3 crate push-dust puffs (same deterministic-clock rule).
const CRATE_PUSH_DUST_INTERVAL = 0.15;
// Cadence cap for the Wave D crate-push strain tick (very quiet scuff):
// one voice every interval while the push holds, never per frame.
const CRATE_PUSH_STRAIN_INTERVAL = 0.16;
// Dash streak ghosts (M2): how many hero silhouettes trail an active burst
// and how long each fades. FX.trails gates BOTH spawn and draw; reduced-
// motion keeps trails ON at half amplitude (fx.js gentle-family policy), so
// alpha rides FX.intensity rather than a new flag.
const DASH_GHOST_MAX = 6;
const DASH_GHOST_LIFE = 0.22;
const LEAN_MAX_RAD = 0.07;          // subtle travel-direction lean ceiling
const LOOKAHEAD_LEAD_S = 0.06;      // seconds of vx lead the offset eases toward
const LOOKAHEAD_MAX_PX = 10;        // hard clamp on the look-ahead render offset
const LOOKAHEAD_DEADZONE_VX = 30;   // below this |vx| the target is exactly zero
// Winning this level finishes the whole run instead of generating another.
// Exported so tests pin their final-level fixtures to the same number.
export const FINAL_LEVEL = 100;
const HIGH_SCORE_KEY = 'platformerHighScore';
// --- Wave C title-screen demo loop -------------------------------------------
// The MENU renders the real sky/hills/cloud parallax behind the title panel:
// a synthetic camera drifting at a gentle crawl with no Level constructed —
// the backdrop bakes once per theme and every later frame is pure blits.
// Themes cross-fade by cycling the band index every TITLE_THEME_SPAN px of
// scroll (~25 s each); repaints are throttled to ~30 fps because the canvas
// holds its last composition between frames anyway, which keeps the idle tab
// far under budget. Seeds are fixed constants: the same demo on every boot.
const TITLE_SCROLL_SPEED = 26;        // px/s of synthetic camera travel
const TITLE_THEME_SPAN = 650;         // px per theme band (~25 s)
const TITLE_FRAME_INTERVAL = 1 / 30;  // s between backdrop repaints
const TITLE_SEEDS = [0x5EED0001, 0x5EED0002, 0x5EED0003];
// Pause-menu arrow routing (R29): value is the cycle direction.
const PAUSE_MENU_ARROWS = { ArrowUp: false, ArrowLeft: false, ArrowDown: true, ArrowRight: true };
// Consecutive failing frames before the loop tries to recover by rebuilding
// the current level; a second window of that many after an attempt gives up
// to MENU (spec §General Error Handling: state recovery, without the R26
// per-frame console flood).
const LOOP_ERROR_RECOVERY_FRAMES = 30;
// Consecutive failed level-transition constructions before the LEVEL_COMPLETE
// retry gives up to MENU (S1). Each retry is a fresh randomised generation,
// so stalls self-heal within a few frames (I2 fix: 0/800 exhaustion at the
// worst tier); 120 in a row means the generator itself is broken, and
// rebuilding every frame forever would freeze the tab on up to 200
// generations+BFS per frame, silent after the first log line.
const LEVEL_TRANSITION_MAX_STALL_FRAMES = 120;

// Owner ruling (cause and effect): dying costs a slice of the run score, so
// staying alive has a very real value. Applied on ANY GAME_OVER — spikes,
// enemies, pit or timeout — exactly once inside handleGameOver. Coins stay
// collected (the retry contract is unchanged) and the clock refills; only
// the score shrinks. Never charged on level/game completion, and never on
// the pause menu's Restart Level (that shares restartCurrentLevel with the
// post-death retry, which must not double-charge). Tunable single point.
export const DEATH_SCORE_PENALTY_RATE = 0.25;

// Pure floor math, exported for unit tests: losing a fraction of the score
// must land on whole points (scores are integers by construction), rounded
// DOWN so the penalty is generous at the margin, and a zero (or corrupt)
// score stays zero.
export function deathScorePenalty(score) {
    if (!Number.isFinite(score) || score <= 0) return 0;
    return Math.floor(score * DEATH_SCORE_PENALTY_RATE);
}

// --- Score economy (owner ruling 2026-11-04) --------------------------------
// "You should get points for clearing a level successfully, reduced points
// for clearing a level with some issues. You should get points for killing
// enemies or dodging past them. I don't want to make it too easy to get
// points though." Baseline unit throughout: COIN_POINTS = 10 — coins stay
// the backbone income (every level demands ALL of them through the portal
// gate), so every award below is justified as a multiple of that coin.
//
// Full payout table (updated for M5 style rewards, Task 7):
//   normal coin              +10  COIN_POINTS          (popup '+N' gold)
//   secret coin              +25  SECRET_COIN_SCORE    (popup 'SECRET +N' grass)
//   walker stomp             +25  STOMP_POINTS         (popup '+N STOMP!' purple)
//   charger/bombardier kill  +40  CHARGER_STOMP_POINTS
//   dodge past               +5   DODGE_POINTS         (popup '+5' cream)
//   stomp chain (>=2 air)    +30  STOMP_CHAIN_BONUS    (popup '+30 CHAIN!' amber)
//   clear, any deaths        floor((100+10*tier)*0.4)  CLEAR_BONUS_REDUCED_RATE
//   clear, flawless          100 + 10*tier             CLEAR_BONUS_BASE/STEP
//   clear, no damage         +50  NO_DAMAGE_CLEAR_BONUS (same gate as flawless)
// Death cut unchanged: each death floors away DEATH_SCORE_PENALTY_RATE (25%)
// of the RUNNING TOTAL — per-total, not per-component — so every row above
// (secrets and chain included) shrinks identically once banked.
//
// Flawless clear bonus base: 10 coins' worth. Measured against generation
// (25-seed survey): extractCoins TARGETS min(5 + level, 30) but reachability/
// patrol/spike exclusions place ~6 coins at L1 and ~13 at L60, so real coin
// income runs ~60 early / ~135 late. A flawless L1 clear totals 160 ≈ 2.7×
// its coin income (no enemies exist below level 5, so the bonus carries the
// whole "clearing well" reward there); a flawless L60 pays 140 on ~135 coins
// (≈ 1.0× bonus-only, ≈ 2.0× total before combat, ≈ 2.8× with realistic
// stomps/dodges stacked on top). Kept deliberately in the same order of
// magnitude as one level's coins — big enough to matter, small enough that
// farming clears cannot outrun playing well.
export const CLEAR_BONUS_BASE = 100;
// One extra coin per tier boundary crossed (difficulty.js TIER_BOUNDARIES):
// legend-level flawless clears pay 150. Mild on purpose — tier difficulty
// already pays out through more/larger coin targets and enemy counts.
export const CLEAR_BONUS_TIER_STEP = 10;
// "Reduced points for clearing a level with some issues": any death on the
// level attempt series drops the bonus to 40% (floored). At L60 that is 56
// against a flawless 140 — finishing-after-dying stays worthwhile, but the
// three compounding 25% penalties (~77 on a realistic ~135-coin bank) plus
// the forfeited 84-point gap to the flawless bonus keep a careless run far
// behind a clean one (measured: ~113 vs ~382 end-of-level totals).
export const CLEAR_BONUS_REDUCED_RATE = 0.4;
// Stomp kill: 2.5 coins for a skill check with a real miss-death ("not too
// easy": a perfect-stomp run earns faster than a coin sweep, a sloppy one
// dies and pays the 25% penalty instead). Bats do not exist as a kind —
// enemies.js ships walker|spiny|charger only — so this value covers walkers.
export const STOMP_POINTS = 25;
// Charger stomp: +15 over a walker as the explicit mid-dash risk premium —
// timing a stomp on a body moving 2.2x patrol speed is the hardest combat
// read in the game (enemies.js KINDS contract).
export const CHARGER_STOMP_POINTS = 40;
// Dodging past a live enemy: half a coin, once per enemy per level attempt
// (per-enemy `dodged` flag, fresh with each rebuilt Level). Cheap enough to
// be a thank-you for crossing safely, small enough that weaving along a
// patrol line farming flips cannot rival collecting the coins the portal
// actually demands.
export const DODGE_POINTS = 5;
// Continuity guard for the centre-cross dodge rule (see the dodge pass in
// Game.update): the largest per-frame relative position step a REAL crossing
// can produce. Worst case = player full speed (200) + ridden-deck carry
// (~44 max, MP_SPEED_MIN+RANGE in level.js) + charger closing dash (~88) against the dt
// cap of 0.05 s ≈ 17 px; 40 leaves generous margin. Anything larger is a
// teleport (E2E debug seams, future warp mechanics) — re-baseline the
// tracker WITHOUT paying, so a seam drop across an enemy's centre line can
// never mint free points.
const DODGE_MAX_CROSS_STEP = 40;

// --- M5 style rewards (SPEC §M5, capability program Task 7) ------------------
// No-damage clear bonus: +50 on top of clearBonusFor whenever this level's
// attempt series took ZERO deaths. Damage-model finding (Task 7): every
// deadly contact in this game — enemy body, spiny back, cannonball, spike,
// pit — is INSTANT DEATH routed through handleGameOver, which is also the
// only writer of deathsOnCurrentLevel. So "no damage taken" has exactly one
// real meaning: cleared without dying on any attempt of this level (it also
// covers timeout deaths, which share the handler — documented honestly).
// The condition therefore co-fires 1:1 with clearBonusFor's flawless tier;
// it is shipped as its own component per spec so a future HP model can
// decouple them without touching the payout site.
export const NO_DAMAGE_CLEAR_BONUS = 50;
// Pure guard mirroring clearBonusFor's conservative style: only the exact
// integer 0 counts as no-damage; corrupt state never mints the bonus.
export function noDamageBonusFor(deathsOnThisLevel) {
    return deathsOnThisLevel === 0 ? NO_DAMAGE_CLEAR_BONUS : 0;
}
// Stomp-chain bonus: two or more stomps WITHOUT touching ground in between
// pays a flat +30 once per chain (not escalating, not per extra step — owner
// spec pins it flat). The chain counter lives on Game (stompChain), counts
// kills from resolvePlayerContact's per-tick list (a simultaneous multi-kill
// frame counts every kill in it), and resets whenever the player is grounded.
// A chain that reaches 3+ pays exactly one bonus (_chainBonusPaid latch,
// cleared with the counter on landing).
export const STOMP_CHAIN_BONUS = 30;
export const STOMP_CHAIN_MIN = 2;

// Pure clear-bonus math, exported for unit tests (guard style mirrors
// deathScorePenalty: never throws, always returns whole points). Full bonus
// only for exactly zero deaths on this level's attempt series; anything
// else — ≥1 death, negative, fractional, NaN — reads as "some issues" and
// takes the reduced rate, so corrupt state can never hand out flawless
// points. Invalid level numbers fall back to the basic-tier base (mirrors
// difficulty.configFor's silent-for-economy-callers fallback).
export function clearBonusFor(deathsOnThisLevel, levelNumber) {
    const base = CLEAR_BONUS_BASE +
        CLEAR_BONUS_TIER_STEP * tierIndexFor(levelNumber);
    const flawless = deathsOnThisLevel === 0;
    return flawless ? base : Math.floor(base * CLEAR_BONUS_REDUCED_RATE);
}

// Theme dust tint (Wave B): the raw theme.dust hue sits too close to the
// dirt/AO tones it spawns against to read as motion. Mixing it halfway to a
// warm cream keeps the theme's earthy hue (day tan → pale sand, dusk amber →
// glow-sand, jungle moss → pale lichen) while silhouetting against the
// AO-darkened deck line where the puffs land.
function dustTint(theme) {
    const hex = theme.dust;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const mix = (c, t) => Math.round(c + (t - c) * 0.5);
    return `rgb(${mix(r, 255)},${mix(g, 246)},${mix(b, 222)})`;
}

// Every live Game, so test scaffolding sharing one window can tear down all
// window listeners at once (see destroy()/destroyAllGames).
const liveGames = new Set();

// Detach every constructed Game's listeners. Test seam for harnesses that
// build many Games against one shared window: a stale Game's Escape handler
// would otherwise drive togglePause() and rewrite overlay nodes belonging to
// the current fixture.
export function destroyAllGames() {
    for (const game of liveGames) game.destroy();
    liveGames.clear();
}

// Game states
export const STATE = {
    MENU: 'MENU',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    GAME_OVER: 'GAME_OVER',
    LEVEL_COMPLETE: 'LEVEL_COMPLETE',
    GAME_COMPLETE: 'GAME_COMPLETE'
};

export class Game {
    constructor() {
        // Game-owned structural nodes must exist: fail loudly rather than
        // fabricating invisible stand-ins (UI.ensureElement self-healing is
        // for UI display elements only).
        this.canvas = document.getElementById('game-canvas');
        if (!this.canvas) {
            throw new Error('Game requires a #game-canvas element in the page');
        }
        this.ctx = this.canvas.getContext('2d');

        // Wave C celebration layer: a transparent full-viewport canvas ABOVE
        // the DOM overlays (confetti has to read over the GAME_COMPLETE
        // scrim). Optional node — test fixtures without it stay inert.
        this.fxCanvas = document.getElementById('celebration-canvas');
        this.fxCtx = this.fxCanvas ? this.fxCanvas.getContext('2d') : null;
        this.confetti = [];           // pooled victory burst (fx.js cap)
        this._fxCanvasDirty = false;  // needs one clear after the last frame

        // Single abort controller for every window listener this Game adds;
        // destroy() detaches them all at once.
        this._abort = new AbortController();

        // Set canvas size for high-DPI displays
        this.resize();
        window.addEventListener('resize', () => this.resize(), { signal: this._abort.signal });

        // Initialize systems
        this.input = new InputHandler();
        this.physics = new Physics(GRAVITY, MAX_FALL_SPEED);
        // Integer world zoom so pixel art fills large screens instead of
        // hugging the top-left corner; the camera viewport is measured in
        // zoomed world units (CSS pixels / zoom), not device pixels.
        this.zoom = computeZoom(window.innerHeight);
        this.camera = new Camera(window.innerWidth / this.zoom, window.innerHeight / this.zoom);
        this.ui = new UI();
        // MENU baseline: with no run in progress the HUD has nothing to show,
        // and hiding it also takes #pause-btn out of the tab order on a fresh
        // load (startGame's publishLevel re-enables it).
        this.ui.hideHUD();
        this.ui.setPauseEnabled(false);
        // Sound chip reflects the persisted preference at boot. Reading it is
        // pure localStorage — the AudioContext itself waits for the first
        // gesture (startGame -> publishLevel -> audio.init()).
        audio.loadMutedPreference();
        this.ui.setMuteLabel(audio.isMuted());
        // Debug seam for E2E audio assertions (getState() is read-only;
        // same spirit as window.game in init()).
        this.audio = audio;
        // Wave C companion seam: the LIVE FX singleton as the bundle sees it
        // (a raw `import('/js/fx.js')` from the page would load a second
        // module instance next to the IIFE bundle and read the wrong copy).
        this.fx = FX;
        // One run clock for the whole game: time carries over between levels
        // because nothing resets it mid-run (startGame() and retryLevel()
        // deliberately re-arm it; level transitions never do). Whether it
        // ticks at all is decided per level by the difficulty tier in
        // publishLevel().
        this.difficulty = new Difficulty();
        this.timer = new Timer(60);
        this.timerActive = false;

        // Sprite layer (Kenney CC0 sheets). Never blocks: draws fall back to
        // flat shapes until (and unless) every sheet has loaded.
        this.sprites = new Sprites();
        // Game-feel state: coin/death sparks, death screen-shake, landing
        // squash. All visual-only — physics and hitboxes are untouched.
        this.particles = [];
        // Ambient motes: rebuilt per level instance, stepped every frame in
        // screen space (visual-only, like the bursts above).
        this.motes = [];
        this._motesSource = null;
        this.shakeTime = 0;
        this.squashTimer = 0;
        this._prevGrounded = true;
        // Tile index the last walking-dust puff fired on (see update()):
        // position-event driven so puffs are deterministic, never RNG.
        this._dustTx = -1;
        // Wall-slide dust cadence timer (M1); reset with every other dust
        // bookkeeping so retries never inherit a mid-puff phase.
        this._slideDustT = 0;
        // Wave D SFX edge trackers: last frame's slide side (slide-START
        // tick) and the crate-strain scuff cadence. Both reset per level.
        this._prevSliding = 0;
        this._crateStrainT = 0;
        // Portal-gate edge tracker for the unlock chime: seeded from the
        // level's current state in publishLevel so a retry that starts with
        // every coin already banked does not re-ring.
        this._portalUnlocked = false;

        // --- Wave B juice state (visual-only; js/fx.js gates every effect) --
        // One-shot reduced-motion boot BEFORE anything can read FX.
        initFX();
        // Wave C: persisted user settings layer OVER the OS default that
        // initFX just applied (precedence: explicit setting > media query —
        // see js/settings.js header). Re-applying per construction is safe:
        // loadSettings is pure storage and applySettings restores exact FX
        // defaults before narrowing them.
        this.settings = loadSettings();
        applySettings(this.settings);
        this.syncSettingsUI();
        // Title-demo parallax state (MENU only; see TITLE_* constants).
        this._titleScroll = 0;
        this._titleFrameAcc = TITLE_FRAME_INTERVAL;  // paint frame one
        this._titleDirty = true;
        // Settings overlay bookkeeping (an overlay, not a game STATE — the
        // six-state machine contract is pinned by tests).
        this.settingsOpen = false;
        this.settingsReturn = 'menu';
        this.dust = [];          // gameplay-dust pool (own cap, never shares
                                 // the burst list or the ambient mote field)
        this.popups = [];        // floating score popups (screen space)
        this.rings = [];         // portal-unlock ring pulses (world space)
        this.shakeMag = 0;       // amplitude of the active shake source
        this.shakeDur = 0;       // envelope reference for the active shake
        this._punchTime = 0;     // counts down from PUNCH_TIME on impacts
        this._launchStretch = 0; // counts down from LAUNCH_STRETCH_TIME
        this._landDepth = 0;     // 0..1 magnitude of the current landing thud
        this._prevFrameVx = 0;   // end-of-frame vx snapshot (skid + lean input)
        this._dashGhosts = [];   // dash-streak snapshots (M2, FX.trails family)
        this._lean = 0;          // smoothed draw-time lean angle (rad)
        this._lookAhead = 0;     // smoothed camera render-offset (px, clamped)

        // Game state
        this.state = STATE.MENU;
        this.level = null;
        // Fresh per-run seed for deterministic level layouts (see seedFor);
        // startGame re-rolls it for each new run.
        this.runSeed = 1;
        // Per-run anti-repeat state (randomness wave 2026-11-05): the seed
        // actually chosen for each level of THIS run (retry and loop recovery
        // read these instead of re-selecting, so the retry contract replays
        // the exact died-on map), and the terrain signatures of every level
        // accepted so far, newest last. Both reset in startGame — a new run
        // has no memory of the last one.
        this.levelSeeds = new Map();
        this.recentLayouts = [];
        this.player = null;
        // Per-level element systems: assigned from the Level's getters in
        // startLevel(), null until a level exists (MENU stays safe because
        // update() only touches them inside the PLAYING branch).
        this.enemyManager = null;
        this.collectibles = null;
        this.hazards = null;
        // Bombardier cannonballs for the published level (per-Level manager
        // from level.getProjectileManager(); pause-freeze comes for free —
        // updateAll only runs inside the PLAYING branch).
        this.projectiles = null;
        // Deck bridges for the published level (fresh manager per
        // publishLevel from level.getMovingPlatforms(); pause freezes them
        // because they only advance inside the PLAYING branch). On bridge
        // maps the deck CARRIES the route across an unjumpable gap — the
        // one-way physics below still means a deck can never block, push or
        // bonk anyone who is not landing on it.
        this.movingPlatforms = null;
        // Deck the player rode at the end of the last resolved frame (carry
        // + jump-off inheritance source); null whenever not landed on one.
        this._riding = null;
        // M3 capability objects for the published level: static pads (list
        // of LaunchPad) and at most ONE pushable crate. Rebuilt fresh per
        // publishLevel from the level's descriptors, so a retry replays
        // identical kinematics (the crate carries no cross-attempt state).
        this.pads = [];
        this.crate = null;
        this._crateWalls = [];
        this._crateDustT = 0;
        this.score = 0;
        // Score at the moment the current level started; retryLevel() rolls
        // back to it so repeated retries of a regenerated level cannot farm
        // coins.
        this.levelStartScore = 0;
        // --- Per-level economy trackers (owner ruling 2026-11-04) ----------
        // Deaths on THIS level's attempt series: incremented in handleGameOver,
        // reset ONLY on run start and on advancing to the NEXT level — never
        // on a retry (retrying IS the "issues" signal feeding clearBonusFor).
        this.deathsOnCurrentLevel = 0;
        // Coin/combat points scored through the loop on this level's attempt
        // series (banked across retries: coins collected before a death were
        // still earned on this level). Deliberately NOT reset in publishLevel
        // — that also runs on every retry — only via resetLevelEconomyTrackers().
        this.levelCoinPoints = 0;
        this.levelCombatPoints = 0;
        this.levelEnemiesKilled = 0;
        this.levelEnemiesDodged = 0;
        // M5 stomp-chain tracker: consecutive enemy kills accumulated while
        // airborne; reset to 0 (with the paid latch) on any grounded frame
        // and on every publishLevel (a retry starts fresh at spawn). Not a
        // per-level economy accumulator — it must NOT survive a retry, so it
        // deliberately lives outside resetLevelEconomyTrackers().
        this.stompChain = 0;
        this._chainBonusPaid = false;
        // M5 run-stats: secrets banked through the loop across the WHOLE run
        // (session-only by design — nothing here touches localStorage; future
        // Wave C screens read it live). Incremented only by the scoring loop,
        // never by seam collectCoin() calls, mirroring levelCoinPoints'
        // "loop-scored only" doctrine. Reset on run start.
        this.runSecretsFound = 0;
        // Breakdown handed to the LEVEL_COMPLETE overlay by handleWin
        // {coins, combat, clearBonus, noDamageBonus, enemiesBested, deaths,
        //  flawless, secretsFound, secretsTotal}.
        this.lastClearBreakdown = null;
        this.currentLevel = 1;
        this.lastTime = 0;
        this.levelCompleteTimer = 0;
        // Loop-error recovery episode state (see _handleLoopError).
        this._loopErrorStreak = 0;
        this._recoveryAttempted = false;

        // Register before binding: bindEvents throws on missing buttons, and
        // an unregistered half-constructed Game would keep its resize and
        // InputHandler window listeners out of destroyAllGames' reach.
        liveGames.add(this);
        this.bindEvents();

        // Start game loop
        requestAnimationFrame((time) => this.loop(time));
    }

    // Detach this Game's window listeners (resize, Escape, and everything
    // InputHandler registered). After destroy() the instance is inert: the
    // loop stops re-scheduling itself.
    destroy() {
        liveGames.delete(this);
        this._destroyed = true;
        this._abort.abort();
        this.input.destroy();
        // A pending coalesced announcement must not outlive the game whose
        // HUD it writes into (review nit).
        this.ui.destroyAnnouncements();
        // The audio singleton is shared across Games (test harnesses build
        // many): tear it down fully so a later Game's init() rebuilds clean.
        audio.shutdown();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        // Backing store in device pixels, CSS size in CSS pixels: ctx is
        // scaled by dpr below, so a CSS-pixel backing store would magnify
        // the frame and clip everything past the top-left quarter.
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        // Assigning canvas.width resets the 2D context transform, which is
        // why scale() must be re-applied after every resize and does not
        // stack across resizes.
        this.ctx.scale(dpr, dpr);
        // Nearest-neighbour scaling for the pixel-art sheets (and crisp
        // fallback shapes): bilinear filtering would smear 18px tiles.
        this.ctx.imageSmoothingEnabled = false;

        // The camera works in zoomed world units; keep its viewport current
        // so the follow/clamp math matches the resized window. Guard for the
        // first call from the constructor, before this.camera exists.
        if (this.camera) {
            this.zoom = computeZoom(window.innerHeight);
            this.camera.width = window.innerWidth / this.zoom;
            this.camera.height = window.innerHeight / this.zoom;
        }

        // Celebration canvas: same CSS box and DPR scale as the main canvas
        // (confetti coordinates are screen-space CSS pixels). Re-assigning
        // width/height resets its transform too — see the note above.
        if (this.fxCanvas && this.fxCtx) {
            this.fxCanvas.width = window.innerWidth * dpr;
            this.fxCanvas.height = window.innerHeight * dpr;
            this.fxCanvas.style.width = window.innerWidth + 'px';
            this.fxCanvas.style.height = window.innerHeight + 'px';
            this.fxCtx.scale(dpr, dpr);
        }
        // Resizing blanks every canvas backing store; the MENU demo must
        // repaint its still composition even under reduced motion (update()
        // turns this into exactly one dirty frame).
        if (this.state === STATE.MENU) this._titlePainted = false;
    }

    bindEvents() {
        // Button listeners (Game-owned: required, see constructor note).
        const startBtn = document.getElementById('start-btn');
        const retryBtn = document.getElementById('retry-btn');
        const playAgainBtn = document.getElementById('play-again-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const muteBtn = document.getElementById('mute-btn');
        const resumeBtn = document.getElementById('resume-btn');
        const restartLevelBtn = document.getElementById('restart-level-btn');
        const quitMenuBtn = document.getElementById('quit-menu-btn');
        if (!startBtn || !retryBtn || !playAgainBtn || !pauseBtn || !muteBtn ||
            !resumeBtn || !restartLevelBtn || !quitMenuBtn) {
            throw new Error('Game requires #start-btn, #retry-btn, #play-again-btn, ' +
                '#pause-btn, #mute-btn, #resume-btn, #restart-level-btn and ' +
                '#quit-menu-btn elements in the page');
        }
        // Every listener carries the abort signal (S2): destroy()'s contract
        // is "instance is inert", and a click landing after teardown would
        // otherwise resurrect state on a game whose loop no longer runs.
        const onClick = (el, fn) =>
            el.addEventListener('click', fn, { signal: this._abort.signal });
        onClick(startBtn, () => this.startGame());
        onClick(retryBtn, () => this.retryLevel());
        onClick(playAgainBtn, () => {
            // Only close the complete screen when a new run actually started:
            // on generation failure startGame keeps its state, and the player
            // needs this screen (and its button) to try again.
            if (this.startGame()) this.ui.hideOverlay('game-complete-screen');
        });
        // Spec §Accessibility: pause/resume must be keyboard-operable with a
        // toggling accessible name, not Escape-only. A native button gives
        // Tab/Enter for free; togglePause keeps the label in sync however the
        // pause was entered. blur() matters: a focused <button> activates on
        // Space at keyup, so after a mouse click every later Space press would
        // strobe PAUSED↔PLAYING (input.js suppresses the jump half while a
        // button holds focus, but gameplay must not silently lose it either).
        onClick(pauseBtn, () => {
            this.togglePause();
            pauseBtn.blur();
        });
        // Sound toggle mirrors the M key (see bindEvents' keydown listener);
        // blur() for the same focused-button-eats-Space reason as pauseBtn.
        onClick(muteBtn, () => {
            this.toggleSound();
            muteBtn.blur();
        });

        // Pause menu options (R29). Each click came from either a real click
        // or native Enter/Space activation of the focused option; blur in
        // every handler so focus never lingers on the overlay it just closed.
        onClick(resumeBtn, () => {
            this.togglePause();
            resumeBtn.blur();
        });
        onClick(restartLevelBtn, () => {
            this.restartCurrentLevel('pause-screen');
            restartLevelBtn.blur();
        });
        onClick(quitMenuBtn, () => {
            this.quitToMenu();
            quitMenuBtn.blur();
        });

        // Wave C settings entries. Every node here is OPTIONAL by contract:
        // integration fixtures mount only the core buttons (bindEvents above
        // throws on those), while index.html ships the full screen. A missing
        // node simply means no entry point in that harness.
        const optionalClick = (id, fn) => {
            const el = document.getElementById(id);
            if (el) onClick(el, fn);
        };
        optionalClick('menu-settings-btn', () => this.openSettings('menu'));
        optionalClick('pause-settings-btn', () => {
            // Leave the pause menu's focus contract clean before layering
            // settings over it (a focused pause button would eat Space).
            this.ui.blurPauseControls();
            this.openSettings('pause');
        });
        optionalClick('settings-back-btn', () => this.closeSettings());
        optionalClick('sound-toggle-btn', () => {
            // Same path as M / the HUD chip: audio.setMuted persists under
            // its established 'platformerMuted' key (single writer).
            this.toggleSound();
        });
        optionalClick('shake-toggle-btn', () => {
            this.settings.shake = !this.settings.shake;
            saveShake(this.settings.shake);
            applySettings(this.settings);
            this.syncSettingsUI();
        });
        optionalClick('motion-toggle-btn', () => {
            // Two-state control over a tri-state store: the switch mirrors
            // the EFFECTIVE state, and any press pins an explicit override
            // opposite to it ('on' forces reduced, 'off' forces full even
            // against an OS reduce preference — the documented precedence).
            const reducedNow = resolveReducedMotion(
                this.settings.reducedMotion, osReducedMotion());
            this.settings.reducedMotion = reducedNow ? 'off' : 'on';
            saveReducedMotion(this.settings.reducedMotion);
            applySettings(this.settings);
            this.syncSettingsUI();
        });

        // Input listener. Every jump press routes through Player.pressJump():
        // immediate while grounded or inside the guarded coyote window,
        // buffered otherwise (see player.js). The initial-press filter lives
        // in InputHandler (wasDown captured before keys.add), so autorepeat
        // keydowns neither re-jump nor refresh the buffer.
        // All closures gate on PLAYING: PAUSED freezes physics, and these are
        // mutation paths that bypass update()'s state gate — a Space press
        // during pause must not launch the player on resume.
        this.input.onJump(() => {
            if (this.state !== STATE.PLAYING || !this.player) return;
            // Blip only on a real launch: pressJump() sets vy synchronously
            // when grounded/coyote fires, while a buffered press leaves it
            // alone — no phantom jump sound for inputs that did not jump.
            const vyBefore = this.player.vy;
            const lockBefore = this.player.wallLockTimer;
            const wallBefore = this.player.wallSide;
            this.player.pressJump();
            if (this.player.vy < vyBefore) {
                audio.playSfx(audio.SFX_VOICES.JUMP);
                // Wall jump (M1): the lock timer's rising edge identifies
                // it uniquely (only pressJump's wall branch arms it). Skid
                // puff at the abandoned wall face, spray biased back toward
                // it like a ground-reversal skid. Presentation-only, FX.dust
                // gated; the mechanic itself never reads any FX flag.
                if (this.player.wallLockTimer > 0 && lockBefore <= 0 &&
                    wallBefore !== 0 && FX.dust) {
                    const wTheme = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
                    spawnDust(this.dust,
                        wallBefore === -1 ? this.player.x : this.player.x + this.player.width,
                        this.player.y + this.player.height / 2,
                        dustTint(wTheme),
                        { count: 5, dir: -Math.sign(this.player.vx), speed: 1.3,
                            alpha: 0.65, life: 0.3, size: 4 });
                }
                // Jump-off inheritance (feel choice): launching from a ridden
                // deck adds the deck velocity, capped (see applyJumpBoost).
                // Bridge decks move 26-44 px/s, far under the cap and too
                // slow to gate a jump puzzle — the boost only ever smooths
                // the step off a dwelling plank.
                applyJumpBoost(this.player, this._riding);
            }
        });
        // Variable jump height: releasing Space mid-rise shortens the hop
        // (once per jump). Gated on PLAYING like pressJump: PAUSED freezes
        // physics, so a keyup during pause must not mutate the frozen arc —
        // the cut flag stays pending and applies to the next rising frame
        // after resume, exactly like every other input path here.
        this.input.onReleaseJump(() => {
            if (this.state !== STATE.PLAYING || !this.player) return;
            this.player.releaseJump();
        });
        // Dash (M2): KeyX primary / KeyC alias, autorepeat-filtered upstream
        // in InputHandler exactly like the jump key. PLAYING-gated like every
        // other mutation path: a press during pause must not fire on resume.
        // Dust puff at the trailing edge marks the launch (FX.dust spawn gate,
        // same family as the wall-jump skid); the mechanic itself never reads
        // an FX flag. Rejected presses (cooldown / arc spent / mid-burst)
        // return false and stay silent.
        this.input.onDash(() => {
            if (this.state !== STATE.PLAYING || !this.player) return;
            if (!this.player.pressDash()) return;
            // Wave D whoosh on accepted launches only — rejected presses
            // (cooldown / arc spent) stay silent exactly like the dust below.
            audio.playSfx(audio.SFX_VOICES.DASH);
            if (FX.dust) {
                const dTheme = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
                spawnDust(this.dust,
                    this.player.dashDir === -1
                        ? this.player.x + this.player.width : this.player.x,
                    this.player.y + this.player.height / 2,
                    dustTint(dTheme),
                    { count: 4, dir: -this.player.dashDir, speed: 1.3,
                        alpha: 0.6, life: 0.3, size: 4 });
            }
        });
        const moveIfPlaying = (fn) => () => {
            if (this.state === STATE.PLAYING) fn();
        };
        // Shift walks: the cap applies only while grounded (Player enforces),
        // so airborne direction keys keep full speed and committed arcs.
        this.input.onMoveLeft(moveIfPlaying(() => this.player?.moveLeft(this.input.isWalk())));
        this.input.onMoveRight(moveIfPlaying(() => this.player?.moveRight(this.input.isWalk())));
        this.input.onReleaseLeft(() => this.player?.stopLeft());
        this.input.onReleaseRight(() => this.player?.stopRight());

        // Escape owns pause/end-screen navigation; InputHandler never fires
        // game actions for it. Check `key` too: some harnesses deliver raw key
        // events with an empty `code` (see input.js resolveCode). Filter OS
        // autorepeat like InputHandler does for its own keys: holding Escape
        // would otherwise strobe PAUSED↔PLAYING and bleed the run clock on
        // frames landing in PLAYING. End-screen navigation lives here and NOT
        // in togglePause: it is an Escape affordance, not a pause-button one
        // (the button is disabled in those states; see setPauseEnabled).
        // While PAUSED, arrow keys cycle the pause menu selection (R29) —
        // never the player: movement callbacks stay PLAYING-gated, so this is
        // the only arrow behavior outside PLAYING. Autorepeat cycles while
        // held, which menus expect; preventDefault stops page scroll.
        window.addEventListener('keydown', (e) => {
            const code = e.code || e.key;
            if (this.settingsOpen && code === 'Tab') {
                // WCAG 2.4.3 focus containment (review fix): while the dialog
                // is open, Tab cycles ONLY its controls. inert on the
                // backdrops covers real browsers; this explicit trap makes
                // containment harness-independent (happy-dom ships no inert)
                // and gives Shift+Tab a defined wrap either way.
                e.preventDefault();
                this.ui.cycleSettingsFocus(!e.shiftKey);
            } else if (code === 'Escape' && !e.repeat) {
                // Settings is a layer, not a state: Escape unwinds it first
                // (back to pause/menu), never pausing the run behind it or
                // navigating away from an end screen while it's open.
                if (this.settingsOpen) {
                    this.closeSettings();
                } else if (this.state === STATE.GAME_OVER ||
                    this.state === STATE.GAME_COMPLETE) {
                    this.returnToMenu();
                } else {
                    this.togglePause();
                }
            } else if (!e.repeat && (code === 'KeyM' || code === 'm' || code === 'M')) {
                // Global sound mute. Autorepeat ignored like every other
                // edge-triggered binding here; KeyM collides with nothing
                // (gameplay keys are arrows/WASD/Space/Shift, pause nav is
                // Escape+arrows). Bare m/M accepted for harnesses that
                // deliver key-only events (see resolveCode in input.js).
                this.toggleSound();
            } else if (this.state === STATE.PAUSED &&
                !this.settingsOpen && code in PAUSE_MENU_ARROWS) {
                e.preventDefault();
                this.ui.cyclePauseFocus(PAUSE_MENU_ARROWS[code]);
            }
        }, { signal: this._abort.signal });

        this._bindTouchControls();
    }

    // Wave D touch controls: on-screen dpad + jump/dash for coarse pointers.
    // Visibility is belt-and-braces: CSS shows #touch-controls ONLY inside a
    // (pointer: coarse) media query AND with the .enabled class this gate
    // adds — the class doubles as the happy-dom test seam (no stylesheet
    // evaluation there), the query covers JS-less and mismatched cases.
    // Buttons drive InputHandler.touchPress/touchRelease — the same logical
    // paths the keyboard feeds (autorepeat-filtered press, release callbacks,
    // PLAYING gates live in the existing callbacks) — never synthesized
    // KeyboardEvents. All nodes optional: integration fixtures without them
    // simply get no pad. Multi-touch works because every button tracks its
    // own pointerId; capture keeps the release on the button when the finger
    // slides off.
    _bindTouchControls() {
        const root = document.getElementById('touch-controls');
        if (!root) return;
        let coarse;
        try {
            coarse = !!(window.matchMedia &&
                window.matchMedia('(pointer: coarse)').matches);
        } catch {
            coarse = false; // hostile/absent matchMedia: stay desktop-clean
        }
        if (coarse) root.classList.add('enabled');
        const signal = this._abort.signal;
        const bindPadButton = (id, action) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('pointerdown', (e) => {
                // preventDefault: no focus steal (focus stays where it was —
                // WCAG focus sanity), no compat mouse events, no selection.
                e.preventDefault();
                if (btn.setPointerCapture && e.pointerId !== undefined) {
                    btn.setPointerCapture(e.pointerId);
                }
                this.input.touchPress(action);
            }, { signal });
            const release = (e) => {
                e.preventDefault();
                this.input.touchRelease(action);
            };
            btn.addEventListener('pointerup', release, { signal });
            btn.addEventListener('pointercancel', release, { signal });
            // Long-press guards: mobile context menu / selection peek would
            // interrupt a held run key.
            btn.addEventListener('contextmenu', (e) => e.preventDefault(),
                { signal });
        };
        bindPadButton('tc-left-btn', 'left');
        bindPadButton('tc-right-btn', 'right');
        bindPadButton('tc-jump-btn', 'jump');
        bindPadButton('tc-dash-btn', 'dash');
    }

    // Spec §Error Handling (invalid state detection): verify the target state
    // before transitioning; an invalid value logs an error and leaves the game
    // in its current state instead of corrupting it.
    setState(next) {
        if (!Object.values(STATE).includes(next)) {
            console.error('Invalid game state transition requested:', next);
            return false;
        }
        this.state = next;
        return true;
    }

    // Pause is strictly PLAYING↔PAUSED. End screens are handled by the
    // Escape keypath (returnToMenu), never by this method: a still-live
    // "Pause Game" button on GAME_OVER that silently jumped to MENU would
    // strand keyboard/screen-reader users away from the score and Retry.
    togglePause() {
        if (this.state === STATE.PLAYING) {
            this.setState(STATE.PAUSED);
            // A buffered press or live coyote window from before the pause
            // must not fire on resume: pause is an interruption, not a frame
            // boundary. (Space keyups during pause are ignored outright —
            // releaseJump is PLAYING-gated like every other input path.)
            this.player?.cancelJumpFeel();
            // Dash companion (M2): an in-flight burst ends at pause too, so
            // half a committed burst never resumes under the player's feet.
            // No refund of cooldown/arc consumption (see cancelDashFeel).
            this.player?.cancelDashFeel();
            this.ui.showOverlay('pause-screen');
            this.ui.setPauseLabel(true);
            // Music ducks to silence under the menu; the scheduler stops
            // meanwhile so a long pause costs nothing (see audio.js).
            audio.duckMusic(true);
            // R29: focus lands inside the menu so arrow+Enter work
            // immediately and assistive tech announces the available options.
            this.ui.focusPauseMenu();
        } else if (this.state === STATE.PAUSED) {
            this.setState(STATE.PLAYING);
            this.ui.hideOverlay('pause-screen');
            this.ui.setPauseLabel(false);
            audio.duckMusic(false);
            // Never leave focus on the just-hidden menu: Space would stay
            // swallowed by its focused button instead of jumping.
            this.ui.blurPauseControls();
        }
    }

    // M key / HUD chip: global sound mute, persisted across sessions. Works
    // in every state (including MENU, where it only flips the stored
    // preference for the next run's context).
    toggleSound() {
        audio.toggleMute();
        this.ui.setMuteLabel(audio.isMuted());
        this.syncSettingsUI();
    }

    // --- Wave C settings overlay --------------------------------------------
    // Mirrors live state into the three switches. `reducedMotion` is passed
    // as the EFFECTIVE resolution ('on'/'off'), so an OS-driven reduce shows
    // checked even before the user has an explicit stored choice.
    syncSettingsUI() {
        if (!this.ui || !this.settings) return;
        this.ui.renderSettings({
            soundOn: !audio.isMuted(),
            shakeOn: !!this.settings.shake,
            reducedMotion: resolveReducedMotion(
                this.settings.reducedMotion, osReducedMotion()) ? 'on' : 'off'
        });
    }

    // Everything behind the settings dialog must stop being focusable and
    // perceivable while it is open (WCAG 2.4.3, review fix): without this,
    // Tab from the dialog walks into the still-visible menu/pause buttons and
    // Enter there starts or resumes a run underneath the open dialog. inert
    // removes the subtree from tab order AND the a11y tree in supporting
    // browsers; aria-hidden is the belt for older AT. The keydown Tab trap in
    // bindEvents keeps containment enforced even where inert is unimplemented.
    _setSettingsBackdrop(inertOn) {
        for (const id of ['menu-screen', 'pause-screen', 'hud']) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (inertOn) {
                el.setAttribute('inert', '');
                el.setAttribute('aria-hidden', 'true');
            } else {
                el.removeAttribute('inert');
                el.removeAttribute('aria-hidden');
            }
        }
    }

    openSettings(from) {
        this.settingsOpen = true;
        this.settingsReturn = from;
        this.syncSettingsUI();
        this._setSettingsBackdrop(true);
        this.ui.showOverlay('settings-screen');
        this.ui.focusSettingsMenu();
    }

    closeSettings() {
        this.settingsOpen = false;
        this.ui.hideOverlay('settings-screen');
        // Backdrop first: an inert container would silently swallow the
        // restore-focus below (a focused control cannot live inside inert).
        this._setSettingsBackdrop(false);
        const active = document.activeElement;
        if (active && typeof active.closest === 'function' &&
            active.closest('#settings-screen')) {
            active.blur();
        }
        // Return focus to the invoking control (review fix): keyboard users
        // land back exactly where they opened the dialog from. A resumed run
        // must never leave focus on a hidden control (Space-eating rule), so
        // the restore only fires when the opener's overlay is actually shown.
        const openerId = this.settingsReturn === 'pause'
            ? 'pause-settings-btn' : 'menu-settings-btn';
        const opener = document.getElementById(openerId);
        const host = opener && typeof opener.closest === 'function'
            ? opener.closest('.overlay') : null;
        if (opener && host && !host.classList.contains('hidden')) {
            opener.focus();
        }
    }

    // Spec: Escape on an end screen returns to MENU, never pauses.
    returnToMenu() {
        this.setState(STATE.MENU);
        // The settings overlay is a layer over menu/pause — drop it with the
        // same blanket-overlay teardown here (no focus dance: this path also
        // runs from error recovery where nothing should hold focus).
        this.settingsOpen = false;
        this.ui.hideOverlay('settings-screen');
        this._setSettingsBackdrop(false);
        // The canvas still shows the abandoned run's last frame — force the
        // MENU demo composition to repaint (once, if motion is reduced).
        this._titlePainted = false;
        // The menu is a silent space by design (music starts only with a
        // run), so leaving a run always stops the loop.
        audio.stopMusic();
        this.ui.hideOverlay('game-over-screen');
        this.ui.hideOverlay('game-complete-screen');
        this.ui.showOverlay('menu-screen');
        // The HUD sits above the 85%-opaque menu overlay: without this
        // the finished run's Score/Level/Time ghost through the menu.
        this.ui.hideHUD();
    }

    // Pause-menu "Quit to Menu": same landing state as Escape from an end
    // screen, plus closing the pause overlay we are operating from.
    quitToMenu() {
        this.ui.blurPauseControls();
        this.ui.hideOverlay('pause-screen');
        this.returnToMenu();
    }

    // Zero the per-level economy counters. Called on run start (startGame)
    // and when advancing to the NEXT level only — never from publishLevel,
    // which also serves retries and loop recovery on the SAME level, where
    // deathsOnCurrentLevel and the accumulators must persist (the retry
    // contract: progress converges, but the "issues" count keeps climbing).
    resetLevelEconomyTrackers() {
        this.deathsOnCurrentLevel = 0;
        this.levelCoinPoints = 0;
        this.levelCombatPoints = 0;
        this.levelEnemiesKilled = 0;
        this.levelEnemiesDodged = 0;
    }

    // Wave B: wipe every transient effect state at a level publish (first
    // play, retry, loop recovery). Without this a death's shake/bursts and
    // any live popups leak across the transition — the fresh attempt must
    // start dead-still at spawn. (No flash field to wipe here by design:
    // the death white-flash beat lives in CSS on #game-over-screen — the
    // canvas overlay was removed in the Wave B fix round, so the scrim is
    // owned by the DOM show/hide, never by resettable game state.)
    resetEffectState() {
        this.particles.length = 0;
        this.dust.length = 0;
        this.popups.length = 0;
        this.rings.length = 0;
        // Wave C: a new attempt (or Play Again) never inherits the last
        // run's confetti; the celebration canvas gets one clean clear.
        if (this.confetti) this.confetti.length = 0;
        this.shakeTime = 0;
        this.shakeMag = 0;
        this.shakeDur = 0;
        this.squashTimer = 0;
        this._punchTime = 0;
        this._launchStretch = 0;
        this._landDepth = 0;
        this._prevFrameVx = 0;
        this._lean = 0;
        this._lookAhead = 0;
        this._dustTx = -1;
        this._slideDustT = 0;
        this._dashGhosts.length = 0;
    }

    // Shared trigger for the Wave B impact family (stomp / shell / death):
    // strongest-wins shake with its own envelope duration plus the zoom
    // punch. Purely visual bookkeeping — fx.js gates both at draw time.
    _impactFx(shakeTime, shakeMag, punch = true) {
        if (shakeTime > this.shakeTime) {
            this.shakeTime = shakeTime;
            this.shakeDur = shakeTime;
        }
        this.shakeMag = Math.max(this.shakeMag, shakeMag);
        if (punch) this._punchTime = PUNCH_TIME;
    }

    // World → screen projection matching draw()'s world transform (CSS px).
    // Ignores the decaying shake/punch embellishments on purpose: popups
    // anchor to the steady camera, which reads calmer than jittering text.
    _worldToScreen(wx, wy) {
        const zoom = this.zoom;
        const effW = window.innerWidth / zoom;
        const effH = window.innerHeight / zoom;
        return [
            (wx - (this.camera.x + effW / 2)) * zoom + window.innerWidth / 2,
            (wy + this.camera.y - effH / 2) * zoom + window.innerHeight / 2
        ];
    }

    startGame() {
        // Construct before mutating anything (same discipline as startLevel):
        // if generation exhausts and fails, a GAME_COMPLETE/GAME_OVER screen
        // keeps its state and overlay instead of being stranded over zeroed
        // run data.
        // Fresh layout seed for this run: retries replay its levels, Play
        // Again does not. Rolled before construction so level 1 uses it.
        this.runSeed = (Math.random() * 0xffffffff) >>> 0;
        // A new run has no anti-repeat memory of the last one: clear the
        // chosen-seed ledger and the recent-layout ring BEFORE building L1.
        this.levelSeeds = new Map();
        this.recentLayouts = [];
        const level = this.tryConstructLevel(1);
        if (!level) return false;
        this.score = 0;
        this.currentLevel = 1;
        // A brand-new run starts with a clean economy sheet: no deaths, no
        // per-level accumulators carried over from the previous run.
        this.resetLevelEconomyTrackers();
        // M5 run-stats are session-scoped to THIS run (never persisted).
        this.runSecretsFound = 0;
        // A brand-new run always gets a fresh clock; whether it ticks at all
        // is decided per level by publishLevel's difficulty-tier gate.
        this.timer.timeRemaining = this.timer.baseTime;
        this.publishLevel(level);
        this.ui.showHUD();
        this.ui.hideOverlay('menu-screen');
        return true;
    }

    // Generation can exhaust its 200-attempt budget (I2 measured ~6% at level
    // 13 before the marker-reachability fix). A throw from a button listener
    // is a dead button that only logs to devtools, so the click-boundary
    // entries catch here: one inline re-attempt — a full generation costs a
    // few ms — absorbs transient exhaustion; on second failure the game keeps
    // its current state and overlay intact and the player gets a message.
    // Deterministic per-level seed: retrying or error-recovering a level
    // rebuilds the exact map you died on (dying to reroll for a friendier
    // layout is not a strategy). New runs roll a fresh runSeed in startGame.
    //
    // Randomness wave 2026-11-05 (player report: levels "partially repeated"):
    // the first construction of a level walks the deterministic candidate
    // chain seedCandidate(runSeed, L, i) and accepts the FIRST candidate whose
    // terrain silhouette (layoutSignature above) overlaps nothing accepted
    // earlier in THIS run by >= LAYOUT_SIMILARITY_MAX. Attribution sweep: the
    // old additive mix was NOT producing correlated rng streams (|corr| 0.04,
    // same as independent seeds) — the repetition is generator machinery
    // convergence onto similar silhouettes, which no seed hash alone fixes;
    // with the guard, worst-pair-per-run surface IoU drops 0.815 -> 0.496
    // mean and zero pairs reach 0.7 within a 100-level run.
    // M4 preference scoring (R6 + R7 lazy scan, capability program Task 6):
    // candidates are built SEQUENTIALLY in BASE chain order; every candidate
    // that passes the guard is scored, and the FIRST one reaching the exported
    // INTERESTING_OK bar ships immediately (later candidates never built).
    // Sub-bar passers are remembered; if the chain ends with none meeting the
    // bar, the HIGHEST-scoring passer ships (ties -> earlier index), so the
    // selection PREFERES and NEVER rejects — zero extra generation retries
    // (each candidate is exactly one seeded construction, same as before;
    // only the ACCEPTANCE rule changed), and selection stays a pure function
    // of (runSeed, level, prior accepted layouts). Mean constructions per
    // transition land within BASE + 0.5 by tuning the bar (Task 6 report).
    // The contract holds because selection happens ONCE per level: the chosen
    // seed is stored in levelSeeds, and every later path (retry, pause-menu
    // restart, loop recovery) reads the stored value WITHOUT re-selecting or
    // touching recentLayouts. Same runSeed replays the identical sequence
    // including every guard decision (all inputs are pure functions of prior
    // accepted levels). When all candidates throw, the primary seed is handed
    // back unstored so the caller's own construction reproduces the throw —
    // startLevel's documented throw-through behaviour is unchanged.
    seedFor(levelNumber) {
        const stored = this.levelSeeds.get(levelNumber);
        if (stored !== undefined) return stored;
        let bestSeed = null, bestSig = null, bestScore = Infinity;
        let pickSeed = null, pickSig = null, pickInteresting = -Infinity;
        let firstPasserIdx = -1;
        for (let i = 0; i < SEED_CANDIDATES; i++) {
            // R7 continuation cap: once a passer exists at index f, indices
            // below f + LAZY_SCAN_EXTRA are still built — with the shipped
            // LAZY_SCAN_EXTRA = 2 that is exactly ONE extra construction
            // beyond BASE's stop point (index f + 1), matching the tuned
            // simulation's limit f + EXTRA (built count, not further steps).
            if (firstPasserIdx >= 0 && i >= firstPasserIdx + LAZY_SCAN_EXTRA) break;
            const seed = seedCandidate(this.runSeed, levelNumber, i);
            let candidate; // assigned in try; throw path continues below
            try {
                candidate = new Level(levelNumber, TILE_SIZE, seed);
            } catch {
                continue; // exhausted construction: next chain link
            }
            const sig = layoutSignature(candidate);
            let worst = 0;
            for (const past of this.recentLayouts) {
                worst = Math.max(worst, layoutSimilarity(sig, past));
                if (worst >= LAYOUT_SIMILARITY_MAX) break;
            }
            if (worst < LAYOUT_SIMILARITY_MAX) {
                if (firstPasserIdx < 0) firstPasserIdx = i;
                const interesting = interestingnessScore(candidate);
                if (interesting > pickInteresting) {
                    pickInteresting = interesting;
                    pickSeed = seed;
                    pickSig = sig;
                }
                // R7 LAZY SCAN: good enough ships NOW — no later candidate
                // is ever constructed (the whole point: builds stay near
                // BASE's mean while scores still upgrade).
                if (interesting >= INTERESTING_OK) break;
                continue; // sub-bar passers keep competing for best-so-far
            }
            if (worst < bestScore) { bestScore = worst; bestSeed = seed; bestSig = sig; }
        }
        if (pickSeed !== null) {
            this.levelSeeds.set(levelNumber, pickSeed);
            this.recentLayouts.push(pickSig);
            return pickSeed;
        }
        if (bestSeed !== null) {
            // Cap exhausted: accept the least-similar candidate seen rather
            // than stall the transition (repetition beats a frozen tab).
            this.levelSeeds.set(levelNumber, bestSeed);
            this.recentLayouts.push(bestSig);
            return bestSeed;
        }
        return seedCandidate(this.runSeed, levelNumber, 0);
    }

    // HUD coin chip from the REQUIRED subset only (R4): collected/total over
    // the non-secret coins, so the number always mirrors what
    // meetsPortalRequirement actually gates. Secret pickups still score and
    // still pop '+N' — they just never join the denominator.
    _updateCoinHud() {
        const required = this.collectibles.getRequiredCoins();
        let collected = 0;
        for (const coin of required) {
            if (coin.collected) collected++;
        }
        this.ui.updateCoins(collected, required.length);
    }

    tryConstructLevel(levelNumber) {
        const seed = this.seedFor(levelNumber);
        try {
            return new Level(levelNumber, TILE_SIZE, seed);
        } catch (first) {
            console.error('Level generation failed; re-attempting once:', first);
        }
        try {
            // Seeded generation is deterministic: re-using the same seed
            // would replay the exact 200-attempt sequence that just failed.
            // Nudge into neighbouring seed space so the rescue can succeed.
            // The rescued map becomes THIS level's map for the rest of the
            // run (stored like a selected seed), so the retry contract still
            // replays exactly what the player is now looking at.
            const rescue = (seed ^ 0x5bf03635) >>> 0;
            const level = new Level(levelNumber, TILE_SIZE, rescue);
            this.levelSeeds.set(levelNumber, rescue);
            this.recentLayouts.push(layoutSignature(level));
            return level;
        } catch (second) {
            console.error('Level generation failed again:', second);
            this.ui.showErrorMessage('Could not prepare that level — try again.');
            return null;
        }
    }

    startLevel() {
        // Construct before publishing anything: if generation exhausts and
        // throws, the game keeps its previous state and system references
        // instead of being left PLAYING with a null/stale level, where the
        // loop's catch would log per-frame errors forever.
        const level = new Level(this.currentLevel, TILE_SIZE, this.seedFor(this.currentLevel));
        this.publishLevel(level);
    }

    // Adopts a fully-constructed level: state flip and system references
    // only change once generation succeeded.
    publishLevel(level) {
        this.level = level;
        // Spawn from the level's reachability-verified spawn tile: its y is
        // already a Player top-left origin standing on the forced flat ground.
        const spawn = level.getSpawnPoint();
        this.player = new Player(spawn.x, spawn.y, PLAYER_SPEED, JUMP_FORCE);
        // Adopt the very system instances this level generated its content
        // into, so the loop sees exactly what the renderer draws.
        this.enemyManager = level.getEnemyManager();
        this.collectibles = level.getCollectibles();
        this.hazards = level.getHazards();
        this.projectiles = level.getProjectileManager();
        // Decks follow the same per-level lifecycle as the systems above:
        // every publish (new level, retry, loop recovery) mints a fresh
        // manager from the adopted level's descriptors, so elapsed time — and
        // therefore the whole shuttle schedule — restarts identically for a
        // replayed seed.
        this.movingPlatforms = new MovingPlatformManager(level.getMovingPlatforms());
        this._riding = null;
        // M3 capability objects: fresh instances from THIS level's
        // descriptors every publish (retry-exact: descriptors are seeded-
        // deterministic, kinematics start from rest).
        this.pads = (level.getPads() || []).map(d => new LaunchPad(d.x, d.y));
        const crateDescs = level.getCrates() || [];
        this.crate = crateDescs.length ? new Crate(crateDescs[0]) : null;
        // B2: shells stop on THIS level's live crate body (cover, not
        // scenery). Fresh publication per level keeps retries exact; empty
        // when the map ships no crate.
        this.projectiles.setCrates(this.crate ? [this.crate] : []);
        // Crate-only pixel walls where the pocket model reads the map edge
        // as a blocker (off-grid tiles produce no collider for anyone); X-
        // pass only — see stepCrate's split-resolution contract.
        this._crateWalls = this.crate ? crateContainmentWalls(
            level.width * level.tileSize, level.height * level.tileSize) : [];
        this._crateDustT = 0;
        // Wave D SFX trackers restart with the level (no inherited mid-slide
        // or mid-strain phase across a retry).
        this._prevSliding = 0;
        this._crateStrainT = 0;
        // Coin chip reflects this level's progress: fresh on first play,
        // carried over on a retry (collected flags transfer with the seed).
        // R4: REQUIRED coins only (secret alcove coins never gate the portal
        // and stay out of the count — see Collectibles.meetsPortalRequirement).
        this._updateCoinHud();
        // Seed the chime edge tracker from the adopted level's gate state
        // (see the unlock check in update()).
        this._portalUnlocked = this.collectibles.meetsPortalRequirement();
        // Snapshot before any of this level's coins can be collected.
        this.levelStartScore = this.score;
        // M5: a fresh attempt (first play, retry, or loop recovery) starts
        // with no airborne stomp history — the chain is earned on THIS attempt.
        this.stompChain = 0;
        this._chainBonusPaid = false;
        this.levelCompleteTimer = 0;
        // Spec §Error Handling (level transition): the run clock carries over
        // untouched, but verify the carried value survived intact; an invalid
        // one falls back to the default rather than corrupting the run.
        if (!Number.isFinite(this.timer.timeRemaining) ||
            this.timer.timeRemaining < 0 || this.timer.timeRemaining > 9999) {
            console.warn('Run clock invalid at level transition; using default',
                this.timer.baseTime, 'seconds');
            this.timer.timeRemaining = this.timer.baseTime;
        }
        // Spec §Error Handling (coin count validation): the all-coins portal
        // gate needs enough coins to be a goal. Generation ships more than
        // this on every tier; a level below the floor is a generator bug —
        // warn and continue (the gate itself never becomes unwinnable).
        if (this.collectibles.getCoins().length < 3) {
            console.warn('Level generated with fewer than 3 coins:',
                this.collectibles.getCoins().length);
        }
        // Difficulty tier is the single authority for whether the run clock
        // runs at all on this level.
        this.timerActive = this.difficulty.isTimerEnabled(this.currentLevel);
        this.ui.setTimerVisible(this.timerActive);
        // Write the carried time before revealing the node: otherwise the
        // first painted frame shows whatever text it last held (e.g. a stale
        // "Time: 1:00" when entering level 5 with 12 s carried over).
        this.ui.updateTimer(this.timer.getTimeRemaining());
        this.setState(STATE.PLAYING);
        this.ui.setPauseLabel(false);
        this.ui.setPauseEnabled(true);
        this.camera.reset();
        // Snap the camera onto the new level immediately: reset() alone would
        // render one frame of fresh terrain through the default origin on
        // short/narrow viewports before follow() catches up.
        this.camera.follow(
            this.player,
            level.width * level.tileSize,
            level.height * level.tileSize
        );
        // Wave B: every effect pool/timer starts empty on a published level
        // (see resetEffectState) — no stale shake/popups across attempts.
        this.resetEffectState();
        // Audio follows the published level. init() is a no-op after the
        // first call and lands inside the Start-click gesture for a fresh
        // run (the menu stays deliberately silent — no context exists until
        // gameplay). unduck covers loop-error recovery, which resumes to
        // PLAYING without passing through togglePause's resume branch. The
        // band preset comes from the THEMES cycle; an identical running
        // track (retry/recovery) crossfades nothing.
        audio.init();
        audio.duckMusic(false);
        audio.startMusic((Math.max(1, this.currentLevel) - 1) % THEMES.length,
            this.currentLevel);
    }

    // GAME_OVER "Retry Level": fresh attempt at the current level.
    retryLevel() {
        this.restartCurrentLevel('game-over-screen');
    }

    // Shared by Retry (GAME_OVER) and the pause menu's Restart Level: one
    // restart contract regardless of which screen initiated it.
    restartCurrentLevel(overlayId) {
        // Snapshot which coins this attempt banked BEFORE rebuilding. The
        // replay is seeded-identical, so coin indices transfer 1:1: dying
        // on a replayed level never re-collects (they stay collected) and
        // never refunds (their score stays). Progress converges across
        // attempts instead of resetting — the retry loop rewards persistence
        // instead of punishing it.
        const keptIndices = this.collectibles
            ? this.collectibles.getCoins()
                .map((coin, i) => (coin.collected ? i : -1))
                .filter(i => i >= 0)
            : [];
        const level = this.tryConstructLevel(this.currentLevel);
        if (!level) return;
        const replayCoins = level.getCollectibles().getCoins();
        for (const i of keptIndices) {
            if (replayCoins[i]) level.getCollectibles().collectCoin(i);
        }
        // Banked coins are already in this.score; re-snapshot so the next
        // restart keeps them too (no rollback: nothing here can double-pay).
        this.levelStartScore = this.score;
        // A fresh attempt gets a fresh clock: without this, retrying after a
        // time-out would kill the player on the very next tick.
        this.timer.timeRemaining = this.timer.baseTime;
        this.ui.hideOverlay(overlayId);
        this.publishLevel(level);
    }

    handleWin() {
        // Clear bonus (owner ruling 2026-11-04): awarded BEFORE any overlay
        // bookkeeping so the HUD total, the overlay breakdown and the banked
        // score all describe the same run. Completion never CHARGES anything
        // (the death penalty stays a handleGameOver-exclusive cost); this is
        // the reward half of cause-and-effect.
        const clearBonus = clearBonusFor(this.deathsOnCurrentLevel, this.currentLevel);
        // M5 no-damage clear bonus: gated on the SAME zero-death predicate as
        // the flawless tier because every hit in this game IS a death (see
        // NO_DAMAGE_CLEAR_BONUS). Its own component so the overlay can name
        // it and a future HP model can split the gates.
        const noDamageBonus = noDamageBonusFor(this.deathsOnCurrentLevel);
        this.score = Math.min(this.score + clearBonus + noDamageBonus,
            Number.MAX_SAFE_INTEGER);
        // M5 run-stats for the LEVEL_COMPLETE line: secrets banked on this
        // level's attempt series over the secrets it shipped. Collected flags
        // transfer across retries (restartCurrentLevel), so an alcove cleared
        // before a death still counts here — same "earned on this level" rule
        // as levelCoinPoints.
        const secretCoins = this.collectibles.getCoins().filter(c => c.secret);
        this.lastClearBreakdown = {
            coins: this.levelCoinPoints,
            combat: this.levelCombatPoints,
            clearBonus,
            noDamageBonus,
            enemiesBested: this.levelEnemiesKilled + this.levelEnemiesDodged,
            deaths: this.deathsOnCurrentLevel,
            flawless: this.deathsOnCurrentLevel === 0,
            secretsFound: secretCoins.filter(c => c.collected).length,
            secretsTotal: secretCoins.length
        };
        this.setState(STATE.LEVEL_COMPLETE);
        // Win sting over the top of the still-running music: the transition
        // is a 2 s beat, not an ending, so the loop carries through to the
        // next level (crossfading only when its band/variation changes).
        audio.playSfx(audio.SFX_VOICES.LEVEL_COMPLETE);
        // The transition is automatic and not pausable: drop the button out
        // of the tab order until publishLevel re-enables it.
        this.ui.setPauseEnabled(false);
        this.levelCompleteTimer = 2; // 2 seconds transition
        this.levelTransitionStalled = false;
        this.levelTransitionStallFrames = 0;

        this.ui.setLevelCompleteBreakdown(this.lastClearBreakdown);
        this.ui.showOverlay('level-complete-screen');

        // Level advance is driven solely by the update-timer path in update();
        // a parallel setTimeout here used to double-advance and leak timers.
    }

    handleGameOver(cause) {
        this.setState(STATE.GAME_OVER);
        // Per-level "issues" counter feeding clearBonusFor (owner ruling
        // 2026-11-04): charged at the same once-per-death site as the score
        // penalty below. It survives the retry on purpose — restartCurrentLevel
        // never resets it; only run start and advancing to the NEXT level do.
        this.deathsOnCurrentLevel++;
        // Music stops dead at death; the falling sting carries the moment.
        // (Wave D note: every hit in this game IS a death — the damage/death
        // voice slot is this one descending sting, no separate hurt sound.)
        audio.stopMusic();
        audio.playSfx(audio.SFX_VOICES.DEATH);
        // Death feedback (visual-only): a short camera shake plus a red
        // burst at the player so the moment of loss is unmistakable. Wave B
        // enhances it — bigger burst and the zoom punch (all FX-gated; the
        // GAME_OVER flow itself is untouched). The white-flash beat lives in
        // CSS on #game-over-screen: a canvas overlay here could never show,
        // the DOM scrim replaces the scene in this same tick.
        this._impactFx(DEATH_SHAKE_TIME, DEATH_SHAKE_MAG);
        if (this.player) {
            spawnBurst(this.particles,
                this.player.x + this.player.width / 2,
                this.player.y + this.player.height / 2,
                '#ff5a5a', 22);
        }
        this.ui.setPauseEnabled(false);
        // Cause and effect (owner ruling): dying costs DEATH_SCORE_PENALTY_RATE
        // of the current score, floored to whole points. Charged exactly here
        // — once per death, never per frame — so further GAME_OVER ticks and
        // the shared restart path cannot double-charge. The overlay then shows
        // the POST-penalty total plus the loss line.
        const penalty = deathScorePenalty(this.score);
        this.score -= penalty;
        // Single game-over presentation path: UI.showGameOver writes the
        // #final-score node and reveals the overlay.
        this.ui.showGameOver(this.score, cause, penalty);
    }

    handleGameComplete() {
        this.setState(STATE.GAME_COMPLETE);
        // The level_complete sting already played when FINAL_LEVEL's portal
        // was reached (handleWin fires 2 s before this handler); here the
        // loop simply stops — end screens are quiet after their sting,
        // matching the silent-menu rule.
        audio.stopMusic();
        this.ui.setPauseEnabled(false);
        let highScore = this.score;
        // Storage-disabled environments throw from getItem/setItem. An
        // uncaught throw here would leave state LEVEL_COMPLETE with an expired
        // timer, so update() would re-enter every frame and flood the loop's
        // console.error. Spec: warn and continue, showing the run score as the
        // high score when storage is unavailable.
        // Accepted trade-off: this read-modify-write is unlocked, so two tabs
        // completing a run simultaneously can lose the higher score. A single-
        // player local game has no cross-tab reconciliation requirement; if
        // that ever changes, re-read before writing or listen for `storage`.
        try {
            const stored = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0;
            if (this.score > stored) {
                localStorage.setItem(HIGH_SCORE_KEY, String(this.score));
            }
            highScore = Math.max(this.score, stored);
        } catch (error) {
            console.warn('High score unavailable (localStorage failed):', error);
        }
        // Wave C victory celebration: one pooled confetti burst across the
        // screen, rendered on the dedicated above-overlay canvas. FX.pulse
        // selects the variant — animated rain when juice is on, a single
        // STATIC hold-and-fade composition under reduced motion (fx.js).
        spawnConfetti(this.confetti, window.innerWidth, window.innerHeight,
            FX.pulse);
        this._fxCanvasDirty = true;
        this.ui.showGameComplete(this.score, highScore,
            { secrets: this.runSecretsFound });
    }

    update(dt) {
        // Visual-only clocks run in every state: sprites animate behind the
        // overlays, particles finish their bursts, and the death shake plays
        // out on the GAME_OVER screen.
        this.sprites.advance(dt);
        stepParticles(this.particles, dt);
        // Victory confetti runs on the same all-states visual clock: the
        // burst must finish its fall while the GAME_COMPLETE overlay is up.
        if (this.confetti.length) stepConfetti(this.confetti, dt);
        // Title-demo parallax clock (MENU): synthetic camera travel plus the
        // ~30 fps repaint tick consumed by draw()'s MENU branch. Under the
        // reduced profile (FX.pulse off — boot media query or the settings
        // override) the demo holds a still composition: an ambient scroll
        // behind a screen the user is reading is exactly the motion that
        // preference asks us not to make.
        if (this.state === STATE.MENU) {
            if (FX.pulse) {
                this._titleScroll += dt * TITLE_SCROLL_SPEED;
                this._titleFrameAcc += dt;
                if (this._titleFrameAcc >= TITLE_FRAME_INTERVAL) {
                    this._titleFrameAcc = 0;
                    this._titleDirty = true;
                }
            } else if (!this._titlePainted) {
                // Still composition: paint exactly once (and again after any
                // resize, which flags dirty from resize()).
                this._titleDirty = true;
            }
        }
        // Ambient life pauses with the game pause (look-A): a frozen world
        // behind the overlay reads as held time, not a rendering stall.
        if (this.motes.length && this.state !== STATE.PAUSED) {
            stepMotes(this.motes, dt, window.innerWidth, window.innerHeight);
        }
        if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
        if (this.shakeTime === 0) this.shakeMag = 0;
        if (this.squashTimer > 0) this.squashTimer = Math.max(0, this.squashTimer - dt);
        // Wave B visual clocks (all states, like the bursts above): punch
        // and launch-stretch decay, popups rise, rings expand, and the lean
        // relaxes to plumb whenever no acceleration drives it (outside
        // PLAYING too, so a pause or end screen never freezes a tilted hero.
        // The death white-flash is NOT one of these clocks: that beat is a
        // CSS scrim animation on #game-over-screen, not canvas state.)
        if (this._punchTime > 0) this._punchTime = Math.max(0, this._punchTime - dt);
        if (this._launchStretch > 0) {
            this._launchStretch = Math.max(0, this._launchStretch - dt);
        }
        stepPopups(this.popups, dt);
        stepRings(this.rings, dt);
        // Dash-streak ghosts fade on the visual clock (all states, like the
        // bursts above): pausing never freezes a half-live streak.
        for (let i = this._dashGhosts.length - 1; i >= 0; i--) {
            this._dashGhosts[i].age += dt;
            if (this._dashGhosts[i].age >= DASH_GHOST_LIFE) {
                this._dashGhosts.splice(i, 1);
            }
        }
        // Pad plate squash decays on the same visual clock: it is a draw-time
        // channel only (the collision box is never touched, FX.squash gates
        // the compression inside drawPads). B2 fix (T5 disclosed minor):
        // PAUSED holds it like the bounce it mirrors — look-A ruling, same
        // gate as the motes above: a frozen world behind the overlay must
        // not leak the plate animating back to rest, or held time reads as
        // a rendering stall. Other non-PLAYING states keep decaying it (the
        // burst-family convention: end screens finish their visuals).
        if (this.state !== STATE.PAUSED) {
            for (const pad of this.pads) {
                if (pad.squash > 0) pad.squash = Math.max(0, pad.squash - dt);
            }
        }
        if (this.state !== STATE.PLAYING && this._lean !== 0) {
            this._lean += (0 - this._lean) * (1 - Math.exp(-10 * dt));
            if (Math.abs(this._lean) < 0.0005) this._lean = 0;
        }
        // Look-ahead eases back to centre whenever travel is not driving it
        // (pause/end screens must not freeze a permanent view lead).
        if (this.state !== STATE.PLAYING && this._lookAhead !== 0) {
            this._lookAhead += (0 - this._lookAhead) * (1 - Math.exp(-8 * dt));
            if (Math.abs(this._lookAhead) < 0.25) this._lookAhead = 0;
        }

        if (this.state === STATE.PLAYING) {
            // Run clock first: a tick that crosses zero is death before any
            // other outcome of the same frame. The PLAYING-only gate means
            // PAUSED freezes the clock for free.
            if (this.timerActive) {
                this.timer.update(dt);
                this.ui.updateTimer(this.timer.getTimeRemaining());
                if (this.timer.isTimeUp()) {
                    this.handleGameOver('time');
                    return;
                }
            }

            // Moving decks advance on the run clock only (PAUSED freezes
            // them). A rider is carried with the deck BEFORE history capture
            // and tile resolution: the landing-credibility convention then
            // sees a gliding rider as stationary relative to the deck, and
            // terrain beside the gap keeps first say on their position each
            // frame (journey ends deposit instead of dragging).
            if (this.movingPlatforms && this.movingPlatforms.platforms.length) {
                this.movingPlatforms.updateAll(dt);
                const ridden = this._riding;
                if (ridden && ridden.isUnder(this.player)) ridden.carry(this.player);
            }

            // Record pre-movement position (before x integration and gravity):
            // the collision resolver needs it to tell a genuine landing from
            // side-wall or level-corner contact at a gap.
            this.player.prevX = this.player.x;
            this.player.prevY = this.player.y;

            // Update player. Jump-feel timers (buffer/coyote/ledge-seed)
            // tick inside Player.update against last frame's collision-
            // derived grounded state; Shift caps ground speed only.
            const bufferWasPending = this.player.jumpBufferTimer > 0;
            this.player.update(dt, this.input.isLeft(), this.input.isRight(),
                { walk: this.input.isWalk() });
            // A buffered press consumed by landing contact launches mid-
            // frame, invisible to the input callback. jump() is the only
            // path that zeroes the buffer while driving vy negative (plain
            // expiry leaves the timer negative), so the pair identifies the
            // silent launch and its missing blip.
            if (bufferWasPending && this.player.jumpBufferTimer === 0 &&
                this.player.vy < 0) {
                audio.playSfx(audio.SFX_VOICES.JUMP);
                // Buffered launch off a ridden deck inherits too (same policy
                // as the input-callback path above).
                applyJumpBoost(this.player, this._riding);
            }

            // Apply physics
            this.physics.applyGravity(this.player, dt);

            const platforms = this.level.getPlatforms();

            // Crates (M3): push detection + crate step BEFORE the player's
            // own resolution, so a pushed crate presents its MOVED face this
            // frame and the player's X resolution against it caps them at the
            // crate face for free (no separate velocity clamp). Detection
            // reads frame-start geometry: prevX/prevY captured above, and
            // player.grounded still holds last frame's resolved value (the
            // resolver below re-derives it after this point).
            if (this.crate) {
                const pressDir =
                    this.input.isRight() && !this.input.isLeft() ? 1 :
                        this.input.isLeft() && !this.input.isRight() ? -1 : 0;
                stepCrate(this.crate, this.physics, platforms, dt,
                    cratePushDirection(this.player, this.crate, pressDir),
                    this._crateWalls);
            }

            // Check collisions. The crate joins the solid list as a FULL
            // solid on both axes — the deliberate contrast with one-way
            // decks below (Y-only, pure-help). Wall probes stay terrain-
            // only: a crate is never a slide/kick surface.
            const solids = this.crate ? platforms.concat([this.crate]) :
                platforms;
            const collisions = this.physics.checkCollisions(this.player, solids);
            // Impact speed before the resolver zeroes it: gates the landing
            // thud below.
            const vyBeforeResolve = this.player.vy;
            this.physics.resolveCollisions(this.player, collisions);

            // Moving decks resolve AFTER terrain and NEVER join the solid
            // list above: Y-axis only, through the same landing-credibility
            // convention as Physics.resolveYCollision. Sides and heads pass
            // straight through a deck — that one-way rule is what keeps them
            // pure-help: they can never block, wall-slide or knock the player
            // off a BFS-validated route. supportUnder re-derives the ride
            // attachment every frame (null once not landed on a deck).
            if (this.movingPlatforms && this.movingPlatforms.platforms.length) {
                const decks = this.movingPlatforms.oneWayRects(this.player);
                if (decks.length) this.physics.resolveYCollision(this.player, decks);
                // attachRider records the attachment on the manager too — the
                // descent-stickiness exception in oneWayRects reads it next
                // frame (single source of truth lives in the manager).
                this._riding = this.movingPlatforms.attachRider(this.player);
            }

            // Wall-contact probes (M1): 1px slivers either side against
            // TERRAIN only — one-way decks are never walls (their pure-help
            // rule above explicitly forbids blocking or wall-sliding off
            // them). Fed to the Player after resolution so next frame's
            // pressJump()/slide check read fresh contact, same contract as
            // the collision-derived grounded flag. Cost: one more linear
            // pass over the platform list per frame (same shape as
            // checkCollisions already pays).
            this.player.setWallContact(wallContactSide(this.player, platforms));

            // Launch pads (M3): feet-flush contact with a pad's floor line
            // converts grounded arrival into the fixed-apex bounce. Gated on
            // vyBeforeResolve >= 0 — arriving from above or resting, never
            // rising. Runs AFTER decks/wall probes and BEFORE the grounded-
            // edge block below, so the pad frame reads as a LAUNCH (no
            // landing squash/brake steals it). applyPadLaunch arms the jump-
            // cut, so releasing early shortens the bounce like any jump.
            if (this.pads.length) {
                const pad = padUnderFeet(this.player, this.pads);
                if (pad && vyBeforeResolve >= 0) {
                    applyPadLaunch(this.player);
                    pad.squash = PAD_SQUASH_TIME;
                    // Wave D: pads get their own boing now — the fixed-arc
                    // spring should never be mistaken for a player jump.
                    audio.playSfx(audio.SFX_VOICES.PAD_BOUNCE);
                    this._launchStretch = LAUNCH_STRETCH_TIME;
                    // Feel: soft dust at the plate + an unlock-family ring,
                    // each spawn-gated exactly like the Wave-B family above
                    // (draw gates live in fx.drawRings / drawPads).
                    if (FX.dust) {
                        const pTheme = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
                        spawnDust(this.dust,
                            pad.x + pad.width / 2, pad.y + pad.height - 4,
                            dustTint(pTheme),
                            { count: 5, dir: 0, speed: 1.1, alpha: 0.7,
                                life: 0.3, size: 4 });
                    }
                    if (FX.pulse) {
                        spawnRing(this.rings, pad.x + pad.width / 2,
                            pad.y + pad.height - 6, '#f2b13c', 6, 34);
                    }
                }
            }

            // Grounded-state edges (visual-tuning hooks, physics-safe):
            // air-to-ground fires the landing squash. The walked-off-a-ledge
            // drop seed now lives inside Player.update, deferred until the
            // coyote window it waits for expires there.
            if (this.player.grounded && !this._prevGrounded) {
                this.squashTimer = 0.12;
                // Wave B: thud magnitude rides the impact fall speed (soft
                // taps stay shallow, big drops slam), and a ground-hugging
                // dust puff marks the contact in the theme's dust colour —
                // the AO-darkened deck line is exactly where light dust
                // reads best (Wave A soft-light convention).
                this._landDepth = Math.min(1, Math.max(0.25,
                    vyBeforeResolve / LAND_DEPTH_REF_VY));
                if (FX.dust) {
                    const dTheme = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
                    spawnDust(this.dust,
                        this.player.x + this.player.width / 2,
                        this.player.y + this.player.height - 8,
                        dustTint(dTheme),
                        { count: 3 + Math.round(3 * this._landDepth), dir: 0,
                            speed: 0.7 + this._landDepth, alpha: 0.65, life: 0.3,
                            size: 4 });
                }
                if (vyBeforeResolve >= LANDING_SFX_MIN_FALL) {
                    audio.playSfx(audio.SFX_VOICES.LAND, this._landDepth);
                }
                // Landing brake: touching down with no direction held kills
                // the carried horizontal speed outright. Without it, jump
                // momentum marches the player off a narrow landing before
                // the (already hard) ground brake can act — the residual
                // "sliding" complaint on 2-tile platforms next to spikes.
                if (!this.input.isLeft() && !this.input.isRight()) {
                    this.player.vx = 0;
                }
            } else if (!this.player.grounded && this._prevGrounded &&
                this.player.vy < 0) {
                // Air-to-air the WRONG way within one frame with negative vy:
                // a jump launched off grounded contact (press or buffered
                // fire). One beat of tall stretch sells the takeoff.
                this._launchStretch = LAUNCH_STRETCH_TIME;
            }
            this._prevGrounded = this.player.grounded;

            // Skid spray (Wave B): a grounded direction REVERSAL at speed.
            // Compared against last frame's snapshot because the input
            // callback re-asserts vx between frames, and against the same
            // threshold family as the run dust so only committed swerves
            // spray. Position-event driven like everything here: no RNG.
            if (this.player.grounded && FX.dust &&
                this._prevFrameVx * this.player.vx < 0 &&
                Math.abs(this._prevFrameVx) >= SKID_MIN_SPEED) {
                const sTheme = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
                spawnDust(this.dust,
                    this.player.x + this.player.width / 2,
                    this.player.y + this.player.height - 8,
                    dustTint(sTheme),
                    { count: 6, dir: -Math.sign(this.player.vx), speed: 1.5,
                        alpha: 0.7, life: 0.34, size: 4 });
            }

            // Walking dust (terrain micro-feedback): a small puff each time a
            // runner crosses into a new tile while grounded. Driven by the
            // position event, not RNG, so two boots of one seed render
            // identical frames. Wave B moved it to its OWN capped pool
            // (MAX_DUST in particles.js): bursts can no longer evict dust,
            // and the low alpha keeps it under the hazard-readability line.
            if (this.player.grounded && Math.abs(this.player.vx) > 120 && FX.dust) {
                const footTx = Math.floor(
                    (this.player.x + this.player.width / 2) / this.level.tileSize);
                if (footTx !== this._dustTx) {
                    this._dustTx = footTx;
                    const dir = this.player.vx > 0 ? -1 : 1;
                    const themeIdx = (Math.max(1, this.currentLevel) - 1) % THEMES.length;
                    spawnDust(this.dust,
                        this.player.x + this.player.width / 2 - dir * 10,
                        this.player.y + this.player.height - 8,
                        dustTint(THEMES[themeIdx]),
                        { count: 1 + (footTx & 1), dir, speed: 0.75,
                            alpha: 0.6, life: 0.28, size: 3 });
                }
            } else {
                this._dustTx = -1;
            }

            // Wall-slide dust (M1): small puffs along the contacted wall
            // face while sliding, on a fixed cadence (deterministic under
            // fixed dt; spawnDust's own jitter is hash-based, never RNG).
            // FX.dust gates the SPAWN exactly like the land/skid/run family
            // above; reduced-motion keeps the pool at half amplitude via
            // fx.js and the mechanic itself never reads any flag.
            // Wave D SFX companion: a quiet tick on the slide-START EDGE
            // only (not gated by FX.dust — sound is not an FX-flag domain).
            if (this.player.sliding && !this._prevSliding) {
                audio.playSfx(audio.SFX_VOICES.WALL_SLIDE);
            }
            this._prevSliding = this.player.sliding;
            if (this.player.sliding && FX.dust) {
                this._slideDustT += dt;
                if (this._slideDustT >= WALL_SLIDE_DUST_INTERVAL) {
                    this._slideDustT = 0;
                    const wTheme = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
                    spawnDust(this.dust,
                        this.player.sliding === -1
                            ? this.player.x : this.player.x + this.player.width,
                        this.player.y + this.player.height - 12,
                        dustTint(wTheme),
                        { count: 2, dir: 0, speed: 0.6, alpha: 0.5,
                            life: 0.26, size: 3 });
                }
            } else {
                this._slideDustT = 0;
            }

            // Crate push dust (M3 feel): puffs at the crate's trailing base
            // on a fixed cadence WHILE pushed (deterministic under fixed dt;
            // spawnDust's own jitter is hash-based, never RNG). Spawn-gated
            // by FX.dust like the whole family above.
            if (this.crate && this.crate.pushed && FX.dust) {
                this._crateDustT += dt;
                if (this._crateDustT >= CRATE_PUSH_DUST_INTERVAL) {
                    this._crateDustT = 0;
                    const cdx = this.crate.x -
                        (this.crate.prevX ?? this.crate.x);
                    const cTheme = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
                    spawnDust(this.dust,
                        this.crate.x + this.crate.width / 2,
                        this.crate.y + this.crate.height - 6,
                        dustTint(cTheme),
                        { count: 2, dir: cdx !== 0 ? -Math.sign(cdx) : 0,
                            speed: 0.8, alpha: 0.6, life: 0.3, size: 3 });
                }
            } else {
                this._crateDustT = 0;
            }

            // Crate push strain (Wave D): a very quiet scuff tick WHILE the
            // push holds, on its own capped cadence so a long shove stays a
            // rhythm, never a per-frame buzz. Deliberately NOT tied to the
            // dust block above: FX flags gate visuals, not sound.
            if (this.crate && this.crate.pushed) {
                this._crateStrainT += dt;
                if (this._crateStrainT >= CRATE_PUSH_STRAIN_INTERVAL) {
                    this._crateStrainT = 0;
                    audio.playSfx(audio.SFX_VOICES.CRATE_PUSH);
                }
            } else {
                this._crateStrainT = 0;
            }

            // Dash streak (M2 feel): snapshot the hero silhouette every burst
            // frame into a short capped ring. Spawn-gated on FX.trails AND
            // drawn under the same flag (a mid-life toggle hides instantly),
            // position-event driven so two boots of one seed render identical
            // frames — no RNG anywhere in the trail.
            if (this.player.dashTimer > 0 && FX.trails) {
                this._dashGhosts.push({ x: this.player.x, y: this.player.y, age: 0 });
                if (this._dashGhosts.length > DASH_GHOST_MAX) {
                    this._dashGhosts.shift();
                }
            }

            // Subtle lean toward travel direction WHILE ACCELERATING (Wave
            // B): an impulse frame (press from rest, reversal) tips the hero
            // a few degrees forward; steady speed relaxes it back to plumb.
            // Draw-time rotation only — see draw()'s player transform.
            const accel = (this.player.vx - this._prevFrameVx) / Math.max(dt, 1e-4);
            let leanTarget = 0;
            // FX.squash off => rigid body (no lean ever accumulates; any
            // residual eases back to zero within a few frames). Gentle
            // family: magnitude rides FX.intensity.
            if (FX.squash && accel * this.player.vx > 0) {
                leanTarget = Math.max(-LEAN_MAX_RAD * FX.intensity,
                    Math.min(LEAN_MAX_RAD * FX.intensity, accel * 0.00002));
            }
            this._lean += (leanTarget - this._lean) * (1 - Math.exp(-10 * dt));
            if (Math.abs(this._lean) < 0.0005) this._lean = 0;
            // End-of-frame snapshot for next frame's skid + lean inputs.
            this._prevFrameVx = this.player.vx;

            // Phase 2 elements. Death checks run in a fixed order (enemies,
            // spikes, pit) and stop the tick at the first hit, so several
            // simultaneous contacts produce exactly one game over.
            // Chargers need the player reference for their trigger zone
            // (walkers/spinies ignore it); see enemies.js header.
            this.enemyManager.updateAll(dt, this.player);
            // M5 stomp-chain bookkeeping (see STOMP_CHAIN_BONUS): any grounded
            // frame clears the airborne kill streak BEFORE this tick's contact
            // can extend it, so a chain only ever links kills that happened
            // without touching ground in between.
            if (this.player.grounded) {
                this.stompChain = 0;
                this._chainBonusPaid = false;
            }
            // Stomp-aware enemy contact: falling feet-first from above
            // squashes the enemy (with a bounce and a poof); any other
            // contact is fatal.
            const contact = this.enemyManager.resolvePlayerContact(this.player);
            if (contact.stomped > 0) {
                // Wave D: the chain counter read BEFORE this tick's increment
                // is the number of kills already stacked airborne — 0 plays
                // the normal squish, each further step climbs a minor third.
                audio.playSfx(audio.SFX_VOICES.STOMP, this.stompChain);
                this.player.vy = -STOMP_BOUNCE;
                // A stomp is a launch of its own: kill the coyote window or
                // pressJump's coyote branch steals the input and upgrades
                // the bounce to a full jump mid-arc, and clear the cut flag
                // so releaseJump cannot shrink this arc — nor bank a stale
                // availability that would clip every later stomp on the
                // first keyup after it.
                this.player.coyoteTimer = 0;
                this.player.jumpCutAvailable = false;
                spawnBurst(this.particles,
                    this.player.x + this.player.width / 2,
                    this.player.y + this.player.height,
                    '#c96bf5', 10);
                // Stomp awards (owner ruling 2026-11-04): scored per enemy by
                // kind from resolvePlayerContact's list — chargers pay the
                // mid-dash risk premium. The stomped enemies are dead now, so
                // the dodge pass below can never double-pay one of them.
                let stompPoints = 0;
                for (const killed of contact.stompedEnemies) {
                    // Premium tier (40): chargers for the mid-dash risk,
                    // bombardiers because dismounting a gun-carrier is the
                    // same hard read — and it carries a gun (owner ruling
                    // 2026-11-04). Stomping KILLS a bombardier: it is not
                    // spiny, its back is stomppable like any other body.
                    stompPoints += (killed.kind === 'charger' ||
                        killed.kind === 'bombardier')
                        ? CHARGER_STOMP_POINTS : STOMP_POINTS;
                }
                this.levelCombatPoints += stompPoints;
                this.levelEnemiesKilled += contact.stompedEnemies.length;
                this.score = Math.min(this.score + stompPoints, Number.MAX_SAFE_INTEGER);
                // Impact punch + shake (Wave B): the visual hit-stop stand-in
                // for a clean stomp, plus one aggregated '+N STOMP!' popup at
                // the first victim (multi-stomps pay once, never stack text).
                this._impactFx(STOMP_SHAKE_TIME, STOMP_SHAKE_MAG);
                if (FX.popups && stompPoints > 0) {
                    const mark = contact.stompedEnemies[0];
                    const [sx, sy] = this._worldToScreen(
                        mark.x + mark.width / 2, mark.y);
                    spawnPopup(this.popups, sx, sy,
                        `+${stompPoints} STOMP!`, '#c96bf5', true);
                }
                // M5 stomp-chain bonus: every kill this tick extends the
                // airborne streak (a simultaneous multi-kill frame counts all
                // of its kills). The flat +30 pays ONCE when the streak first
                // reaches STOMP_CHAIN_MIN; the latch keeps a 3+ chain on the
                // same flat payout until landing clears everything. Popup at
                // the hero (the enemy-position STOMP popup may share the
                // frame — different text, so the pool dedupe never eats it).
                this.stompChain += contact.stomped;
                if (this.stompChain >= STOMP_CHAIN_MIN && !this._chainBonusPaid) {
                    this._chainBonusPaid = true;
                    this.levelCombatPoints += STOMP_CHAIN_BONUS;
                    this.score = Math.min(this.score + STOMP_CHAIN_BONUS,
                        Number.MAX_SAFE_INTEGER);
                    if (FX.popups) {
                        const [cx, cy] = this._worldToScreen(
                            this.player.x + this.player.width / 2,
                            this.player.y - 14);
                        spawnPopup(this.popups, cx, cy,
                            `+${STOMP_CHAIN_BONUS} CHAIN!`, '#f4a460', true);
                    }
                }
            }
            if (contact.deadly) {
                // Teach the spiked-back rule at the exact moment it bites.
                this.handleGameOver(contact.deadlyBySpiny ? 'spiny' : 'enemy');
                return;
            }

            // Bombardier cannonballs step AFTER the enemy bodies resolve
            // (fixed death order: patrol contact, then shot, then spikes,
            // then pit — one game over per tick). dt-driven only, so PAUSED
            // freezes a ball mid-arc; impacts feed the shared particle
            // system for dust (visual-only Math.random lives there, never
            // in the simulation), and a hit ends the run with its own
            // teachable cause.
            const shots = this.projectiles.updateAll(dt, this.player);
            if (shots.fired > 0) audio.playSfx(audio.SFX_VOICES.BOMBARD_FIRE);
            for (const impact of shots.impacts) {
                spawnBurst(this.particles, impact.x, impact.y, '#b9a58a', 6);
                // Wave B: a shell landing shakes the frame lightly and gets
                // the zoom punch so shots announce themselves even muted.
                this._impactFx(SHELL_SHAKE_TIME, SHELL_SHAKE_MAG);
            }
            if (shots.hitPlayer) {
                this.handleGameOver('projectile');
                return;
            }

            if (this.hazards.checkPlayerSpikes(this.player)) {
                this.handleGameOver('spike');
                return;
            }

            // Check for falling off the world, delegated to Hazards. The
            // height passed is in world/CSS pixels: canvas.height is the
            // device-pixel backing store and drifts with devicePixelRatio,
            // which would move the death line (and could place it above the
            // spawn ground on short windows).
            if (this.hazards.checkPitFall(this.player, this.level.height * this.level.tileSize)) {
                this.handleGameOver('pit');
                return;
            }

            // Dodge awards (owner ruling 2026-11-04): once per live enemy per
            // level attempt for ALREADY crossing it — the player's centre was
            // on one side last frame and is on the other this frame, with no
            // death having ended the tick (every deadly check above returns
            // first, so a dying frame can never award). Dead enemies are
            // skipped forever, which pins stomp/dodge mutual exclusion: an
            // enemy killed before being crossed stays skipped by its `dead`
            // flag and never collects the dodge. The per-enemy `dodged` flag
            // caps repeat flips (patrol turnarounds, pacing back and forth)
            // at one award; it is born false with each rebuilt Level, so a
            // retry re-arms every patrol. Riding a moving deck past counts —
            // the rule reads centres, not inputs. A flip whose position step
            // exceeds DODGE_MAX_CROSS_STEP is a teleport, not a crossing:
            // re-baseline unpaid. dt-driven only: this lives inside the
            // PLAYING branch, so PAUSED cannot farm flips.
            for (const enemy of this.enemyManager.enemies) {
                if (enemy.isDead()) continue;
                const px = this.player.x + this.player.width / 2;
                const side = Math.sign(px - (enemy.x + enemy.width / 2));
                if (side === 0) continue; // straddling centres: hold last side
                if (enemy._dodgePrevSide !== 0 && side !== enemy._dodgePrevSide &&
                    !enemy.dodged && Math.abs(px - enemy._dodgePrevPx) <= DODGE_MAX_CROSS_STEP) {
                    enemy.dodged = true;
                    this.levelCombatPoints += DODGE_POINTS;
                    this.levelEnemiesDodged++;
                    this.score = Math.min(this.score + DODGE_POINTS,
                        Number.MAX_SAFE_INTEGER);
                    // Wave B: the dodge bonus surfaces as a small cream '+5'
                    // at the body just crossed (chip ink-cream, quiet tier).
                    if (FX.popups) {
                        const [sx, sy] = this._worldToScreen(
                            enemy.x + enemy.width / 2, enemy.y - 6);
                        spawnPopup(this.popups, sx, sy,
                            `+${DODGE_POINTS}`, '#fdf6e8');
                    }
                }
                enemy._dodgePrevSide = side;
                enemy._dodgePrevPx = px;
            }

            // Coins add onto the running total, which accumulates across
            // levels; the per-collectibles getScore() is this level's score
            // only and must never be assigned over the total. Capped at
            // MAX_SAFE_INTEGER (spec §Error Handling) so no accumulation
            // length can wrap the score into negative territory. M5: the
            // detailed pass splits SECRET coins so they pay their premium in
            // the same tick (portal gate and HUD stay REQUIRED-only — T6
            // semantics untouched).
            const pickups = this.collectibles.checkCollectionDetailed(this.player);
            if (pickups.count > 0) {
                const normalCount = pickups.count - pickups.secretCount;
                const coinPoints = normalCount * COIN_POINTS +
                    pickups.secretCount * SECRET_COIN_SCORE;
                // Wave D reward differentiation by ear: the plain ping for
                // route coins, the richer three-tone for secrets — a mixed
                // frame rings both (rare, and they layer cleanly).
                if (normalCount > 0) audio.playSfx(audio.SFX_VOICES.COIN);
                if (pickups.secretCount > 0) {
                    audio.playSfx(audio.SFX_VOICES.COIN_SECRET);
                }
                // Sparkle at the player: pickups read as events, not silent
                // counter bumps. The burst inherits the coin sheet's gold.
                spawnBurst(this.particles,
                    this.player.x + this.player.width / 2,
                    this.player.y + this.player.height / 2,
                    COIN_BURST_COLOR, 12);
                this.score = Math.min(
                    this.score + coinPoints,
                    Number.MAX_SAFE_INTEGER
                );
                // Per-level coin tracker for the LEVEL_COMPLETE breakdown:
                // only loop-scored pickups land here, matching exactly what
                // entered this.score (seam-collectCoin() calls never scored
                // either side). Coins banked before a death stay counted —
                // they were earned on THIS level's attempt series. The line
                // carries secret premiums too: it mirrors the coin income of
                // the clear, tier by tier.
                this.levelCoinPoints += coinPoints;
                // M5 run-stats (session-only): every secret banked through
                // the loop counts once ever — collected flags make repeat
                // pickups impossible, and retry transfers via seam calls
                // deliberately do NOT re-count.
                this.runSecretsFound += pickups.secretCount;
                // Spec: +2 s per coin, unconditionally. The run clock is one
                // object across the whole game, so coins banked before the
                // timer tier (level 5) are already on it when it starts
                // ticking — no separate pending-bonus ledger needed.
                for (let i = 0; i < pickups.count; i++) this.timer.addCoinBonus();
                this._updateCoinHud();
                // Wave B: one '+N' popup per pickup event (multi-coin frames
                // pay a single aggregated number above the hero — chip gold).
                if (FX.popups && normalCount > 0) {
                    const [sx, sy] = this._worldToScreen(
                        this.player.x + this.player.width / 2,
                        this.player.y + 4);
                    spawnPopup(this.popups, sx, sy,
                        `+${normalCount * COIN_POINTS}`, '#ffd23f');
                }
                // M5: the secret premium announces itself — grass-green
                // (palette --grass, unmistakable against the coin gold and
                // ink outline) one tier above the hero so a mixed frame shows
                // both lines. Same pool, same FX.popups gate as its siblings.
                if (FX.popups && pickups.secretCount > 0) {
                    const [sx, sy] = this._worldToScreen(
                        this.player.x + this.player.width / 2,
                        this.player.y - 12);
                    spawnPopup(this.popups, sx, sy,
                        `SECRET +${pickups.secretCount * SECRET_COIN_SCORE}`,
                        '#3ecf6a', true);
                }
            }

            // Portal-gate chime on the locked→unlocked flip only: the flag
            // is seeded from the level's current state in publishLevel, so
            // a retry that starts with every coin banked never re-rings.
            if (!this._portalUnlocked && this.collectibles.meetsPortalRequirement()) {
                this._portalUnlocked = true;
                audio.playSfx(audio.SFX_VOICES.PORTAL_UNLOCK);
                // Wave B celebration on the locked→unlocked flip: one-shot
                // expanding ring pulse (FX.pulse) plus a themed sparkle fan
                // through the existing burst pool.
                const gate = this.level.getPortal();
                if (gate && FX.pulse) {
                    const gx = gate.x + gate.width / 2;
                    const gy = gate.y + gate.height / 2;
                    const pTheme = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
                    spawnRing(this.rings, gx, gy, pTheme.portalGlow);
                    spawnBurst(this.particles, gx, gy, pTheme.portalGlow, 10);
                }
            }

            // Check portal contact; ghosted and inert until every coin is
            // collected, so locked contact does nothing. Same Collectibles
            // instance the loop scores through (publishLevel adopts it from
            // the level) — one access path, no aliasing against this.level.
            const portal = this.level.getPortal();
            if (portal && !this.player.hasReachedPortal() &&
                this.collectibles.meetsPortalRequirement() &&
                this.physics.checkAABB(this.player, portal)) {
                this.player.markPortalReached();
            }

            // Check level completion
            if (this.player.hasReachedPortal()) {
                this.handleWin();
            }

            // Update camera
            this.camera.follow(
                this.player,
                this.level.width * this.level.tileSize,
                this.level.height * this.level.tileSize,
                dt
            );

            // Camera look-ahead (Wave B): a RENDER-ONLY offset eased toward
            // ~0.06 s of travel lead, hard-clamped to ±10 px with a standstill
            // deadzone so it never jitters at rest. camera.x stays the single
            // authoritative logic position — this value is applied (and world-
            // clamped) in draw() only, and shows strictly MORE of what's
            // ahead, never less. Disabled by FX.lookahead (reduced-motion).
            const laTarget = FX.lookahead &&
                Math.abs(this.player.vx) > LOOKAHEAD_DEADZONE_VX
                ? Math.max(-LOOKAHEAD_MAX_PX,
                    Math.min(LOOKAHEAD_MAX_PX, this.player.vx * LOOKAHEAD_LEAD_S))
                : 0;
            this._lookAhead += (laTarget - this._lookAhead) *
                (1 - Math.exp(-8 * dt));
            if (Math.abs(laTarget - this._lookAhead) < 0.25) {
                this._lookAhead = laTarget;
            }

            // Update UI
            this.ui.updateScore(this.score);
            this.ui.updateLevel(this.currentLevel);
        } else if (this.state === STATE.LEVEL_COMPLETE) {
            this.levelCompleteTimer -= dt;
            if (this.levelCompleteTimer <= 0) {
                if (this.currentLevel >= FINAL_LEVEL) {
                    // The run ends here: never construct level FINAL_LEVEL+1.
                    this.handleGameComplete();
                    this.ui.hideOverlay('level-complete-screen');
                } else {
                    // The fallible construction happens BEFORE currentLevel
                    // advances: on generation exhaustion the game stays
                    // LEVEL_COMPLETE with the finished level intact, instead of
                    // corrupting into a PLAYING state with stale systems or
                    // double-advancing via the stale portal flag.
                    const next = this.currentLevel + 1;
                    try {
                        const level = new Level(next, TILE_SIZE, this.seedFor(next));
                        this.currentLevel = next;
                        // The NEXT level starts a clean economy sheet: deaths,
                        // coin/combat accumulators and bested counts from the
                        // cleared level are spent (its bonus was already paid
                        // by handleWin). Retries never reach this line.
                        this.resetLevelEconomyTrackers();
                        this.publishLevel(level);
                        this.ui.hideOverlay('level-complete-screen');
                        // Wave C between-levels card: rides the first ~1.6 s
                        // of live play on the new map (presentation-only —
                        // the transition budget itself is untouched).
                        this.ui.showLevelIntro(next);
                    } catch (error) {
                        // Spec §Error Handling (transition timeout): never
                        // stick in LEVEL_COMPLETE. Keep forcing the transition
                        // every frame past the nominal 2 s budget — each retry
                        // is a fresh randomised generation, so this self-heals
                        // fast (I2 fix: 0/800 exhaustion) — but log once per
                        // stall instead of flooding console.error through the
                        // loop. Persistent failure hands off to MENU on the
                        // same terms as loop-error recovery (S1): a generator
                        // that fails LEVEL_TRANSITION_MAX_STALL_FRAMES frames
                        // in a row is broken, not unlucky, and unbounded
                        // per-frame rebuilds freeze the tab silently.
                        this.levelTransitionStallFrames++;
                        if (this.levelTransitionStallFrames >
                            LEVEL_TRANSITION_MAX_STALL_FRAMES) {
                            console.error(
                                'Level transition failed persistently; returning to menu:', error);
                            this.ui.hideOverlay('level-complete-screen');
                            this.returnToMenu();
                            this.ui.showErrorMessage('Something went wrong. Returning to main menu.');
                        } else if (!this.levelTransitionStalled) {
                            console.error('Level transition stalled; retrying:', error);
                            this.levelTransitionStalled = true;
                        }
                    }
                }
            }
        }
    }

    draw() {
        const sprites = this.sprites.ready() ? this.sprites : null;

        // MENU live demo backdrop (Wave C): the real sky/hills/cloud system
        // scrolling behind the title panel with NO Level constructed — the
        // backdrop bakes once per theme band and later frames are pure
        // cached blits, repaint-throttled to ~30 fps. On skipped ticks the
        // canvas must NOT be cleared either (a clear without a repaint would
        // flicker flat sky between blits), so the MENU branch owns its full
        // clear-and-paint cycle and returns. Guarded by sprites readiness
        // like every other sheet pass; degrade path stays the flat sky.
        if (this.state === STATE.MENU && sprites) {
            if (this._titleDirty) {
                this._titleDirty = false;
                this._titlePainted = true;
                this.ctx.fillStyle = '#87CEEB';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                const viewW = window.innerWidth;
                const viewH = window.innerHeight;
                const cycle = Math.floor(this._titleScroll / TITLE_THEME_SPAN);
                const themeIdx = ((cycle % THEMES.length) + THEMES.length) %
                    THEMES.length;
                sprites.drawBackground(this.ctx, themeIdx + 1,
                    this._titleScroll, viewW, viewH, Infinity,
                    TITLE_SEEDS[themeIdx]);
                sprites.drawForeground(this.ctx, themeIdx + 1,
                    this._titleScroll, viewW, viewH, TITLE_SEEDS[themeIdx]);
                sprites.drawVignette(this.ctx, themeIdx + 1, viewW, viewH);
            }
            return;
        }

        // Clear canvas (legacy sky colour; themed parallax paints over it
        // when sheets are loaded).
        this.ctx.fillStyle = '#87CEEB';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // PAUSED keeps rendering the frozen scene; the overlay sits on top.
        if (this.state === STATE.PLAYING || this.state === STATE.LEVEL_COMPLETE ||
            this.state === STATE.PAUSED) {
            this.ctx.save();

            const viewW = window.innerWidth;
            const viewH = window.innerHeight;
            const zoom = this.zoom;
            // Visible world extent at the current zoom.
            const effW = viewW / zoom;
            const effH = viewH / zoom;
            const themeIdx = (Math.max(1, this.currentLevel) - 1) % THEMES.length;

            // Impact zoom punch (Wave B): 1 -> 1.03 -> 1 over ~120 ms around
            // the viewport centre, composed OUTSIDE the world transform so it
            // scales the whole rendered scene. Presentation only — the loop
            // keeps stepping the simulation at its fixed cadence (this is a
            // substitute for hit-stop, never one). Gated by FX.punch.
            const punch = punchScale(PUNCH_TIME - this._punchTime);
            if (punch !== 1) {
                this.ctx.translate(viewW / 2, viewH / 2);
                this.ctx.scale(punch, punch);
                this.ctx.translate(-viewW / 2, -viewH / 2);
            }

            // Look-ahead render offset (see update()): clamped into the same
            // world bounds the camera itself obeys, so the lead can never
            // reveal past the map edge; small-map centring stays untouched.
            const worldWpx = this.level.width * this.level.tileSize;
            let camX = this.camera.x;
            if (this._lookAhead !== 0 && worldWpx > effW) {
                camX = Math.max(0, Math.min(camX + this._lookAhead,
                    worldWpx - effW));
            }

            // Screen y of the world floor under the full transform:
            // screen = (world + camera.y - effH/2) * zoom + viewH/2. Also
            // drives the climb read (zenith overlay trigger in sprites.js,
            // falling flecks below): >64 px past the viewport bottom means
            // the camera is aloft on a vertical map.
            const worldBottom = this.level.height * this.level.tileSize;
            const worldBottomScreen =
                (worldBottom + this.camera.y - effH / 2) * zoom + viewH / 2;
            if (sprites) {
                sprites.drawBackground(this.ctx, this.currentLevel, camX,
                    viewW, viewH, worldBottomScreen,
                    this.level.seed === undefined ? null : this.level.seed);
            }

            // Screen shake (death / stomps / shell impacts): a DETERMINISTIC
            // decaying sine offset on the camera only — physics and hitboxes
            // never see it, and frame captures replay identically (the old
            // Math.random pass broke the render-no-RNG rule). Gated by
            // FX.shake inside shakeOffset.
            const sh = shakeOffset(this.shakeTime,
                this.shakeMag || DEATH_SHAKE_MAG,
                this.shakeDur || DEATH_SHAKE_TIME);
            const shakeX = sh.x;
            const shakeY = sh.y;

            // World transform: centre the (zoomed) viewport on the camera's
            // top-left corner. At zoom 1 this reduces exactly to the legacy
            // translate(-camera.x, +camera.y). Camera clamping centres the
            // whole level when it is smaller than the viewport. The look-
            // ahead lead rides here (camX), never into camera.x itself.
            this.ctx.translate(viewW / 2 + shakeX, viewH / 2 + shakeY);
            this.ctx.scale(zoom, zoom);
            this.ctx.translate(-(camX + effW / 2), this.camera.y - effH / 2);

            // Terrain comes from the sprite layer's culled grid pass (in
            // world units of the zoomed viewport); level.draw owns entities.
            if (sprites) sprites.drawWorld(this.ctx, this.level, camX, this.camera.y, effW, effH);
            // Moving decks sit between props and entities: world-washed like
            // terrain furniture, always under coins/enemies/player. Vector art
            // works with or without the sheets, so this call is unconditional.
            if (this.movingPlatforms && this.movingPlatforms.platforms.length) {
                this.sprites.drawMovingPlatforms(this.ctx,
                    this.movingPlatforms.platforms, this.currentLevel);
            }
            // M3 capability objects sit in the same world-furniture band:
            // vector art, so they render identically with or without the
            // sprite sheets (the degrade path IS the primary path).
            if (this.pads.length) drawPads(this.ctx, this.pads);
            if (this.crate) drawCrates(this.ctx, [this.crate]);
            // Mood wash over background+terrain+props only — entities below
            // paint at full contrast (hazard-readability ruling).
            if (sprites) sprites.drawMoodTint(this.ctx, this.currentLevel,
                camX, this.camera.y, effW, effH);
            this.level.draw(this.ctx, sprites, this.player);

            // Cannonballs ride above the entity pass (they fly over decks
            // and heads) but below the player, so the hero is never hidden
            // by an incoming ball. Wave B: with FX.trails on they carry a
            // themed ember ghost trail so shots stay trackable against dusk.
            if (this.projectiles && this.projectiles.list.length) {
                this.projectiles.drawAll(this.ctx,
                    FX.trails ? THEMES[themeIdx].mote : null);
            }

            // Dash-streak ghosts (M2): fading hero silhouettes behind the
            // body, drawn UNDER the live player so the real sprite always
            // wins. Same theme-mote hue as projectile trails; alpha decays
            // with age and rides FX.intensity (reduced-motion softens rather
            // than removes — fx.js keeps the trails family ON). Draw gate
            // mirrors the spawn gate in update().
            if (FX.trails && this._dashGhosts.length) {
                const ghColor = THEMES[themeIdx].mote;
                for (const g of this._dashGhosts) {
                    const k = Math.max(0, 1 - g.age / DASH_GHOST_LIFE);
                    this.ctx.globalAlpha = k * k * 0.35 * FX.intensity;
                    this.ctx.fillStyle = ghColor;
                    this.ctx.fillRect(g.x, g.y,
                        this.player.width, this.player.height);
                }
                this.ctx.globalAlpha = 1;
            }

            // Player squash & stretch (Wave B, DRAW-TIME ONLY — the collision
            // box is never touched): landing thud compresses height (depth
            // scaled by impact fall speed) while widening the silhouette; a
            // jump launch stretches tall for a beat; acceleration leans the
            // hero toward travel. Height rides the legacy `squash` channel
            // (the sprite path anchors feet), width/lean ride a ctx transform
            // around the same feet anchor. FX.squash off => rigid body.
            let squash = 1;
            let bodySx = 1;
            if (FX.squash) {
                const landK = this.squashTimer > 0 ? this.squashTimer / 0.12 : 0;
                const depth = 0.30 * (0.45 + 0.55 * this._landDepth) * FX.intensity;
                const launchK = this._launchStretch > 0
                    ? this._launchStretch / LAUNCH_STRETCH_TIME : 0;
                squash = (1 - depth * landK) * (1 + 0.18 * launchK * FX.intensity);
                bodySx = 1 + depth * landK * 0.8 - 0.13 * launchK * FX.intensity;
            }
            this.ctx.save();
            if (bodySx !== 1 || this._lean !== 0) {
                const pcx = this.player.x + this.player.width / 2;
                const pfeet = this.player.y + this.player.height;
                this.ctx.translate(pcx, pfeet);
                this.ctx.rotate(this._lean);
                this.ctx.scale(bodySx, 1);
                this.ctx.translate(-pcx, -pfeet);
            }
            this.player.draw(this.ctx, sprites, squash);
            this.ctx.restore();

            if (this.particles.length) drawParticles(this.ctx, this.particles);
            // Gameplay dust rides its own pool (own cap) just under the burst
            // sparks; low per-particle alpha keeps it out of the playfield.
            if (this.dust.length) drawParticles(this.ctx, this.dust);
            // Portal-unlock ring pulses (world space; FX.pulse gates both the
            // spawn in update() and this draw, so a mid-life flag flip hides).
            if (FX.pulse && this.rings.length) drawRings(this.ctx, this.rings);

            this.ctx.restore();

            // Ambient motes draw OUTSIDE the world transform: they live in
            // screen space with per-mote parallax against cameraX, rebuilt
            // once per level instance from a hash of the LEVEL SEED (look-A).
            // Firefly bands on night themes hover low; climb maps carry
            // falling flecks that only render while the floor is out of view.
            const amb = THEMES[themeIdx];
            if (this._motesSource !== this.level) {
                this._motesSource = this.level;
                const climbMap = worldBottom > viewH / zoom + 64;
                this.motes = createMotes(MOTE_COUNT,
                    (Math.imul((this.level.seed ?? this.currentLevel) >>> 0,
                        0x9E3779B1) ^ 0x51F3B6A1) >>> 0,
                    viewW, viewH,
                    { fireflies: amb.fireflies, flecks: climbMap ? CLIMB_FLECKS : 0 });
            }
            if (this.motes.length) {
                drawMotes(this.ctx, this.motes, camX, viewW,
                    amb.mote, amb.fireflies, worldBottomScreen - viewH > 64);
            }

            // Foreground silhouette strip + vignette: the near side of the
            // lens. Both screen-space, both drawn under the seed readout so
            // the diagnostics text stays legible.
            if (sprites) {
                sprites.drawForeground(this.ctx, this.currentLevel,
                    camX, viewW, viewH,
                    this.level.seed === undefined ? null : this.level.seed);
                sprites.drawVignette(this.ctx, this.currentLevel, viewW, viewH);
            }

            // Floating score popups (Wave B): canvas-space layer above the
            // world, below the DOM HUD chips; pixel font, chip-palette fills.
            drawPopups(this.ctx, this.popups, zoom);

            // Map identity readout: pins the exact generated layout from a
            // screenshot alone (retry replays the same seed, so what the
            // player sees is what `new Level(level, 32, seed)` reproduces).
            // Legibility ruling 2026-11-05 (player report: "The seed can
            // barely be seen in the bottom right"): the old 10px black-at-
            // 45%-alpha text vanished against dark terrain. A soft shadow
            // plate plus bright bold text keeps it readable on ANY backdrop —
            // sky, rock or night band — while staying quiet enough to ignore.
            if (this.level && this.level.seed !== null) {
                const label = `L${this.currentLevel} seed ${this.level.seed}`;
                this.ctx.font = 'bold 12px monospace';
                this.ctx.textAlign = 'right';
                const tw = this.ctx.measureText(label).width;
                const padX = 6, padY = 4;
                const x1 = viewW - 8, baseline = viewH - 8;
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
                this.ctx.fillRect(x1 - tw - padX, baseline - 10,
                    tw + padX * 2, 10 + padY);
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
                this.ctx.fillText(label, x1, baseline);
                this.ctx.textAlign = 'left';
            }
        }
    }

    loop(time) {
        // destroy() halts the frame chain: any already-scheduled final frame
        // returns here instead of re-arming and mutating a torn-down game.
        if (this._destroyed) return;

        const dt = (time - this.lastTime) / 1000;
        this.lastTime = time;

        // Cap dt to prevent physics issues on lag spikes
        const cappedDt = Math.min(dt, 0.05);

        // Schedule the next frame before running fallible work: a throw in
        // update/draw must not permanently freeze the game. The error is
        // surfaced on the console rather than silently killing the loop.
        requestAnimationFrame((t) => this.loop(t));
        try {
            this.update(cappedDt);
            this.draw();
            this.drawCelebration();
            // Clean frame: the error episode is over.
            this._loopErrorStreak = 0;
            this._recoveryAttempted = false;
        } catch (error) {
            console.error('Game loop error:', error);
            this._handleLoopError();
        }
    }

    // Wave C victory layer pass: blit the pooled confetti onto the dedicated
    // above-overlay canvas; when the pool empties, one final clear wipes the
    // celebration canvas transparent again (pointer-events:none keeps it
    // click-through the whole time).
    drawCelebration() {
        const ctx = this.fxCtx;
        if (!ctx || typeof ctx.clearRect !== 'function') return;
        if (!this.confetti.length) {
            if (this._fxCanvasDirty) {
                ctx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);
                this._fxCanvasDirty = false;
            }
            return;
        }
        ctx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);
        drawConfetti(ctx, this.confetti);
        this._fxCanvasDirty = true;
    }

    // Spec §General Error Handling: "On error, attempt to return to PLAYING
    // state with error message displayed." Forcing that on the first error
    // would storm exactly like the R26 flood whenever corruption persists,
    // so recovery engages only after LOOP_ERROR_RECOVERY_FRAMES consecutive
    // failing frames inside a run, tries once per episode (rebuilding the
    // current level heals most broken state), and gives up to MENU if
    // errors keep coming through the next equal window.
    _handleLoopError() {
        this._loopErrorStreak++;
        const inRun = this.state === STATE.PLAYING || this.state === STATE.PAUSED;
        if (!inRun) return; // outside a run there is no PLAYING to recover into
        if (!this._recoveryAttempted) {
            if (this._loopErrorStreak >= LOOP_ERROR_RECOVERY_FRAMES) {
                this._attemptLoopRecovery();
            }
        } else if (this._loopErrorStreak >= 2 * LOOP_ERROR_RECOVERY_FRAMES) {
            console.error('Game loop errors persisted after recovery; returning to menu');
            this.ui.hideOverlay('pause-screen');
            this.returnToMenu();
            this.ui.showErrorMessage('Something went wrong. Returning to main menu.');
        }
    }

    _attemptLoopRecovery() {
        this._recoveryAttempted = true;
        console.error('Attempting recovery from repeated game loop errors');
        try {
            // Construct before publishing (same discipline as startGame): if
            // generation throws, fall through to the MENU handoff rather than
            // adopting a half-built level.
            const level = new Level(this.currentLevel, TILE_SIZE,
                this.seedFor(this.currentLevel));
            this.ui.showErrorMessage('Something went wrong — recovering…');
            // Recovery can fire while PAUSED (draw() runs inside the loop's
            // try during pause), and publishLevel flips straight to PLAYING:
            // close the pause overlay first or the run resumes live behind a
            // still-visible "Game Paused" modal. Mirrors togglePause's
            // PAUSED→PLAYING branch; both are no-ops when not paused.
            this.ui.blurPauseControls();
            this.ui.hideOverlay('pause-screen');
            this.publishLevel(level);
        } catch (inner) {
            console.error('Recovery failed; returning to menu:', inner);
            this.ui.hideOverlay('pause-screen');
            this.returnToMenu();
            this.ui.showErrorMessage('Something went wrong. Returning to main menu.');
        }
    }
}

export function init() {
    const game = new Game();
    // Debug seam for E2E tests (read-only from the test's perspective).
    if (typeof window !== 'undefined') {
        window.game = game;
    }
}

// Initialize game when DOM is ready
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
    });
}
