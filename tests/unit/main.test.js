import { test, expect, describe } from "bun:test";

describe("main.js module", () => {
  test("imports without throwing under happy-dom (side-effect-safe)", async () => {
    // A module-scope side effect that throws would reject this import and fail the test.
    const mod = await import("../../js/main.js");
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  test("exports Game and init as functions", async () => {
    const { Game, init } = await import("../../js/main.js");
    expect(typeof Game).toBe("function");
    expect(typeof init).toBe("function");
  });

  test("exports STATE with exactly the four required states", async () => {
    const { STATE } = await import("../../js/main.js");
    expect(STATE).toEqual({
      MENU: "MENU",
      PLAYING: "PLAYING",
      GAME_OVER: "GAME_OVER",
      LEVEL_COMPLETE: "LEVEL_COMPLETE",
    });
  });

  test("importing main.js does not auto-construct a Game", async () => {
    // No #game-canvas element exists in the bare happy-dom document, so if any
    // module-scope code had constructed a Game it would have thrown during the
    // import above. A second dynamic import returns the cached module and must
    // still not touch the DOM.
    const mod = await import("../../js/main.js");
    expect(mod.Game).toBeInstanceOf(Function);
    expect(document.getElementById("game-canvas")).toBeNull();
  });
});
