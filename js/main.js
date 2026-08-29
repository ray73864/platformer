import { InputHandler } from './input.js';
import { Physics } from './physics.js';
import { Player } from './player.js';
import { Level } from './level.js';
import { Camera } from './camera.js';
import { UI } from './ui.js';

// Game constants
export const TILE_SIZE = 32;
const GRAVITY = 980;
const PLAYER_SPEED = 200;
const JUMP_FORCE = 350;
const MAX_FALL_SPEED = 600;

// Game states
export const STATE = {
    MENU: 'MENU',
    PLAYING: 'PLAYING',
    GAME_OVER: 'GAME_OVER',
    LEVEL_COMPLETE: 'LEVEL_COMPLETE'
};

export class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
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

        // Game state
        this.state = STATE.MENU;
        this.level = null;
        this.player = null;
        this.score = 0;
        this.currentLevel = 1;
        this.lastTime = 0;
        this.levelCompleteTimer = 0;

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
        // Button listeners
        document.getElementById('start-btn').addEventListener('click', () => this.startGame());
        document.getElementById('retry-btn').addEventListener('click', () => this.retryLevel());

        // Input listener
        // Input listener. Grounded-gated here (not inside Player.jump(), whose
        // unit test requires an ungated jump()) so autorepeat keydowns cannot
        // re-fire the jump mid-flight.
        this.input.onJump(() => {
            if (this.player?.grounded) {
                this.player.jump();
            }
        });
        this.input.onMoveLeft(() => this.player?.moveLeft());
        this.input.onMoveRight(() => this.player?.moveRight());
        this.input.onReleaseLeft(() => this.player?.stopLeft());
        this.input.onReleaseRight(() => this.player?.stopRight());
    }

    startGame() {
        this.score = 0;
        this.currentLevel = 1;
        this.startLevel();
        this.ui.showHUD();
        this.ui.hideOverlay('menu-screen');
    }

    startLevel() {
        this.state = STATE.PLAYING;
        this.level = new Level(this.currentLevel, TILE_SIZE);
        this.player = new Player(100, 100, PLAYER_SPEED, JUMP_FORCE);
        this.camera.reset();
        this.levelCompleteTimer = 0;
    }

    retryLevel() {
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
        this.ui.showOverlay('game-over-screen');
        document.getElementById('final-score').textContent = `Score: ${this.score}`;
    }

    update(dt) {
        if (this.state === STATE.PLAYING) {
            // Update player
            this.player.update(dt, this.input.isLeft(), this.input.isRight());

            // Apply physics
            this.physics.applyGravity(this.player, dt);

            // Check collisions
            const collisions = this.physics.checkCollisions(this.player, this.level.getPlatforms());
            this.physics.resolveCollisions(this.player, collisions);

            // Check for falling off screen
            if (this.player.y > this.canvas.height + 100) {
                this.handleGameOver();
            }

            // Check portal contact
            const portal = this.level.getPortal();
            if (portal && !this.player.hasReachedPortal() &&
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
                this.currentLevel++;
                this.startLevel();
                this.ui.hideOverlay('level-complete-screen');
            }
        }
    }

    draw() {
        // Clear canvas
        this.ctx.fillStyle = '#87CEEB';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.state === STATE.PLAYING || this.state === STATE.LEVEL_COMPLETE) {
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

        this.update(cappedDt);
        this.draw();

        requestAnimationFrame((t) => this.loop(t));
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
