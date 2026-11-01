import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Gate logic for asset verification, kept pure (no process exit) so unit
 * tests can exercise it against temp fixtures. Bun APIs only, per the
 * project's runtime rule.
 *
 * Manifest entry paths resolve against <gameRoot>/assets — the directory
 * the plan's Task 10 promotion flow commits art into ("commit the files
 * under game/assets/... matching the manifest paths"). Joining them onto
 * the bare game root looked for game/<path> and failed the documented
 * promotion step even with art present.
 */

/**
 * Validate the shape of manifest entries before any filesystem work. A
 * dropped or misspelled `required` must fail loudly: classifying by
 * truthiness silently downgraded a required asset to a warning, defeating
 * the hard gate on exactly the typo the promotion flow invites.
 *
 * @param {unknown} assets The parsed manifest "assets" value.
 * @returns {string[]} Human-readable problems; empty when everything is valid.
 */
export function validateEntries(assets) {
    if (!Array.isArray(assets)) {
        return ['manifest "assets" must be an array'];
    }
    const problems = [];
    assets.forEach((entry, i) => {
        if (entry === null || typeof entry !== 'object') {
            problems.push(`entry ${i}: expected an object`);
            return;
        }
        if (typeof entry.path !== 'string' || entry.path.length === 0) {
            problems.push(`entry ${i}: "path" must be a non-empty string`);
        } else if (isAbsolute(entry.path)) {
            problems.push(
                `entry ${i}: "path" must be relative to assets/ ` +
                `(absolute path: ${entry.path})`
            );
        } else {
            const rel = relative('.', normalizeSeparators(entry.path));
            if (rel === '..' || rel.startsWith('../')) {
                problems.push(
                    `entry ${i}: "path" must stay inside assets/ ` +
                    `(escaping path: ${entry.path})`
                );
            }
        }
        if (typeof entry.required !== 'boolean') {
            problems.push(
                `entry ${i}: "required" must be true or false — a missing ` +
                `or misspelled flag must not silently downgrade a hard gate`
            );
        }
    });
    return problems;
}

function normalizeSeparators(p) {
    return p.replaceAll('\\', '/');
}

/**
 * @param {Array<{path: string, required: boolean}>} entries Validated entries.
 * @param {string} baseDir Directory that manifest entry paths resolve against.
 * @returns {Promise<{ok: boolean, failures: string[], warnings: string[]}>}
 *   failures: required entries missing, unreadable, not a regular file, or
 *   zero-byte. warnings: optional entries in the same state.
 */
export async function checkAssets(entries, baseDir) {
    const failures = [];
    const warnings = [];
    const root = resolve(baseDir);

    for (const entry of entries) {
        const path = join(root, entry.path);
        // Belt and braces against escaping paths even when callers skip
        // validateEntries: a required asset must never be satisfiable from
        // outside version control.
        const rel = relative(root, resolve(path));
        if (rel === '' || rel === '..' || rel.startsWith('../') ||
            isAbsolute(rel)) {
            failures.push(`${entry.path} (path escapes ${baseDir})`);
            continue;
        }

        // A real file with content: existence alone would pass on empty
        // placeholder files, and unreadable ones (races, EACCES) are treated
        // as absent rather than crashing the gate.
        let present;
        try {
            const file = Bun.file(path);
            present = (await file.exists()) && (await file.size) > 0;
        } catch {
            present = false;
        }

        if (!present) {
            if (entry.required) {
                failures.push(entry.path);
            } else {
                warnings.push(entry.path);
            }
        }
    }

    return { ok: failures.length === 0, failures, warnings };
}

/**
 * The full gate for one game root: read assets/manifest.json, validate its
 * shape, and check every entry against <gameRoot>/assets. Returns the
 * process exit code so tests can drive it without spawning a subprocess.
 */
export async function runGate(gameRoot) {
    const manifestPath = join(gameRoot, 'assets', 'manifest.json');

    let manifest;
    try {
        manifest = JSON.parse(await Bun.file(manifestPath).text());
    } catch (err) {
        console.error(`❌ Cannot read asset manifest at ${manifestPath}: ${err.message}`);
        return 1;
    }

    const shapeProblems = validateEntries(manifest?.assets);
    if (shapeProblems.length > 0) {
        console.error(`❌ Asset manifest is malformed: ${manifestPath}`);
        for (const problem of shapeProblems) {
            console.error(`   - ${problem}`);
        }
        return 1;
    }

    // Manifest entry paths are relative to assets/ — resolve them there.
    const { ok, failures, warnings } = await checkAssets(
        manifest.assets,
        join(gameRoot, 'assets')
    );

    for (const asset of warnings) {
        console.warn(`⚠️  Optional asset not present (not blocking): ${asset}`);
    }

    if (!ok) {
        console.error('❌ Missing required assets:');
        for (const asset of failures) {
            console.error(`   - ${asset}`);
        }
        console.error('\nAcquire them per "source"/"license" in assets/manifest.json.');
        return 1;
    }

    console.log(`✅ Asset verification passed (${manifest.assets.length} manifest entries checked).`);
    return 0;
}

// import.meta.main keeps the gate runnable as a CLI while letting tests
// import the pieces (and runGate) without triggering exits/output.
if (import.meta.main) {
    process.exit(await runGate(join(__dirname, '..')));
}
