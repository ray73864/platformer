// Phase 2 integration E2E: proves collectibles, hazards and enemies behave
// end-to-end in a real browser at level 5+, driven through the window.game
// debug seam. Terrain is randomly generated, so every assertion locates its
// subject (coin/spike/enemy/safe tile) in the live level data instead of
// assuming positions, and levels missing a required element are regenerated
// through the seam rather than failed on. Threat clearance for anything the
// player is teleported onto is re-evaluated AT THE MOMENT of the drop —
// margins computed several CLI round-trips earlier go stale while enemies
// patrol (I9).
import { test, expect, beforeAll, afterAll } from "bun:test";
import {
    startServer, openGame, startGame, ab, abEvalJSON, abWaitFn, waitLanded,
    screenshot, elementState, closeSession, sessionName
} from "./helpers.js";

const SESSION = sessionName("p2-elements");
let server;

beforeAll(async () => {
    server = await startServer();
}, 60000);

afterAll(() => {
    server?.stop();
    closeSession(SESSION);
});

// One source of truth for "no enemy can touch this rect right now" (S11):
// threat needs real collision possibility — same-row proximity (a body
// fills its tile row, so |dy| >= 64 means no contact is possible) AND
// horizontal closeness within `margin` px. Portal drops use the 96px base;
// teleports onto coins/spikes add the 32px contact radius on top, because
// AABB contact begins once the gap closes to body width, not at zero (I9).
const noThreatFn = `(g, r, margin) => g.enemyManager.enemies.every(
    e => Math.abs(e.y - r.y) >= 64 ||
         e.x + e.width < r.x - margin ||
         e.x > r.x + r.width + margin)`;

// Regenerates the given level through the seam and reports what the generated
// level contains, plus anchors that don't depend on enemy positions at
// action time:
// - safeTileX: standable tile outside every enemy's patrol span, so a parked
//   player cannot be touched while observers sample enemy motion.
// - portalClear: no patrol can touch the portal right now (re-checked again
//   at drop time inside completeViaPortal).
const phase2Summary = (levelNumber) => `(() => {
    const g = window.game;
    // Levels are deterministic per run seed (retry replays the same map);
    // the harness regenerates until a layout meets its requirement, so each
    // attempt re-rolls the run seed first.
    g.runSeed = (Math.random() * 0xffffffff) >>> 0;
    g.currentLevel = ${levelNumber};
    g.startLevel();
    let safeTileX = null;
    for (const key of g.level.reachableTiles) {
        const px = (key % g.level.width) * g.level.tileSize;
        const clear = g.enemyManager.enemies.every(
            e => px + g.player.width <= e.minX || px >= e.maxX
        );
        if (clear) { safeTileX = px; break; }
    }
    const portalClear = (${noThreatFn})(g, g.level.portal, 96);
    return {
        direction: g.level.direction,
        width: g.level.width,
        height: g.level.height,
        coins: g.level.coins.length,
        spikes: g.hazards.getSpikes().length,
        enemies: g.enemyManager.enemies.length,
        safeTileX,
        portalClear
    };
})()`;

const MAX_REGENERATIONS = 12;

// Opens the game, starts it, then jumps to the given level via the seam and
// keeps regenerating until the generated level satisfies the scenario's
// requirement (random terrain occasionally lacks spikes/enemies or a safe
// anchor; regenerating is the harness's job, not a test failure).
function openAtLevel(levelNumber, requirement) {
    openGame(SESSION, server.url);
    startGame(SESSION);
    abWaitFn(SESSION, "window.game.state === 'PLAYING'");
    let summary;
    for (let attempt = 0; attempt < MAX_REGENERATIONS; attempt++) {
        summary = abEvalJSON(SESSION, phase2Summary(levelNumber));
        if (requirement(summary)) return summary;
    }
    throw new Error(
        `no generated level ${levelNumber} satisfied the requirement after ` +
        `${MAX_REGENERATIONS} regenerations (last summary: ` +
        `${JSON.stringify(summary)})`
    );
}

// In-seam regeneration used by the action-time pick loops below.
function regenerate() {
    // Re-roll the run seed: startLevel() is deterministic per seed now.
    abEvalJSON(SESSION, `(() => { const g = window.game;
        g.runSeed = (Math.random() * 0xffffffff) >>> 0;
        g.startLevel(); return true; })()`);
}

