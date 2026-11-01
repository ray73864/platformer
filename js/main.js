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

        // Set canvas size for high-DPI displays
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Initialize systems
        this.input = new InputHandler();
        this.physics = new Physics(GRAVITY, MAX_FALL_SPEED);
        // Camera viewport is in CSS pixels, not the device-pixel backing store.
        this.camera = new Camera(window.innerWidth, window.innerHeight);
        this.ui = new UI();
        // One run clock for the whole game: time carries over between levels
        // (Timer.startNextLevel contract). Whether it ticks at all is decided
        // per level by the difficulty tier in publishLevel().
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

        // Bind event listeners
        this.bindEvents();

        // Start game loop
        requestAnimationFrame((time) => this.loop(time));
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
        if (!startBtn || !retryBtn || !playAgainBtn) {
            throw new Error('Game requires #start-btn, #retry-btn and #play-again-btn elements in the page');
        }
        startBtn.addEventListener('click', () => this.startGame());
        retryBtn.addEventListener('click', () => this.retryLevel());
        playAgainBtn.addEventListener('click', () => {
            this.startGame();
            this.ui.hideOverlay('game-complete-screen');
        });

        // Input listener.
        // Immediate jump while grounded (or within coyote reach of the ground
        // it just left); otherwise buffer the press so a landing inside the
        // window still jumps. The initial-press filter lives in InputHandler
        // (wasDown captured before keys.add), so autorepeat keydowns neither
        // re-jump nor refresh the buffer.
        this.input.onJump(() => {
            if (!this.player) return;
            if (this.player.grounded || this.coyoteTimer > 0) {
                this.player.jump();
            } else {
                this.jumpBufferTimer = JUMP_BUFFER_TIME;
            }
        });
        this.input.onMoveLeft(() => this.player?.moveLeft());
        this.input.onMoveRight(() => this.player?.moveRight());
        this.input.onReleaseLeft(() => this.player?.stopLeft());
        this.input.onReleaseRight(() => this.player?.stopRight());

        // Escape owns pause/end-screen navigation; InputHandler never fires
        // game actions for it. Check `key` too: some harnesses deliver raw key
        // events with an empty `code` (see input.js resolveCode).
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Escape' || e.key === 'Escape') this.togglePause();
        });
    }

    togglePause() {
        if (this.state === STATE.PLAYING) {
            this.state = STATE.PAUSED;
            this.ui.showOverlay('pause-screen');
        } else if (this.state === STATE.PAUSED) {
            this.state = STATE.PLAYING;
            this.ui.hideOverlay('pause-screen');
        } else if (this.state === STATE.GAME_OVER || this.state === STATE.GAME_COMPLETE) {
            // Spec: Escape on an end screen returns to MENU, never pauses.
            this.state = STATE.MENU;
            this.ui.hideOverlay('game-over-screen');
            this.ui.hideOverlay('game-complete-screen');
            this.ui.showOverlay('menu-screen');
        }
    }

    startGame() {
        this.score = 0;
        this.currentLevel = 1;
        // A brand-new run always gets a fresh clock; whether it ticks at all
        // is decided per level by publishLevel's difficulty-tier gate.
        this.timer.timeRemaining = this.timer.baseTime;
        this.startLevel();
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
        // Difficulty tier is the single authority for whether the run clock
        // runs at all on this level.
        this.timerActive = this.difficulty.isTimerEnabled(this.currentLevel);
        this.ui.setTimerVisible(this.timerActive);
        this.state = STATE.PLAYING;
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
        // Roll the score back to the level-start snapshot first: the level
        // regenerates on retry, so keeping mid-level pickups would let
        // repeated die-and-retry runs farm coins.
        this.score = this.levelStartScore;
        // A fresh attempt gets a fresh clock: without this, retrying after a
        // time-out would kill the player on the very next tick.
        this.timer.timeRemaining = this.timer.baseTime;
        this.ui.hideOverlay('game-over-screen');
        this.startLevel();
    }

    handleWin() {
        this.state = STATE.LEVEL_COMPLETE;
        this.levelCompleteTimer = 2; // 2 seconds transition

        this.ui.showOverlay('level-complete-screen');

        // Level advance is driven solely by the update-timer path in update();
        // a parallel setTimeout here used to double-advance and leak timers.
    }

    handleGameOver() {
        this.state = STATE.GAME_OVER;
        // Single game-over presentation path: UI.showGameOver writes the
        // #final-score node and reveals the overlay.
        this.ui.showGameOver(this.score);
    }

    handleGameComplete() {
        this.state = STATE.GAME_COMPLETE;
        const stored = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0;
        if (this.score > stored) {
            localStorage.setItem(HIGH_SCORE_KEY, String(this.score));
        }
        this.ui.showGameComplete(this.score, Math.max(this.score, stored));
    }

    update(dt) {
        if (this.state === STATE.PLAYING) {
            // Run clock first: a tick that crosses zero is death before any
            // other outcome of the same frame. The PLAYING-only gate means
            // PAUSED freezes the clock for free.
            if (this.timerActive) {
                this.timer.update(dt, false);
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
                // shortcut: pre-L5 coins are score-only; there is no live clock to extend.
                if (this.timerActive) {
                    for (let i = 0; i < collectedCoins; i++) this.timer.addCoinBonus();
                }
            }

            // Check portal contact; hidden until the 70% coin gate is met,
            // so locked contact does nothing.
            const portal = this.level.getPortal();
            if (portal && !this.player.hasReachedPortal() &&
                this.level.collectibles.meetsPortalRequirement() &&
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
                } else {
                    // The fallible construction happens BEFORE currentLevel
                    // advances: on generation exhaustion the game stays
                    // LEVEL_COMPLETE with the finished level intact, instead of
                    // corrupting into a PLAYING state with stale systems or
                    // double-advancing via the stale portal flag.
                    const next = this.currentLevel + 1;
                    const level = new Level(next, TILE_SIZE);
                    this.currentLevel = next;
                    this.publishLevel(level);
                }
                this.ui.hideOverlay('level-complete-screen');
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
