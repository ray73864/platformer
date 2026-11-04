// Integration seam: Game.update() weaving the Phase 2 systems together.
//
// Unit tests pin Collectibles/Hazards/EnemyManager in isolation, and the
// element-level integration files pin Level -> system wiring. What nothing
// covers yet is the GAME LOOP itself: that a PLAYING tick actually consults
// the per-level enemy manager, hazards, and collectibles, in the specified
// order, with death triggering exactly once per frame across simultaneous
// hits, score accumulating across levels (never overwritten by a per-level
// getScore), retries restoring the level-start score snapshot, and pit death
// still firing at the exact world-pixel threshold after delegating to
// Hazards.checkPitFall. These tests drive Game.update(dt) directly under
// happy-dom, mirroring state_transitions.test.js.
import { test, expect } from "bun:test";
import { installGameTestScaffolding, mountFixture } from "./setup.js";

installGameTestScaffolding();

import { Game, STATE, FINAL_LEVEL, DEATH_SCORE_PENALTY_RATE } from "../../js/main.js";
import { Collectibles } from "../../js/collectibles.js";
import { Level } from "../../js/level.js";

const DT = 0.016;
// Mirrors GRAVITY in main.js (not exported). Used to cancel one tick of
// gravity below so the pit-death boundary can be probed exactly:
// applyGravity is semi-implicit Euler (vy += g*dt; y += vy*dt), so seeding
// vy with -(GRAVITY * DT) — the identical float expression — leaves the
// player's y unchanged across the tick.
const GRAVITY = 980;
// Mirrors STOMP_BOUNCE in main.js (not exported): the upward velocity a
// squashed enemy grants.
const STOMP_BOUNCE = 260;
const COIN_POINTS = 10; // mirrors COIN_POINTS in collectibles.js

function startPlaying() {
    mountFixture();
    const game = new Game();
    document.getElementById('start-btn').click();
    return game;
}

// Puts overlays in a known-hidden baseline so "shown" assertions prove
// showGameOver actually revealed the overlay (state_transitions.test.js idiom).
function hideOverlays(game) {
    game.ui.hideOverlay('menu-screen');
    game.ui.hideOverlay('game-over-screen');
    game.ui.hideOverlay('level-complete-screen');
}

// Neutralises generator-produced enemies/spikes so only the elements a test
// injects can kill the player.
function clearGeneratedThreats(game) {
    game.enemyManager.clear();
    game.hazards.clear();
}

// A real Collectibles instance holding n coins stacked at the player's
// current position: one checkCollection call collects all n. Swapping it in
// for the level's own keeps the collection contract real while making the
// collected count deterministic.
function coinsAtPlayer(game, n) {
    const collectibles = new Collectibles();
    for (let i = 0; i < n; i++) {
        collectibles.addCoin(game.player.x, game.player.y);
    }
    return collectibles;
}

function advanceToNextLevel(game) {
    const portal = game.level.portal;
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.player.markPortalReached();
    game.update(DT);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);
    for (let i = 0; i < 3 && game.state === STATE.LEVEL_COMPLETE; i++) {
        game.update(0.8);
    }
    expect(game.state).toBe(STATE.PLAYING);
}

test("a MENU-state Game has no element systems and update() stays inert", () => {
    mountFixture();
    const game = new Game();

    expect(game.enemyManager).toBeNull();
    expect(game.collectibles).toBeNull();
    expect(game.hazards).toBeNull();
    expect(game.levelStartScore).toBe(0);

    game.update(DT);
    expect(game.state).toBe(STATE.MENU);
});

test("startLevel wires the per-level element systems from the level's getters", () => {
    const game = startPlaying();

    // Same-instance identity, not merely same-type: the loop must consult the
    // very objects the Level exposes, or generated content is invisible to it.
    expect(game.enemyManager).toBe(game.level.getEnemyManager());
    expect(game.collectibles).toBe(game.level.getCollectibles());
    expect(game.hazards).toBe(game.level.getHazards());
});

