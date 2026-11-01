/**
 * Collection bookkeeping and scoring for the coins a Level generates.
 *
 * Contract:
 * - Coins are plain objects `{x, y, width, height, collected}` in pixel
 *   space. `loadCoins(coins)` adopts an externally generated array by
 *   reference so the level's renderer and this class share coin objects.
 * - Each newly collected coin is worth COIN_POINTS (10). Collecting an
 *   already-collected coin (by index or via overlap) never scores twice.
 * - `checkCollection(player)` tests the player AABB against every
 *   uncollected coin and returns the number of coins collected by that
 *   single call (0 when nothing overlaps), so a player straddling two
 *   coins picks both up at once.
 */
import { aabbOverlap } from './physics.js';

const COIN_WIDTH = 16;
const COIN_HEIGHT = 16;
// Exported so the game loop scores collections through the same constant
// rather than mirroring a magic number (the running total lives in Game).
export const COIN_POINTS = 10;

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
        this.score += COIN_POINTS;
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

    // Portal coin-gate (spec: 70% of coins). The collected > total guard is
    // defensive per spec; direct flag counting makes it unreachable in practice.
    meetsPortalRequirement() {
        const total = this.coins.length;
        if (total === 0) return false;

        const collected = this.coins.filter(coin => coin.collected).length;
        if (collected > total) return true;

        return collected >= Math.max(1, Math.floor(total * 0.7));
    }

    checkCollection(player) {
        let collectedNow = 0;

        for (let i = 0; i < this.coins.length; i++) {
            const coin = this.coins[i];
            if (coin.collected) continue;

            // Axis-aligned overlap; touching edges do not count.
            if (aabbOverlap(player, coin)) {
                this.collectCoin(i);
                collectedNow++;
            }
        }

        return collectedNow;
    }
}
