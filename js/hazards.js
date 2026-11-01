/**
 * Spike and pit hazard detection.
 *
 * Contract:
 * - Spikes are plain objects `{x, y, width, height}` covering the full 32x32
 *   tile rect, but collision uses an inset hitbox (SPIKE_HITBOX_INSET on every
 *   side) so brushing the decorative edge of a spike tile does not kill; only
 *   the lethal core does. Touching edges do not count as contact.
 * - `checkPlayerSpikes(player)` returns a single boolean: any number of
 *   simultaneous spike contacts is one death signal for the game loop.
 * - `checkPitFall(player, levelHeightPx)` preserves the shipped main.js
 *   semantics exactly: death when the player's top-left `y` exceeds
 *   `levelHeightPx + PIT_DEATH_MARGIN_PX` (strict `>`). The caller passes
 *   `level.height * tileSize` in world/CSS pixels — never canvas backing-store
 *   pixels, which drift with devicePixelRatio.
 */
import { aabbOverlap } from './physics.js';

const SPIKE_WIDTH = 32;
const SPIKE_HEIGHT = 32;
const SPIKE_HITBOX_INSET = 4;
const PIT_DEATH_MARGIN_PX = 100;

export class Hazards {
    constructor() {
        this.spikes = [];
    }

    addSpike(x, y) {
        this.spikes.push({
            x,
            y,
            width: SPIKE_WIDTH,
            height: SPIKE_HEIGHT
        });
    }

    checkSpikeCollision(player, spike) {
        // Inset hitbox centred within the full tile rect stored by addSpike.
        const hitbox = {
            x: spike.x + SPIKE_HITBOX_INSET,
            y: spike.y + SPIKE_HITBOX_INSET,
            width: spike.width - 2 * SPIKE_HITBOX_INSET,
            height: spike.height - 2 * SPIKE_HITBOX_INSET
        };

        // Axis-aligned overlap against the inset; touching edges do not count.
        return aabbOverlap(player, hitbox);
    }

    checkPlayerSpikes(player) {
        for (const spike of this.spikes) {
            if (this.checkSpikeCollision(player, spike)) {
                return true;
            }
        }
        return false;
    }

    checkPitFall(player, levelHeightPx) {
        // A player that has fallen past the bottom of the level grid plus a
        // grace margin is dead. Strict `>` keeps the exact threshold alive,
        // matching the inline check this replaces (see Task 6 integration).
        return player.y > levelHeightPx + PIT_DEATH_MARGIN_PX;
    }

    clear() {
        this.spikes.length = 0;
    }

    getSpikes() {
        return this.spikes;
    }
}