// Teleports the player, zeroing velocity and grounded alongside the
// position: physics only refreshes grounded on the next tick, and the
// helpers' landing polls read it.
function teleport(x, y) {
    abEvalJSON(
        SESSION,
        `(() => { const p = window.game.player;
                  p.x = ${x}; p.y = ${y};
                  p.vx = 0; p.vy = 0; p.grounded = false;
                  return true; })()`
    );
}

const ENEMY_SNAPSHOT =
    `window.game.enemyManager.enemies.map(e =>` +
    ` ({ x: e.x, minX: e.minX, maxX: e.maxX, w: e.width }))`;

// Drops the player onto the live portal and drives the game to
// LEVEL_COMPLETE. The drop itself is hazard-free (every direction's portal
// band excludes spikes and enemy markers), but an enemy may have walked into
// range since any earlier summary; clearance is re-checked at the moment of
// the drop and stale terrain regenerated through the seam. A stray patrol
// that still wins the race is recovered via the retry button. Bounded;
// returns the final state string. Once LEVEL_COMPLETE is seen, the 2s
// auto-advance countdown is frozen through the seam so post-completion
// assertions cannot race it into level N+1 (I10).
function completeViaPortal() {
    let outcome = null;
    for (let attempt = 0; attempt < 6 && outcome !== "LEVEL_COMPLETE"; attempt++) {
        if (outcome === "GAME_OVER") {
            ab(SESSION, "click", "#retry-btn");
            abWaitFn(SESSION, "window.game.state === 'PLAYING'");
        }
        const dropped = abEvalJSON(
            SESSION,
            `(() => { const g = window.game;
                      // The portal is coin-gated (70%): meet the threshold
                      // through the real Collectibles API before dropping.
                      const c = g.collectibles;
                      const coins = c.getCoins();
                      for (let i = 0; i < coins.length && !c.meetsPortalRequirement(); i++) c.collectCoin(i);
                      if (!c.meetsPortalRequirement()) return false;
                      const portal = g.level.portal;
                      const clear = (${noThreatFn})(g, portal, 96);
                      if (!clear) return false;
                      const p = g.player;
                      p.x = portal.x; p.y = portal.y - 60;
                      p.vx = 0; p.vy = 0; p.grounded = false;
                      return true; })()`
        );
        if (!dropped) {
            regenerate();
            continue;
        }
        abWaitFn(
            SESSION,
            "window.game.state === 'LEVEL_COMPLETE' ||" +
            " window.game.state === 'GAME_OVER'"
        );
        outcome = abEvalJSON(
            SESSION,
            `(() => { const g = window.game;` +
            ` if (g.state === 'LEVEL_COMPLETE') g.levelCompleteTimer = 60;` +
            ` return g.state; })()`
        );
    }
    return outcome;
}

test("Level 5 generates phase 2 elements at the larger footprint", async () => {
    const summary = openAtLevel(5,
        s => s.coins >= 5 && s.spikes >= 1 && s.enemies >= 1
    );
    expect(summary.width).toBe(24);
    expect(summary.height).toBe(18);
    expect(summary.coins).toBeGreaterThanOrEqual(5);
    expect(summary.spikes).toBeGreaterThanOrEqual(1);
    expect(summary.enemies).toBeGreaterThanOrEqual(1);

    const hud = abEvalJSON(
        SESSION,
        `{ state: window.game.state,
           level: document.getElementById('level-display').textContent }`
    );
    expect(hud.state).toBe("PLAYING");
    expect(hud.level).toBe("Level: 5");
    screenshot(SESSION, "phase2-level5-generation.png");
}, 90000);