test("an enemy overlapping the player during a PLAYING tick ends the run", () => {
    const game = startPlaying();
    hideOverlays(game);
    clearGeneratedThreats(game);

    // Enemy body placed flush on the player; one tick of patrol (0.8px)
    // cannot break the deep overlap.
    game.enemyManager.addEnemy(
        game.player.x, game.player.y,
        game.player.x - 50, game.player.x + 100
    );

    game.update(DT);

    expect(game.state).toBe(STATE.GAME_OVER);
    expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(false);
});

test("a stomp bounce kills the coyote window and any stale cut flag", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    // Land first so the coyote window is genuinely live: update() refreshes
    // it on every frame of ground contact, using the PREVIOUS frame's
    // collision-derived grounded flag — so one settling tick past first
    // contact is what actually arms it.
    for (let i = 0; i < 120 && !game.player.grounded; i++) game.update(DT);
    game.update(DT);
    expect(game.player.grounded).toBe(true);
    expect(game.player.coyoteTimer).toBeGreaterThan(0);

    // Drop feet-first onto an enemy placed just below the feet: falling,
    // previous bottom inside the stomp tolerance of the enemy's top edge
    // (see resolvePlayerContact in enemies.js). A stale jump-cut flag from
    // an earlier jump sits armed, as it would mid-combo.
    game.player.y -= 64;
    game.player.grounded = false;
    game.player.vy = 200;
    game.player.jumpCutAvailable = true;
    game.enemyManager.addEnemy(
        game.player.x, game.player.y + game.player.height - 12,
        game.player.x - 50, game.player.x + 100
    );

    game.update(DT);

    // Stomped, not died: the bounce replaces the coyote window (otherwise
    // pressJump's coyote branch re-fires a full jump on top of it — a
    // double-launch above the modelled rise) and clears the cut flag
    // (otherwise releaseJump shrinks this arc, and a banked availability
    // clips every later stomp on its first keyup).
    expect(game.state).toBe(STATE.PLAYING);
    expect(game.player.vy).toBe(-STOMP_BOUNCE);
    expect(game.player.coyoteTimer).toBe(0);
    expect(game.player.jumpCutAvailable).toBe(false);

    // A press immediately after the bounce must NOT launch: the window is
    // dead, so it merely buffers for the next landing. Pre-fix, the live
    // coyote timer turned this into vy = -jumpForce stacked on the bounce.
    game.player.pressJump();
    expect(game.player.vy).toBe(-STOMP_BOUNCE);
    expect(game.player.jumpBufferTimer).toBeGreaterThan(0);
});

test("spike core contact during a PLAYING tick ends the run", () => {
    const game = startPlaying();
    hideOverlays(game);
    clearGeneratedThreats(game);

    // Spike offset by 8px: even the 4px-inset lethal core overlaps the
    // player rect.
    game.hazards.addSpike(game.player.x + 8, game.player.y + 8);

    game.update(DT);

    expect(game.state).toBe(STATE.GAME_OVER);
    expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(false);
});

test("simultaneous enemy, spike, and pit hits produce exactly one game over", () => {
    const game = startPlaying();
    hideOverlays(game);
    clearGeneratedThreats(game);

    // Stack all three death sources on the same tick: an enemy and a spike
    // at the player position AND the player below the pit line.
    const worldBottom = game.level.height * game.level.tileSize;
    game.enemyManager.addEnemy(
        game.player.x, worldBottom + 200,
        game.player.x - 50, game.player.x + 100
    );
    game.hazards.addSpike(game.player.x, worldBottom + 200);
    game.player.y = worldBottom + 200;

    let gameOverCalls = 0;
    const original = game.handleGameOver.bind(game);
    game.handleGameOver = () => {
        gameOverCalls++;
        original();
    };

    game.update(DT);

    expect(game.state).toBe(STATE.GAME_OVER);
    expect(gameOverCalls).toBe(1);
    // And the run stays dead: further ticks do not re-trigger.
    game.update(DT);
    expect(gameOverCalls).toBe(1);
});

