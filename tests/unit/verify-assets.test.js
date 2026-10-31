import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { checkAssets } from "../../scripts/verify-assets.js";

// Each test gets its own temp directory so fixtures never collide; cleanup
// runs after every test regardless of assertion outcome.
const tempDirs = [];

function fixtureDir() {
    if (tempDirs.length === 0) {
        afterEach(() => {
            for (const dir of tempDirs.splice(0)) {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    }
    const dir = mkdtempSync(join(tmpdir(), "verify-assets-"));
    tempDirs.push(dir);
    return dir;
}

function entry(path, required) {
    return { path, source: "https://kenney.nl", license: "CC0", required };
}

test("required asset present with content passes", () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "tile.png"), "not empty");

    const result = checkAssets([entry("tile.png", true)], dir);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
});

test("required asset missing fails", () => {
    const dir = fixtureDir();

    const result = checkAssets([entry("missing.png", true)], dir);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["missing.png"]);
});

test("required zero-byte asset fails", () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "empty.png"), "");

    const result = checkAssets([entry("empty.png", true)], dir);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["empty.png"]);
});

test("required path that is a directory fails (existsSync alone is not enough)", () => {
    const dir = fixtureDir();
    mkdirSync(join(dir, "fake.png"));

    const result = checkAssets([entry("fake.png", true)], dir);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["fake.png"]);
});

test("optional asset missing warns but does not fail", () => {
    const dir = fixtureDir();

    const result = checkAssets([entry("nice-to-have.png", false)], dir);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual(["nice-to-have.png"]);
});

test("optional asset present passes without warnings", () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "bonus.png"), "data");

    const result = checkAssets([entry("bonus.png", false)], dir);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
});

test("nested manifest paths resolve against the base directory", () => {
    const dir = fixtureDir();
    mkdirSync(join(dir, "packs"));
    writeFileSync(join(dir, "packs", "tiles.zip"), "zip bytes");

    const result = checkAssets(
        [entry("packs/tiles.zip", true), entry("packs/other.zip", false)],
        dir
    );

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(["packs/other.zip"]);
});

test("mixed entries: only required violations fail, optional ones warn", () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "present.png"), "bytes");

    const result = checkAssets(
        [
            entry("present.png", true),
            entry("gone-required.png", true),
            entry("gone-optional.png", false)
        ],
        dir
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["gone-required.png"]);
    expect(result.warnings).toEqual(["gone-optional.png"]);
});
