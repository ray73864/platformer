import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { checkAssets, validateEntries, runGate } from "../../scripts/verify-assets.js";

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

test("required asset present with content passes", async () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "tile.png"), "not empty");

    const result = await checkAssets([entry("tile.png", true)], dir);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
});

test("required asset missing fails", async () => {
    const dir = fixtureDir();

    const result = await checkAssets([entry("missing.png", true)], dir);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["missing.png"]);
});

test("required zero-byte asset fails", async () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "empty.png"), "");

    const result = await checkAssets([entry("empty.png", true)], dir);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["empty.png"]);
});

test("required path that is a directory fails (existence alone is not enough)", async () => {
    const dir = fixtureDir();
    mkdirSync(join(dir, "fake.png"));

    const result = await checkAssets([entry("fake.png", true)], dir);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["fake.png"]);
});

test("optional asset missing warns but does not fail", async () => {
    const dir = fixtureDir();

    const result = await checkAssets([entry("nice-to-have.png", false)], dir);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual(["nice-to-have.png"]);
});

test("optional asset present passes without warnings", async () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "bonus.png"), "data");

    const result = await checkAssets([entry("bonus.png", false)], dir);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
});

test("nested manifest paths resolve against the base directory", async () => {
    const dir = fixtureDir();
    mkdirSync(join(dir, "packs"));
    writeFileSync(join(dir, "packs", "tiles.zip"), "zip bytes");

    const result = await checkAssets(
        [entry("packs/tiles.zip", true), entry("packs/other.zip", false)],
        dir
    );

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(["packs/other.zip"]);
});

test("mixed entries: only required violations fail, optional ones warn", async () => {
    const dir = fixtureDir();
    writeFileSync(join(dir, "present.png"), "bytes");

    const result = await checkAssets(
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

// --- Entry shape validation (I7) --------------------------------------------

test("validateEntries accepts well-formed manifests", () => {
    expect(validateEntries([entry("a.png", true), entry("b.png", false)]))
        .toEqual([]);
});

test("validateEntries rejects non-array manifests and non-object entries", () => {
    expect(validateEntries(null).length).toBe(1);
    expect(validateEntries(undefined).length).toBe(1);
    expect(validateEntries("nope").length).toBe(1);
    expect(validateEntries([null]).length).toBe(1);
    expect(validateEntries(["a.png"]).length).toBe(1);
});

test("a dropped or misspelled required flag is a hard shape failure", () => {
    // Truthiness classification used to downgrade these to warnings — the
    // exact one-character typo the promotion flow invites.
    expect(validateEntries([{ path: "a.png" }]).length).toBe(1);
    expect(validateEntries([{ path: "a.png", reqired: true }]).length).toBe(1);
    expect(validateEntries([{ path: "a.png", required: "true" }]).length).toBe(1);
});

test("absolute and escaping manifest paths are rejected", () => {
    const abs = validateEntries([{ path: "/etc/hostname", required: true }]);
    expect(abs.length).toBe(1);
    const esc = validateEntries([
        { path: "../../../etc/hostname", required: true }
    ]);
    expect(esc.length).toBe(1);
});

test("checkAssets never satisfies an escaping path from outside the base", async () => {
    const outer = fixtureDir();
    const inner = join(outer, "game", "assets");
    mkdirSync(inner, { recursive: true });
    // The file exists above the base; joining it in from outside version
    // control must fail even though a naive join+exists would pass.
    writeFileSync(join(outer, "sneaky-outside.txt"), "bytes");
    const result = await checkAssets(
        [{ path: "../sneaky-outside.txt", required: true }],
        inner
    );
    expect(result.ok).toBe(false);
});

// --- runGate: the CLI contract (I1) ------------------------------------------

// Builds a temp game root: manifest at <root>/assets/manifest.json, art
// under <root>/assets/<path> exactly as the plan's Task 10 promotion flow
// commits it. The shipped gate must accept that layout with required:true.
function gameRootWith(manifestBody) {
    const root = fixtureDir();
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "manifest.json"), manifestBody);
    return root;
}

test("runGate passes when required art is committed under assets/ (Task 10 promotion contract)", async () => {
    const root = gameRootWith(JSON.stringify({
        assets: [
            { path: "tilesets/tiles.png", source: "s", license: "CC0", required: true }
        ]
    }));
    mkdirSync(join(root, "assets", "tilesets"));
    writeFileSync(join(root, "assets", "tilesets", "tiles.png"), "art bytes");

    expect(await runGate(root)).toBe(0);
});

test("runGate fails when a required entry is missing despite the assets/ layout", async () => {
    const root = gameRootWith(JSON.stringify({
        assets: [
            { path: "tilesets/tiles.png", source: "s", license: "CC0", required: true }
        ]
    }));

    expect(await runGate(root)).toBe(1);
});

test("runGate fails on a malformed manifest without raw throws", async () => {
    // JSON that parses to null used to deref .assets and crash uncaught.
    expect(await runGate(gameRootWith("null"))).toBe(1);
    // Unparseable JSON: handled by the read/parse guard.
    expect(await runGate(gameRootWith("{ not json"))).toBe(1);
    // Missing manifest entirely.
    const empty = fixtureDir();
    expect(await runGate(empty)).toBe(1);
});

test("runGate fails when required art sits at the wrong base (regression: joining on game root)", async () => {
    const root = fixtureDir();
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "manifest.json"), JSON.stringify({
        assets: [
            { path: "tilesets/tiles.png", source: "s", license: "CC0", required: true }
        ]
    }));
    // Art at <root>/tilesets (the old wrong base) must NOT satisfy the gate.
    mkdirSync(join(root, "tilesets"));
    writeFileSync(join(root, "tilesets", "tiles.png"), "art bytes");

    expect(await runGate(root)).toBe(1);
});

test("runGate on the real repo root passes with the shipped all-optional manifest", async () => {
    // Exercises main()'s exact wiring against the committed manifest: any
    // shape regression in game/assets/manifest.json fails here.
    expect(await runGate(join(import.meta.dir, "..", ".."))).toBe(0);
});

test("CLI smoke: bun scripts/verify-assets.js exits 0 on the shipped tree", () => {
    const proc = Bun.spawnSync(["bun", "run", "verify"], {
        cwd: join(import.meta.dir, ".."),
        stdout: "pipe",
        stderr: "pipe"
    });
    expect(proc.exitCode).toBe(0);
});
