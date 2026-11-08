/**
 * Collection bookkeeping and scoring for the coins a Level generates.
 *
 * Contract:
 * - Coins are plain objects `{x, y, width, height, collected}` in pixel
 *   space. `loadCoins(coins)` adopts an externally generated array by
 *   reference so the level's renderer and this class share coin objects.
 * - Each newly collected coin is worth COIN_POINTS (10); SECRET coins
 *   (M5, `secret: true`) are worth SECRET_COIN_SCORE (25). Collecting an
 *   already-collected coin (by index or via overlap) never scores twice.
 * - `checkCollection(player)` tests the player AABB against every
 *   uncollected coin and returns the number of coins collected by that
 *   single call (0 when nothing overlaps), so a player straddling two
 *   coins picks both up at once. `checkCollectionDetailed(player)` is the
 *   same pass reporting the secret split for the scoring loop.
 */
import { aabbOverlap } from './physics.js';

const COIN_WIDTH = 16;
const COIN_HEIGHT = 16;
// Exported so the game loop scores collections through the same constant
// rather than mirroring a magic number (the running total lives in Game).
export const COIN_POINTS = 10;
// M5 style reward (SPEC §M5, owner-approved capability program): a coin that
// carries `secret: true` — an alcove interior placed by level.js's M4 carver —
// pays 2.5 coins instead of one. Secrets demand the wall-jump chimney skill and
// are never required by the portal gate (see meetsPortalRequirement), so the
// premium buys risk-reward, never progress. Same unit discipline as the combat
// tiers in main.js: whole multiples of COIN_POINTS.
export const SECRET_COIN_SCORE = 25;

export class Collectibles {
    constructor() {
        this.coins = [];
        this.score = 0;
    }

    loadCoins(coins) {
        this.coins = coins;
    }

    addCoin(x, y) {
        this.coins.push({
            x,
            y,
            width: COIN_WIDTH,
            height: COIN_HEIGHT,
            collected: false
        });
    }

    collectCoin(index) {
        if (index < 0 || index >= this.coins.length) return;

        const coin = this.coins[index];
        if (coin.collected) return;

        coin.collected = true;
        // M5: secret coins pay the premium tier on this ledger too, so a
        // caller reading getScore() sees the same value the loop awards.
        this.score += coin.secret ? SECRET_COIN_SCORE : COIN_POINTS;
    }

    getScore() {
        return this.score;
    }

    getCoins() {
        return this.coins;
    }

    getUncollectedCoins() {
        return this.coins.filter(coin => !coin.collected);
    }

    // Portal coin gate: ALL coins must be collected (owner ruling
    // 2026-11-03, superseding the spec's 70% threshold — at 70% a stray
    // touch of the unlocked portal ended the level with coins still on the
    // map). A locked portal is inert, so no coin can ever be lost to an
    // accidental brush-past. With no coins at all the gate opens trivially
    // (generation ships >= 5 per level; Game.publishLevel warns below the
    // spec floor of 3).
    // M4/R4 ruling: SECRET coins (alcove interiors, capability program Task 6)
    // are excluded from the requirement — secrets must never gate progress,
    // because reaching them demands the wall-jump chimney skill the base
    // fairness proofs treat as unreachable. The HUD shows the REQUIRED count
    // only (Game.updateCoins call sites read getRequiredCoins), so "Coins:
    // n/n" always means "portal unlocked", never a hidden extra ask.
    meetsPortalRequirement() {
        const required = this.getRequiredCoins();
        if (required.length === 0) return true;
        const collected = required.filter(coin => coin.collected).length;
        return collected >= required.length;
    }

    // The portal-gate subset: every coin except the secret ones. Shared by
    // meetsPortalRequirement and the HUD writers so the displayed count can
    // never drift from the actual gate.
    getRequiredCoins() {
        return this.coins.filter(coin => !coin.secret);
    }

    // Same pass as checkCollection, reporting the secret split so the game
    // loop can price each pickup tier without a second AABB sweep. Returns
    // {count, secretCount} — count is every coin collected by this call,
    // secretCount the `secret: true` subset.
    checkCollectionDetailed(player) {
        let collectedNow = 0;
        let secretNow = 0;

        for (let i = 0; i < this.coins.length; i++) {
            const coin = this.coins[i];
            if (coin.collected) continue;

            // Axis-aligned overlap; touching edges do not count.
            if (aabbOverlap(player, coin)) {
                this.collectCoin(i);
                collectedNow++;
                if (coin.secret) secretNow++;
            }
        }

        return { count: collectedNow, secretCount: secretNow };
    }

    checkCollection(player) {
        return this.checkCollectionDetailed(player).count;
    }
}