test("collected coins add 10 points each to the running total across levels", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    // Two coins on one tick: both counted, 20 points.
    game.collectibles = coinsAtPlayer(game, 2);
    game.update(DT);
    expect(game.score).toBe(2 * COIN_POINTS);

    // Advance to level 2 through the real LEVEL_COMPLETE path. The flawless
    // L1 clear pays its bonus (clearBonusFor(0, 1) = 100) into the carried
    // total — adapted 2026-11-04 for the score-economy ruling; the point of
    // this test (coin accumulation, never overwrite) is untouched.
    advanceToNextLevel(game);
    expect(game.currentLevel).toBe(2);
    expect(game.score).toBe(2 * COIN_POINTS + 100);
    expect(game.levelStartScore).toBe(2 * COIN_POINTS + 100);

    // Level 2 collections accumulate onto the carried total. The fresh fake
    // reports its OWN score as 3 * COIN_POINTS = 30; if the loop assigned
    // per-level getScore() over the running total, score would read 30 here
    // instead of 150.
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 3);
    game.update(DT);
    expect(game.collectibles.getScore()).toBe(3 * COIN_POINTS);
    expect(game.score).toBe(2 * COIN_POINTS + 100 + 3 * COIN_POINTS);
});

test("retrying keeps banked coins but costs DEATH_SCORE_PENALTY_RATE of score", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    // Bank 10 points on level 1, then complete it: the flawless clear bonus
    // (+100, clearBonusFor(0, 1)) rides into level 2's carried total, so it
    // starts at 110. (Adapted 2026-11-04 for the score-economy ruling.)
    game.collectibles = coinsAtPlayer(game, 1);
    game.update(DT);
    expect(game.score).toBe(COIN_POINTS);
    advanceToNextLevel(game);
    expect(game.levelStartScore).toBe(COIN_POINTS + 100);

    // Farm 2 more coins mid-level-2, then die: 110 + 20 = 130.
    clearGeneratedThreats(game);
    game.collectibles = coinsAtPlayer(game, 2);
    game.update(DT);
    expect(game.score).toBe(130);

    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);
    // Owner ruling (cause and effect): the death itself already charged the
    // penalty — before any retry click.
    const penalty = Math.floor(130 * DEATH_SCORE_PENALTY_RATE);
    expect(penalty).toBe(32); // floor(32.5): whole points, rounded down
    expect(game.score).toBe(130 - penalty);

    document.getElementById('retry-btn').click();

    // The replay is seeded-identical, so banked coins transfer with it: the
    // collected flags persist (each coin scores exactly once ever — nothing
    // can double-pay) and the REDUCED score carries forward. The retry does
    // not re-charge the penalty. Element systems are rewired to the rebuilt
    // level instance.
    expect(game.state).toBe(STATE.PLAYING);
    expect(game.score).toBe(98);
    expect(game.levelStartScore).toBe(98);
    expect(game.collectibles).toBe(game.level.getCollectibles());
    expect(game.enemyManager).toBe(game.level.getEnemyManager());
    expect(game.hazards).toBe(game.level.getHazards());
});

test("retrying a failed first level keeps banked coins minus the death penalty", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    game.collectibles = coinsAtPlayer(game, 1);
    game.update(DT);
    expect(game.score).toBe(COIN_POINTS);

    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);

    document.getElementById('retry-btn').click();
    expect(game.state).toBe(STATE.PLAYING);
    // Coins stay collected; the score arrives reduced by the death penalty
    // (floor(10 * 0.25) = 2).
    expect(game.score).toBe(COIN_POINTS - Math.floor(COIN_POINTS * DEATH_SCORE_PENALTY_RATE));
});

test("pit death fires at the exact world-pixel threshold via the delegated check", () => {
    const game = startPlaying();
    hideOverlays(game);
    clearGeneratedThreats(game);

    const worldBottom = game.level.height * game.level.tileSize;
    // Cancel this tick's gravity so the pit check sees the y we set
    // (see GRAVITY note above): strict `>` means exactly at the line lives.
    game.player.vy = -(GRAVITY * DT);
    game.player.y = worldBottom + 100;
    game.update(DT);
    expect(game.state).toBe(STATE.PLAYING);

    // One pixel past the same line dies — the old inline threshold, preserved
    // through Hazards.checkPitFall.
    game.player.vy = -(GRAVITY * DT);
    game.player.y = worldBottom + 101;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);
});

// --- Generation-failure containment (OOSI1) ---------------------------------

