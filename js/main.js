import { InputHandler } from './input.js';
import { Physics } from './physics.js';
import { Player } from './player.js';
import { Level } from './level.js';
import { Camera } from './camera.js';
import { UI } from './ui.js';
import { COIN_POINTS } from './collectibles.js';
import { Difficulty, tierIndexFor } from './difficulty.js';
import { Timer } from './timer.js';
import { Sprites, THEMES } from './sprites.js';
import { MovingPlatformManager, applyJumpBoost } from './movingplatforms.js';
import { spawnBurst, stepParticles, drawParticles, createMotes, stepMotes, drawMotes, MAX_PARTICLES } from './particles.js';
import * as audio from './audio.js';

// Game constants
export const TILE_SIZE = 32;

// Ambient drifting motes per level (dust/fireflies by theme). Deliberately
// far below MAX_MOTES: ambience should never read as noise.
const MOTE_COUNT = 18;

// Integer world zoom: on large displays the pixel art scales up to fill the
// viewport instead of sitting small in the top-left. Target ~540 CSS px of
// visible world height per zoom step (1080p -> 2x, 1440p+ -> 3x, laptops
// stay 1x so generation geometry stays legible).
export function computeZoom(viewportHeight) {
    return Math.max(1, Math.min(3, Math.round(viewportHeight / 540)));
}

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
// Winning this level finishes the whole run instead of generating another.
// Exported so tests pin their final-level fixtures to the same number.
export const FINAL_LEVEL = 100;
const HIGH_SCORE_KEY = 'platformerHighScore';
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
        // Portal-gate edge tracker for the unlock chime: seeded from the
        // level's current state in publishLevel so a retry that starts with
        // every coin already banked does not re-ring.
        this._portalUnlocked = false;

        // Game state
        this.state = STATE.MENU;
        this.level = null;
        // Fresh per-run seed for deterministic level layouts (see seedFor);
        // startGame re-rolls it for each new run.
        this.runSeed = 1;
        this.player = null;
        // Per-level element systems: assigned from the Level's getters in
        // startLevel(), null until a level exists (MENU stays safe because
        // update() only touches them inside the PLAYING branch).
        this.enemyManager = null;
        this.collectibles = null;
        this.hazards = null;
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
        // Breakdown handed to the LEVEL_COMPLETE overlay by handleWin
        // {coins, combat, clearBonus, enemiesBested, deaths, flawless}.
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
            this.player.pressJump();
            if (this.player.vy < vyBefore) {
                audio.playSfx('jump');
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
            if (code === 'Escape' && !e.repeat) {
                if (this.state === STATE.GAME_OVER || this.state === STATE.GAME_COMPLETE) {
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
            } else if (this.state === STATE.PAUSED && code in PAUSE_MENU_ARROWS) {
                e.preventDefault();
                this.ui.cyclePauseFocus(PAUSE_MENU_ARROWS[code]);
            }
        }, { signal: this._abort.signal });
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
    }

    // Spec: Escape on an end screen returns to MENU, never pauses.
    returnToMenu() {
        this.setState(STATE.MENU);
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

    startGame() {
        // Construct before mutating anything (same discipline as startLevel):
        // if generation exhausts and fails, a GAME_COMPLETE/GAME_OVER screen
        // keeps its state and overlay instead of being stranded over zeroed
        // run data.
        // Fresh layout seed for this run: retries replay its levels, Play
        // Again does not. Rolled before construction so level 1 uses it.
        this.runSeed = (Math.random() * 0xffffffff) >>> 0;
        const level = this.tryConstructLevel(1);
        if (!level) return false;
        this.score = 0;
        this.currentLevel = 1;
        // A brand-new run starts with a clean economy sheet: no deaths, no
        // per-level accumulators carried over from the previous run.
        this.resetLevelEconomyTrackers();
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
    seedFor(levelNumber) {
        return (this.runSeed + Math.imul(levelNumber, 0x9E3779B1)) >>> 0;
    }

    tryConstructLevel(levelNumber) {
        try {
            return new Level(levelNumber, TILE_SIZE, this.seedFor(levelNumber));
        } catch (first) {
            console.error('Level generation failed; re-attempting once:', first);
        }
        try {
            // Seeded generation is deterministic: re-using the same seed
            // would replay the exact 200-attempt sequence that just failed.
            // Nudge into neighbouring seed space so the rescue can succeed.
            return new Level(levelNumber, TILE_SIZE,
                (this.seedFor(levelNumber) ^ 0x5bf03635) >>> 0);
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
        // Decks follow the same per-level lifecycle as the systems above:
        // every publish (new level, retry, loop recovery) mints a fresh
        // manager from the adopted level's descriptors, so elapsed time — and
        // therefore the whole shuttle schedule — restarts identically for a
        // replayed seed.
        this.movingPlatforms = new MovingPlatformManager(level.getMovingPlatforms());
        this._riding = null;
        // Coin chip reflects this level's progress: fresh on first play,
        // carried over on a retry (collected flags transfer with the seed).
        this.ui.updateCoins(
            this.collectibles.getCoins().length -
                this.collectibles.getUncollectedCoins().length,
            this.collectibles.getCoins().length
        );
        // Seed the chime edge tracker from the adopted level's gate state
        // (see the unlock check in update()).
        this._portalUnlocked = this.collectibles.meetsPortalRequirement();
        // Snapshot before any of this level's coins can be collected.
        this.levelStartScore = this.score;
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
        this.score = Math.min(this.score + clearBonus, Number.MAX_SAFE_INTEGER);
        this.lastClearBreakdown = {
            coins: this.levelCoinPoints,
            combat: this.levelCombatPoints,
            clearBonus,
            enemiesBested: this.levelEnemiesKilled + this.levelEnemiesDodged,
            deaths: this.deathsOnCurrentLevel,
            flawless: this.deathsOnCurrentLevel === 0
        };
        this.setState(STATE.LEVEL_COMPLETE);
        // Win sting over the top of the still-running music: the transition
        // is a 2 s beat, not an ending, so the loop carries through to the
        // next level (crossfading only when its band/variation changes).
        audio.playSfx('level_complete');
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
        audio.stopMusic();
        audio.playSfx('death');
        // Death feedback (visual-only): a short camera shake plus a red
        // burst at the player so the moment of loss is unmistakable.
        this.shakeTime = 0.35;
        if (this.player) {
            spawnBurst(this.particles,
                this.player.x + this.player.width / 2,
                this.player.y + this.player.height / 2,
                '#ff5a5a', 16);
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
        this.ui.showGameComplete(this.score, highScore);
    }

    update(dt) {
        // Visual-only clocks run in every state: sprites animate behind the
        // overlays, particles finish their bursts, and the death shake plays
        // out on the GAME_OVER screen.
        this.sprites.advance(dt);
        stepParticles(this.particles, dt);
        if (this.motes.length) {
            stepMotes(this.motes, dt, window.innerWidth, window.innerHeight);
        }
        if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
        if (this.squashTimer > 0) this.squashTimer = Math.max(0, this.squashTimer - dt);

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
                audio.playSfx('jump');
                // Buffered launch off a ridden deck inherits too (same policy
                // as the input-callback path above).
                applyJumpBoost(this.player, this._riding);
            }

            // Apply physics
            this.physics.applyGravity(this.player, dt);

            // Check collisions
            const collisions = this.physics.checkCollisions(this.player, this.level.getPlatforms());
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

            // Grounded-state edges (visual-tuning hooks, physics-safe):
            // air-to-ground fires the landing squash. The walked-off-a-ledge
            // drop seed now lives inside Player.update, deferred until the
            // coyote window it waits for expires there.
            if (this.player.grounded && !this._prevGrounded) {
                this.squashTimer = 0.12;
                if (vyBeforeResolve >= LANDING_SFX_MIN_FALL) audio.playSfx('land');
                // Landing brake: touching down with no direction held kills
                // the carried horizontal speed outright. Without it, jump
                // momentum marches the player off a narrow landing before
                // the (already hard) ground brake can act — the residual
                // "sliding" complaint on 2-tile platforms next to spikes.
                if (!this.input.isLeft() && !this.input.isRight()) {
                    this.player.vx = 0;
                }
            }
            this._prevGrounded = this.player.grounded;

            // Walking dust (terrain micro-feedback): a small puff each time a
            // runner crosses into a new tile while grounded. Driven by the
            // position event, not RNG, so two boots of one seed render
            // identical frames; capped with the shared particle budget.
            if (this.player.grounded && Math.abs(this.player.vx) > 120) {
                const footTx = Math.floor(
                    (this.player.x + this.player.width / 2) / this.level.tileSize);
                if (footTx !== this._dustTx) {
                    this._dustTx = footTx;
                    const dir = this.player.vx > 0 ? -1 : 1;
                    const themeIdx = (Math.max(1, this.currentLevel) - 1) % THEMES.length;
                    this.particles.push({
                        x: this.player.x + this.player.width / 2 - dir * 10,
                        y: this.player.y + this.player.height - 2,
                        vx: dir * (30 + (footTx & 3) * 8),
                        vy: -(20 + (footTx & 1) * 14),
                        life: 0.28,
                        maxLife: 0.28,
                        size: 2 + (footTx & 1),
                        color: THEMES[themeIdx].dust
                    });
                    if (this.particles.length > MAX_PARTICLES) this.particles.shift();
                }
            } else {
                this._dustTx = -1;
            }

            // Phase 2 elements. Death checks run in a fixed order (enemies,
            // spikes, pit) and stop the tick at the first hit, so several
            // simultaneous contacts produce exactly one game over.
            // Chargers need the player reference for their trigger zone
            // (walkers/spinies ignore it); see enemies.js header.
            this.enemyManager.updateAll(dt, this.player);
            // Stomp-aware enemy contact: falling feet-first from above
            // squashes the enemy (with a bounce and a poof); any other
            // contact is fatal.
            const contact = this.enemyManager.resolvePlayerContact(this.player);
            if (contact.stomped > 0) {
                audio.playSfx('stomp');
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
                    stompPoints += killed.kind === 'charger'
                        ? CHARGER_STOMP_POINTS : STOMP_POINTS;
                }
                this.levelCombatPoints += stompPoints;
                this.levelEnemiesKilled += contact.stompedEnemies.length;
                this.score = Math.min(this.score + stompPoints, Number.MAX_SAFE_INTEGER);
            }
            if (contact.deadly) {
                // Teach the spiked-back rule at the exact moment it bites.
                this.handleGameOver(contact.deadlyBySpiny ? 'spiny' : 'enemy');
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
                }
                enemy._dodgePrevSide = side;
                enemy._dodgePrevPx = px;
            }

            // Coins add onto the running total, which accumulates across
            // levels; the per-collectibles getScore() is this level's score
            // only and must never be assigned over the total. Capped at
            // MAX_SAFE_INTEGER (spec §Error Handling) so no accumulation
            // length can wrap the score into negative territory.
            const collectedCoins = this.collectibles.checkCollection(this.player);
            if (collectedCoins > 0) {
                audio.playSfx('coin');
                // Sparkle at the player: pickups read as events, not silent
                // counter bumps. Gold matches the coin sprite.
                spawnBurst(this.particles,
                    this.player.x + this.player.width / 2,
                    this.player.y + this.player.height / 2,
                    '#ffd23f', 12);
                this.score = Math.min(
                    this.score + collectedCoins * COIN_POINTS,
                    Number.MAX_SAFE_INTEGER
                );
                // Per-level coin tracker for the LEVEL_COMPLETE breakdown:
                // only loop-scored pickups land here, matching exactly what
                // entered this.score (seam-collectCoin() calls never scored
                // either side). Coins banked before a death stay counted —
                // they were earned on THIS level's attempt series.
                this.levelCoinPoints += collectedCoins * COIN_POINTS;
                // Spec: +2 s per coin, unconditionally. The run clock is one
                // object across the whole game, so coins banked before the
                // timer tier (level 5) are already on it when it starts
                // ticking — no separate pending-bonus ledger needed.
                for (let i = 0; i < collectedCoins; i++) this.timer.addCoinBonus();
                this.ui.updateCoins(
                    this.collectibles.getCoins().length -
                        this.collectibles.getUncollectedCoins().length,
                    this.collectibles.getCoins().length
                );
            }

            // Portal-gate chime on the locked→unlocked flip only: the flag
            // is seeded from the level's current state in publishLevel, so
            // a retry that starts with every coin banked never re-rings.
            if (!this._portalUnlocked && this.collectibles.meetsPortalRequirement()) {
                this._portalUnlocked = true;
                audio.playSfx('portal_unlock');
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

            if (sprites) {
                // Screen y of the world floor under the full transform:
                // screen = (world + camera.y - effH/2) * zoom + viewH/2.
                const worldBottom = this.level.height * this.level.tileSize;
                const worldBottomScreen =
                    (worldBottom + this.camera.y - effH / 2) * zoom + viewH / 2;
                sprites.drawBackground(this.ctx, this.currentLevel, this.camera.x,
                    viewW, viewH, worldBottomScreen);
            }

            // Death screen-shake: a decaying random offset on the camera
            // only — physics and hitboxes never see it.
            let shakeX = 0;
            let shakeY = 0;
            if (this.shakeTime > 0) {
                const mag = 9 * (this.shakeTime / 0.35);
                shakeX = (Math.random() * 2 - 1) * mag;
                shakeY = (Math.random() * 2 - 1) * mag;
            }

            // World transform: centre the (zoomed) viewport on the camera's
            // top-left corner. At zoom 1 this reduces exactly to the legacy
            // translate(-camera.x, +camera.y). Camera clamping centres the
            // whole level when it is smaller than the viewport.
            this.ctx.translate(viewW / 2 + shakeX, viewH / 2 + shakeY);
            this.ctx.scale(zoom, zoom);
            this.ctx.translate(-(this.camera.x + effW / 2), this.camera.y - effH / 2);

            // Terrain comes from the sprite layer's culled grid pass (in
            // world units of the zoomed viewport); level.draw owns entities.
            if (sprites) sprites.drawWorld(this.ctx, this.level, this.camera.x, this.camera.y, effW, effH);
            // Moving decks sit between props and entities: world-washed like
            // terrain furniture, always under coins/enemies/player. Vector art
            // works with or without the sheets, so this call is unconditional.
            if (this.movingPlatforms && this.movingPlatforms.platforms.length) {
                this.sprites.drawMovingPlatforms(this.ctx,
                    this.movingPlatforms.platforms, this.currentLevel);
            }
            // Mood wash over background+terrain+props only — entities below
            // paint at full contrast (hazard-readability ruling).
            if (sprites) sprites.drawMoodTint(this.ctx, this.currentLevel,
                this.camera.x, this.camera.y, effW, effH);
            this.level.draw(this.ctx, sprites);

            // Draw player (landing squash compresses height only)
            const squash = this.squashTimer > 0 ? 1 - 0.25 * (this.squashTimer / 0.12) : 1;
            this.player.draw(this.ctx, sprites, squash);

            if (this.particles.length) drawParticles(this.ctx, this.particles);

            this.ctx.restore();

            // Ambient motes draw OUTSIDE the world transform: they live in
            // screen space with per-mote parallax against cameraX, rebuilt
            // once per level instance from a level-derived seed.
            if (this._motesSource !== this.level) {
                this._motesSource = this.level;
                this.motes = createMotes(MOTE_COUNT,
                    Math.imul(this.currentLevel, 0x9E3779B1) >>> 0, viewW, viewH);
            }
            if (this.motes.length) {
                const amb = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
                drawMotes(this.ctx, this.motes, this.camera.x, viewW,
                    amb.mote, amb.fireflies);
            }

            // Foreground silhouette strip + vignette: the near side of the
            // lens. Both screen-space, both drawn under the seed readout so
            // the diagnostics text stays legible.
            if (sprites) {
                sprites.drawForeground(this.ctx, this.currentLevel,
                    this.camera.x, viewW, viewH);
                sprites.drawVignette(this.ctx, this.currentLevel, viewW, viewH);
            }

            // Map identity readout: pins the exact generated layout from a
            // screenshot alone (retry replays the same seed, so what the
            // player sees is what `new Level(level, 32, seed)` reproduces).
            if (this.level && this.level.seed !== null) {
                this.ctx.font = '10px monospace';
                this.ctx.textAlign = 'right';
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
                this.ctx.fillText(`L${this.currentLevel} seed ${this.level.seed}`,
                    viewW - 8, viewH - 8);
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
            // Clean frame: the error episode is over.
            this._loopErrorStreak = 0;
            this._recoveryAttempted = false;
        } catch (error) {
            console.error('Game loop error:', error);
            this._handleLoopError();
        }
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