test("Collecting a coin raises score by exactly the collected count x 10 and syncs the HUD", async () => {
    openAtLevel(5, s => s.coins >= 5);
    waitLanded(SESSION);

    // Action-time pick (I9): find an uncollected coin no enemy can reach in
    // time (clearance + contact radius), teleport onto it, and capture the
    // score/collected baseline — all inside ONE eval, so nothing can walk
    // into range between measuring and acting. If the live terrain offers
    // none, regenerate and look again.
    let placed = null;
    for (let attempt = 0; attempt < MAX_REGENERATIONS && !placed; attempt++) {
        placed = abEvalJSON(
            SESSION,
            `(() => { const g = window.game;
                      const idx = g.level.coins.findIndex(c => !c.collected &&
                          (${noThreatFn})(g, c, 128));
                      if (idx < 0) return null;
                      const c = g.level.coins[idx];
                      const p = g.player;
                      p.x = c.x; p.y = c.y;
                      p.vx = 0; p.vy = 0; p.grounded = false;
                      return { idx, score: g.score,
                               collected: g.level.coins.filter(k => k.collected).length }; })()`
        );
        if (!placed) regenerate();
    }
    expect(placed).not.toBeNull();

    abWaitFn(SESSION, `window.game.level.coins[${placed.idx}].collected === true`);

    // The HUD is rewritten every PLAYING tick; poll until it mirrors the
    // engine total rather than racing the next frame.
    abWaitFn(
        SESSION,
        `document.getElementById('score-display').textContent ===` +
        ` ('Score: ' + window.game.score)`
    );
    const after = abEvalJSON(
        SESSION,
        `{ score: window.game.score,
           state: window.game.state,
           hud: document.getElementById('score-display').textContent,
           collected: window.game.level.coins.filter(k => k.collected).length }`
    );
    // Exact attribution (S3): the score delta must equal exactly ten times
    // the number of coins that flipped to collected across the drop — a
    // bare "> 0 and % 10" could never fail for any implementation.
    const newCollected = after.collected - placed.collected;
    expect(newCollected).toBeGreaterThanOrEqual(1);
    expect(after.score - placed.score).toBe(newCollected * 10);
    expect(after.hud).toBe(`Score: ${after.score}`);
    expect(after.state).toBe("PLAYING");

    // Stability: parked on the coin tile, nothing else is collecting.
    const stable = abEvalJSON(SESSION, "window.game.score");
    expect(stable).toBe(after.score);
    screenshot(SESSION, "phase2-coin-collected.png");
}, 90000);

test("Spike contact ends the game and shows the game-over overlay", async () => {
    openAtLevel(5, s => s.spikes >= 1);
    waitLanded(SESSION);

    // Action-time pick (I9): the spike must be clear of enemies when the
    // player lands on it, or an enemy could win the race and still leave
    // the frozen body overlapping the spike — a false "spikes kill" pass.
    // Clearance and the teleport happen in ONE eval; attribution is then
    // verified: spike overlap true AND enemy contact false.
    let dead = null;
    for (let attempt = 0; attempt < MAX_REGENERATIONS && !dead; attempt++) {
        const placed = abEvalJSON(
            SESSION,
            `(() => { const g = window.game;
                      const spike = g.hazards.getSpikes().find(s =>
                          (${noThreatFn})(g, s, 128));
                      if (!spike) return null;
                      const p = g.player;
                      p.x = spike.x; p.y = spike.y;
                      p.vx = 0; p.vy = 0; p.grounded = false;
                      return { x: spike.x, y: spike.y }; })()`
        );
        if (!placed) {
            regenerate();
            continue;
        }
        // The 32x32 body fully covers the inset lethal core, so the very
        // next tick must kill.
        abWaitFn(SESSION, "window.game.state === 'GAME_OVER'");
        const outcome = abEvalJSON(
            SESSION,
            `{ score: window.game.score,
               onSpike: window.game.hazards.checkPlayerSpikes(window.game.player),
               enemyTouch: window.game.enemyManager.checkPlayerCollisions(window.game.player) }`
        );
        dead = (outcome.onSpike && !outcome.enemyTouch) ? outcome : null;
        if (!dead) {
            // An enemy won the race despite clearance: regenerate and retry.
            regenerate();
            abWaitFn(SESSION, "window.game.state === 'PLAYING'");
        }
    }
    expect(dead).not.toBeNull();

    expect(elementState(SESSION, "game-over-screen").hidden).toBe(false);
    expect(abEvalJSON(SESSION,
        `document.getElementById('final-score').textContent`
    )).toBe(`Score: ${dead.score}`);
    screenshot(SESSION, "phase2-spike-game-over.png");
}, 90000);

