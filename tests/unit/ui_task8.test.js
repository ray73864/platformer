// Wave C UI pins: cause-of-death tip table completeness, HUD urgent-clock
// threshold logic (chip classes + FX.pulse gate), level-intro card copy,
// change-gated HUD writers, and the throttled polite announcement region.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { UI, isTimeUrgent, TIME_URGENT_THRESHOLD } from "../../js/ui.js";
import { FX } from "../../js/fx.js";

const FIXTURE = `
    <div id="hud">
        <span class="hud-chip"><span id="score-display">Score: 0</span></span>
        <span class="hud-chip"><span id="level-display">Level: 1</span></span>
        <span class="hud-chip"><span id="coins-display">Coins: 0/0</span></span>
        <span class="hud-chip" id="timer-chip"><span id="timer-display">Time: 0:30</span></span>
    </div>
    <p id="death-cause" hidden></p>
    <p id="death-tip" hidden></p>
    <p id="score-penalty" hidden></p>
    <div id="final-score"></div>
`;

beforeAll(() => { document.body.innerHTML = FIXTURE; });
afterAll(() => { document.body.innerHTML = ""; });

// --- cause-of-death tips -----------------------------------------------------

test("every named death cause carries a non-empty tip", () => {
    const causes = Object.keys(UI.DEATH_CAUSE_TEXT);
    expect(causes.length).toBeGreaterThanOrEqual(6);
    for (const cause of causes) {
        const tip = UI.DEATH_TIP[cause];
        expect(typeof tip, `tip for ${cause}`).toBe('string');
        expect(tip.trim().length, `tip for ${cause} non-empty`).toBeGreaterThan(0);
    }
    // No orphan tips pointing at causes the game never reports.
    for (const cause of Object.keys(UI.DEATH_TIP)) {
        expect(UI.DEATH_CAUSE_TEXT).toHaveProperty(cause);
    }
});

test("showGameOver reveals the tip with the cause and hides it otherwise", () => {
    const ui = new UI();
    const tipEl = document.getElementById('death-tip');

    ui.showGameOver(50, 'pit', 10);
    expect(tipEl.hidden).toBe(false);
    expect(tipEl.textContent).toBe(UI.DEATH_TIP.pit);

    ui.showGameOver(0, 'unknown-cause');
    expect(tipEl.hidden).toBe(true);
    // Legacy call shape (no cause at all) stays safe.
    expect(() => ui.showGameOver(100)).not.toThrow();
    expect(tipEl.hidden).toBe(true);
});

// --- urgent clock -------------------------------------------------------------

test("isTimeUrgent: strictly inside (0, 10), junk-safe", () => {
    expect(TIME_URGENT_THRESHOLD).toBe(10);
    expect(isTimeUrgent(9.999)).toBe(true);
    expect(isTimeUrgent(10)).toBe(false);   // exactly ten is NOT urgent
    expect(isTimeUrgent(30)).toBe(false);
    expect(isTimeUrgent(0)).toBe(false);    // the tick that kills never pulses
    expect(isTimeUrgent(-5)).toBe(false);
    expect(isTimeUrgent(NaN)).toBe(false);
    expect(isTimeUrgent(undefined)).toBe(false);
});

test("updateTimer drives time-urgent/time-pulse on the chip, gated by FX.pulse", () => {
    const ui = new UI();
    const chip = document.getElementById('timer-chip');

    ui.updateTimer(30);
    expect(chip.classList.contains('time-urgent')).toBe(false);
    expect(chip.classList.contains('time-pulse')).toBe(false);

    ui.updateTimer(9);
    expect(chip.classList.contains('time-urgent')).toBe(true);
    expect(chip.classList.contains('time-pulse')).toBe(true); // FX.pulse default

    const savedPulse = FX.pulse;
    FX.pulse = false; // reduced motion: static color, no animation class
    ui.updateTimer(8);
    expect(chip.classList.contains('time-urgent')).toBe(true);
    expect(chip.classList.contains('time-pulse')).toBe(false);
    FX.pulse = savedPulse;

    ui.updateTimer(45); // carried bonus back above the line clears both
    expect(chip.classList.contains('time-urgent')).toBe(false);
    expect(chip.classList.contains('time-pulse')).toBe(false);
});

test("fixtures without a chip wrapper fall back to the bare span", () => {
    document.body.innerHTML = `<span id="timer-display">Time: 0:30</span>`;
    const ui = new UI();
    ui.updateTimer(5);
    expect(document.getElementById('timer-display')
        .classList.contains('time-urgent')).toBe(true);
    document.body.innerHTML = FIXTURE;
});

// --- level-intro card -----------------------------------------------------------

test("theme names map the THEMES cycle: DAY / DUSK / JUNGLE", () => {
    expect(UI.themeNameFor(1)).toBe('DAY');
    expect(UI.themeNameFor(2)).toBe('DUSK');
    expect(UI.themeNameFor(3)).toBe('JUNGLE');
    expect(UI.themeNameFor(4)).toBe('DAY');   // wraps
    expect(UI.themeNameFor(0)).toBe('DAY');   // clamped
});

test("showLevelIntro writes 'LEVEL n · THEME' and restarts its animation", () => {
    const ui = new UI();
    ui.showLevelIntro(23);
    const card = document.getElementById('level-intro-card');
    expect(card.textContent).toBe('LEVEL 23 \u00b7 DUSK');
    expect(card.classList.contains('show')).toBe(true);
    ui.showLevelIntro(24);
    expect(card.textContent).toBe('LEVEL 24 \u00b7 JUNGLE');
    expect(card.classList.contains('show')).toBe(true);
});

// --- change-gated writers + announcements ----------------------------------------

test("identical HUD writes are skipped (MutationObserver sees nothing)", async () => {
    const ui = new UI();
    const el = document.getElementById('score-display');
    el.textContent = 'Score: 42';
    const records = [];
    const observer = new window.MutationObserver(muts => records.push(...muts));
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    ui.updateScore(42);
    ui.updateScore(42);
    await Bun.sleep(20);
    expect(records.length).toBe(0);
    ui.updateScore(52);
    await Bun.sleep(20);
    expect(records.length).toBeGreaterThan(0);
    observer.disconnect();
});

test("rapid coin pickups coalesce into ONE polite announcement", async () => {
    const ui = new UI();
    // ensureElement creates (and idempotently returns) the live region.
    const region = ui.ensureElement('hud-announce', 'sr-only');
    // Drain any throttle window opened by earlier tests first so this one
    // observes only its own burst.
    await Bun.sleep(1150);
    region.textContent = '';
    for (let i = 1; i <= 6; i++) ui.updateCoins(i, 6);
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');       // nothing written synchronously
    await Bun.sleep(1300);
    // One flush carrying the LATEST state — not six queued readings.
    expect(region.textContent).toBe('coins 6 of 6');
});
