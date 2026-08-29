import { test } from "bun:test";

// Browser E2E scenarios for player movement. Skipped until agent-browser and
// a running dev server are wired into the test harness (Task 11). These must
// not run as vacuous passing assertions of game behaviour.

const SKIP_REASON = "requires agent-browser + running server; wire at Task 11";

test.skip(`Player moves left with arrow key (${SKIP_REASON})`, async () => {
    // Intended steps (not yet executable):
    // 1. Start the game
    // 2. Press left arrow key
    // 3. Verify player moves left
});

test.skip(`Player jumps with spacebar (${SKIP_REASON})`, async () => {
    // Intended steps (not yet executable):
    // 1. Start the game
    // 2. Press spacebar
    // 3. Verify player jumps
});
