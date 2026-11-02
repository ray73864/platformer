import { test, expect } from "bun:test";
import { computeZoom } from "../../js/main.js";

// World zoom fills large screens without ever shrinking below 1x, capped at
// 3x so 4K panels do not magnify a single tile across half the display.
test("computeZoom keeps laptops at 1x and scales big displays", () => {
    expect(computeZoom(768)).toBe(1);   // laptop
    expect(computeZoom(500)).toBe(1);   // short window never goes below 1
    expect(computeZoom(1080)).toBe(2);  // full HD
    expect(computeZoom(1440)).toBe(3);  // 1440p fills more of the panel
    expect(computeZoom(2160)).toBe(3);  // 4K
    expect(computeZoom(4320)).toBe(3);  // 8K stays capped at 3
});