test("startLevel leaves a MENU game untouched when generation exhausts", () => {
    mountFixture();
    const game = new Game();

    // Stub the portal pick so every one of the 200 attempts fails and the
    // constructor throws its fail-fast error.
    const original = Level.prototype.pickPortalTile;
    Level.prototype.pickPortalTile = () => null;
    try {
        expect(() => game.startLevel()).toThrow(/no reachable portal/);
        // Containment: no corruption into a PLAYING state with half-adopted
        // systems — the pre-call state and emptiness survive.
        expect(game.state).toBe(STATE.MENU);
        expect(game.level).toBeNull();
    } finally {
        Level.prototype.pickPortalTile = original;
    }
});

test("level advance keeps currentLevel and LEVEL_COMPLETE intact when generation exhausts", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    hideOverlays(game);

    const portal = game.level.portal;
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.player.markPortalReached();
    game.update(DT);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);
    const finishedLevel = game.currentLevel;

    // Spec §Error Handling (transition timeout): update() must not throw out
    // of a stalled transition — it keeps forcing the advance every frame and
    // logs once per stall instead of flooding.
    const originalConsole = console.error;
    let logged = 0;
    console.error = () => { logged++; };
    const original = Level.prototype.pickPortalTile;
    Level.prototype.pickPortalTile = () => null;
    try {
        game.update(3); // countdown fires, generation fails
        game.update(DT); // retried, fails again
        expect(game.state).toBe(STATE.LEVEL_COMPLETE);
        // currentLevel only advances after a successful construction, so the
        // game is not corrupted and cannot double-advance via the stale
        // portal flag into an unbounded ~2s cycle.
        expect(game.currentLevel).toBe(finishedLevel);
        expect(logged).toBe(1); // once per stall, not per frame
    } finally {
        console.error = originalConsole;
        Level.prototype.pickPortalTile = original;
    }

    // Self-heal: the next attempt with a working generator advances normally.
    game.update(DT);
    expect(game.state).toBe(STATE.PLAYING);
    expect(game.currentLevel).toBe(finishedLevel + 1);
});

// S1: the transition retry is bounded — persistent failure hands off to MENU
// on the same terms as loop-error recovery, instead of rebuilding every
// frame forever (a frozen tab, silent after one log line).
test("a persistently failing level transition hands off to MENU after the stall cap", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    hideOverlays(game);

    const portal = game.level.portal;
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.player.markPortalReached();
    game.update(DT);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);

    const originalConsole = console.error;
    console.error = () => {};
    const original = Level.prototype.pickPortalTile;
    Level.prototype.pickPortalTile = () => null;
    try {
        // Must match LEVEL_TRANSITION_MAX_STALL_FRAMES in main.js. The first
        // update(3) expires the 2 s budget and burns stall frame #1; 120 more
        // failing frames cross the cap and trip the handoff.
        game.update(3);
        for (let i = 0; i < 120; i++) game.update(DT);
        expect(game.state).toBe(STATE.MENU);
        // No orphan overlays: the complete screen closes, the menu is up,
        // and the player gets the same notice as loop-recovery's give-up.
        expect(document.getElementById('level-complete-screen').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('menu-screen').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('error-message').classList.contains('hidden')).toBe(false);
    } finally {
        console.error = originalConsole;
        Level.prototype.pickPortalTile = original;
        game.ui.hideErrorMessage();
    }
});

// --- Construct-before-publish on the run-flow entries (S5 review) -----------

test("startGame keeps end-screen state intact when generation exhausts", () => {
    mountFixture();
    const game = new Game();
    // Park a finished run behind Play Again.
    game.state = STATE.GAME_COMPLETE;
    game.score = 500;
    game.currentLevel = FINAL_LEVEL;

    const originalConsole = console.error;
    console.error = () => {};
    const original = Level.prototype.pickPortalTile;
    Level.prototype.pickPortalTile = () => null;
    try {
        // I3: persistent generation failure is caught at the click boundary
        // (after one inline re-attempt) and surfaced as a message — never an
        // uncaught throw escaping into the button listener.
        expect(game.startGame()).toBe(false);
        expect(document.getElementById('error-message').classList.contains('hidden')).toBe(false);
        // Nothing was zeroed before the fallible construction: the visible
        // GAME_COMPLETE screen still describes the run it shows.
        expect(game.state).toBe(STATE.GAME_COMPLETE);
        expect(game.score).toBe(500);
        expect(game.currentLevel).toBe(FINAL_LEVEL);
    } finally {
        console.error = originalConsole;
        Level.prototype.pickPortalTile = original;
        game.ui.hideErrorMessage();
    }
});

