import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Required assets
const requiredAssets = [
    'assets/tilesets/ancient-titan-remains.png',
    'assets/characters/seer-chibi.png',
    'assets/enemies/fantasy-enemies.png'
];

function verifyAssets() {
    const missingAssets = [];

    for (const asset of requiredAssets) {
        const path = join(__dirname, '..', asset);

        // A real file with content: existsSync alone would pass on empty
        // placeholder files and directories.
        if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
            missingAssets.push(asset);
        }
    }

    if (missingAssets.length > 0) {
        // Advisory, not a gate: no code loads these assets yet in Phase 1, so
        // failing hard here would block an otherwise-green branch. It becomes
        // a gate when the asset loader lands (Phase 2).
        console.warn('⚠️  Missing required assets (advisory — nothing loads them yet):');
        for (const asset of missingAssets) {
            console.warn(`   - ${asset}`);
        }
        console.warn('\nSee docs/superpowers/specs/2026-08-28-platformer-phase1-core-engine.md');
        return false;
    }

    console.log('✅ All required assets are present.');
    return true;
}

// Run verification
verifyAssets();
