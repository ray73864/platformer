// Phase 2 integration E2E: proves collectibles, hazards and enemies behave
// end-to-end in a real browser at level 5+, driven through the window.game
// debug seam. Terrain is randomly generated, so every assertion locates its
// subject (coin/spike/enemy/safe tile) in the live level data instead of
// assuming positions, and levels missing a required element are regenerated
// through the seam rather than failed on.
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

// Regenerates the given level through the seam and reports what the generated
// level contains, plus pre-computed safe anchors so each scenario can act
// without tripping the other element types:
// - safeTileX: standable tile outside every enemy's patrol span, so a parked
//   player cannot be touched while observers sample enemy motion.
// - safeCoinIdx: uncollected coin no active enemy is within ~2s of (96px at
//   50px/s) on an overlapping row, so collection cannot be pre-empted by an
//   enemy kill.
// - safeSpike: spike likewise clear of enemies, so a spike death is
//   attributable to the spike.
// - portalClear: no enemy on the portal's row (or a body-height of it) comes
//   within 96px horizontally, i.e. no patrol can touch the portal right now.
const phase2Summary = (levelNumber) => `(() => {
    const g = window.game;
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
    const safeCoinIdx = g.level.coins.findIndex(c => !c.collected &&
        g.enemyManager.enemies.every(
            e => Math.abs(e.x - c.x) > 96 || Math.abs(e.y - c.y) >= 64
        ));
    const spike = g.hazards.getSpikes().find(s =>
        g.enemyManager.enemies.every(e => Math.abs(e.x - s.x) > 128));
    const portal = g.level.portal;
    // Threat needs real collision possibility: same-row proximity (a body
    // fills its tile row, so |dy| >= 64 means no contact is possible —
    // same convention as safeCoinIdx above) AND horizontal closeness. On
    // vertical levels every patrol sits rows below the top-band portal, so
    // an x-only test would demand impossible terrain.
    const portalClear = g.enemyManager.enemies.every(
        e => Math.abs(e.y - portal.y) >= 64 ||
             e.x + e.width < portal.x - 96 ||
             e.x > portal.x + portal.width + 96);
    return {
        direction: g.level.direction,
        width: g.level.width,
        height: g.level.height,
        coins: g.level.coins.length,
        spikes: g.hazards.getSpikes().length,
        enemies: g.enemyManager.enemies.length,
        safeTileX,
        safeCoinIdx,
        safeSpike: spike ? { x: spike.x, y: spike.y } : null,
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
// returns the final state string.
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
                      const portal = g.level.portal;
                      const clear = g.enemyManager.enemies.every(
                          e => Math.abs(e.y - portal.y) >= 64 ||
                               e.x + e.width < portal.x - 96 ||
                               e.x > portal.x + portal.width + 96);
                      if (!clear) return false;
                      const p = g.player;
                      p.x = portal.x; p.y = portal.y - 60;
                      p.vx = 0; p.vy = 0; p.grounded = false;
                      return true; })()`
        );
        if (!dropped) {
            abEvalJSON(
                SESSION,
                `(() => { window.game.startLevel(); return true; })()`
            );
            continue;
        }
        abWaitFn(
            SESSION,
            "window.game.state === 'LEVEL_COMPLETE' ||" +
            " window.game.state === 'GAME_OVER'"
        );
        outcome = abEvalJSON(SESSION, "window.game.state");
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

test("Collecting a coin raises score by tens and syncs the HUD", async () => {
    const summary = openAtLevel(5, s => s.safeCoinIdx >= 0);
    const idx = summary.safeCoinIdx;
    waitLanded(SESSION);

    const before = abEvalJSON(
        SESSION,
        `{ score: window.game.score,
           hud: document.getElementById('score-display').textContent }`
    );

    const coin = abEvalJSON(
        SESSION,
        `(() => { const c = window.game.level.coins[${idx}];
                  return { x: c.x, y: c.y }; })()`
    );
    teleport(coin.x, coin.y);
    abWaitFn(SESSION, `window.game.level.coins[${idx}].collected === true`);

    // The HUD is rewritten every PLAYING tick; poll until it mirrors the
    // engine total rather than racing the next frame.
    abWaitFn(
        SESSION,
        `window.game.score >= ${before.score} + 10 &&` +
        ` document.getElementById('score-display').textContent ===` +
        ` ('Score: ' + window.game.score)`
    );
    const after = abEvalJSON(
        SESSION,
        `{ score: window.game.score,
           state: window.game.state,
           hud: document.getElementById('score-display').textContent }`
    );
    const delta = after.score - before.score;
    expect(delta).toBeGreaterThan(0);
    expect(delta % 10).toBe(0); // COIN_POINTS multiples only
    expect(after.hud).toBe(`Score: ${after.score}`);
    expect(after.state).toBe("PLAYING");
    screenshot(SESSION, "phase2-coin-collected.png");
}, 90000);

test("Spike contact ends the game and shows the game-over overlay", async () => {
    const summary = openAtLevel(5, s => s.safeSpike !== null);
    waitLanded(SESSION);

    // Land the player squarely on the spike tile: the 32x32 body fully
    // covers the inset lethal core, so the very next tick must kill.
    teleport(summary.safeSpike.x, summary.safeSpike.y);
    abWaitFn(SESSION, "window.game.state === 'GAME_OVER'");

    // Attribution: the frozen player still overlaps the spike hitbox, so the
    // death is the spike's, not some incidental hazard.
    const dead = abEvalJSON(
        SESSION,
        `{ score: window.game.score,
           onSpike: window.game.hazards.checkPlayerSpikes(window.game.player) }`
    );
    expect(dead.onSpike).toBe(true);
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