test("Enemies patrol within their bounds while the player stays clear", async () => {
    const summary = openAtLevel(5,
        s => s.enemies >= 1 && s.safeTileX !== null
    );

    // Park outside every patrol span (drop from the sky onto the standable
    // column, matching the level-complete harness pattern) so nothing can
    // kill the player while observers sample enemy motion.
    teleport(summary.safeTileX, 40);
    waitLanded(SESSION);

    const samples = [];
    for (let i = 0; i < 3; i++) {
        samples.push(abEvalJSON(SESSION, ENEMY_SNAPSHOT));
        await Bun.sleep(400);
    }
    const final = abEvalJSON(
        SESSION,
        `{ state: window.game.state, enemies: ${ENEMY_SNAPSHOT} }`
    );
    samples.push(final.enemies);

    for (const sample of samples) {
        expect(sample.length).toBeGreaterThanOrEqual(1);
        for (const e of sample) {
            expect(e.x).toBeGreaterThanOrEqual(e.minX);
            expect(e.x + e.w).toBeLessThanOrEqual(e.maxX);
        }
    }
    // Patrol is alive: at least one enemy changed position across the
    // sampled window (bounds are >= 3 tiles wide, so a patrolling body
    // travels well beyond float noise at 50 px/s over 800+ ms).
    const moved = final.enemies.some((e, i) => Math.abs(e.x - samples[0][i].x) > 1);
    expect(moved).toBe(true);
    expect(final.state).toBe("PLAYING");
    screenshot(SESSION, "phase2-enemy-patrol.png");
}, 90000);

test("Reaching the portal on level 5 completes the level", async () => {
    // A patrol span can sweep into the portal band (bounds follow the solid
    // run under the marker's row), which would make a clear drop impossible
    // on that terrain; require a level whose portal starts clear.
    openAtLevel(5, s => s.portalClear);
    waitLanded(SESSION);

    expect(completeViaPortal()).toBe("LEVEL_COMPLETE");

    const done = abEvalJSON(
        SESSION,
        `{ level: window.game.currentLevel,
           hud: document.getElementById('level-display').textContent }`
    );
    expect(done.level).toBe(5);
    expect(done.hud).toBe("Level: 5");
    expect(elementState(SESSION, "level-complete-screen").hidden).toBe(false);
    screenshot(SESSION, "phase2-level5-complete.png");
}, 90000);

test("Reaching the portal on level 6 (left-facing) completes the level", async () => {
    // Level 6 mirrors the canonical generation: spawn on the right edge,
    // portal band on the left. Same seam-driven traversal as level 5; the
    // direction assertion documents that the mirrored map is what ran.
    const summary = openAtLevel(6,
        s => s.direction === "left" && s.portalClear
    );
    expect(summary.width).toBe(24);
    expect(summary.height).toBe(18);
    waitLanded(SESSION);

    expect(completeViaPortal()).toBe("LEVEL_COMPLETE");

    const done = abEvalJSON(
        SESSION,
        `{ level: window.game.currentLevel,
           hud: document.getElementById('level-display').textContent }`
    );
    expect(done.level).toBe(6);
    expect(done.hud).toBe("Level: 6");
    expect(elementState(SESSION, "level-complete-screen").hidden).toBe(false);
    screenshot(SESSION, "phase2-level6-complete.png");
}, 90000);

test("Reaching the portal on level 7 (vertical) completes the level", async () => {
    // Level 7 climbs the 15x24 grid from the bottom-center spawn to a
    // top-band portal (y <= 4). The drop lands on the portal's validated
    // standable tile inside the spike/marker-free top band; enemy patrols
    // live below it, so clearance re-check plus retry recovery cover races.
    const summary = openAtLevel(7,
        s => s.direction === "vertical" && s.portalClear
    );
    expect(summary.width).toBe(15);
    expect(summary.height).toBe(24);
    waitLanded(SESSION);

    expect(completeViaPortal()).toBe("LEVEL_COMPLETE");

    const done = abEvalJSON(
        SESSION,
        `{ level: window.game.currentLevel,
           portalY: window.game.level.portal.y / window.game.level.tileSize,
           hud: document.getElementById('level-display').textContent }`
    );
    expect(done.level).toBe(7);
    expect(done.portalY).toBeLessThanOrEqual(4);
    expect(done.hud).toBe("Level: 7");
    expect(elementState(SESSION, "level-complete-screen").hidden).toBe(false);
    screenshot(SESSION, "phase2-level7-complete.png");
}, 90000);
