import { test } from "bun:test";

// Browser E2E scenarios for game start. Skipped until agent-browser and a
// running dev server are wired into the test harness (Task 11). These must
// not run as vacuous passing assertions of game behaviour.

const SKIP_REASON = "requires agent-browser + running server; wire at Task 11";

test.skip(`Game starts with menu screen (${SKIP_REASON})`, async () => {
    // Intended steps (not yet executable):
    // 1. Open the game page in a browser via agent-browser
    // 2. Verify the menu screen is visible
});

test.skip(`Start button navigates to gameplay (${SKIP_REASON})`, async () => {
    // Intended steps (not yet executable):
    // 1. Open the game page
    // 2. Verify menu screen is visible
    // 3. Click start button
    // 4. Verify gameplay screen is visible
});
