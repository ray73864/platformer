import { readFileSync, existsSync } from 'fs';
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
    let allPresent = true;
    const missingAssets = [];

    for (const asset of requiredAssets) {
        const path = join(__dirname, '..', asset);

        if (!existsSync(path)) {
            missingAssets.push(asset);
            allPresent = false;
        }
    }

    if (!allPresent) {
        console.error('❌ Missing required assets:');
        for (const asset of missingAssets) {
            console.error(`   - ${asset}`);
        }
        console.error('\nPlease download the required assets before running the game.');
        console.error('See docs/superpowers/specs/2026-08-28-platformer-phase1-core-engine.md');
        process.exit(1);
    }

    console.log('✅ All required assets are present.');
    return true;
}

// Run verification
verifyAssets();
