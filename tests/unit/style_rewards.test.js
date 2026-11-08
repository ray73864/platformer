// Unit seam: M5 style-reward math (SPEC §M5, Task 7).
//
// Pure guards mirror the score-economy house style (clearBonusFor /
// deathScorePenalty): never throw, always whole points, corrupt input falls
// back on the conservative side. The Collectibles half pins the SECRET tier
// on the per-level ledger and the detailed collection pass that prices it.
import { test, expect } from "bun:test";
import {
    noDamageBonusFor,
    NO_DAMAGE_CLEAR_BONUS,
    STOMP_CHAIN_BONUS,
    STOMP_CHAIN_MIN
} from "../../js/main.js";
import {
    COIN_POINTS,
    SECRET_COIN_SCORE,
    Collectibles
} from "../../js/collectibles.js";

test("M5 constants keep their stated relationship to COIN_POINTS", () => {
    // Same multiples discipline as the combat tiers: secrets pay 2.5 coins,
    // the no-damage clear pays 5, the chain pays 3.
    expect(SECRET_COIN_SCORE).toBe(2.5 * COIN_POINTS);
    expect(NO_DAMAGE_CLEAR_BONUS).toBe(5 * COIN_POINTS);
    expect(STOMP_CHAIN_BONUS).toBe(3 * COIN_POINTS);
    expect(STOMP_CHAIN_MIN).toBe(2);
    // Economy discipline (SPEC): every premium sits within the 10/25/40 ladder.
    expect(SECRET_COIN_SCORE).toBeLessThan(40);
    expect(STOMP_CHAIN_BONUS).toBeLessThan(NO_DAMAGE_CLEAR_BONUS);
});

test("noDamageBonusFor pays exactly on zero deaths and guards like clearBonusFor", () => {
    expect(noDamageBonusFor(0)).toBe(50);
    expect(noDamageBonusFor(1)).toBe(0);
    expect(noDamageBonusFor(7)).toBe(0);
    // Corrupt counts NEVER mint the bonus — only the exact integer 0 qualifies
    // (same conservative rule as the flawless clear tier).
    for (const bad of [NaN, -1, 1.5, Infinity, "0", null, undefined]) {
        expect(noDamageBonusFor(bad)).toBe(0);
    }
});

test("secret coins pay the premium on the Collectibles ledger", () => {
    const c = new Collectibles();
    c.addCoin(0, 0); // plain coin via the sanctioned builder: no secret flag
    c.coins.push({ x: 32, y: 0, width: 16, height: 16, collected: false,
        secret: true });
    c.collectCoin(0);
    expect(c.getScore()).toBe(COIN_POINTS);
    c.collectCoin(1);
    expect(c.getScore()).toBe(COIN_POINTS + SECRET_COIN_SCORE);
    // Re-collecting either index never pays twice (unchanged contract).
    c.collectCoin(0);
    c.collectCoin(1);
    expect(c.getScore()).toBe(COIN_POINTS + SECRET_COIN_SCORE);
});

test("checkCollectionDetailed reports the secret split; checkCollection keeps counting", () => {
    const c = new Collectibles();
    c.coins.push({ x: 0, y: 0, width: 16, height: 16, collected: false });
    c.coins.push({ x: 0, y: 0, width: 16, height: 16, collected: false,
        secret: true });
    const player = { x: -4, y: -4, width: 24, height: 24 };
    const pickups = c.checkCollectionDetailed(player);
    expect(pickups).toEqual({ count: 2, secretCount: 1 });
    expect(c.getScore()).toBe(COIN_POINTS + SECRET_COIN_SCORE);
    // An empty follow-up frame counts nothing, and the legacy wrapper still
    // returns a plain number.
    expect(c.checkCollectionDetailed(player)).toEqual({ count: 0, secretCount: 0 });
    expect(c.checkCollection(player)).toBe(0);
});

test("portal-gate subset ignores secret coins (T6 non-regression)", () => {
    const c = new Collectibles();
    c.coins.push({ x: 0, y: 0, width: 16, height: 16, collected: false });
    c.coins.push({ x: 64, y: 0, width: 16, height: 16, collected: false,
        secret: true });
    // Required coin alone uncollected -> gate closed even though the secret
    // sits right next to the player.
    expect(c.meetsPortalRequirement()).toBe(false);
    c.collectCoin(0);
    expect(c.meetsPortalRequirement()).toBe(true);
    expect(c.getRequiredCoins().length).toBe(1);
    expect(c.getCoins().length).toBe(2);
});
