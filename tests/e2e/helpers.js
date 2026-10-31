// Shared E2E harness: spawns the real dev server (the same `serve` package
// that `bun run start` uses) on a free loopback port, drives a browser
// through the agent-browser CLI, and guarantees both are torn down when tests
// finish — including on abnormal runner exits.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GAME_DIR = new URL("../..", import.meta.url).pathname;

// Per-process subdirectory and session suffixes (see sessionName): fixed
// names collide across concurrent or interrupted runs, mixing screenshots
// and inheriting stale browser sessions.
export const SCREENSHOT_DIR = join(
    process.env.E2E_SCREENSHOT_DIR || join(tmpdir(), "platformer-e2e"),
    `run-${process.pid}`
);

mkdirSync(SCREENSHOT_DIR, { recursive: true });

export function sessionName(base) {
    return `${base}-${process.pid}`;
}

export function getFreePort() {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

// Every spawned serve process group, so teardown does not depend solely on
// afterAll: an interrupted or crashed runner would otherwise orphan detached
// servers that linger for the whole session.
const liveChildren = new Set();

function reapAll() {
    for (const child of liveChildren) stopServer(child);
}

process.on("exit", reapAll);
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        reapAll();
        process.exit(signal === "SIGINT" ? 130 : 143);
    });
}

// The probe in getFreePort closes its port before serve binds it, so another
// process can claim the port in between (TOCTOU). If serve dies on bind, retry
// with a freshly probed port instead of stalling to the full deadline.
const MAX_SERVE_ATTEMPTS = 3;

export async function startServer() {
    let lastError;
    for (let attempt = 1; attempt <= MAX_SERVE_ATTEMPTS; attempt++) {
        const port = await getFreePort();
        // Detached so the whole process group (bun x wrapper + node serve child)
        // can be killed with one negative-pid signal. Loopback-only: a bare
        // `-l <port>` makes serve listen on 0.0.0.0, exposing the source tree
        // and directory listing unauthenticated to the LAN.
        const child = spawn("bun", ["x", "serve", "-l", `tcp://127.0.0.1:${port}`, "-n", "."], {
            cwd: GAME_DIR,
            detached: true,
            stdio: "ignore"
        });
        liveChildren.add(child);

        let died = false;
        child.on("exit", () => {
            died = true;
        });

        const deadline = Date.now() + 20000;
        for (;;) {
            try {
                const res = await fetch(`http://127.0.0.1:${port}/`);
                if (res.ok) {
                    return { url: `http://127.0.0.1:${port}`, stop: () => stopServer(child) };
                }
            } catch {
                // Server not accepting connections yet.
            }
            if (died) {
                lastError = new Error(
                    `serve exited before serving port ${port} ` +
                    `(attempt ${attempt}/${MAX_SERVE_ATTEMPTS}; the probed port ` +
                    `may have been claimed by another process)`
                );
                break;
            }
            if (Date.now() > deadline) {
                stopServer(child);
                throw new Error(`dev server did not start on port ${port}`);
            }
            await Bun.sleep(200);
        }
    }
    throw lastError;
}

export function stopServer(child) {
    liveChildren.delete(child);
    try {
        process.kill(-child.pid, "SIGKILL");
    } catch {
        try {
            child.kill("SIGKILL");
        } catch {
            // Already gone.
        }
    }
}

export function ab(session, ...args) {
    const res = spawnSync("agent-browser", ["--session", session, ...args], {
        encoding: "utf8",
        // Without a timeout a wedged CLI call blocks this synchronous call —
        // and with it the whole test process, including every teardown.
        timeout: 30000
    });
    if (res.error) {
        throw new Error(
            `agent-browser ${args.join(" ")} could not run: ${res.error.message}`
        );
    }
    if (res.status !== 0) {
        throw new Error(
            `agent-browser ${args.join(" ")} failed ` +
            `(status ${res.status}): ${res.stderr?.trim()}`
        );
    }
    return res.stdout.trim();
}

// The CLI JSON-encodes the eval result; scripts here return a JSON string,
// so decoding takes two passes.
export function abEvalJSON(session, expression) {
    const script = `JSON.stringify(${expression})`;
    const encoded = Buffer.from(script).toString("base64");
    const raw = ab(session, "eval", "-b", encoded);
    try {
        return JSON.parse(JSON.parse(raw));
    } catch (cause) {
        throw new Error(
            `agent-browser eval did not return double-encoded JSON for ` +
            `expression "${expression}"; raw output: ${JSON.stringify(raw).slice(0, 400)}`,
            { cause }
        );
    }
}

export function openGame(session, url, width = 800, height = 600) {
    // Launch the browser first, then set the viewport before navigation so
    // the Game is constructed at a known canvas size.
    ab(session, "open");
    ab(session, "set", "viewport", String(width), String(height));
    ab(session, "open", url);
    // Pin to the new document: without this, the MENU predicate below can be
    // satisfied by the PREVIOUS page before navigation commits.
    ab(session, "wait", "--load", "domcontentloaded");
    ab(session, "wait", "--fn", "window.game && window.game.state === 'MENU'");
}

export function startGame(session) {
    ab(session, "click", "#start-btn");
}

export function abWaitFn(session, expression, timeoutMs = 15000) {
    ab(session, "wait", "--fn", expression, "--timeout", String(timeoutMs));
}

// Polls until the player is standing. `grounded` is re-derived from live
// collision contact every physics tick (resolveCollisions clears it before
// resolution), so pre-physics spawn state reads false and only a real
// landing flips it — no page-global sticky flag that can go stale across
// tests. Harnesses that teleport the player must set `grounded = false`
// alongside the position, since physics only refreshes it on the next tick.
export function waitLanded(session) {
    abWaitFn(
        session,
        "window.game.player.grounded === true"
    );
}

export function screenshot(session, name) {
    const path = join(SCREENSHOT_DIR, name);
    ab(session, "screenshot", path);
    return path;
}

export function elementState(session, id) {
    return abEvalJSON(
        session,
        `{ hidden: document.getElementById(${JSON.stringify(id)}).classList.contains('hidden') }`
    );
}

export function closeSession(session) {
    // Retry once: a close racing an in-flight command can fail transiently.
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            ab(session, "close");
            return;
        } catch (error) {
            lastError = error;
            Bun.sleepSync(500);
        }
    }
    // Surface it: swallowing both failures lets a later run inherit a stale
    // session and misattribute state across runs.
    throw new Error(
        `failed to close agent-browser session "${session}": ${lastError?.message}`
    );
}
