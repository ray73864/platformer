import { test } from "bun:test";

// Browser E2E scenarios for level completion. Skipped until agent-browser and
// a running dev server are wired into the test harness (Task 11). These must
// not run as vacuous passing assertions of game behaviour.

const SKIP_REASON = "requires agent-browser + running server; wire at Task 11";

test.skip(`Player reaches portal to complete level (${SKIP_REASON})`, async () => {
    // Intended steps (not yet executable):
    // 1. Start the game
    // 2. Navigate through level
    // 3. Reach portal
    // 4. Verify level complete screen appears
});
