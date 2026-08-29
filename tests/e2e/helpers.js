// Shared E2E harness: spawns the real dev server (the same `serve` package
// that `bun run start` uses) on a free port, drives a browser through the
// agent-browser CLI, and guarantees both are torn down when tests finish.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GAME_DIR = new URL("../..", import.meta.url).pathname;

export const SCREENSHOT_DIR =
    process.env.E2E_SCREENSHOT_DIR || join(tmpdir(), "platformer-e2e");

mkdirSync(SCREENSHOT_DIR, { recursive: true });

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

export async function startServer() {
    const port = await getFreePort();
    // Detached so the whole process group (bun x wrapper + node serve child)
    // can be killed with one negative-pid signal.
    const child = spawn("bun", ["x", "serve", "-l", String(port), "-n", "."], {
        cwd: GAME_DIR,
        detached: true,
        stdio: "ignore"
    });

    const deadline = Date.now() + 20000;
    for (;;) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/`);
            if (res.ok) break;
        } catch {
            // Server not accepting connections yet.
        }
        if (Date.now() > deadline) {
            stopServer(child);
            throw new Error(`dev server did not start on port ${port}`);
        }
        await Bun.sleep(200);
    }

    return { url: `http://127.0.0.1:${port}`, stop: () => stopServer(child) };
}

export function stopServer(child) {
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
        encoding: "utf8"
    });
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
    return JSON.parse(JSON.parse(raw));
}

export function openGame(session, url, width = 800, height = 600) {
    // Launch the browser first, then set the viewport before navigation so
    // the Game is constructed at a known canvas size.
    ab(session, "open");
    ab(session, "set", "viewport", String(width), String(height));
    ab(session, "open", url);
    ab(session, "wait", "--fn", "window.game && window.game.state === 'MENU'");
}

export function startGame(session) {
    ab(session, "click", "#start-btn");
}

export function abWaitFn(session, expression, timeoutMs = 15000) {
    ab(session, "wait", "--fn", expression, "--timeout", String(timeoutMs));
}

// Polls until the player has completed at least one falling frame and come
// to rest (vy === 0 between frames), replacing fixed settle sleeps. The
// sticky flag guards the pre-physics vy === 0 at spawn.
export function waitLanded(session) {
    abWaitFn(
        session,
        "(() => { const p = window.game.player;" +
        " if (p.vy > 0) window.__fellOnce = true;" +
        " return window.__fellOnce === true && p.vy === 0; })()"
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
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            ab(session, "close");
            return;
        } catch {
            Bun.sleepSync(500);
        }
    }
}