test("retryLevel keeps the game-over overlay and state when generation exhausts", () => {
    const game = startPlaying();
    hideOverlays(game);
    // Real death to GAME_OVER so the overlay is up.
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);

    const originalConsole = console.error;
    console.error = () => {};
    const original = Level.prototype.pickPortalTile;
    Level.prototype.pickPortalTile = () => null;
    try {
        // I3: no throw into the click listener; a message explains the dead
        // press and both attempts leave state untouched.
        game.retryLevel();
        expect(document.getElementById('error-message').classList.contains('hidden')).toBe(false);
        // Overlay and state survive intact: the retry button is still there
        // to press once generation works again.
        expect(game.state).toBe(STATE.GAME_OVER);
        expect(document.getElementById('game-over-screen').classList.contains('hidden')).toBe(false);
    } finally {
        console.error = originalConsole;
        Level.prototype.pickPortalTile = original;
        game.ui.hideErrorMessage();
    }
});

test("a single exhausted construction self-heals via the inline re-attempt", () => {
    mountFixture();
    const game = new Game();
    // Fail exactly one full construction: pickPortalTile is called once per
    // generation attempt, so nulling the first 200 calls (MAX_GENERATION_
    // ATTEMPTS in level.js) exhausts the first candidate of seedFor's chain,
    // and the next candidate succeeds (randomness wave 2026-11-05; before
    // the chain this slot was tryConstructLevel's inline XOR re-attempt).
    let calls = 0;
    const originalConsole = console.error;
    console.error = () => {};
    const original = Level.prototype.pickPortalTile;
    Level.prototype.pickPortalTile = function (...args) {
        calls++;
        return calls <= 200 ? null : original.apply(this, args);
    };
    try {
        expect(game.startGame()).toBe(true);
        // 2026-11-05 randomness wave: seedFor now walks the anti-repeat
        // candidate chain, so the exhausted first construction (200 calls) is
        // followed by CHAIN CANDIDATE 1 succeeding on its first attempt
        // (call 201) and the caller rebuilding that stored seed for
        // publication (call 202). Same self-heal contract as the old inline
        // re-attempt — one failure absorbed silently, no message — just one
        // extra pickPortalTile through the stored-seed path.
        expect(calls).toBe(202);
        expect(game.state).toBe(STATE.PLAYING);
        // Self-healed: no error message reaches the player.
        expect(document.getElementById('error-message').classList.contains('hidden')).toBe(true);
    } finally {
        console.error = originalConsole;
        Level.prototype.pickPortalTile = original;
    }
});

// --- Score integrity (S7) ----------------------------------------------------

test("score is capped at MAX_SAFE_INTEGER however long coins keep coming", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    game.score = Number.MAX_SAFE_INTEGER - 5;
    game.collectibles = coinsAtPlayer(game, 3); // would add 30 unbounded
    game.update(DT);
    expect(game.score).toBe(Number.MAX_SAFE_INTEGER);

    // And stays there on further pickups.
    game.collectibles = coinsAtPlayer(game, 1);
    game.update(DT);
    expect(game.score).toBe(Number.MAX_SAFE_INTEGER);
});

// --- Portal coin-gate (R21) ---------------------------------------------------

