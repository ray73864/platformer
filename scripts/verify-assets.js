import { existsSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Gate logic for asset verification, kept pure (no process exit) so unit
 * tests can exercise it against temp fixtures.
 *
 * @param {Array<{path: string, source?: string, license?: string, required: boolean}>} entries
 * @param {string} baseDir Directory that manifest entry paths resolve against.
 * @returns {{ok: boolean, failures: string[], warnings: string[]}}
 *   failures: required entries missing, not a regular file, or zero-byte.
 *   warnings: optional entries in the same state.
 */
export function checkAssets(entries, baseDir) {
    const failures = [];
    const warnings = [];

    for (const entry of entries) {
        const path = join(baseDir, entry.path);

        // A real file with content: existsSync alone would pass on empty
        // placeholder files and directories.
        const stat = existsSync(path) ? statSync(path) : null;
        const present = stat !== null && stat.isFile() && stat.size > 0;

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

function main() {
    const gameRoot = join(__dirname, '..');
    const manifestPath = join(gameRoot, 'assets', 'manifest.json');

    let manifest;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
        console.error(`❌ Cannot read asset manifest at ${manifestPath}: ${err.message}`);
        process.exit(1);
    }

    if (!Array.isArray(manifest.assets)) {
        console.error(`❌ Asset manifest must contain an "assets" array: ${manifestPath}`);
        process.exit(1);
    }

    const { ok, failures, warnings } = checkAssets(manifest.assets, gameRoot);

    for (const asset of warnings) {
        console.warn(`⚠️  Optional asset not present (not blocking): ${asset}`);
    }

    if (!ok) {
        console.error('❌ Missing required assets:');
        for (const asset of failures) {
            console.error(`   - ${asset}`);
        }
        console.error('\nAcquire them per "source"/"license" in assets/manifest.json.');
        process.exit(1);
    }

    console.log(`✅ Asset verification passed (${manifest.assets.length} manifest entries checked).`);
}

// import.meta.main keeps the gate runnable as a CLI while letting tests
// import checkAssets without triggering exits/output.
if (import.meta.main) {
    main();
}
