import { InputHandler } from './input.js';
import { Physics } from './physics.js';
import { Player } from './player.js';
import { Level } from './level.js';
import { Camera } from './camera.js';
import { UI } from './ui.js';
import { COIN_POINTS } from './collectibles.js';
import { Difficulty } from './difficulty.js';
import { Timer } from './timer.js';

// Game constants
export const TILE_SIZE = 32;
const GRAVITY = 980;
const PLAYER_SPEED = 200;
const JUMP_FORCE = 350;
const MAX_FALL_SPEED = 600;
// Jump feel windows: a Space press is honoured for this long after it lands
// (buffer), and ground contact is remembered for this long after it ends
// (coyote), so presses straddling the grounded transition are not dropped.
const JUMP_BUFFER_TIME = 0.12;
const COYOTE_TIME = 0.1;
// Winning this level finishes the whole run instead of generating another.
const FINAL_LEVEL = 15;
const HIGH_SCORE_KEY = 'platformerHighScore';

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
        // Camera viewport is in CSS pixels, not the device-pixel backing store.
        this.camera = new Camera(window.innerWidth, window.innerHeight);
        this.ui = new UI();
        // MENU baseline: with no run in progress the HUD has nothing to show,
        // and hiding it also takes #pause-btn out of the tab order on a fresh
        // load (startGame's publishLevel re-enables it).
        this.ui.hideHUD();
        this.ui.setPauseEnabled(false);
        // One run clock for the whole game: time carries over between levels
        // because nothing resets it mid-run (startGame() and retryLevel()
        // deliberately re-arm it; level transitions never do). Whether it
        // ticks at all is decided per level by the difficulty tier in
        // publishLevel().
        this.difficulty = new Difficulty();
        this.timer = new Timer(60);
        this.timerActive = false;

        // Game state
        this.state = STATE.MENU;
        this.level = null;
        this.player = null;
        // Per-level element systems: assigned from the Level's getters in
        // startLevel(), null until a level exists (MENU stays safe because
        // update() only touches them inside the PLAYING branch).
        this.enemyManager = null;
        this.collectibles = null;
        this.hazards = null;
        this.score = 0;
        // Score at the moment the current level started; retryLevel() rolls
        // back to it so repeated retries of a regenerated level cannot farm
        // coins.
        this.levelStartScore = 0;
        this.currentLevel = 1;
        this.lastTime = 0;
        this.levelCompleteTimer = 0;
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;

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

        // The camera works in CSS pixels; keep its viewport current so the
        // follow/clamp math matches the resized window. Guard for the first
        // call from the constructor, before this.camera exists.
        if (this.camera) {
            this.camera.width = window.innerWidth;
            this.camera.height = window.innerHeight;
        }
    }

    bindEvents() {
        // Button listeners (Game-owned: required, see constructor note).
        const startBtn = document.getElementById('start-btn');
        const retryBtn = document.getElementById('retry-btn');
        const playAgainBtn = document.getElementById('play-again-btn');
        const pauseBtn = document.getElementById('pause-btn');
        if (!startBtn || !retryBtn || !playAgainBtn || !pauseBtn) {
            throw new Error('Game requires #start-btn, #retry-btn, #play-again-btn and #pause-btn elements in the page');
        }
        startBtn.addEventListener('click', () => this.startGame());
        retryBtn.addEventListener('click', () => this.retryLevel());
        playAgainBtn.addEventListener('click', () => {
            this.startGame();
            this.ui.hideOverlay('game-complete-screen');
        });
        // Spec §Accessibility: pause/resume must be keyboard-operable with a
        // toggling accessible name, not Escape-only. A native button gives
        // Tab/Enter for free; togglePause keeps the label in sync however the
        // pause was entered. blur() matters: a focused <button> activates on
        // Space at keyup, so after a mouse click every later Space press would
        // strobe PAUSED↔PLAYING (input.js suppresses the jump half while a
        // button holds focus, but gameplay must not silently lose it either).
        pauseBtn.addEventListener('click', () => {
            this.togglePause();
            pauseBtn.blur();
        });

        // Input listener.
        // Immediate jump while grounded (or within coyote reach of the ground
        // it just left); otherwise buffer the press so a landing inside the
        // window still jumps. The initial-press filter lives in InputHandler
        // (wasDown captured before keys.add), so autorepeat keydowns neither
        // re-jump nor refresh the buffer.
        // All closures gate on PLAYING: PAUSED freezes physics, and these are
        // mutation paths that bypass update()'s state gate — a Space press
        // during pause must not launch the player on resume.
        this.input.onJump(() => {
            if (this.state !== STATE.PLAYING || !this.player) return;
            if (this.player.grounded || this.coyoteTimer > 0) {
                this.player.jump();
            } else {
                this.jumpBufferTimer = JUMP_BUFFER_TIME;
            }
        });
        const moveIfPlaying = (fn) => () => {
            if (this.state === STATE.PLAYING) fn();
        };
        this.input.onMoveLeft(moveIfPlaying(() => this.player?.moveLeft()));
        this.input.onMoveRight(moveIfPlaying(() => this.player?.moveRight()));
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
        window.addEventListener('keydown', (e) => {
            if ((e.code === 'Escape' || e.key === 'Escape') && !e.repeat) {
                if (this.state === STATE.GAME_OVER || this.state === STATE.GAME_COMPLETE) {
                    this.returnToMenu();
                } else {
                    this.togglePause();
                }
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
            this.ui.showOverlay('pause-screen');
            this.ui.setPauseLabel(true);
        } else if (this.state === STATE.PAUSED) {
            this.setState(STATE.PLAYING);
            this.ui.hideOverlay('pause-screen');
            this.ui.setPauseLabel(false);
        }
    }

    // Spec: Escape on an end screen returns to MENU, never pauses.
    returnToMenu() {
        this.setState(STATE.MENU);
        this.ui.hideOverlay('game-over-screen');
        this.ui.hideOverlay('game-complete-screen');
        this.ui.showOverlay('menu-screen');
        // The HUD sits above the 85%-opaque menu overlay: without this
        // the finished run's Score/Level/Time ghost through the menu.
        this.ui.hideHUD();
    }

    startGame() {
        // Construct before mutating anything (same discipline as startLevel):
        // if generation exhausts and throws, a GAME_COMPLETE/GAME_OVER screen
        // keeps its state and overlay instead of being stranded over zeroed
        // run data.
        const level = new Level(1, TILE_SIZE);
        this.score = 0;
        this.currentLevel = 1;
        // A brand-new run always gets a fresh clock; whether it ticks at all
        // is decided per level by publishLevel's difficulty-tier gate.
        this.timer.timeRemaining = this.timer.baseTime;
        this.publishLevel(level);
        this.ui.showHUD();
        this.ui.hideOverlay('menu-screen');
    }

    startLevel() {
        // Construct before publishing anything: if generation exhausts and
        // throws, the game keeps its previous state and system references
        // instead of being left PLAYING with a null/stale level, where the
        // loop's catch would log per-frame errors forever.
        const level = new Level(this.currentLevel, TILE_SIZE);
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
        // Snapshot before any of this level's coins can be collected.
        this.levelStartScore = this.score;
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
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
        // Spec §Error Handling (coin count validation): the 70% portal gate is
        // only meaningful with enough coins to divide. Generation ships more
        // than this on every tier; a level below the floor is a generator bug
        // — warn and continue (the gate itself never becomes unwinnable).
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
    }

    retryLevel() {
        // Construct before mutating anything (same discipline as startGame):
        // on generation failure the game stays GAME_OVER with the overlay and
        // its retry button intact, instead of a bare GAME_OVER with no way
        // back in.
        const level = new Level(this.currentLevel, TILE_SIZE);
        // Roll the score back to the level-start snapshot first: the level
        // regenerates on retry, so keeping mid-level pickups would let
        // repeated die-and-retry runs farm coins.
        this.score = this.levelStartScore;
        // A fresh attempt gets a fresh clock: without this, retrying after a
        // time-out would kill the player on the very next tick.
        this.timer.timeRemaining = this.timer.baseTime;
        this.ui.hideOverlay('game-over-screen');
        this.publishLevel(level);
    }

    handleWin() {
        this.setState(STATE.LEVEL_COMPLETE);
        // The transition is automatic and not pausable: drop the button out
        // of the tab order until publishLevel re-enables it.
        this.ui.setPauseEnabled(false);
        this.levelCompleteTimer = 2; // 2 seconds transition
        this.levelTransitionStalled = false;

        this.ui.showOverlay('level-complete-screen');

        // Level advance is driven solely by the update-timer path in update();
        // a parallel setTimeout here used to double-advance and leak timers.
    }

    handleGameOver() {
        this.setState(STATE.GAME_OVER);
        this.ui.setPauseEnabled(false);
        // Single game-over presentation path: UI.showGameOver writes the
        // #final-score node and reveals the overlay.
        this.ui.showGameOver(this.score);
    }

    handleGameComplete() {
        this.setState(STATE.GAME_COMPLETE);
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
        if (this.state === STATE.PLAYING) {
            // Run clock first: a tick that crosses zero is death before any
            // other outcome of the same frame. The PLAYING-only gate means
            // PAUSED freezes the clock for free.
            if (this.timerActive) {
                this.timer.update(dt);
                this.ui.updateTimer(this.timer.getTimeRemaining());
                if (this.timer.isTimeUp()) {
                    this.handleGameOver();
                    return;
                }
            }

            // Update player
            this.player.update(dt, this.input.isLeft(), this.input.isRight());

            // Apply physics
            this.physics.applyGravity(this.player, dt);

            // Check collisions
            const collisions = this.physics.checkCollisions(this.player, this.level.getPlatforms());
            this.physics.resolveCollisions(this.player, collisions);

            // Coyote time: remember ground contact briefly after it ends, so a
            // jump pressed just after walking off a ledge still fires.
            this.coyoteTimer = this.player.grounded
                ? COYOTE_TIME
                : this.coyoteTimer - dt;

            // Consume a buffered jump press as soon as the player is grounded.
            if (this.jumpBufferTimer > 0) {
                this.jumpBufferTimer -= dt;
                if (this.player.grounded) {
                    this.player.jump();
                    this.jumpBufferTimer = 0;
                }
            }

            // Phase 2 elements. Death checks run in a fixed order (enemies,
            // spikes, pit) and stop the tick at the first hit, so several
            // simultaneous contacts produce exactly one game over.
            this.enemyManager.updateAll(dt);
            if (this.enemyManager.checkPlayerCollisions(this.player)) {
                this.handleGameOver();
                return;
            }

            if (this.hazards.checkPlayerSpikes(this.player)) {
                this.handleGameOver();
                return;
            }

            // Check for falling off the world, delegated to Hazards. The
            // height passed is in world/CSS pixels: canvas.height is the
            // device-pixel backing store and drifts with devicePixelRatio,
            // which would move the death line (and could place it above the
            // spawn ground on short windows).
            if (this.hazards.checkPitFall(this.player, this.level.height * this.level.tileSize)) {
                this.handleGameOver();
                return;
            }

            // Coins add onto the running total, which accumulates across
            // levels; the per-collectibles getScore() is this level's score
            // only and must never be assigned over the total. Capped at
            // MAX_SAFE_INTEGER (spec §Error Handling) so no accumulation
            // length can wrap the score into negative territory.
            const collectedCoins = this.collectibles.checkCollection(this.player);
            if (collectedCoins > 0) {
                this.score = Math.min(
                    this.score + collectedCoins * COIN_POINTS,
                    Number.MAX_SAFE_INTEGER
                );
                // Spec: +2 s per coin, unconditionally. The run clock is one
                // object across the whole game, so coins banked before the
                // timer tier (level 5) are already on it when it starts
                // ticking — no separate pending-bonus ledger needed.
                for (let i = 0; i < collectedCoins; i++) this.timer.addCoinBonus();
            }

            // Check portal contact; hidden until the 70% coin gate is met,
            // so locked contact does nothing. Same Collectibles instance the
            // loop scores through (publishLevel adopts it from the level) —
            // one access path, no aliasing against this.level.
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
                this.level.height * this.level.tileSize
            );

            // Update UI
            this.ui.updateScore(this.score);
            this.ui.updateLevel(this.currentLevel);
        } else if (this.state === STATE.LEVEL_COMPLETE) {
            this.levelCompleteTimer -= dt;
            if (this.levelCompleteTimer <= 0) {
                if (this.currentLevel >= FINAL_LEVEL) {
                    // The run ends here: never construct level 16.
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
                        const level = new Level(next, TILE_SIZE);
                        this.currentLevel = next;
                        this.publishLevel(level);
                        this.ui.hideOverlay('level-complete-screen');
                    } catch (error) {
                        // Spec §Error Handling (transition timeout): never
                        // stick in LEVEL_COMPLETE. Keep forcing the transition
                        // every frame past the nominal 2 s budget — each retry
                        // is a fresh randomised generation, so this self-heals
                        // (R26: 0/1000 throws) — but log once per stall
                        // instead of flooding console.error through the loop.
                        if (!this.levelTransitionStalled) {
                            console.error('Level transition stalled; retrying:', error);
                            this.levelTransitionStalled = true;
                        }
                    }
                }
            }
        }
    }

    draw() {
        // Clear canvas
        this.ctx.fillStyle = '#87CEEB';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // PAUSED keeps rendering the frozen scene; the overlay sits on top.
        if (this.state === STATE.PLAYING || this.state === STATE.LEVEL_COMPLETE ||
            this.state === STATE.PAUSED) {
            this.ctx.save();

            // Apply camera transform (camera.y is negative of the world-top offset)
            this.ctx.translate(-this.camera.x, this.camera.y);

            // Draw level
            this.level.draw(this.ctx);

            // Draw player
            this.player.draw(this.ctx);

            this.ctx.restore();
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
        } catch (error) {
            console.error('Game loop error:', error);
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