test("portal contact completes the level only once the 70% coin gate is met", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);

    // Teleport onto the live portal with no coins banked: the locked gate
    // must ignore contact, so the player can stand on it without winning.
    const portal = game.level.portal;
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.update(DT);
    expect(game.state).toBe(STATE.PLAYING);
    expect(game.player.hasReachedPortal()).toBe(false);

    // Meet the threshold through the real Collectibles API; same contact.
    // Same handle the loop's gate reads (game.collectibles is publishLevel's
    // adoption of level.getCollectibles() — one access path, no aliasing).
    const collectibles = game.collectibles;
    const coins = collectibles.getCoins();
    for (let i = 0; i < coins.length && !collectibles.meetsPortalRequirement(); i++) {
        collectibles.collectCoin(i);
    }
    expect(collectibles.meetsPortalRequirement()).toBe(true);

    game.update(DT);
    expect(game.player.hasReachedPortal()).toBe(true);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);

    // Exit LEVEL_COMPLETE deterministically (mirrors level_flow.test.js) so
    // the armed 2s timer cannot cross into a later test.
    for (let i = 0; i < 3 && game.state === STATE.LEVEL_COMPLETE; i++) {
        game.update(0.8);
    }
});

// --- Death score penalty (owner ruling: cause and effect) -------------------

test("dying deducts DEATH_SCORE_PENALTY_RATE of the score, floored, once per death", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    hideOverlays(game);

    game.score = 123; // mid-level total above any snapshot
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);
    expect(game.score).toBe(123 - Math.floor(123 * DEATH_SCORE_PENALTY_RATE)); // 93

    // Once per death, never per frame: GAME_OVER ticks must not shave more.
    game.update(DT);
    game.update(DT);
    expect(game.score).toBe(93);

    // Overlay shows the POST-penalty total plus the loss line.
    expect(document.getElementById('final-score').textContent).toBe('Score: 93');
    const penaltyEl = document.getElementById('score-penalty');
    expect(penaltyEl.hidden).toBe(false);
    expect(penaltyEl.textContent).toBe('-30 points');
});

test("a timeout death is penalized like any other cause", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    hideOverlays(game);

    game.score = 41;
    game.timerActive = true; // force the clock regardless of tier gating
    game.timer.timeRemaining = 0.001;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);
    // floor(41 * 0.25) = 10: the timeout costs exactly as much as a spike.
    expect(game.score).toBe(31);
    expect(document.getElementById('death-cause').textContent).toBe('Time ran out');
    expect(document.getElementById('score-penalty').textContent).toBe('-10 points');
});

test("a zero score stays zero and hides the penalty line", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    hideOverlays(game);

    expect(game.score).toBe(0);
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);
    expect(game.score).toBe(0);
    expect(document.getElementById('score-penalty').hidden).toBe(true);
    expect(document.getElementById('final-score').textContent).toBe('Score: 0');
});

test("two deaths compound on the reduced score; completion pays the reduced clear bonus", () => {
    const game = startPlaying();
    clearGeneratedThreats(game);
    hideOverlays(game);

    game.score = 100;
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.score).toBe(75); // -floor(100*0.25)

    document.getElementById('retry-btn').click();
    expect(game.state).toBe(STATE.PLAYING);
    game.score += 5; // bank a little between attempts
    game.player.y = game.level.height * game.level.tileSize + 200;
    game.update(DT);
    expect(game.state).toBe(STATE.GAME_OVER);
    expect(game.score).toBe(80 - Math.floor(80 * DEATH_SCORE_PENALTY_RATE)); // 60

    // Completion never CHARGES (the penalty stays death-only), but since the
    // 2026-11-04 economy ruling it PAYS: two deaths on this level's attempt
    // series make the clear reduced — clearBonusFor(2, 1) = floor(100*0.4)
    // = 40. Finish the level through the real gate and pin the total.
    document.getElementById('retry-btn').click();
    expect(game.state).toBe(STATE.PLAYING);
    expect(game.deathsOnCurrentLevel).toBe(2); // retries kept counting
    const before = game.score;
    const coins = game.collectibles.getCoins();
    for (let i = 0; i < coins.length && !game.collectibles.meetsPortalRequirement(); i++) {
        game.collectibles.collectCoin(i);
    }
    const portal = game.level.portal;
    game.player.x = portal.x;
    game.player.y = portal.y;
    game.update(DT);
    expect(game.state).toBe(STATE.LEVEL_COMPLETE);
    expect(game.score).toBe(before + 40);
    expect(game.lastClearBreakdown).toEqual({
        coins: 0, combat: 0, clearBonus: 40, enemiesBested: 0,
        deaths: 2, flawless: false
    });
});
