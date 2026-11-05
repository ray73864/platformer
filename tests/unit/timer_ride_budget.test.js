// Forced-ride clock budget (feel & finish wave, item 3, 2026-11-06): deck
// bridges and elevator shafts are REQUIRED crossings — their wait+ride time
// lands directly on the run clock (base 60 s, carryover between levels, +2 s
// per coin). Measurement across the fairness band (scratch sweep seeds
// 700..809 x L5..100, 4397 ride maps from real generated parameters; this
// test itself re-checks a representative subset s=700..702) put the
// worst-case forced
// ride at 30.4 s on a shaft (leg <= 9.6 s at V_DECK_SPEED_MIN x 3 legs +
// 2 dwells) and 20.1 s on a bridge; income-adjusted (60 + 2*coins) those are
// shares of 0.32 and 0.20. A competent-bot simulated clock (deck/elevator
// brains, 130 wins across decades) showed traversal-only times topping out
// at 36.8 s with ZERO maps past 65% of budget — so no TIME BUDGET allowance
// ships, and these tests pin the invariant instead: a forced ride must never
// eat more than 40% of its own map's clock budget, and the absolute worst
// case must stay under the structural ceiling implied by the speed/lift
// constants (3 * MAX_SHAFT_LIFT*TILE/V_DECK_SPEED_MIN + 2*DECK_DWELL_S ~ 31 s).
import { test, expect } from "bun:test";
import { Level } from "../../js/level.js";

const T = 32;
const BASE_BUDGET = 60;   // Timer default baseTime (timer.js)
const COIN_SECONDS = 2;   // Timer.addCoinBonus
const DWELL = 0.8;        // DECK_DWELL_S in level.js (dwell field on every desc)

// Seconds a rider spends on one forced crossing: wait for the near stop plus
// the traverse. Worst case arrives just after the near-lip hold ends and
// waits a full return leg before riding out: 3*leg + 2*dwell.
function rideCost(desc) {
    const leg = (desc.max - desc.min) / desc.speed;
    return { leg, worst: 3 * leg + 2 * (desc.dwell ?? 0), dwell: desc.dwell ?? 0 };
}

test("every forced ride stays within its map's clock budget", { timeout: 60000 }, () => {
    let checked = 0, bridges = 0, shafts = 0;
    let worstShare = 0, worstAt = "", worstSecs = 0;
    for (let s = 700; s <= 702; s++) {
        for (let lvl = 8; lvl <= 100; lvl++) {
            const level = new Level(lvl, T, lvl * 1000 + s);
            const descs = level.getMovingPlatforms();
            if (!descs.length) continue;
            checked++;
            const { worst, dwell } = rideCost(descs[0]);
            expect(dwell).toBe(DWELL);
            const coins = level.getCoins().length;
            const share = worst / (BASE_BUDGET + COIN_SECONDS * coins);
            if (share > worstShare) {
                worstShare = share;
                worstAt = `L${lvl}s${s}`;
                worstSecs = worst;
            }
            // Structural ceilings from the generator constants: horizontal
            // decks span <= (MAX_DECK_GAP - MP_DECK_TILES) tiles at >= 26 px/s,
            // shafts <= MAX_SHAFT_LIFT rows at >= 20 px/s.
            const cap = level.direction === 'vertical' ? 31 : 21;
            expect(worst).toBeLessThan(cap);
            // The shipped ruling: never over 40% of the map's own budget.
            expect(share).toBeLessThanOrEqual(0.40);
            if (level.direction === 'vertical') shafts++; else bridges++;
        }
    }
    // The sweep must actually see both ride kinds or it pins nothing.
    expect(bridges).toBeGreaterThan(20);
    expect(shafts).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(100);
    // Report the binding map through the assertion itself (readable failure).
    expect(worstShare, worstAt).toBeLessThanOrEqual(0.40);
    expect(worstSecs).toBeGreaterThan(0);
});
