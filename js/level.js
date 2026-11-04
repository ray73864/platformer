import { Collectibles } from './collectibles.js';
import { Difficulty, PHASE2_FIRST_LEVEL, tierIndexFor } from './difficulty.js';
import { EnemyManager } from './enemies.js';
import { Hazards } from './hazards.js';
import { Physics, aabbOverlap } from './physics.js';
import { Player } from './player.js';

const DIFFICULTY = new Difficulty();

const MAX_GENERATION_ATTEMPTS = 200;
const SPAWN_TILE_X = 2;
// Horizontal jump scan bound in tiles: hang time 2*350/980 ≈ 0.71s at speed
// 200 px/s covers ~143px, i.e. ~4 tiles of 32px. Conservative integer bound.
const MAX_H_JUMP = 4;
// Vertical levels (Task 9) climb a taller, narrower grid. Physics constants
// are unchanged; the grid simply gives the documented one-tile-per-jump
// climb more rows to spend, and death/camera already scale with
// level.height * tileSize.
const VERTICAL_WIDTH = 15;
const VERTICAL_HEIGHT = 24;
// Portal candidate band on vertical levels: reachable tiles at or above
// this row. Hazard/marker placement additionally keeps the bottom spawn
// neighborhood (y >= height - VERTICAL_SPAWN_EXCL_ROWS) clear.
const VERTICAL_PORTAL_MAX_Y = 4;
const VERTICAL_SPAWN_EXCL_ROWS = 6;
// Tile radius kept clear of spikes around a coin: dropping past a coin one
// tile off-line must never land the player on a tooth (playtest screenshot:
// coin over a spike corridor, uncollectable without dying).
const COIN_SPIKE_MARGIN = 2;
// Columns at each end of a horizontal map kept free of hazards and enemy
// markers (see hazardPlacementAllowed): spawn runway and portal apron.
const HAZARD_SPAWN_EXCLUDE_COLS = 9;
// Plateau caps for the per-level density ramps (Phase 3, levels 16-100).
// Each formula below grows linearly with the level number and would explode
// past the shipped range: uncapped at L99 they read gapChance 2.12 (always
// true → every segment edge becomes a pit), spike target 49, coin target 104.
// Measured uncapped: EVERY construction from level 44 up threw after the full
// 200-attempt budget (380/380 seeded builds across levels 25-100) — terrain
// fragments so hard that no flat ground survives for the REQUIRED spike/enemy
// sites. With the caps, the same sweep is 0 throws and ≤6.7 avg attempts per
// decade. Each cap flattens its ramp at the value the curve reaches near the
// first new tier boundary (L25), so every battle-tested level ≤25 keeps
// byte-identical generation while late levels asymptote instead of starving.
const GAP_CHANCE_CAP = 0.64;   // = 0.22 + 0.02*(25-4)
const SPIKE_TARGET_CAP = 20;   // realized counts sit far lower (THREAT_SPACING)
const COIN_TARGET_CAP = 30;    // = 5 + 25

// --- Risky enemy kinds (player ruling 2026-11-03: "I didn't like how I
// could just jump on top of every enemy, it added no risk") ------------------
// Stomping stays a SKILL: walkers stay stompable, spinies punish landing on
// anything (spiked back), chargers punish blind approaches with a
// telegraphed dash but stay stomppable mid-dash (risk/reward). Gate levels
// so each threat arrives after the player has proven the old ones: spiny at
// the advanced tier boundary (L10), charger deep in it (L20). Chances ramp
// linearly to their plateaus so a gate level introduces the kind rarely
// (~1%) instead of ambushing with 25% odds on first sight.
const SPINY_FIRST_LEVEL = 10;
const SPINY_RAMP_LEVELS = 21;    // L10..L30 inclusive reach the plateau
const SPINY_CHANCE_MAX = 0.25;   // ~1 in 4 deployed enemies at L30+
const CHARGER_FIRST_LEVEL = 20;
const CHARGER_RAMP_LEVELS = 21;  // L20..L40 inclusive reach the plateau
const CHARGER_CHANCE_MAX = 0.20; // 1 in 5 deployed enemies at L40+
// A map of pure spinies is a wall, not a challenge (no stompable route
// through a gauntlet you can only outrun): cap spinies at ceil(n/3) of the
// deployed enemies per map.
const SPINY_CAP_DIVISOR = 3;
// Hostile kinds (spiny, charger) may only stand on shelves whose SOLID RUN
// beneath the spawn is at least this many tiles wide (screenshot ruling
// 2026-11-03: a staircase of narrow pillars whose ONE mandatory landing
// pillar carried a spiny patrolling its tiny top — the player had to land
// exactly onto/next to a stomp-immune moving body or die on the takeoff lip
// below it; structural probe: 73/255 = 29% of hostile deployments sat on
// runs <= 3 tiles, effectively unwinnable).
// WHY 4 is sufficient (and no ledge-touching-span ban is needed — every
// patrol span ends at a wall or ledge BY CONSTRUCTION, banning those would
// ban nearly every legal site): on a 4-tile shelf the player CAN traverse a
// stomp-immune patrol by timing. Patrol speed is 40 px/s against a 200 px/s
// player (5x), and a grounded jump clears ~143px ≈ 4 tiles (see
// MAX_H_JUMP), so the body (32px) plus margins passes well inside one arc.
// The shelf itself gives room to stand, wait for the patrol to reach its
// far bound, then jump past — no stomp required. Chargers dash at 2.2x
// (88 px/s) but telegraph 0.45 s of windup (~90 px of player movement to
// step out of lane) and their dash clamps to the same solid-supported
// bounds. If measured clear rates still collapse against baseline, escalate
// to 5 for chargers specifically (dash halves the reaction room) — tune by
// measurement, not by eye.
const HOSTILE_MIN_RUN = 4;

// --- Deck bridges: REQUIRED crossings over unjumpable gaps ------------------
// Player ruling 2026-11-04: "moving platforms should only appear when the gap
// is too large to jump over." This replaces the old optional-aids placement
// (decks over already-jumpable gaps) entirely: decks now CARRY routes. The
// generator emits a BRIDGE GAP segment wider than anything the plain BFS
// accepts, and validation runs through the deck's virtual corridor (see
// computeReachable's corridor parameter). Gates:
//  * Level 8+: the basic tier (L1..7) stays pristine while the player is
//    learning the core verbs — and byte-identical generation there is a
//    determinism gate (the roll below must never fire for L1..7).
//  * Horizontal maps only this wave; vertical shaft elevators are the next
//    wave (the manager already supports axis 'v' and the prev-top catch fix).
const DECK_BRIDGE_FIRST_LEVEL = 8;
const MAX_DECK_BRIDGES = 1;          // per map this wave (structural gate)
// Per-attempt roll for a bridge on an eligible horizontal map. MEASURED
// realized coverage of shipped horizontal L8+ maps (12 seeds x L8..100):
// raw 0.45 -> 26%, 0.55 -> 31%, 0.60 -> 37%, 0.65 -> 41%. Tuned to 0.60 for
// the middle of the 30-45% band; realized < raw because narrow tiers
// (L8..24) have no feasible slots at all and failing attempts reroll.
const BRIDGE_CHANCE = 0.6;
// WHY 6: Step-0 physics measurement (scratch sim on the shipped Player/
// Physics, brute-forced press frames incl. the full coyote window) shows a
// flush-flanked pit is jumpable up to 5 tiles at same height (~2.7px pixel-
// perfect margin at W5) and 6 tiles when the far flank sits 1 row LOWER.
// The generator's modeled envelope (MAX_H_JUMP=4 landing scan) refuses pits
// ≥ 4 columns wide, but the physical envelope is the fairness contract:
// a "required" bridge the speedrunner can skip is a lie. 6 clears the
// worst physical case with margin; flanks are additionally forced EXACTLY
// flush (bridgeIntact) so the down-1 bonus never applies.
const MIN_DECK_GAP = 6;              // tiles of pure void between the lips
const MAX_DECK_GAP = 7;              // variety band, both ≥ MIN
const BRIDGE_MIN_START_COL = 7;      // left lip ≥ one past the spawn zone
// Right lip capped at width-6 so the corridor never touches the portal band
// (x >= width-4) and shares the hazard band's runway discipline.
// Boarding fairness: the deck HOLDS flush at each lip for this long — a
// required crossing must offer a walk-on window, not a departing plank.
const DECK_DWELL_S = 0.8;
const MP_DECK_TILES = 2;             // deck width in tiles
const MP_CLEARANCE_ROWS = 3;         // air rows required above the sweep
const MP_SPEED_MIN = 26;             // px/s — slower than the 200 px/s walk:
const MP_SPEED_RANGE = 18;           // riders always out-move the ride
// Enemy-marker exclusion around a bridge: lip columns are a-1 and b+1, so
// ±2 columns from each lip = [a-3, b+3]. Hostiles near a FORCED boarding
// point are unfair (shelf ruling lineage); the corridor itself can never
// host a site (no solid support beneath any corridor cell).
const BRIDGE_LIP_BAN_COLS = 3;

// --- Elevator shafts: REQUIRED vertical climbs on vertical maps ------------
// Player ruling 2026-11-04: "Vertical platforms seem like a nice idea, maybe
// having to use them to go side to side on the game to get up to a higher
// point in the level?" The deck-bridge pattern rotated 90°: the generator
// carves a 2-column chimney through the climb with a flush stand ledge at
// each stop, and the route THROUGH it validates over the cabin's virtual
// corridor (see computeReachable's shaft parameter). Horizontal maps and
// vertical maps below the gate never roll the shaft, so their rng streams —
// and byte-identical generation — are untouched.
// Gate rationale: L13 is the first vertical level AFTER every player has
// seen at least one horizontal deck bridge (bridges start L8; L8/L9 are
// horizontal, L11 horizontal, L13 vertical) — the ride verb is introduced
// where it is optional-danger-free horizontally first, then made load-bearing.
const ELEVATOR_FIRST_LEVEL = 13;
const MAX_SHAFTS = 1;                // per map (structural gate)
// Raw per-attempt roll. Realized coverage lands lower (attempt rerolls on
// burned constructions); measured against the 40-60% target below.
const SHAFT_CHANCE = 0.7;
// WHY 4: Step-0 measurement (scratch sim on the shipped Player/Physics,
// brute-forced press frames incl. run-ups/coyote/buffer, maxrise.mjs): the
// movement MODEL climbs exactly 1 row per jump (computeReachable steps up to
// ty = y-1 only), and the PHYSICAL envelope agrees — measured apex 59.62px =
// 1.86 rows (theory 62.5px continuous), 0/1110 policies landed a 2-row rise.
// A lift of 2 is therefore already unjumpable; 4 (= modeled 1 + 3) keeps a
// >= 2-row margin over the physical apex AND gives the ride substance, 6 is
// the variety cap (worst-case ride ~9.6 s at the slowest speed).
const MIN_SHAFT_LIFT = 4;            // rows between stop surfaces
const MAX_SHAFT_LIFT = 6;
const SHAFT_COLS = 2;                // chimney width == cabin width
// Stand-shelf columns each side per stop. Width 2 is load-bearing for the
// deterministic delivery tail (see generateVertical): the lower climb lands
// OUTSIDE the shelf edge and steps up through a one-tile stair beside it, so
// no jump-off stand ever needs headroom under the shelf row itself. Boarding
// stays forgiving — the rider walks the shelf top to the flush mouth.
const SHAFT_LEDGE_W = 2;
// Approach fairness window: the ledge spans plus 2 columns beyond each outer
// edge, at both stops' stand rows and the row above (markers/spikes banned,
// deployed patrols clamped out — reuse of the bridge lip-ban machinery).
const SHAFT_WINDOW_PAD = 2;
// Vertical cabin speed: STRICTLY SLOWER than horizontal decks (26-44 px/s) —
// riders board from a standstill at a flush ledge, and a modest ride keeps
// reaction room on the hop-off. Dwell reuses DECK_DWELL_S at BOTH stops.
const V_DECK_SPEED_MIN = 20;
const V_DECK_SPEED_RANGE = 5;
// Stop rows for the bottom stop: at least 3 rows above the ground band's
// standing row (a lower-section climb precedes the ride) and at most row 18
// so the top stop (B - lift >= 12 - 6 = 6) stays clear of the portal band
// (y <= VERTICAL_PORTAL_MAX_Y) with a buffer row.
const SHAFT_BOTTOM_MIN_ROW = 12;
const SHAFT_BOTTOM_MAX_ROW = 18;

// --- Motif knob sets (see motifForLevel) -------------------------------------
// gapMul scales the per-level gapChance ramp (1 is float-exact for the
// standard stream); gapMinW forces a STARTED gap to widen before it may end
// (hills' "fewer but larger" gaps). Archipelago keeps gap frequency at the
// tier value but holds every island together for ARCH_MIN_ISLAND_RUN columns
// before a fresh gap may start — interior spike/patrol sites need flat width
// (the constructor's spike/enemy presence guards must not starve on islands),
// and paints only depth rows instead of filling to the bottom, which is what
// makes the silhouette read as floating islands over sparse ground. Since
// the verification tune wave: the archipelago emission rules additionally
// resume FLUSH after wide gaps (never step-and-hold toward the floor) and
// hard-gate painting so no slab lands within 3 rows of the map bottom;
// canyon terrain runs the STANDARD stream verbatim (gapMul 1) and gets its
// identity purely from the canopy pass (own side-stream, low corridor roofs,
// no hazards or markers on canopy rock); pillars pre-seed one tower cluster
// per map, refire at 0.35/junction, and suspend gap rolls while a staircase
// queue runs.
//
// DENSITY RECONCILIATION (policy: realized per-map densities within ±15% of
// the standard-motif density for the same level band, unless the delta IS
// the motif's identity and documented here; census = L8..40 x 100 seeds vs
// HEAD-232edce baseline, /tmp/opencode/review-motifs/density_drift.mjs):
//   FIXED this wave:
//   * canyon coins/spikes/enemies/pit cols now ±0.3% across L25..100 (was
//     enemies +47%): gapMul 0.85→1 (patrol fragmentation was inverted),
//     canopy draws moved to a dedicated side stream (main-stream consumption
//     reshuffled spike/marker picks: +55% deployed on site-scarce maps from
//     stream shift ALONE, A/B measured), and hazards/markers banned from
//     canopy support cells (roof-perched spikes vacated the floor sites the
//     marker proximity vetoes depend on: un-vetoed pool flooded deployments
//     to target, +55..+90% along the whole canyon run).
//   * terraces coins +15.4%→+12.1% and enemies −38.5%→−29.6% via band
//     re-roll 0.7→0.55 (longer settled treads keep patrol spans alive).
//   * archipelago all three metrics inside ±5% (coins +4.1, spikes +1.0,
//     enemies +2.5) despite the float retune.
//   * canyon SOFT-LOCKS killed (physics sweep found capped-route maps):
//     canopies keep off pit mouths plus one launch column each side, and
//     canyonRouteFair() re-validates every ACCEPTED construction by RUNNING
//     THE SHIPPED Player/Physics over the route graph (edgecheck's
//     harvest-aware soft-lock semantics inside the accept loop) — routes
//     that die on spike cores or truncated arcs now reject instead of
//     shipping. Retry tiers: canopy-only re-roll (stream rewind), then
//     fresh terrain; seeds the gate never bites keep pre-gate streams
//     byte-identically.
//   DOCUMENTED RESIDUALS (knob space exhausted; closing these would require
//   weakening fairness machinery — forbidden):
//   * atrium spikes −71.5% (0.12 vs 0.43/map): "fewer, WIDER ledges" leaves
//     fewer mid-shelf candidate cells (measured 1.8 vs 2.6/map) and each
//     accepted spike claims ±4 columns of an already-scarce row pool. Both
//     numbers sit far below the formula target; vertical spikes are
//     opportunistic by design (constructor never requires them vertically).
//   * zigzag spikes +18.5% (0.51 vs 0.43/map): absolute delta +0.08/map,
//     noise scale on opportunistic vertical spikes; kept as-is.
//   * terraces enemies −29.6% (3.24 vs 4.60): band transits are stepped
//     columns, and patrolSpan ≥2 flat columns (fairness rule: a marker must
//     deploy onto a moving patrol, never a frozen body) cannot hold there.
//     Longer treads (6..10) measured WORSE (2.77); 0.55 is the frontier.
//   * terraces pit cols 8.8% vs 13.6% and pillars pit cols 14.3% vs 20.5%:
//     contiguous plateaus / solid tower mass ARE the silhouettes.
//   * pillars coins +21.6%, spikes +23.0%, enemies −31.6%: tower clusters
//     add reachable vertical surface (coin pool fills closer to the shared
//     target), remove pit rims from the spike besideDropOff veto ring (more
//     surviving floor sites), and break patrol spans on their stair flanks
//     (same fairness rule as terraces). Refire 0.25/hold 3..5 variants both
//     measured no better than the shipped 0.35/2..4.
//   * archipelago pit cols 80.3% vs 20.1%: lethal void between islands is
//     the motif (player ruling: islands must FLOAT where players walk);
//     route validity stays BFS-verified per attempt, zero throws measured.

// ---------------------------------------------------------------------------
// Route physics simulation (canyonRouteFair support; see its comment on the
// Level class). Two module-local helpers, kept out of the class to hold the
// simulation surface small and dependency-free (Player/Physics are shipped
// runtime modules — the gate exercises the SAME code the game runs).

// Model-edge scan mirroring computeReachable's transition set without the
// reachability bookkeeping: enumerates consecutive-cell edges so the route's
// shortest path can be reconstructed and each hop simulated. Deck corridors
// emit trusted 'deck' edges (rider suites validate the ride itself).
function routeModelEdges(level) {
    const tiles = level.tiles;
    const w = level.width, h = level.height;
    const solid = (x, y) => {
        if (x < 0 || x >= w) return true;
        if (y < 0 || y >= h) return false;
        return tiles[y][x] === 1;
    };
    const hazard = (x, y) => {
        if (x < 0 || x >= w || y < 0 || y >= h) return false;
        return tiles[y][x] === 2;
    };
    const freeCell = (x, y) => !solid(x, y) && !hazard(x, y);
    const standable = (x, y) => freeCell(x, y) && solid(x, y + 1);
    const corr = level.bridgeGap;
    const isCorr = (x, y) => corr !== null && corr !== undefined &&
        y === corr.S - 1 && x >= corr.a && x <= corr.b;
    const key = (x, y) => y * w + x;
    const edges = [];
    if (!standable(level.spawnTile.x, level.spawnTile.y)) return edges;
    const seen = new Set([key(level.spawnTile.x, level.spawnTile.y)]);
    const queue = [[level.spawnTile.x, level.spawnTile.y]];
    while (queue.length) {
        const [x, y] = queue.shift();
        if (isCorr(x, y)) {
            for (const dir of [-1, 1]) {
                const nx = x + dir;
                if (isCorr(nx, y)) {
                    edges.push({ ax: x, ay: y, bx: nx, by: y,
                        kind: 'deck', dist: 1, dir });
                    if (!seen.has(key(nx, y))) {
                        seen.add(key(nx, y)); queue.push([nx, y]);
                    }
                    continue;
                }
                for (const ny of [y, y - 1]) {
                    if (standable(nx, ny)) {
                        edges.push({ ax: x, ay: y, bx: nx, by: ny,
                            kind: 'deck', dist: 1, dir });
                        if (!seen.has(key(nx, ny))) {
                            seen.add(key(nx, ny)); queue.push([nx, ny]);
                        }
                    }
                }
            }
            continue;
        }
        for (const dir of [-1, 1]) {
            for (let dist = 1; dist <= MAX_H_JUMP; dist++) {
                let blocked = false, hazardRun = 0;
                for (let m = 1; m < dist; m++) {
                    const midX = x + dir * m;
                    if (solid(midX, y)) { blocked = true; break; }
                    if (hazard(midX, y)) {
                        hazardRun++;
                        if (hazardRun >= 3) { blocked = true; break; }
                    } else hazardRun = 0;
                }
                if (blocked) continue;
                const c = x + dir * dist;
                for (let ly = y; ly < h; ly++) {
                    if (hazard(c, ly)) break;
                    if (standable(c, ly)) {
                        edges.push({ ax: x, ay: y, bx: c, by: ly,
                            kind: ly === y ? 'walk' : 'fall', dist, dir });
                        if (!seen.has(key(c, ly))) {
                            seen.add(key(c, ly)); queue.push([c, ly]);
                        }
                    }
                    if (solid(c, ly)) break;
                }
            }
            for (const dist of [1, 2]) {
                const c = x + dir * dist;
                const ty = y - 1;
                if (!standable(c, ty)) continue;
                let clear = true;
                if (dist === 2) {
                    const midX = x + dir;
                    if (solid(midX, ty) || hazard(midX, ty)) clear = false;
                }
                if (clear) {
                    edges.push({ ax: x, ay: y, bx: c, by: ty,
                        kind: 'stepup', dist, dir });
                    if (!seen.has(key(c, ty))) {
                        seen.add(key(c, ty)); queue.push([c, ty]);
                    }
                }
            }
        }
        if (corr !== null && corr !== undefined) {
            for (const nx of [x - 1, x + 1]) {
                const ny = isCorr(nx, y) ? y
                    : (isCorr(nx, y + 1) ? y + 1 : -1);
                if (ny >= 0) {
                    edges.push({ ax: x, ay: y, bx: nx, by: ny,
                        kind: 'deck', dist: 1, dir: Math.sign(nx - x) });
                    if (!seen.has(key(nx, ny))) {
                        seen.add(key(nx, ny)); queue.push([nx, ny]);
                    }
                }
            }
        }
    }
    return edges;
}

// Runs ONE input policy on ONE route edge with the shipped Player and
// Physics classes. True when the body lands inside cell B alive. Mirrors
// edgecheck.simPolicy faithfully on the mechanics that decide outcomes:
// settle frames, jump press gated on grounded contact (main.js), held-key
// window, landing brake (main.js zeroes vx on touchdown with no input),
// inset spike cores (hazards.js convention), void death below the grid.
// Policy fields: j (jump frame, null = never), from/until (direction-held
// window), off (start offset px toward B). Returns {ok, harvests:Set<key>}
// where harvests holds grid keys (y*w+x) of grounded landings reached on
// cells other than A — overshoot footholds count as executed movement.
function simTransition(e, pol, ctx) {
    const { T, w, DT, SIM_FRAMES, PLAYER_SPEED, JUMP_FORCE, physicsFactory,
        collect, cores, pitY } = ctx;
    const harvests = new Set();
    const fail = () => ({ ok: false, harvests });
    const dir = Math.sign(e.bx - e.ax);
    const physics = physicsFactory();
    const player = new Player(
        e.ax * T + (pol.off || 0) * dir, e.ay * T, PLAYER_SPEED, JUMP_FORCE);
    player.prevX = player.x; player.prevY = player.y;
    const candidates = [];
    const step = (left, right) => {
        player.prevX = player.x; player.prevY = player.y;
        player.update(DT, left, right);
        physics.applyGravity(player, DT);
        physics.resolveCollisions(player, collect(player, candidates));
    };
    step(false, false); step(false, false);
    if (!player.grounded) return fail();
    const dirFrom = pol.from || 0;
    const dirUntil = pol.until === undefined ? Infinity : pol.until;
    let prevGrounded = true;
    for (let f = 0; f < SIM_FRAMES; f++) {
        const held = f >= dirFrom && f < dirUntil;
        if (pol.j !== null && f === pol.j && player.grounded) player.jump();
        step(held && dir < 0, held && dir > 0);
        if (player.grounded && !prevGrounded && !held) {
            player.vx = 0; // landing brake (main.js)
        }
        prevGrounded = player.grounded;
        for (const core of cores) {
            if (aabbOverlap(player, core)) return fail();
        }
        if (player.y > pitY + 100) return fail();
        if (player.grounded) {
            const cx = Math.floor((player.x + player.width / 2) / T);
            const bodyRow = Math.floor((player.y + player.height - 0.001) / T);
            if (cx === e.bx && bodyRow === e.by) {
                return { ok: true, harvests };
            }
            if (cx !== e.ax || bodyRow !== e.ay) {
                harvests.add(bodyRow * w + cx);
            }
        }
    }
    return fail();
}

const MOTIF_KNOBS = {
    standard: { gapMul: 1, gapMinW: 1 },
    hills: { gapMul: 0.55, gapMinW: 2 },
    // Wide gaps force the landing one row DOWN (uncrossable-rise law), and
    // at the capped ~0.64 gap chance that force-down outran the band walk,
    // pinning terraces to the floor line. Halve the gap rate so treads stay
    // contiguous and bands actually form.
    terraces: { gapMul: 0.45, gapMinW: 1 },
    archipelago: { gapMul: 1, gapMinW: 1 },
    canyon: { gapMul: 1, gapMinW: 1 },
    pillars: { gapMul: 0.8, gapMinW: 1 }
};
const ARCH_MIN_ISLAND_RUN = 4;

// Contiguous type-1 tiles on a support row through a column: the solid-run
// width of the shelf a spawn cell stands on (same measurement as the
// fairness probe — support row y+1 only; rock/spikes on the walk row do not
// shrink the shelf itself, patrolSpan owns the walkability view).
function solidRunWidth(tiles, width, x, supportY) {
    const row = tiles[supportY];
    if (!row || row[x] !== 1) return 0;
    let left = x;
    while (left > 0 && row[left - 1] === 1) left--;
    let right = x;
    while (right < width - 1 && row[right + 1] === 1) right++;
    return right - left + 1;
}

// Shelf columns flanking a shaft at its two stop ledges: SHAFT_LEDGE_W wide
// on each side; the shaft columns themselves stay void by construction.
function shaftLedgeCols(sx, ex) {
    const cols = [];
    for (let k = 1; k <= SHAFT_LEDGE_W; k++) cols.push(sx - k, ex + k);
    return cols;
}

// Deterministic boarding side of a shaft (no rng): whichever flank points
// away from the map center. Shared by generateVertical (chain seam) and
// shaftIntact (egress-cell assertion) so the two cannot drift.
function shaftBoardSide(sx, width) {
    return sx >= Math.floor(width / 2) ? -1 : 1;
}

// Linear 0->max ramp over [firstLevel, firstLevel + rampLevels - 1], flat
// outside (0 below the gate, max above the ramp).
function kindChance(levelNumber, firstLevel, rampLevels, maxChance) {
    if (!Number.isInteger(levelNumber) || levelNumber < firstLevel) return 0;
    const t = Math.min(1, (levelNumber - firstLevel + 1) / rampLevels);
    return maxChance * t;
}

// Travel direction is deterministic from the level number so tests and E2E
// flows can rely on it: the shipped Phase 1 ramp (levels 1-4) stays
// right-facing, then right/left/vertical cycle from level 5 onward
// (L5 right, L6 left, L7 vertical, L8 right, L9 left).
function directionForLevel(levelNumber) {
    if (levelNumber < PHASE2_FIRST_LEVEL) return 'right';
    return ['right', 'left', 'vertical'][(levelNumber - PHASE2_FIRST_LEVEL) % 3];
}

// --- Layout motifs -----------------------------------------------------------
// Player ruling 2026-11-04: "A lot of the levels just seem same old same
// old." Palettes varied; STRUCTURE did not — every horizontal map was the
// ground-with-gaps silhouette grammar, every vertical map the staggered-
// shelf climb. A motif is a KNOB SET applied to the existing generation
// machines (the horizontal column/segment walk and the vertical ledge
// chain), never a parallel generator: terrain shape changes, while spikes,
// markers, kinds, deck bridges, elevator shafts, coins, portal and spawn
// keep running UNCHANGED on top of the motif-shaped final grid, with every
// ban radius and fairness gate biting exactly as before.
//
// Selection is a PURE function of the level number (no rng draw anywhere):
// seeded replay stays exact, the same level always replays identical, and
// adjacent same-direction levels never repeat a motif. Gates ramp the
// availability so the early game stays pristine-ish:
//   * 'standard' — the shipped machine, byte-identical rng stream. The ONLY
//     motif for every level below its first competitor, which pins L1..11
//     horizontal AND every vertical map below L16 byte-for-byte against the
//     pre-motif generator (the L1..7 golden pin plus the untouched streams
//     cover that). Introducing motifs reshapes maps from each gate level up
//     BY DESIGN: the changed bands are horizontal L12+ and vertical L16+.
//   * Weights: standard thins with level (3 slots <L16, 2 <L25, 1 from the
//     expert tier); every gated motif doubles from the expert tier (L25+),
//     weighting mid-tiers toward the more complex structures.
const MOTIF_GATES = {
    hills: 12,        // rolling surface, fewer/larger gaps
    terraces: 16,     // 2-3 elevation bands as big plateaus, step-up seams
    archipelago: 20,  // thin floating-island chains over sparse ground
    canyon: 25,       // overhead rock sections narrowing the corridor read
    pillars: 30,      // stepped tower clusters over flat-ish ground
    atrium: 16,       // vertical: fewer, WIDER ledges (open chambers)
    zigzag: 19        // vertical: dense alternating short shelves
};

// Small deterministic integer hash (Knuth multiply + murmur-style mixes):
// adjacent level numbers land on different slots without any state.
function motifHash(levelNumber) {
    let h = Math.imul(levelNumber, 0x9E3779B1) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x85EBCA6B) >>> 0;
    h ^= h >>> 13;
    return h >>> 0;
}

// Weighted slot list for one level: repeated names ARE the availability
// curve (pick uniformly from the slots). Vertical pools stay unweighted —
// three shapes across the vertical run is already the full appetite.
function motifSlots(levelNumber, direction) {
    if (direction === 'vertical') {
        const pool = ['standard'];
        if (levelNumber >= MOTIF_GATES.atrium) pool.push('atrium');
        if (levelNumber >= MOTIF_GATES.zigzag) pool.push('zigzag');
        return pool;
    }
    const tier = tierIndexFor(levelNumber);
    const slots = [];
    const push = (name, gate) => {
        if (levelNumber < gate) return;
        const weight = name === 'standard'
            ? (levelNumber < 16 ? 3 : levelNumber < 25 ? 2 : 1)
            : (tier >= 3 ? 2 : 1);
        for (let i = 0; i < weight; i++) slots.push(name);
    };
    push('standard', 1);
    push('hills', MOTIF_GATES.hills);
    push('terraces', MOTIF_GATES.terraces);
    push('archipelago', MOTIF_GATES.archipelago);
    push('canyon', MOTIF_GATES.canyon);
    push('pillars', MOTIF_GATES.pillars);
    return slots;
}

// Motif of the nearest EARLIER level of the same direction class — what the
// player actually experiences back-to-back (a vertical map between two
// horizontals resets the eye). Recursion terminates at level 1.
function prevSameDirectionMotif(levelNumber, direction) {
    for (let n = levelNumber - 1; n >= 1; n--) {
        if (directionForLevel(n) === direction) return motifForLevel(n);
    }
    return null;
}

// The motif contract, exported for tests and diagnostics: deterministic
// (same input, same output, no rng), adjacency-differs within each
// direction class, and never earlier than the motif's gate. Invalid input
// reads as 'standard' WITHOUT warning (per-frame-safe like tierIndexFor).
export function motifForLevel(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) return 'standard';
    const direction = directionForLevel(levelNumber);
    const slots = motifSlots(levelNumber, direction);
    let idx = motifHash(levelNumber) % slots.length;
    const prev = prevSameDirectionMotif(levelNumber, direction);
    // Adjacency-differs: rotate off the predecessor's motif. With >= 2
    // distinct names in the pool one rotation always lands elsewhere; a
    // single-name pool (early game) has nothing to differ FROM anyway.
    let guard = 0;
    while (prev !== null && slots[idx] === prev && guard++ < slots.length) {
        idx = (idx + 1) % slots.length;
    }
    return slots[idx];
}

// Seeded PRNG (mulberry32): a Level built with the same seed replays
// identically, so retrying a level re-runs the map you died on instead of
// rerolling for a friendier generation.
function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// In-place Fisher-Yates shuffle: bounded, no unbounded random retry loops.
function shuffle(items, rng = Math.random) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

// Movement model for the reachability check, matching the game's physics:
// JUMP_FORCE=350 / GRAVITY=980 gives a max jump rise of ~62px (< 2 tiles at
// tileSize 32), so climbing more than one tile in a single jump is not
// possible. Horizontal range per grounded jump: total hang time returning to
// launch height is t = 2*JUMP_FORCE/GRAVITY ≈ 0.71s; at PLAYER_SPEED=200 that
// is ~143px ≈ 4 tiles (tileSize 32), so we scan landings up to 4 columns away
// for same-or-lower targets. From any standing tile (air with solid below)
// the player can:
//   - walk or fall left/right, including jumping across bottomless pits up
//     to 3 tiles wide (landing column at most 4 away); every intermediate
//     column must be passable at the current row;
//   - jump up exactly one tile onto a step, straight across or over a gap of
//     one intermediate column.
// Out-of-bounds: side walls are solid, the sky is open, and falling below the
// grid bottom (a pit with no floor) kills, so it offers no landing.
//
// Spike tiles (type 2) are treated conservatively as death, never as terrain:
// they are NOT standable, they provide no support (standing on a spike tip
// is impossible), and they terminate downward landing scans (falling into a
// spike column kills rather than passing through). Aerial pass-through is
// bounded by simulation against Physics + Hazards, not assumed: the inset
// 24px lethal core of a ground-level spike forces feet ≥28px above the launch
// row, leaving ~0.54s of hang time ≈ 108px at speed 200 — enough to cross ONE
// core (32px body + 24px core = 56px sweep) with margin, and two adjacent
// cores only barely; three or more consecutive spikes cannot be crossed at
// all. So a flat jump may arc over strips of at most two adjacent surface
// spikes but never rests on or inside one, and a run of ≥3 adjacent spikes is
// modelled as a wall. A spike CAPPING a riser (sitting on a column whose top
// is one tile above the launch row) is worse: its core then forces feet ≥60px
// above launch — with max rise ~62.5px that leaves only ~28.6px of travel,
// less than the 56px sweep, so the crossing is physically impossible in every
// takeoff/timing combination (simulated: 0/4539 survived). Such capped risers
// are modelled as full wall height for step-up jumps. Generation keeps spikes
// ≥2 columns apart, so these stricter rules cost no accepted layouts; they
// only stop the BFS from validating routes the shipped physics cannot fly.
// Consequence: reachability of coins, portal, and enemy spawns never routes
// THROUGH death. Grids without type-2 tiles behave bit-identically to the
// pre-hazard model (hazard() is constant false there).
//
// requireOpenHead (used by the vertical validation): additionally reject any
// standable cell with a solid tile directly overhead. The 32x32 body fills a
// 32px tile exactly, so a ceiling leaves zero jump clearance — every rise the
// BFS would model from that cell is a head-butt. The vertical generator's
// ledges can hang over lower ledge tops (a bounce extends a ledge back over
// the columns two rows down), so without this rule those cells become
// validated launch/landing points and unfair coin/portal placements. Walking
// beneath an overhang stays modelled: the horizontal scans only test the body
// row for solidity. Horizontal heightmaps structurally never put a ceiling
// over a standable cell, so their callers keep the default (false) and
// byte-identical behaviour.
// Optional `corridor` (deck bridges): a virtual walkway { a, b, S } spanning
// gap columns a..b with its deck-top row at S (rider body row S-1). The
// generator declares one per bridge gap so the BFS can validate the route
// THROUGH the deck — without it a bridge map would reject itself. Rules,
// deliberately conservative (the deck moves horizontally; only dwell
// positions near the lips offer stable jumps, and we promise nothing from
// mid-corridor stances):
//   - Corridor cells connect HORIZONTALLY to each other and to both lip
//     cells (bidirectional: flush across, one step up onto a higher flank,
//     one step down off a higher lip onto the dwelling deck). Left-flowing
//     levels get this for free — the model is symmetric in x and the 'left'
//     mirror transforms the descriptor alongside the grid.
//   - Corridor cells NEVER launch anything else: no fall scans, no dist-2
//     overhang climbs, no upward jumps beyond the lips. A cell reached only
//     via the corridor cannot become a launchpad for further strict-rule
//     derivation.
//   - Corridor cells join reachableTiles (they are ROUTE cells): hazard
//     protections apply upstream (pit columns carry no spike support by
//     construction; markers are banned within BRIDGE_LIP_BAN_COLS of either
//     lip), and coins may sit on them (collectible exactly once while
//     riding across — the crossing is mandatory anyway).
// Callers without a bridge pass null: behavior is byte-identical.
//
// Optional `shaft` (elevator shafts, vertical maps): the cabin's virtual
// corridor on a 2-column chimney { sx, ex, A, B } — cabin top row sweeps
// A..B pixels/32, rider body rows A-1..B-1. The generator declares one per
// carved shaft so the BFS can validate the climb THROUGH the elevator; the
// rules mirror the deck corridor exactly, rotated 90°:
//   - Shaft cells connect bidirectionally along the ride (both columns at
//     every rider row, and up/down within the shaft) and ONTO stop ledges at
//     the two stop rows only (A-1 and B-1): flush across, or one step up
//     onto a higher flank. Left/right flow symmetry is inherited — vertical
//     maps never mirror.
//   - Zero launch authority, same as the corridor: no fall scans, no dist-2
//     overhang climbs, no upward jumps beyond the stops. A cell reached only
//     via the shaft cannot become a launchpad for strict-rule derivation.
//   - Boarding from terrain: adjacent column into a STOP-ROW shaft cell,
//     flush or one step down (mirrors the lip rule). Mid-shaft boarding is
//     not modelled even though the physics permits it — conservative.
//   - Shaft cells join reachableTiles (ROUTE cells): coins may sit on them
//     (collectible while riding); hazard/marker windows are banned upstream.
// Callers without a shaft pass null: behavior is byte-identical.
export function computeReachable(
    tiles,
    width,
    height,
    startTile,
    requireOpenHead = false,
    corridor = null,
    shaft = null
) {
    const solid = (x, y) => {
        if (x < 0 || x >= width) return true;
        if (y < 0 || y >= height) return false;
        return tiles[y][x] === 1;
    };
    const hazard = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        return tiles[y][x] === 2;
    };
    // A cell you could occupy: neither solid rock nor a spike.
    const freeCell = (x, y) => !solid(x, y) && !hazard(x, y);
    const standable = (x, y) =>
        freeCell(x, y) && solid(x, y + 1) &&
        (!requireOpenHead || !solid(x, y - 1));

    // Virtual deck-walkway cell (bridge corridor): rider body row S-1
    // across the gap columns. See the header for the rule set.
    const isCorr = (x, y) =>
        corridor !== null && y === corridor.S - 1 &&
        x >= corridor.a && x <= corridor.b;

    // Virtual elevator-cabin cells (shaft): rider body rows A-1..B-1 across
    // the chimney columns sx..ex. See the header for the rule set.
    const isShaft = (x, y) =>
        shaft !== null && x >= shaft.sx && x <= shaft.ex &&
        y >= shaft.A - 1 && y <= shaft.B - 1;
    // Boarding/egress exists only at the two stop rows (flush walk-on onto
    // the pixel-exact ledges); mid-shaft cells connect nothing outside.
    const isShaftStopRow = (y) =>
        shaft !== null && (y === shaft.A - 1 || y === shaft.B - 1);

    const key = (x, y) => y * width + x;
    const reachable = new Set();

    if (!standable(startTile.x, startTile.y)) {
        return reachable;
    }

    const queue = [[startTile.x, startTile.y]];
    reachable.add(key(startTile.x, startTile.y));

    while (queue.length > 0) {
        const [x, y] = queue.shift();

        // Corridor cells expand ONLY along the walkway and onto the lips
        // (flush across, or one step up onto a higher flank). The standard
        // scans below are skipped entirely for them — mid-corridor stances
        // launch nothing (see header).
        if (isCorr(x, y)) {
            for (const dir of [-1, 1]) {
                const nx = x + dir;
                if (isCorr(nx, y)) {
                    if (!reachable.has(key(nx, y))) {
                        reachable.add(key(nx, y));
                        queue.push([nx, y]);
                    }
                    continue;
                }
                for (const ny of [y, y - 1]) {
                    if (standable(nx, ny) && !reachable.has(key(nx, ny))) {
                        reachable.add(key(nx, ny));
                        queue.push([nx, ny]);
                    }
                }
            }
            continue;
        }

        // Shaft cells expand ONLY along the cabin (both columns at every
        // rider row, up/down the chimney) and FLUSH onto stop ledges at the
        // two stop rows. Standard scans are skipped entirely — zero launch
        // authority, mirroring the corridor rules rotated 90° (see header).
        if (isShaft(x, y)) {
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (isShaft(nx, ny)) {
                    if (!reachable.has(key(nx, ny))) {
                        reachable.add(key(nx, ny));
                        queue.push([nx, ny]);
                    }
                } else if (isShaftStopRow(y) && ny === y &&
                    standable(nx, ny) && !reachable.has(key(nx, ny))) {
                    reachable.add(key(nx, ny));
                    queue.push([nx, ny]);
                }
            }
            continue;
        }

        for (const dir of [-1, 1]) {
            // Walk or fall along/across columns at current row height. A move
            // of distance d models a flat jump: every column between start and
            // landing must be air at the current row, and the landing column
            // is scanned downward from y for any standable tile (same-or-
            // lower target). Scan bound MAX_H_JUMP = physical jump range
            // ~143px / 32px.
            for (let dist = 1; dist <= MAX_H_JUMP; dist++) {
                let blocked = false;
                let hazardRun = 0;
                for (let m = 1; m < dist; m++) {
                    const midX = x + dir * m;
                    if (solid(midX, y)) {
                        blocked = true;
                        break;
                    }
                    // Physics-verified boundary (see header): three or more
                    // adjacent surface spikes cannot be cleared by a grounded
                    // jump, so the strip is a wall to this scan. Generation
                    // keeps spikes ≥2 columns apart; this only models what
                    // simulation showed, never rejecting generated layouts.
                    if (hazard(midX, y)) {
                        hazardRun++;
                        if (hazardRun >= 3) {
                            blocked = true;
                            break;
                        }
                    } else {
                        hazardRun = 0;
                    }
                }
                if (blocked) continue;

                const c = x + dir * dist;
                for (let ly = y; ly < height; ly++) {
                    // Falling into a spike cell is death: no landing here
                    // and nothing further down the column either.
                    if (hazard(c, ly)) break;
                    if (standable(c, ly) && !reachable.has(key(c, ly))) {
                        reachable.add(key(c, ly));
                        queue.push([c, ly]);
                    }
                    if (solid(c, ly)) break;
                }
            }

            // Jump up one tile onto a step: landing tile must be standable.
            for (const dist of [1, 2]) {
                const c = x + dir * dist;
                const ty = y - 1;
                if (!standable(c, ty)) continue;

                let clear = true;
                if (dist === 2) {
                    // ANY obstruction in the intermediate column at the
                    // TARGET row blocks the hop — both orientations are
                    // physically impossible, only by different mechanisms:
                    //  - full riser (solid at ty AND at the launch row y):
                    //    a >=2-tile-high wall whose top sits beyond jump
                    //    rise (~62px); a spike capping a one-tile riser
                    //    counts too — clearing its inset core demands feet
                    //    ≥60px above the launch row, leaving ~28.6px of
                    //    travel against a 56px overlap sweep (see header);
                    //  - overhang (solid/hazard at ty, AIR at y): the
                    //    obstruction's underside sits exactly at landing
                    //    height while its top is a full tile (64px) above
                    //    the launch floor — beyond the ~62.5px max rise —
                    //    and the 32px body fills the tile, so any transit
                    //    of the mid column at landing height ends in a
                    //    head-bonk (vy zeroed mid-rise, physics.js) or an
                    //    X-pin against the riser behind it. Simulation
                    //    evidence (edgecheck sweep, 440 seeded maps): all
                    //    729 claimed-but-impossible step-up edges share
                    //    this signature; the isolated overhang fixture
                    //    fails under every one of 66 input policies and
                    //    never once passes.
                    // Removing the old `&& solid(midX, y)` clause makes the
                    // model strictly edge-REMOVING (more conservative), so
                    // validated routes stay physically executable. Cost:
                    // vertical generation retries rise ~4.5 -> ~12 attempts
                    // on average (max observed 79 of the 200 budget, all
                    // builds succeeding across 1600+ seeded sweeps) — still
                    // ~1 ms per level load. A generator-side protection for
                    // the bounced-hop overhang case (d2MidCells paint-skip)
                    // was implemented and REMOVED: measurement showed it
                    // starved the next landing's support cell instead
                    // (attempts 11.77 vs 11.70 without it); do not
                    // reintroduce it without beating the strict-rule-only
                    // baseline.
                    const midX = x + dir;
                    if (solid(midX, ty) || hazard(midX, ty)) {
                        clear = false;
                    }
                }
                if (clear && !reachable.has(key(c, ty))) {
                    reachable.add(key(c, ty));
                    queue.push([c, ty]);
                }
            }
        }

        // Boarding edge (bridge corridor): stepping off a lip column onto
        // the dwelling deck — flush across, or one row down from a higher
        // lip. Only columns ADJACENT to the corridor qualify, so only the
        // two lips can board; every other cell treats the corridor as air.
        if (corridor !== null) {
            for (const nx of [x - 1, x + 1]) {
                const ny = isCorr(nx, y) ? y :
                    (isCorr(nx, y + 1) ? y + 1 : -1);
                if (ny >= 0 && !reachable.has(key(nx, ny))) {
                    reachable.add(key(nx, ny));
                    queue.push([nx, ny]);
                }
            }
        }

        // Boarding edge (shaft): stepping off an adjacent ledge column onto
        // the dwelling cabin AT A STOP ROW — flush only (the generator forces
        // pixel-exact ledges, so the corridor's one-row-down variant has no
        // analogue here). Every other cell treats the shaft as air.
        if (shaft !== null && isShaftStopRow(y)) {
            for (const nx of [x - 1, x + 1]) {
                if (isShaft(nx, y) && !reachable.has(key(nx, y))) {
                    reachable.add(key(nx, y));
                    queue.push([nx, y]);
                }
            }
        }
    }

    return reachable;
}

export function canReach(
    tiles,
    width,
    height,
    startTile,
    goalTile,
    requireOpenHead = false
) {
    const reachable = computeReachable(
        tiles,
        width,
        height,
        startTile,
        requireOpenHead
    );
    return reachable.has(goalTile.y * width + goalTile.x);
}

export class Level {
    constructor(levelNumber, tileSize, seed) {
        this.levelNumber = levelNumber;
        this.tileSize = tileSize;
        // Seeded when given (Game passes runSeed-per-level so retries are
        // exact replays); unseeded callers keep fresh random maps.
        const resolvedSeed = seed === undefined
            ? (Math.random() * 0xffffffff) >>> 0
            : seed >>> 0;
        this.rng = makeRng(resolvedSeed);
        // The resolved seed, kept for diagnostics: the HUD readout lets a
        // playtest screenshot pin the exact map for reproduction. Also the
        // root of the canyon-canopy side stream (paintCanyonCeilings).
        this.seedResolved = resolvedSeed;
        this.seed = seed === undefined ? null : resolvedSeed;

        // Task 9: travel direction varies per level (deterministic mapping).
        this.direction = directionForLevel(levelNumber);

        // Layout motif (see motifForLevel): pure function of the level
        // number, stable across every generation attempt and retry, read by
        // generatePlatforms/generateVertical as a knob set. 'standard' keeps
        // the shipped rng stream byte-identical.
        this.motif = motifForLevel(levelNumber);

        // Difficulty tiers size horizontal maps (see LEVEL_CONFIGS in
        // difficulty.js: six tiers from 20x15 up to 40x30 at legend).
        // Vertical levels climb a fixed 15x24 grid.
        if (this.direction === 'vertical') {
            this.width = VERTICAL_WIDTH;   // tiles
            this.height = VERTICAL_HEIGHT; // tiles
        } else {
            const size = DIFFICULTY.getLevelSize(levelNumber);
            this.width = size.width;   // tiles
            this.height = size.height; // tiles
        }

        let attempt = 0;
        let valid = false;
        // Canyon post-deployment fairness (see canyonRouteFair): an accepted
        // construction whose SHIPPED grid fails the physics-executed route
        // check regenerates. Retry tiers, cheapest first:
        //   1) main-stream REWIND (same terrain, hazard and enemy economy
        //      rebuilt identically) while the canopy side stream advances
        //      via _canopyCalls — each retry re-rolls only ceiling placement;
        //   2) after REWIND_BUDGET unfair repeats, genuinely new terrain via
        //      an attempt-seeded stream root.
        // Seeds the gate never bites keep the ORIGINAL pre-gate stream
        // semantics exactly (invalid attempts simply continue consuming),
        // so byte identity holds for every construction accepted without a
        // physics rejection — including all golden-pinned L1..7 maps.
        let fair = false;
        let physRejects = 0;
        let gateEngaged = false;
        const REWIND_BUDGET = 4;
        while (!fair && attempt < MAX_GENERATION_ATTEMPTS) {
            // Terrain, spike tiles (type 2), and enemy markers (type 4) are
            // all laid down before computeReachable runs, so the validation
            // BFS sees the final geometry. If spikes wall off the map, no
            // portal candidate survives and the retry regenerates.
            this.tiles = this.generateLevel();
            this.spawnTile = this.getSpawnTile();
            this.reachableTiles = computeReachable(
                this.tiles,
                this.width,
                this.height,
                this.spawnTile,
                // Vertical ledges create overhangs a 32px body cannot jump
                // out of; validate those maps headroom-aware (see
                // computeReachable). Horizontal heightmaps keep the default.
                // bridgeGap is null on vertical maps and shaftGap is null on
                // horizontal ones, so one argument spelling covers both.
                this.direction === 'vertical',
                this.bridgeGap,
                this.shaftGap
            );
            this.portalTile = this.pickPortalTile();
            valid = this.portalTile !== null && this.bridgeIntact() &&
                this.shaftIntact();
            // Patrol AI from level 5 onward is a product contract (README).
            // Jagged Phase-2 terrain can leave no legal marker site inside
            // the band, so a zero-marker construction is rejected here —
            // otherwise unit tests would flake on terrain variance (~0.1% of
            // constructions) and level 5+ could ship with no enemies at all.
            // The same reasoning covers spikes: the keep-if-harmless gate can
            // reject every candidate on heavily fragmented maps, so hazard
            // presence is required here too (level 5+ always ships spikes).
            if (valid && DIFFICULTY.hasPhase2Content(this.levelNumber)) {
                // Check what actually deploys, not raw markers: a marker that
                // fails deriveEnemySpawns' band/reachability/patrolSpan filters
                // ships zero enemies while a raw count reports success. Same
                // call spawnEnemies() makes below, on the same tiles and
                // reachableTiles, so guard and deployment cannot diverge.
                // Vertical climbs earn their difficulty from the ascent
                // itself; forcing a spike onto them historically meant
                // placing it on the route's walking surface (the map has
                // almost nowhere else). Spikes stay REQUIRED on horizontal
                // maps and opportunistic-but-fair on vertical ones.
                valid = this.deriveEnemySpawns().length > 0 &&
                    (this.direction === 'vertical' ||
                        this.countTilesOfType(2) > 0);
            }
            attempt++;
            if (valid) {
                if (this.canyonRouteFair()) {
                    fair = true; // shipped grid walks clean
                } else {
                    valid = false;
                    physRejects++;
                    gateEngaged = true;
                    if (physRejects <= REWIND_BUDGET) {
                        // Tier 1: same terrain, next canopy variant. The
                        // side-stream ordinal (_canopyCalls) intentionally
                        // survives the rewind so ceiling placement re-rolls.
                        this.rng = makeRng(this.seedResolved);
                    }
                }
            } else if (gateEngaged && physRejects > REWIND_BUDGET) {
                // Tier 2: fresh terrain, own stream root; canopy series
                // restarts with it.
                this.rng = makeRng((this.seedResolved ^ Math.imul(
                    attempt + 1, 0x01000193)) >>> 0);
                this._canopyCalls = 0;
                physRejects = 0;
            }
        }

        // Accepted construction's retry cost, kept for diagnostics the same
        // way this.seed is: sweeps read this to flag level bands drifting
        // toward the MAX_GENERATION_ATTEMPTS budget.
        this.generationAttempts = attempt;

        // Fail fast rather than hand back a soft-locked level: without a
        // portal the player can never finish, and the run would silently
        // stall. Reaching 200 failed attempts means the generator itself is
        // broken, not merely unlucky.
        if (!valid) {
            throw new Error(
                `Level ${levelNumber}: no reachable portal position after ` +
                `${MAX_GENERATION_ATTEMPTS} generation attempts`
            );
        }

        // Pixel-space spawn point sits on the forced flat ground at the
        // direction's spawn tile (left-facing mirrors it to the right edge,
        // vertical drops the player bottom-center on the ground band).
        this.spawnPoint = {
            x: this.spawnTile.x * tileSize,
            y: this.spawnTile.y * tileSize
        };
        this.platforms = this.extractPlatforms();
        this.portal = this.portalTile
            ? {
                x: this.portalTile.x * tileSize,
                y: this.portalTile.y * tileSize,
                width: 32,
                height: 48
            }
            : null;
        // Reachability-verified coins stay the generation source of truth;
        // Collectibles owns the collection bookkeeping over them. Both point
        // at the same array so draw() and getCoins() see collected flags.
        this.collectibles = new Collectibles();
        this.collectibles.loadCoins(this.extractCoins());
        this.coins = this.collectibles.getCoins();
        // Hazards scan the tile grid for spike tiles (type 2), which the
        // Phase 2 generator places at level >= 5.
        this.hazards = new Hazards();
        this.extractHazards();
        // Enemies scan the tile grid for enemy spawn tiles (type 4), which
        // the Phase 2 generator places at level >= 5; unreachable markers
        // are skipped by the spawn validation.
        this.enemyManager = new EnemyManager();
        this.spawnEnemies();
        // Deck-bridge descriptors derive LAST: speed/phase rolls consume
        // this.rng only after every geometry, spike, marker, portal, coin and
        // enemy-kind draw has finished (same discipline as spawnEnemies' kind
        // rolls), so terrain/coins/enemies stay byte-identical for a given
        // seed and the schedule never perturbs a validated route. The bridge
        // GAP itself was decided and validated inside generateLevel/the
        // attempt loop above — a map with a corridor always ships its deck.
        // Fresh Level per publish/retry => fresh manager with an identical
        // phase schedule (replays are exact).
        this.movingPlatforms = this.deriveMovingPlatforms();
    }

    // Standing tile per direction on the forced flat ground band: canonical
    // left spawn for 'right', mirrored right spawn for 'left' (mirror of
    // x=2 is width-3), bottom-center for 'vertical'.
    getSpawnTile() {
        const y = this.height - 4;
        switch (this.direction) {
            case 'left':
                return { x: this.width - 3, y };
            case 'vertical':
                return { x: Math.floor(this.width / 2), y };
            default:
                return { x: SPAWN_TILE_X, y };
        }
    }

    // Spawn tile in canonical right-facing generation space (before the
    // 'left' column flip): the single spelling shared by placeSpikes'
    // keep-if-harmless gate and generateLevel's marker reachability pass,
    // so neither can drift from the other.
    canonicalSpawnTile() {
        return this.direction === 'vertical'
            ? this.getSpawnTile()
            : { x: SPAWN_TILE_X, y: this.height - 4 };
    }

    generateLevel() {
        const tiles = Array(this.height).fill(null).map(() =>
            Array(this.width).fill(0)
        );

        // Cells carrying the validated vertical route (jump-off/landing);
        // spikes must never cover them. Null for horizontal generation.
        this.pathCells = null;
        // Deck-bridge corridor (canonical space until the 'left' flip below;
        // generatePlatforms sets it, everything else keeps it null).
        this.bridgeGap = null;
        // Elevator shaft descriptor (vertical maps only — never mirrored,
        // because the 'left' flip below cannot co-occur with a shaft).
        this.shaftGap = null;
        // Canyon ceiling-span rects (canonical space until the 'left' flip;
        // paintCanyonCeilings fills them, exposeCeilingSpans reads them).
        this.ceilingSpans = null;

        if (this.direction === 'vertical') {
            this.generateVertical(tiles);
        } else {
            this.generatePlatforms(tiles);
        }
        // Order matters: hazards and enemy markers exist in the grid before
        // the constructor's computeReachable pass validates the level.
        this.placeSpikes(tiles);
        // Marker candidates must be judged against the final terrain plus
        // spikes (I2): a spike can strip a ledge of its only legal approach,
        // and deriveEnemySpawns would then silently drop every marker on it,
        // exhausting whole constructions on vertical maps (~6% at level 13).
        // Same BFS, spawn tile and headroom rule as the constructor's pass on
        // this same grid — markers that survive here deploy for real. Computed
        // in canonical (pre-mirror) space; the movement model is symmetric
        // in x, so 'left' reachability mirrors exactly.
        this.generationReachable = computeReachable(
            tiles,
            this.width,
            this.height,
            this.canonicalSpawnTile(),
            this.direction === 'vertical',
            this.bridgeGap,
            this.shaftGap
        );
        this.placeEnemyMarkers(tiles);

        // 'left' generates entirely in canonical right-facing space — spawn
        // zone, end zone, portal band and hazard exclusions are all written
        // for that space — and mirrors afterwards. The column flip maps the
        // terrain, the spike/marker exclusion bands, and the movement model
        // (symmetric in x) onto exact mirrored counterparts. The bridge
        // corridor descriptor rides the same transform: gap columns [a..b]
        // map to [width-1-b .. width-1-a], deck row unchanged.
        if (this.direction === 'left') {
            for (const row of tiles) row.reverse();
            if (this.bridgeGap) {
                const { a, b, S } = this.bridgeGap;
                this.bridgeGap = { a: this.width - 1 - b, b: this.width - 1 - a, S };
            }
            if (this.ceilingSpans && this.ceilingSpans.length > 0) {
                this.ceilingSpans = this.ceilingSpans.map((s) => ({
                    x0: this.width - 1 - s.x1, x1: this.width - 1 - s.x0,
                    yTop: s.yTop, yBot: s.yBot
                }));
            }
        }

        return tiles;
    }

    generateVertical(tiles) {
        const w = this.width;
        const h = this.height;

        // Vertical motifs (see MOTIF_GATES): knob-only reshapers of the SAME
        // ledge-chain machine — extMin/extMax scale each link's decorative
        // forward run (atrium: wide chamber shelves; zigzag: short dense
        // ones). The route mechanics (rise <= 1 per jump, pathCells
        // protection, wall bounce, chimney exclusion, steered shaft delivery
        // tail) are untouched, so elevators, spikes, markers and coins keep
        // their exact fairness contracts. 'standard' reproduces the shipped
        // draws verbatim (ext = 2 + floor(rng*4)). A forced direction flip
        // for zigzag was TRIED AND REMOVED: reversing every link parks the
        // next span inside the previous hop's intermediate column at target
        // height (strict dist-2 rule) and starves the attempt budget (avg
        // 35.6 attempts, ~1/1000 throws); short shelves alone measured avg
        // 14.5 with 0 throws over 400 maps while reading visibly denser.
        const kv = this.motif === 'atrium'
            ? { extMin: 4, extMax: 8, standardStream: false }
            : this.motif === 'zigzag'
                ? { extMin: 1, extMax: 2, standardStream: false }
                : { extMin: 2, extMax: 5, standardStream: true };

        // Ground band along the bottom: full-width solid from row h-3 down,
        // so the standing surface is row h-4 across the whole floor and the
        // bottom-center spawn always stands on solid ground.
        for (let x = 0; x < w; x++) {
            for (let y = h - 3; y < h; y++) {
                tiles[y][x] = 1;
            }
        }

        // --- Elevator shaft slot (see ELEVATOR_* constants) -----------------
        // ONE roll per eligible construction attempt, drawn BEFORE the chain
        // so a hit reshapes the whole map around the chimney. Levels below
        // the gate never roll (their rng streams — and byte-identical
        // generation — are untouched); every eligible vertical attempt
        // consumes exactly one draw here whether it hits or not, which is an
        // ACCEPTED design change reshuffling vertical maps from the gate up.
        if (this.levelNumber >= ELEVATOR_FIRST_LEVEL &&
            this.rng() < SHAFT_CHANCE) {
            const lift = MIN_SHAFT_LIFT +
                Math.floor(this.rng() * (MAX_SHAFT_LIFT - MIN_SHAFT_LIFT + 1));
            // Ledges need SHAFT_LEDGE_W columns each side plus the 2 shaft
            // columns plus 2 more for the delivery tail's stair (tOut/tOut2
            // stay off the walls on either flank); bottom stop keeps >= 3
            // rows of climb beneath it and the top stop stays clear of the
            // portal band (see constants).
            const sxMin = SHAFT_LEDGE_W + 3;                 // 5
            const sxMax = w - 3 - SHAFT_LEDGE_W - SHAFT_COLS; // 8 on w=15
            const sx = sxMin +
                Math.floor(this.rng() * (sxMax - sxMin + 1));
            const B = SHAFT_BOTTOM_MIN_ROW + Math.floor(
                this.rng() * (SHAFT_BOTTOM_MAX_ROW - SHAFT_BOTTOM_MIN_ROW + 1));
            this.shaftGap = { sx, ex: sx + SHAFT_COLS - 1, A: B - lift, B };
        }

        // Ascending chain of floating ledges, each exactly one row above the
        // last: rise <= 1 per jump is the only climb the movement model
        // allows (see computeReachable), so the chain steps up from the
        // ground's standing row to the top portal band (y <= 4). Every link
        // is a single dist-1 or dist-2 rise-jump from the previous standing
        // spot, and each ledge extends FORWARD (direction of travel) from
        // its landing tile. Forward-only extension is what keeps the route
        // provably intact in the final grid: a ledge's solid row equals the
        // previous ledge's standing row, so painting backwards would bury
        // the very cells the validated route stands on. Direction bounces
        // off the side walls; the constructor's BFS stays the safety net.
        // With a shaft the sweep splits in TWO segments (see ELEVATOR_*):
        // the LOWER climb is steered row by row toward the boarding flank so
        // its final landing (row B-1) always stands on the bottom floor
        // beside the chimney — free-snake landings missed the flush floor far
        // too often (measured: ~94% of constructions burned on delivery);
        // the elevator carries the route across rows B-1..A; the UPPER climb
        // resumes on the barrier slab's egress stand (row A-1) walking away.
        this.pathCells = new Set();
        let x = Math.floor(w / 2); // current standing column
        let dir = this.rng() < 0.5 ? 1 : -1;
        const g = this.shaftGap;
        // Deterministic boarding side (see shaftBoardSide): the flank that
        // points away from the map center, hence within <= 2 columns of the
        // bottom-center spawn's climb entry.
        const boardSide = g === null ? 0 : shaftBoardSide(g.sx, w);
        const boardCol = g === null ? -1 :
            (boardSide < 0 ? g.sx - 1 : g.ex + 1);
        // Current steering target for steered links (set per segment below).
        let steerCol = -1;

        // One chain link: pick the landing column, paint the supporting
        // ledge forward, record the route cells. steered=true replaces the
        // snake with a deterministic approach onto the target column (unit
        // steps, occasional dist-2 while still far, sidestep outward once
        // arrived); it never enters the shaft columns and never outruns the
        // walls. forceCol pins this link's landing exactly (used for the
        // final steered hop into the delivery tail).
        const chainLink = (row, steered, forceCol = 0) => {
            let step;
            if (steered) {
                const delta = forceCol || steerCol - x;
                if (delta === 0) step = boardSide; // park sideways, outward
                else step = Math.sign(delta) *
                    (Math.abs(delta) > 1 && this.rng() < 0.15 ? 2 : 1);
                if (forceCol && Math.abs(forceCol - x) <= 2) step = forceCol - x;
            } else {
                step = dir * (this.rng() < 0.15 ? 2 : 1);
            }
            let c = x + step;
            const inShaftCols = (cx) => g !== null &&
                row <= g.B + 1 && cx >= g.sx && cx <= g.ex;
            if (!steered) {
                // Wall bounce, extended to the chimney: landing columns must
                // stay outside the shaft columns whenever the landing row
                // sits at or below the bottom stop + 1 (a route cell inside
                // the future void would be de-supported by the carve; the
                // mouth pocket at row B+1 stays legal because its support
                // row B+2 survives). The flipped step always fits: both
                // neighbours of an outside column cannot sit inside a
                // 2-wide shaft, and standing columns stay within [1, w-2].
                if (c < 1 || c > w - 2 || inShaftCols(c)) {
                    // Bounce off the wall; the flipped step always fits
                    // since every standing column stays inside [1, w-2]. A
                    // bounced hop is always dist-1, so it contributes no
                    // mid cell.
                    step = -Math.sign(step || 1);
                    c = x + step;
                }
                // Support-punch guard: a landing column whose cell-below
                // (row + 1, c) already carries the route gets its support
                // (row, c) PUNCHED by the never-cap rule below — the landing
                // would float and the BFS would freeze the climb. Mirrored
                // step first, then unit sidesteps; the constructor BFS stays
                // the final authority if all fail. Motif-gated: 'standard'
                // historically resolved this rare collision through whole-
                // attempt retries, and its shipped rng stream is a byte-
                // identity contract (the pin catches even two L7 seeds where
                // the guard would have fired) — leave it alone.
                if (!kv.standardStream &&
                    this.pathCells.has((row + 1) * w + c)) {
                    for (const alt of [x - step, x + 1, x - 1]) {
                        if (alt >= 1 && alt <= w - 2 && !inShaftCols(alt) &&
                            !this.pathCells.has((row + 1) * w + alt)) {
                            step = alt - x;
                            c = alt;
                            break;
                        }
                    }
                }
            }
            dir = Math.sign(step) || dir;
            // Decorative forward run (>= 2 tiles standard): gives the ledge
            // body a contiguous top at least 3 columns wide for enemy
            // patrols. Motif knobs scale the run (atrium wider, zigzag
            // shorter); the standard range reproduces the shipped draw.
            const ext = kv.extMin +
                Math.floor(this.rng() * (kv.extMax - kv.extMin + 1));
            const lo = dir === 1 ? c : c - ext;
            const hi = dir === 1 ? c + ext : c;
            for (let cx = Math.max(0, lo); cx <= Math.min(w - 1, hi); cx++) {
                // Never cap a route cell: painting (row, cx) directly above
                // a recorded jump-off/landing ((row + 1, cx) carries the
                // route) gives that stand cell a ceiling, and the
                // headroom-aware vertical BFS (computeReachable's
                // requireOpenHead) refuses every jump from a capped cell —
                // the chain link would be validated out of existence. Only
                // decorative run can be punched: a ledge's own landing
                // support (row, c) is never a cell-above-route (the route
                // column always moved), so the chain stays intact.
                if (this.pathCells.has((row + 1) * w + cx)) continue;
                tiles[row][cx] = 1;
            }
            // Jump-off and landing cells carry the route: protect them from
            // spikes AND enemy markers (a patrol sweeping a route cell
            // makes the only validated climb periodically lethal, S10).
            this.pathCells.add(row * w + x);
            this.pathCells.add((row - 1) * w + c);
            return c;
        };

        if (g === null) {
            for (let row = h - 4; row >= VERTICAL_PORTAL_MAX_Y + 1; row--) {
                x = chainLink(row, false);
            }
        } else {
            // Deterministic delivery tail (see SHAFT_LEDGE_W): the lower
            // climb is steered to the stair column just OUTSIDE the bottom
            // shelf's edge, then three fixed cells carry the route up onto
            // the shelf top and walk it to the flush cabin mouth:
            //   (B+1, tOut) -> (B, tOut2) -> dist-2 hop -> (B-1, inner),
            //   walk inner..flank, board at the stop row.
            // Every jump-off stand sits clear of the shelf row, so no solid
            // ever caps the route (measured with an in-shelf approach: every
            // unpunched construction died with the BFS frozen below the
            // floor line; punching the shelf instead broke boarding itself).
            const { sx, ex } = g;
            const flankCol = boardSide < 0 ? sx - 1 : ex + 1;
            const tOut = flankCol + boardSide * SHAFT_LEDGE_W;
            const tOut2 = tOut + boardSide;
            const inner = flankCol + boardSide * (SHAFT_LEDGE_W - 1);
            steerCol = tOut;
            for (let row = h - 4; row >= g.B + 2; row--) {
                x = chainLink(row, true, row === g.B + 2 ? tOut : 0);
            }
            // Tail supports + air shaft, painted after the chain so they win
            // over any decorative run.
            tiles[g.B + 2][tOut] = 1;   // launch stand support
            tiles[g.B + 1][tOut2] = 1;  // mid-stand support
            for (const [ty, tx] of [
                [g.B + 1, tOut], [g.B, tOut], [g.B, tOut2], [g.B - 1, tOut2],
                [g.B - 1, tOut], [g.B - 1, inner], [g.B - 2, inner]
            ]) tiles[ty][tx] = 0;
            // Protect the whole delivery corridor from spikes and markers.
            for (const [ty, tx] of [
                [g.B + 1, tOut], [g.B, tOut2], [g.B - 1, inner],
                [g.B - 2, inner]
            ]) this.pathCells.add(ty * w + tx);
            for (let k = 0; k <= SHAFT_LEDGE_W - 1; k++) {
                this.pathCells.add((g.B - 1) * w + (inner + boardSide * k));
            }
            // Segment seam: resume the climb on the slab egress stand.
            x = boardCol;
            dir = boardSide;
            for (let row = g.A - 1; row >= VERTICAL_PORTAL_MAX_Y + 1; row--) {
                x = chainLink(row, false);
            }
        }

        if (g !== null) {
            const { sx, ex, A, B } = g;
            // Barrier slab (row A, full width except the chimney): THE
            // requirement enforcer. It seals the map horizontally — side
            // walls included — leaving the foothold-free 2-column chimney
            // as the ONLY breach between the lower and upper regions.
            // Mounting the slab from below through the hole needs a 2-row
            // rise (measured physical apex 1.86 rows, see MIN_SHAFT_LIFT),
            // which nothing can do; shaftIntact re-proves portal
            // unreachability WITHOUT the cabin against the final grid.
            for (let cx = 0; cx < w; cx++) {
                if (cx >= sx && cx <= ex) continue;
                tiles[A][cx] = 1;
            }
            // Bottom floor (row B): the stop shelf SHAFT_LEDGE_W columns
            // each side of the chimney. Its top surface is PIXEL-EXACT on
            // the cabin's bottom stop (max = B*T), mirroring the bridge
            // flush rule: boarding is a flush walk. The steered lower climb
            // always lands within one column of boardCol, inside this span.
            for (let cx = sx - SHAFT_LEDGE_W; cx <= ex + SHAFT_LEDGE_W; cx++) {
                if (cx < 0 || cx >= w || (cx >= sx && cx <= ex)) continue;
                tiles[B][cx] = 1;
            }
            // Chimney LAST: pure air rows 0..B+1 across both shaft columns
            // (cabin sweep rows A..B, rider rows A-1..B-1, portal-band
            // clearance above, and ONE pocket-free row under the parked
            // cabin — a descending deck must never engulf a waiting
            // player). Punches the slab cleanly at the shaft columns;
            // everything below row B+1 stays untouched, so falling past
            // the bottom floor costs the climb, exactly like a bridge pit.
            for (let y = 0; y <= B + 1; y++) {
                for (let cx = sx; cx <= ex; cx++) tiles[y][cx] = 0;
            }
        }
    }

    generatePlatforms(tiles) {
        const isPhase2 = DIFFICULTY.hasPhase2Content(this.levelNumber);
        // Continuous per-level ramp: gaps widen at level 3+ and become more
        // frequent every level within what the reachability model validates
        // (rises stay <= 1 tile via the terrace walk; gaps stay <= 3 columns,
        // inside the ~142px crossing range at speed 200).
        const maxGap = this.levelNumber >= 3 ? 3 : 2;
        // Plateaued at GAP_CHANCE_CAP (see constant): uncapped this ramp reads
        // 2.12 at level 99, which turns every segment edge into a pit and
        // leaves no flat ground for spike/marker sites.
        const gapChance = isPhase2
            ? Math.min(0.22 + 0.02 * (this.levelNumber - 4), GAP_CHANCE_CAP) // .24 at lvl 5 .. .64 at 25+
            : 0.18 + 0.04 * this.levelNumber;      // early-game ramp
        // Terrain reads as designed plateaus, not per-column sawtooth noise:
        // each elevation holds for a segment, then steps at a junction.
        let segRemaining = 0;

        let currentY = this.height - 3; // Top solid row of the ground column
        let gapStreak = 0;

        // --- Deck-bridge slot (canonical space; see DECK_BRIDGE_* constants)
        // ONE roll per eligible construction attempt. L1..7 never roll (the
        // byte-identity gate for the basic tier depends on this stream being
        // untouched); from L8 up every horizontal map consumes exactly one
        // draw here, which reshuffles those maps by design.
        // FEASIBILITY GATE: a bridge void devours its own columns plus the
        // ±3 besideDropOff ring around each lip and the ±2 marker-lip ban —
        // roughly gapW+6 hazard-band columns. The constructor REQUIRES both
        // a deployed enemy and a spike on horizontal Phase-2 maps, so a slot
        // is only offered when BOTH flanking segments of the hazard band
        // keep >= 2 usable columns (one hosts the spike, the other the
        // patrol; the void separates them by > THREAT_SPACING for free).
        // Narrow tiers (24/28-wide maps, L8..24) fail this arithmetically
        // and simply generate WITHOUT a bridge — never forced, no wasted
        // retries. Expert tier and up (>= 32 wide) carry feasible slots.
        let bridgeA = -1;
        let bridgeW = 0;
        let bridgeS = -1;
        if (this.levelNumber >= DECK_BRIDGE_FIRST_LEVEL &&
            this.rng() < BRIDGE_CHANCE) {
            const bandLo = HAZARD_SPAWN_EXCLUDE_COLS;   // 9
            const bandHi = this.width - 6;
            const slots = [];
            for (let wGap = MIN_DECK_GAP; wGap <= MAX_DECK_GAP; wGap++) {
                for (let s = BRIDGE_MIN_START_COL; s + wGap - 1 <= this.width - 6; s++) {
                    const leftSeg = Math.max(0, Math.min(s - 4, bandHi) - bandLo + 1);
                    const rightSeg = Math.max(0, bandHi - Math.max(s + wGap - 1 + 4, bandLo) + 1);
                    if (leftSeg >= 2 && rightSeg >= 2) slots.push({ s, wGap });
                }
            }
            if (slots.length > 0) {
                const pick = slots[Math.floor(this.rng() * slots.length)];
                bridgeA = pick.s;
                bridgeW = pick.wGap;
            }
        }

        // --- Motif knobs (see MOTIF_GATES) ----------------------------------
        // 'standard' keeps gapMul 1 (float-exact) and every decision
        // expression below verbatim, so its rng stream and geometry are
        // byte-identical. Non-standard motifs consume extra draws ONLY from
        // their gate level up (documented reshuffle band).
        const motif = this.motif;
        const KM = MOTIF_KNOBS[motif] ?? MOTIF_KNOBS.standard;
        // Hills: cosine surface (starts flush with the ground line at x=0,
        // so the spawn zone resets into the curve without a step).
        const hill = motif === 'hills' ? {
            amp: 2 + Math.floor(this.rng() * 3),      // 2..4 rows
            lambda: 10 + Math.floor(this.rng() * 7)   // 10..16 columns
        } : null;
        // Terraces: 2-3 elevation bands; the walk staircases toward the
        // active band and re-picks it after settling.
        const ter = motif === 'terraces' ? (() => {
            // Band spacing 2..3 rows: deeper steps starve the spike site
            // rules (every tooth within 3 columns of a riser or a drop is
            // vetoed), and whole attempts died with zero spikes on the old
            // 3..4-row bands.
            const d = 2 + Math.floor(this.rng() * 2);
            const bands = this.rng() < 0.5
                ? [this.height - 3, this.height - 3 - d,
                    Math.max(3, this.height - 3 - 2 * d)]
                : [this.height - 3, this.height - 3 - d];
            // Start aimed at the UPPER band, not the floor line: the spawn
            // zone holds the ground row, then the map climbs onto its first
            // terrace immediately (measured: starting on the floor band left
            // most maps flat because re-rolls only fire once settled).
            return { bands, bandY: bands[bands.length - 1] };
        })() : null;
        // Pillars: scripted tower sequences (climb k, hold, descend k) queued
        // at junctions; between towers the ground stays nearly flat. TUNE
        // 2026-11-04 (verification review): at 0.16/junction with no seed,
        // 43.8% of pillar maps shipped FLAT (spread ≤1) and half had no
        // tower flank at all. One cluster is now pre-seeded per map (it
        // climbs right out of the spawn zone) and the queue refire doubled
        // to 0.35/junction. Holds widened to 2..4 columns so tower tops
        // keep legal patrol spans (marker sites need ≥2 flat columns).
        const pil = motif === 'pillars' ? { queue: [] } : null;
        if (pil !== null) {
            const k = 2 + Math.floor(this.rng() * 3);
            const hold = 2 + Math.floor(this.rng() * 3);
            for (let i = 0; i < k; i++) pil.queue.push(-1);
            for (let i = 0; i < hold; i++) pil.queue.push(0);
            for (let i = 0; i < k; i++) pil.queue.push(1);
        }
        // Archipelago: thin island slabs (depth rows instead of fill-to-
        // bottom) with a minimum flat run before a gap may START, so islands
        // keep interior spike/patrol sites (the constructor's spike/enemy
        // presence guards must survive on sparse ground).
        const arch = motif === 'archipelago'
            ? { depth: 3, run: 0 } : null;

        for (let x = 0; x < this.width; x++) {
            // Bridge void columns: pure air top-to-bottom (falling in =
            // void death only, never a spiked floor). currentY passes
            // through untouched, so both lips end up EXACTLY flush —
            // Step 0 showed a far flank 1 row lower makes even a 6-wide
            // pit coyote-jumpable, and flush keeps the crossing deck-only.
            if (bridgeA >= 0 && x === bridgeA) bridgeS = currentY;
            if (bridgeA >= 0 && x >= bridgeA && x < bridgeA + bridgeW) {
                continue;
            }
            if (bridgeA >= 0 && x === bridgeA + bridgeW) {
                // Forced flush right lip (no junction step, fresh plateau).
                // Always painted full-depth even under thin-island motifs:
                // the flush-flank contract wants ordinary mass at the lip.
                for (let y = currentY; y < this.height; y++) tiles[y][x] = 1;
                segRemaining = 1 + Math.floor(this.rng() * 4);
                continue;
            }

            const isSpawnZone = x < 6;
            const isEndZone = x >= this.width - 5;

            // The column left of a bridge lip must be solid (it IS the lip):
            // suppress the ordinary gap roll there. Columns inside the
            // corridor never reach this line. Pillar staircases get the same
            // protection while their queue runs: a hole cut mid-climb breaks
            // the tower flank AND hands the wide-gap resume a forced step
            // that overrides the scripted sequence (verifier note).
            let doGap = false;
            if (!isSpawnZone && !isEndZone && gapStreak < maxGap &&
                segRemaining === 0 && !(bridgeA >= 0 && x === bridgeA - 1) &&
                !(pil !== null && pil.queue.length > 0)) {
                if (KM.gapMinW > 1 && gapStreak > 0 && gapStreak < KM.gapMinW) {
                    doGap = true; // hills: widen a started gap, no re-roll
                } else if (arch !== null && gapStreak === 0 &&
                    arch.run < ARCH_MIN_ISLAND_RUN) {
                    doGap = false; // young island: hold it together
                } else {
                    doGap = this.rng() < gapChance * KM.gapMul;
                }
            }
            if (doGap) {
                gapStreak++;
                if (arch !== null) arch.run = 0;
                continue; // Air column (pit) at a segment edge; max maxGap in a row
            }
            const resumedAfterWideGap = gapStreak >= 2;
            gapStreak = 0;

            if (isSpawnZone) {
                currentY = this.height - 3;
                segRemaining = 0;
            } else if (segRemaining > 0) {
                segRemaining--; // Hold this plateau's elevation
            } else {
                // Junction: terrace one step up or down, then hold for the
                // plateau's length. A reflecting +/-1 walk (slightly biased
                // down so ceilings don't stick) keeps adjacent heights within
                // the verified one-tile climb while producing terraced mesa
                // profiles instead of floor-hugging noise. After a pit two
                // or more columns wide the landing must sit at same-or-lower
                // height: rise-jumps reach only dist <= 2 in the movement
                // model, so a column rising over a wide gap is an uncrossable
                // wall — THAT forcing stays universal, above every motif.
                // The old atTop/atFloor bounces belong to the standard
                // chooser only: motif steppers self-target within clamped
                // ranges (the currentY clamp below is their boundary), and
                // running the bounce first pinned terraces to the floor line
                // (measured: elevation spread 1 row across 400 seeds).
                let step;
                let popped = false;
                let terMoving = false;
                // Archipelago resumes FLUSH instead of stepping down: the
                // uncrossable-rise law only forbids rising over a wide gap,
                // and the +1-down at gapChance≈0.64 ratcheted the island
                // walk line to the floor (measured: 40% of route stand-tiles
                // floated, elevated band reached in 1.7% of solid columns).
                // Flush lips stay deck-crossable in the movement model.
                if (resumedAfterWideGap) step = motif === 'archipelago' ? 0 : 1;
                else if (motif === 'hills') {
                    const target = this.height - 3 - Math.round(
                        hill.amp *
                        (0.5 - 0.5 * Math.cos((2 * Math.PI * x) / hill.lambda)));
                    const delta = target - currentY;
                    if (delta !== 0) step = Math.sign(delta);
                    else step = this.rng() < 0.3
                        ? (this.rng() < 0.5 ? 1 : -1) : 0;
                } else if (motif === 'terraces') {
                    // Re-roll only fires once the walk has SETTLED on the
                    // active band, and always picks a DIFFERENT band: holding
                    // the floor band with a same-band-allowed roll left most
                    // maps flat (elevation spread ~0 across 400 seeds).
                    if (ter.bandY === currentY) {
                        const others = ter.bands.filter(
                            (b) => b !== ter.bandY);
                        if (others.length > 0 && this.rng() < 0.55) {
                            ter.bandY =
                                others[Math.floor(this.rng() * others.length)];
                        }
                    }
                    const delta = ter.bandY - currentY;
                    step = delta === 0 ? 0 : Math.sign(delta);
                    terMoving = delta !== 0;
                } else if (motif === 'pillars') {
                    if (pil.queue.length === 0 && this.rng() < 0.35) {
                        const k = 2 + Math.floor(this.rng() * 3);
                        const hold = 2 + Math.floor(this.rng() * 3);
                        for (let i = 0; i < k; i++) pil.queue.push(-1);
                        for (let i = 0; i < hold; i++) pil.queue.push(0);
                        for (let i = 0; i < k; i++) pil.queue.push(1);
                    }
                    if (pil.queue.length > 0) {
                        step = pil.queue.shift();
                        popped = true;
                    } else {
                        step = this.rng() < 0.15
                            ? (this.rng() < 0.5 ? 1 : -1) : 0;
                    }
                } else if (motif === 'archipelago') {
                    // Islands ride an ELEVATED band (tops h-8..h-5) so the
                    // thin slabs read as floating chains over open void —
                    // riding the floor line made them look like plain ground
                    // with holes. Spawn zone stays on the ground row, so the
                    // chain steps up at the left flank naturally.
                    const hiRow = Math.max(3, this.height - 8);
                    const loRow = this.height - 5;
                    if (currentY <= hiRow) step = 1;
                    else if (currentY >= loRow) step = -1;
                    else step = this.rng() < 0.5 ? 1 : -1;
                } else {
                    // Standard chooser (also canyon terrain walk),
                    // verbatim including its rng draw order.
                    const atTop = currentY <= 3;
                    const atFloor = currentY >= this.height - 3;
                    if (atTop) step = 1;
                    else if (atFloor) step = -1;
                    else step = this.rng() < 0.55 ? 1 : -1;
                }
                currentY = Math.min(this.height - 3, Math.max(3, currentY + step));
                if (popped) {
                    segRemaining = 0; // staircase: every riser is its own column
                } else if (motif === 'terraces') {
                    // Every column risers toward the active band (adjacent
                    // heights stay within the verified one-tile climb), so
                    // the map REACHES its bands instead of crawling one row
                    // per plateau and spending the whole map in transit.
                    // Settled treads 4..8 wide: interiors beyond the ±3
                    // riser/drop veto keep legal spike sites, so attempts
                    // stop dying on the required-spike guard.
                    segRemaining = terMoving ? 0 : 4 + Math.floor(this.rng() * 5);
                } else if (arch !== null && resumedAfterWideGap) {
                    // Land flush, then CLIMB BACK toward the island band on
                    // the very next junction instead of holding the low
                    // landing for a whole segment (the hold was the second
                    // half of the floor-ratchet: land down, sit there,
                    // paint grounded-looking slabs).
                    segRemaining = 0;
                } else {
                    segRemaining = 1 + Math.floor(this.rng() * 4);
                }
                // Mostly 2-row slabs: thin decks read as floating; the
                // occasional 3 still gives islands some mass.
                if (arch !== null) arch.depth = 2 + (this.rng() < 0.3 ? 1 : 0);
            }

            // Hard float gate: an island slab NEVER paints within 3 rows of
            // the map bottom — a slab sitting on the floor reads as grounded
            // ground with holes, not an island. The stepper keeps currentY
            // inside [h-8, h-5], so this only trims the depth of transition
            // columns (a thin deck over ≥3 void rows still reads floating);
            // the spawn zone keeps its ordinary grounded runway because the
            // player starts there. Bridge lips paint full-depth above.
            let paintBottom = this.height;
            if (arch !== null && !isSpawnZone) {
                paintBottom = Math.min(currentY + arch.depth, this.height - 3);
            }
            for (let y = currentY; y < paintBottom; y++) {
                tiles[y][x] = 1; // Solid platform
            }
            if (arch !== null) arch.run++;
        }

        if (bridgeA >= 0) {
            this.bridgeGap = { a: bridgeA, b: bridgeA + bridgeW - 1, S: bridgeS };
        }
        if (motif === 'canyon') this.paintCanyonCeilings(tiles);
        return tiles;
    }

    // Canyon overhead rock (see MOTIF_GATES.canyon). THE LAW: no standable
    // cell may gain a solid within TWO rows above it — the 32px body fills a
    // tile and the ~62.5px jump barely clears two rows, so anything closer
    // turns a BFS-modelled jump into a head-bonk. The horizontal movement
    // model deliberately does NOT run requireOpenHead (byte-identical
    // heritage), so the GENERATOR owns this clearance; the structural sweep
    // re-verifies it against every final grid.
    //
    // TUNE 2026-11-04 (verification review): the first version hung flat
    // slabs 4..6 rows above the tallest column in the span, which measured
    // as floating islands, not a corridor: median headroom 5 rows, ceiling
    // present on only ~8 cells per map, 5% of maps zero. The roof now
    // FOLLOWs the smoothed surface top at a per-span clearance of 2..3 free
    // rows above the walk line (the legal minimum under THE LAW — bottom =
    // t-hr-2 keeps rows t-1..t-3 free in every column, and cellSafe below
    // stays as the belt-and-braces guard), spans widen to 8..14 columns and
    // number 2..3 per map, placement retries until at least one span paints,
    // and painted rects land in this.ceilingSpans so the renderer keeps
    // decoration off overhead rock (exposeCeilingSpans). Spans stay clear of
    // the spawn runway (x < 8), the portal apron (x > width-6) and any
    // bridge window (deck clearance needs pure air above the corridor).
    // Ceilings can only REMOVE movement edges (solid mid-columns block
    // scans), so the BFS validating the real grid stays honest — worst case
    // is a rejected attempt, never an unfair accepted route.
    paintCanyonCeilings(tiles) {
        const w = this.width;
        // Canopy draws come from a DEDICATED stream (level seed + attempt
        // ordinal), never the main generator rng: consuming main-stream
        // draws here reshuffled every downstream shuffle (spike claims,
        // marker picks), and on site-scarce maps that alone swung realized
        // enemy density +55% vs the identical-terrain baseline (measured
        // A/B, L32 x 100 seeds). The side stream keeps spikes/markers
        // byte-aligned with the standard stream; ceilings then act purely
        // through geometry (reachability pruning), which is the honest
        // channel.
        const crng = makeRng(((this.seedResolved ?? 0) ^
            Math.imul(0x9E3779B1, this._canopyCalls = (this._canopyCalls ?? 0) + 1)) >>> 0);
        const topRow = (x) => {
            for (let y = 0; y < this.height; y++) {
                if (tiles[y][x] === 1) return y;
            }
            return null;
        };
        // Painting (x,r) would cap standable (x,r+1) [needs solid r+2] or
        // (x,r+2) [needs solid r+3]. Reject exactly those cells.
        const cellSafe = (x, r) => r >= 1 &&
            tiles[r + 2]?.[x] !== 1 && tiles[r + 3]?.[x] !== 1;
        const bwLo = this.bridgeGap ? this.bridgeGap.a - 1 : -1;
        const bwHi = this.bridgeGap ? this.bridgeGap.b + 1 : -1;
        this.ceilingSpans = [];
        // Terrain tops snapshotted BEFORE any canopy paint: a second span
        // reading the first span's roof as "surface" hung a double-decker
        // ceiling with a sealed pocket (measured on L32 seed#0) — the exact
        // stacked-slab silhouette the corridor read exists to avoid. Where
        // spans overlap, the later pass merges into existing rock instead.
        const surfTop = [];
        for (let x = 0; x < w; x++) surfTop.push(topRow(x));
        // PIT-JUMP PROTECTION (physics-sweep ruling): a canopy lid over a
        // pit truncates the crossing arc — apex 62.5px, body 32px, so a
        // full flight needs ~94.5px = three free rows and an hr=2 roof cuts
        // it into the void. Margin bands around pits were tried first and
        // STARVED the motif: canyon terrain is pit-dense (~21% of columns),
        // ±2 exclusion lifted zero-roof maps to 8.3%, ±4 to 31.3%. The
        // shipped rule keeps rock off the fall itself (void columns) plus
        // one launch column either side, and canyonRouteFair() rejects
        // any construction whose accepted route still crosses under a roof
        // that a headroom-aware walk cannot pass — geometry-checked, not
        // margin-guessed. Open mouths read as canyon entrances; canopies
        // gather between them.
        const pitNear = new Array(w).fill(false);
        for (let x = 0; x < w; x++) {
            if (surfTop[x] !== null) continue; // solid underfoot everywhere
            for (let k = Math.max(0, x - 1); k <= Math.min(w - 1, x + 1); k++) {
                pitNear[k] = true;
            }
        }
        const targetSpans = 2 + (crng() < 0.5 ? 1 : 0);
        // Guard bounds rng burn: geometry usually satisfies targetSpans (or
        // the whole budget) without ever hitting it.
        let guard = 0;
        const paintedKeys = new Set(); // every canopy cell, for the law repair
        while ((this.ceilingSpans.length < targetSpans ||
            this.ceilingSpans.length === 0) && guard++ < 8) {
            const len = 8 + Math.floor(crng() * 7);       // 8..14 columns
            const maxStart = w - 6 - len;                     // portal apron
            if (maxStart < 8) break;                          // too narrow
            const start = 8 + Math.floor(crng() * (maxStart - 8 + 1));
            const thick = 1 + Math.floor(crng() * 2);     // 1..2 rows
            const hr = 2 + (crng() < 0.5 ? 1 : 0);        // headroom 2..3
            // Surface tops across the span; gap columns carry the nearest
            // known top so the roof stays continuous over shallow bumps
            // (deep falls are already excluded by the jump zone above).
            const tops = [];
            for (let x = start; x < start + len; x++) tops.push(surfTop[x]);
            for (let k = 1; k < tops.length; k++) {
                if (tops[k] === null) tops[k] = tops[k - 1];
            }
            for (let k = tops.length - 2; k >= 0; k--) {
                if (tops[k] === null) tops[k] = tops[k + 1];
            }
            if (tops[0] === null) continue; // whole span over pure void
            // Follow the OWN column top: bottom = t-hr-2 puts the walk row
            // (t-1) at exactly hr free rows under the roof — the corridor
            // read. (A ±1 min-window smoothing was tried first and lifted
            // the roof over every bump: measured headroom median 4, only
            // 19.8% of under-canopy route cols at ≤3.) THE LAW holds per
            // column by construction (rows t-1..t-3 stay air) and cellSafe
            // remains the guard.
            let painted = 0, yTop = this.height, yBot = -1, x0 = -1, x1 = -1;
            for (let x = start; x < start + len; x++) {
                if (x >= bwLo && x <= bwHi) continue; // bridge clearance wins
                if (pitNear[x]) continue; // pit crossings keep open sky
                const t = tops[x - start];
                const bottom = t - hr - 2; // walk row t-1 keeps hr free rows
                for (let rr = Math.max(2, bottom - thick + 1); rr <= bottom; rr++) {
                    if (rr < 1 || rr >= this.height) continue;
                    if (tiles[rr][x] === 1 || !cellSafe(x, rr)) continue;
                    tiles[rr][x] = 1;
                    painted++;
                    paintedKeys.add(rr * w + x);
                    if (x0 < 0) x0 = x;
                    x1 = x;
                    if (rr < yTop) yTop = rr;
                    if (rr > yBot) yBot = rr;
                }
                // Stalactite fang: one extra row down at scattered columns.
                // cellSafe rejects it whenever the local headroom is already
                // at the legal floor (its +3 scan hits the surface), so fangs
                // only bite where they cannot cap a standable cell.
                if (crng() < 0.3) {
                    const rr = bottom + 1;
                    if (rr >= 2 && rr < this.height && tiles[rr][x] !== 1 &&
                        cellSafe(x, rr)) {
                        tiles[rr][x] = 1;
                        painted++;
                        paintedKeys.add(rr * w + x);
                        if (x0 < 0) x0 = x;
                        x1 = x;
                        if (rr < yTop) yTop = rr;
                        if (rr > yBot) yBot = rr;
                    }
                }
            }
            if (painted > 0) this.ceilingSpans.push({ x0, x1, yTop, yBot });
        }
        // Law repair (structural sweep, L53 s5300014): cellSafe only sees
        // the grid AT PAINT TIME, so a later span can add support BENEATH an
        // earlier span's cell and turn it into a cap over a newly-standable
        // row (two free rows between spans became one standable row). Drop
        // offending canopy cells until the grid obeys THE LAW everywhere;
        // removal never adds mass, so each pass strictly shrinks the set and
        // the loop terminates. Terrain can never be the cap here: a heightmap
        // solid at y-1 implies fill through y, so no standable sits under it.
        let dirty = true;
        while (dirty) {
            dirty = false;
            for (const key of paintedKeys) {
                const x = key % w;
                const y = (key - x) / w;
                for (const dy of [1, 2]) {
                    const sy = y + dy;
                    if (sy < this.height && tiles[sy][x] === 0 &&
                        tiles[sy + 1]?.[x] === 1) {
                        tiles[y][x] = 0;
                        paintedKeys.delete(key);
                        dirty = true;
                        break;
                    }
                }
            }
        }
    }

    // Ceiling-span rects painted over the corridor, in FINAL grid space
    // ({x0,x1,yTop,yBot} inclusive; 'left' maps mirror them with the grid).
    // Empty array on every non-canyon map. The renderer uses this to keep
    // surface decoration (props/sprites scatter) off overhead rock — cactus
    // and battlement growth on a canopy top reads as a floating island,
    // killing the corridor feel the ceilings exist to create.
    exposeCeilingSpans() {
        return this.ceilingSpans ?? [];
    }

    // Canyon route validation (physics-sweep ruling): the horizontal BFS
    // model deliberately ignores headroom, so a canopy can seal a crossing
    // the scan still claims — a soft-lock no margin rule caught in three
    // measured tiers. Instead of guessing margins, re-run the reachability
    // pass with requireOpenHead ON: it models the one jump type a roof can
    // kill (the step-up onto a ledge), and under canyon canopies every
    // standable cell already has its two legal free rows, so the flag bites
    // ONLY on cells capped by painted rock. A route that survives is
    // walkable under open-sky rules; anything else rejects the construction
    // and the retry loop regenerates. Ceilings never add floor, so this gate
    // cannot demand geometry the terrain does not have. The authoritative
    // call site is canyonRouteFair below — post-deployment, on the shipped
    // grid — because spike/marker removals re-open cells the pre-placement
    // walk could not use; validateCanyonRoute stays as the reusable
    // primitive for tests and diagnostics.
    validateCanyonRoute() {
        if (this.motif !== 'canyon' || this.direction === 'vertical') {
            return true;
        }
        const strict = computeReachable(
            this.tiles, this.width, this.height, this.spawnTile,
            true, this.bridgeGap, this.shaftGap);
        return strict.has(
            this.portalTile.y * this.width + this.portalTile.x);
    }

    // Post-deployment fairness check for canyon constructions (see
    // validateCanyonRoute). The pre-placement gate above runs BEFORE spikes
    // and markers land; their removals re-open cells (a spike tile is not
    // standable to the strict walk) that the shipped grid's route later
    // walks as a flat fall — L48 s48001 carried exactly such a construction
    // whose pre-placement gates ALL passed while every physical crossing of
    // the pit at 7..9 died in void or on the spike at 15,19. So the
    // authoritative verdict runs once per accepted construction, after
    // deployment, here: fail => clear the board and regenerate (attempts
    // consume the same streams, so terrain stays deterministic per attempt
    // ordinal). Two tiers:
    //   1) geometry — headroom-aware walk must reach the portal;
    //   2) physics (when Level.physRoute is injected by the verification
    //      harness) — the portal must be reachable using ONLY edges the
    //      shipped player/physics simulation lands, deck/lift crossings
    //      trusted, plus grounded landings harvested mid-flight. This is
    //      edgecheck's soft-lock cross-check moved inside the accept loop;
    //      runtime play never injects it (zero-dependency rule), and the
    //      sweeps prove zero soft-locks ship.
    canyonRouteFair() {
        if (this.motif !== 'canyon' || this.direction === 'vertical') {
            return true;
        }
        if (!this.validateCanyonRoute()) return false;
        if (Level.physRoute) {
            return Level.physRoute(this);
        }
        return this.routePhysicallyExecutable();
    }

    // Physics-executed route check (shipping gate). The horizontal BFS
    // models jumps geometrically; L48 s48001 proved geometry alone can ship
    // a route whose every physical crossing dies (a single spike reads as
    // passable to the scan, but the drop behind it stretches the body's
    // overlap with the inset core past survival under EVERY takeoff timing).
    // This runs the SHIPPED Player + Physics over the BFS shortest path's
    // transitions: each consecutive pair must be landable under at least one
    // input policy (walk-through, or jump at frame j with direction held /
    // late-steer variants), mirroring edgecheck's policy battery in reduced
    // form. Deck/lift crossings are trusted (validated by their own rider
    // suites). Early exit on first success per transition keeps accepted
    // maps cheap (~ms); only doomed transitions burn the full battery — and
    // those reject the construction anyway. Constants mirror main.js
    // (PLAYER_SPEED/JUMP_FORCE) and edgecheck's faithful simPolicy loop:
    // settle frames, ledge-fall seeding via player.update, landing brake,
    // inset spike cores (hazards.js convention), void below the grid.
    routePhysicallyExecutable() {
        const T = this.tileSize;
        const w = this.width, h = this.height;
        // Policy battery (reduced edgecheck set): walk-through, early jump
        // held end-to-end, late-steer jumps (direction pressed after
        // takeoff), and release-early variants so landing-brake behavior is
        // exercised too.
        const policies = [{ j: null }];
        for (const j of [0, 1, 2, 3, 4, 6, 8]) policies.push({ j });
        for (const j of [0, 2]) {
            for (const from of [8, 12, 16, 20, 24]) {
                policies.push({ j, from });
            }
        }
        for (const until of [10, 16, 24]) policies.push({ j: 0, until });
        for (const j of [0, 2, 4]) {
            for (const off of [6, 12, 18]) policies.push({ j, off });
        }
        const rectGrid = [];
        for (let y = 0; y < h; y++) {
            const row = [];
            for (let x = 0; x < w; x++) {
                row.push(this.tiles[y][x] === 1
                    ? { x: x * T, y: y * T, width: T, height: T } : null);
            }
            rectGrid.push(row);
        }
        const INSET = 4; // hazards.js inset-core convention
        // Spike CORES straight from the tile grid: at gate time the spike
        // list object may not exist yet (it is built after acceptance), but
        // type-2 cells are laid before validation runs.
        const cores = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (this.tiles[y][x] === 2) {
                    cores.push({
                        x: x * T + INSET, y: y * T + INSET,
                        width: T - 2 * INSET, height: T - 2 * INSET
                    });
                }
            }
        }
        const pitY = h * T;
        const collect = (player, out) => {
            out.length = 0;
            const x0 = Math.floor(player.x / T) - 1;
            const x1 = Math.floor((player.x + player.width) / T) + 1;
            const y0 = Math.floor(player.y / T) - 1;
            const y1 = Math.floor((player.y + player.height) / T) + 1;
            for (let ty = y0; ty <= y1; ty++) {
                if (ty < 0 || ty >= h) continue;
                for (let tx = x0; tx <= x1; tx++) {
                    if (tx < 0 || tx >= w) continue;
                    const r = rectGrid[ty][tx];
                    if (r) out.push(r);
                }
            }
            return out;
        };
        const ctx = {
            T, DT: 1 / 60, SIM_FRAMES: 180,
            PLAYER_SPEED: 200, JUMP_FORCE: 350, // mirror main.js
            physicsFactory: () => new Physics(),
            collect, cores, pitY, w
        };
        const routeEdges = routeModelEdges(this);
        // Harvest-aware search over physics-executed footholds (edgecheck's
        // soft-lock semantics, mirrored): adjacency = landed route-model
        // edges PLUS grounded landings harvested mid-flight (an overshoot
        // onto a new column is a real foothold). BFS must reach the portal
        // through that graph; shortest-path-only checking would reject maps
        // where the executable chain detours (measured on L48 s48001).
        const adj = new Map();
        const addAdj = (ak, bk) => {
            if (!adj.has(ak)) adj.set(ak, []);
            adj.get(ak).push(bk);
        };
        const startK = this.spawnTile.y * w + this.spawnTile.x;
        const goalK = this.portalTile.y * w + this.portalTile.x;
        const seen = new Set();
        let anyLanded = false;
        // Runs one policy on one edge; returns {ok, harvests:[cellKey,...]}
        // where harvests are grounded landings reached anywhere but A.
        const sim = (e, pol) => simTransition(e, pol, ctx);
        for (const e of routeEdges) {
            const ak = e.ay * w + e.ax;
            if (e.kind === 'deck' || e.kind === 'lift') {
                addAdj(ak, e.by * w + e.bx);
                continue;
            }
            const ek = `${e.ax},${e.ay}->${e.bx},${e.by}`;
            if (seen.has(ek)) continue;
            seen.add(ek);
            let landedHere = false;
            for (const pol of policies) {
                const r = sim(e, pol);
                if (r.ok) {
                    landedHere = true;
                    addAdj(ak, e.by * w + e.bx);
                }
                for (const hk of r.harvests) addAdj(ak, hk);
            }
            if (landedHere) anyLanded = true;
        }
        if (!anyLanded) return false;
        const vis = new Set([startK]);
        const q = [startK];
        while (q.length) {
            const k = q.pop();
            if (k === goalK) return true;
            for (const n of (adj.get(k) ?? [])) {
                if (!vis.has(n)) { vis.add(n); q.push(n); }
            }
        }
        return false;
    }

    // Generation-space exclusion for spikes and enemy markers. Canonical
    // right-facing space keeps the spawn zone (x < 6) and portal band
    // (x >= width - 4) clear with a one-column buffer; 'left' generates in
    // that same space and mirrors afterwards, which maps its allowed band
    // x ∈ [6, w-6] exactly onto x ∈ [5, w-7] — disjoint from the mirrored
    // portal band x ∈ [2, 4] (the old w-5 bound overlapped it at column 4).
    // Vertical space keeps the bottom spawn neighborhood
    // (y >= height - VERTICAL_SPAWN_EXCL_ROWS) and the top portal band
    // (y <= VERTICAL_PORTAL_MAX_Y) clear.
    hazardPlacementAllowed(coord) {
        if (this.direction === 'vertical') {
            return coord > VERTICAL_PORTAL_MAX_Y &&
                coord < this.height - VERTICAL_SPAWN_EXCL_ROWS;
        }
        // Nine columns of opening runway: hazards/patrols inside the first
        // screenful of the level kill players before they have any context
        // (playtest ruling: ambushes at spawn read as cheating, not hard).
        return coord >= HAZARD_SPAWN_EXCLUDE_COLS &&
            coord <= this.width - 6;
    }

    // Fairness window around a shaft (vertical mirror of the bridge lip ban,
    // see SHAFT_WINDOW_PAD): the stop ledges plus two columns beyond each
    // outer edge, at both stops' stand rows and the row above. Markers and
    // spikes never site here, and deployed patrols clamp out of these
    // columns (deriveEnemySpawns), so the approach to a REQUIRED boarding
    // point is never swept — same ruling lineage as the bridge lips.
    inShaftWindow(x, y) {
        const g = this.shaftGap;
        if (!g) return false;
        if (x < g.sx - SHAFT_LEDGE_W - SHAFT_WINDOW_PAD ||
            x > g.ex + SHAFT_LEDGE_W + SHAFT_WINDOW_PAD) return false;
        return y === g.A - 1 || y === g.A - 2 ||
            y === g.B - 1 || y === g.B - 2;
    }

    // Tile bounds of the band a patrol may sweep, per direction: mirrors
    // hazardPlacementAllowed's canonical band. Patrols are clamped here so
    // they can never sweep the spawn tile or the portal band (I3): support-
    // row runs alone leak past both because the forced-flat spawn ground
    // connects to terrain beyond column 5.
    patrolBandBounds() {
        if (this.direction === 'left') {
            return [5, this.width - 1 - HAZARD_SPAWN_EXCLUDE_COLS];
        }
        if (this.direction === 'vertical') {
            return [0, this.width - 1];
        }
        return [HAZARD_SPAWN_EXCLUDE_COLS, this.width - 6];
    }

    // Free patrol span around a marker candidate (x, y): contiguous columns
    // whose walk row is actually walkable — solid support beneath AND the
    // body row itself free of rock and spikes. A support-only scan sweeps
    // into neighbouring terrain because heightmaps rise up to one tile per
    // column (a step-up's mass occupies this row), and type-2 spikes sit on
    // the walk row and are lethal, not terrain (I4). Other markers (type 4)
    // sit on ordinary standable air and do not break a run. On vertical
    // levels the recorded route cells also end a run: an enemy sweeping a
    // jump-off/landing cell makes the only validated climb periodically
    // lethal with no stomp mechanic (S10). Returns null when the marker
    // tile itself is unsupported or on the route.
    patrolSpan(tiles, x, y) {
        const solidAt = (cx, cy) =>
            cx >= 0 && cx < this.width && cy >= 0 && cy < this.height &&
            tiles[cy][cx] === 1;
        const blockedByRoute = (cx, cy) =>
            this.pathCells !== null &&
            this.pathCells.has(cy * this.width + cx);
        const walkable = (cx, cy) =>
            cx >= 0 && cx < this.width && cy >= 0 && cy < this.height &&
            tiles[cy][cx] !== 1 && tiles[cy][cx] !== 2 &&
            !blockedByRoute(cx, cy);
        if (!solidAt(x, y + 1) || blockedByRoute(x, y)) return null;
        let left = x;
        while (solidAt(left - 1, y + 1) && walkable(left - 1, y)) left--;
        let right = x;
        while (solidAt(right + 1, y + 1) && walkable(right + 1, y)) right++;
        return { left, right };
    }

    // One geometry pass over the grid's type-4 markers producing every
    // valid enemy deployment: standable marker tile, reachable from the
    // player spawn, free patrol span (patrolSpan), clamped to the
    // direction's band (patrolBandBounds). Shared by spawnEnemies and the
    // coin exclusion so patrol bounds and coin placement can never diverge.
    // Markers outside the band are skipped: the generator never emits them,
    // and an enemy whose spawn column sits beyond its own clamped bounds
    // would teleport on its first tick.
    deriveEnemySpawns() {
        const spawns = [];
        const [bandMin, bandMax] = this.patrolBandBounds();
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.tiles[y][x] !== 4) continue;
                if (x < bandMin || x > bandMax) continue;
                if (!this.reachableTiles.has(y * this.width + x)) continue;
                const span = this.patrolSpan(this.tiles, x, y);
                if (!span) continue;
                let left = Math.max(span.left, bandMin);
                let right = Math.min(span.right, bandMax);
                // Forced-boarding fairness (deck bridges): isMarkerSite bans
                // SITES inside the lip window, but a legal site just outside
                // it can patrol INTO the window — the approach to a REQUIRED
                // boarding point would still be swept. End the patrol at the
                // window edge (the site's own column always survives: it is
                // outside the window by construction).
                if (this.bridgeGap) {
                    const wLo = this.bridgeGap.a - BRIDGE_LIP_BAN_COLS;
                    const wHi = this.bridgeGap.b + BRIDGE_LIP_BAN_COLS;
                    if (x < wLo) right = Math.min(right, wLo - 1);
                    else if (x > wHi) left = Math.max(left, wHi + 1);
                }
                // Same clamp for shaft approach windows (elevator rides):
                // a legal site just outside the window must not patrol INTO
                // it. Support-break already stops any span at the chimney
                // (the shaft columns are pure void), so this tightens the
                // ledge-side approach — reuse of the bridge clamp machinery,
                // column-scoped like the original.
                if (this.shaftGap) {
                    const wLo = this.shaftGap.sx - SHAFT_LEDGE_W -
                        SHAFT_WINDOW_PAD;
                    const wHi = this.shaftGap.ex + SHAFT_LEDGE_W +
                        SHAFT_WINDOW_PAD;
                    if (x < wLo) right = Math.min(right, wLo - 1);
                    else if (x > wHi) left = Math.max(left, wHi + 1);
                }
                spawns.push({ x, y, left, right });
            }
        }
        return spawns;
    }

    placeSpikes(tiles) {
        // Phase 2 elements appear only from the tier boundary up: the
        // early-game ramp and existing E2E flows stay untouched below it.
        if (!DIFFICULTY.hasPhase2Content(this.levelNumber)) return;

        // Mild count scaling with level number, hard-capped far below the
        // spec's 10%-of-all-tiles density limit. Plateaued at
        // SPIKE_TARGET_CAP (uncapped: 49 at L99); realized counts sit far
        // lower anyway because THREAT_SPACING claims 9 columns per spike, so
        // on the widest shipped map (~26 band columns) only ~3 fit — the cap
        // documents intent and stops the formula outrunning geometry.
        const target = Math.min(
            2 + Math.floor((this.levelNumber - PHASE2_FIRST_LEVEL) / 2),
            SPIKE_TARGET_CAP,
            Math.floor(this.width * this.height * 0.1)
        );

        // Surface hazards only: air tiles directly above solid ground, never
        // inside the direction's exclusion zones, never within two columns
        // of a constructed climb's jump-off/landing cells, and never beside
        // a drop-off or raised lip: players WALK off ledges, and a tooth at
        // feet level under a lip kills anyone who steps instead of jumps
        // (playtest ruling — deaths must be explainable and avoidable by
        // ordinary movement).
        // Local geometry (works for every direction, including vertical
        // maps whose floating ledges make any global surface array lie):
        // the spike's own support is row y+1, so inspect neighbours against
        // THAT surface, not the column's first solid from the sky.
        const besideDropOff = (x, y) => {
            for (let dx = -3; dx <= 3; dx++) {
                if (dx === 0) continue;
                const nx = x + dx;
                if (nx < 0 || nx >= this.width) continue;
                // A pit/bottomless drop within rollout distance of the tooth.
                let ground = false;
                for (let r = y + 1; r <= y + 4 && r < this.height; r++) {
                    if (tiles[r][nx] === 1) { ground = true; break; }
                }
                if (!ground) return true;
                // Raised mass beside the spike: players WALK off its lip and
                // the tooth sits at feet level exactly where they land
                // (playtest ruling — deaths must be avoidable by ordinary
                // movement, and stepping off a ledge is ordinary).
                // y===0 guard: a surface at row 1 would put the candidate
                // itself in the top sky row (canyon canopies are clamped to
                // row >= 2 so this cannot fire today; it kept a latent
                // tiles[-1] crash alive through the pre-motif ceiling pass).
                if (tiles[y][nx] === 1 || (y > 0 && tiles[y - 1][nx] === 1)) {
                    return true;
                }
            }
            return false;
        };
        const nearRouteCell = (x, y) => {
            if (!this.pathCells) return false;
            // Route cells are the forced landing/jump-off spots of the
            // constructed climb. A tooth ON THE SAME WALKING SURFACE within
            // two columns turns a mandatory jump into a pixel-perfect one
            // (screenshot ruling: "everytime I try to jump up onto the
            // ledge near the spikes, I end up hitting the spikes"). Other
            // rows are different platforms; banning them starves vertical
            // maps, where the snaking route touches nearly every row.
            for (let dx = -2; dx <= 2; dx++) {
                const nx = x + dx;
                if (nx >= 0 && nx < this.width &&
                    this.pathCells.has(y * this.width + nx)) return true;
            }
            return false;
        };
        const candidates = [];
        for (let y = 0; y < this.height - 1; y++) {
            for (let x = 0; x < this.width; x++) {
                if (tiles[y][x] !== 0 || tiles[y + 1][x] !== 1) continue;
                if (!this.hazardPlacementAllowed(
                    this.direction === 'vertical' ? y : x)) {
                    continue;
                }
                if (nearRouteCell(x, y)) continue;
                // No teeth on canyon-canopy rock (mirror of the marker ban):
                // a spike perched on a slab top sits out of the corridor's
                // threat geometry entirely — it neither menaces the walk
                // line nor claims its columns — yet it consumes the map's
                // single-spike budget and vacates the FLOOR sites where the
                // marker proximity vetoes depend on it. Measured: relocated
                // roof spikes un-vetoed the floor patrol pool and drove
                // canyon deployed density +55..+90% past target across the
                // motif's whole level run. Canopy rock hosts no hazards;
                // the corridor floor keeps the standard economy.
                if (this.inCeilingCell(x, y + 1)) continue;
                // Shaft approach fairness: no teeth on or beside the stop
                // ledges (see inShaftWindow). The chimney columns themselves
                // are pure void, so a spike can never site inside them.
                if (this.inShaftWindow(x, y)) continue;
                if (this.direction === 'vertical') {
                    // Vertical ledges are ALL edge, so the horizontal
                    // rollout rule would veto every cell. Instead: teeth
                    // sit mid-shelf only — solid support one column each
                    // way — so a spike never caps a ledge tip over a drop.
                    if (x < 1 || x > this.width - 2 ||
                        tiles[y + 1][x - 1] !== 1 ||
                        tiles[y + 1][x + 1] !== 1) continue;
                } else if (besideDropOff(x, y)) continue;
                candidates.push({ x, y });
            }
        }
        shuffle(candidates, this.rng);

        // Keep-if-harmless gate: a spike is kept only when the grid still has
        // a reachable portal-band tile after placing it. A surface spike makes
        // its entire column unlandable (the movement model breaks downward
        // landing scans on hazards — falling onto a spike kills), so a spike
        // on a pit rim or capping a riser can silently wall the corridor off.
        // Blind placement plus whole-map retries starved the advanced-tier
        // sizes (~98% of attempts unreachable at level 15, throwing after
        // MAX_GENERATION_ATTEMPTS); testing each placement against the same
        // validation the constructor applies rejects severing spikes at the
        // source instead. Bounded by the candidate list, like everything else
        // here. Evaluated in canonical right-facing space: 'left' mirrors
        // afterwards and the movement model is symmetric in x, so a mirrored
        // route mirrors its validation exactly.
        const headroom = this.direction === 'vertical';
        const spawn = this.canonicalSpawnTile();
        // Keep-if-harmless gate, two survival requirements (I2):
        // 1. Portal reachability: a surface spike makes its entire column
        //    unlandable (the movement model breaks downward landing scans on
        //    hazards — falling onto a spike kills), so a spike on a pit rim
        //    or capping a riser can silently wall the corridor off. Blind
        //    placement plus whole-map retries starved the advanced-tier sizes
        //    (~98% of attempts unreachable at level 15, throwing after
        //    MAX_GENERATION_ATTEMPTS); testing each placement against the
        //    same validation the constructor applies rejects severing spikes
        //    at the source instead.
        // 2. Marker-site survival: a spike that strips the last deployable
        //    enemy site forces whole-map rejection by the constructor's
        //    deployed-spawn guard — on vertical level 13 that coupling burned
        //    ~6% of construction budgets. Requiring one surviving site per
        //    accepted placement measured 0/400 exhaustion (was 22-48/400).
        // Bounded by the candidate list, like everything else here. Evaluated
        // in canonical right-facing space: 'left' mirrors afterwards and the
        // movement model is symmetric in x, so a mirrored route mirrors its
        // validation exactly.
        const placementSafe = () => {
            const reachable = computeReachable(
                tiles, this.width, this.height, spawn, headroom,
                this.bridgeGap, this.shaftGap);
            let portalBand = false;
            for (const key of reachable) {
                const x = key % this.width;
                const y = Math.floor(key / this.width);
                // Shared with pickPortalTile through the canonical-band
                // predicate: one spelling of the band numbers, so a future
                // change cannot void this safety net while it reports
                // success. Canonical (pre-mirror) space is required here —
                // 'left' mirrors only after generateLevel returns.
                if (this.inCanonicalPortalBand(x, y)) {
                    portalBand = true;
                    break;
                }
            }
            if (!portalBand) return false;
            for (const key of reachable) {
                if (this.isMarkerSite(
                    tiles, key % this.width,
                    Math.floor(key / this.width), reachable)) {
                    return true;
                }
            }
            return false;
        };

        let placed = 0;
        const usedColumns = new Set();
        // Threat isolation: a jump travels ~142px (4+ tiles) with no air
        // control, so hazards closer together than a full arc force chained
        // frame-perfect takeoffs (playtest bot + human reports agreed this
        // reads as unfair, not hard). Each spike claims THREAT_SPACING
        // columns on both sides against every other spike.
        const THREAT_SPACING = 4;
        for (const c of candidates) {
            if (placed >= target) break;
            // shortcut: on heavily fragmented advanced-tier maps fewer safe
            // sites exist than the target count, so realized spike density
            // runs below target there; presence is guaranteed by the
            // constructor's zero-spike rejection instead.
            let blocked = false;
            for (let dx = -THREAT_SPACING; dx <= THREAT_SPACING && !blocked; dx++) {
                if (usedColumns.has(c.x + dx)) blocked = true;
            }
            if (blocked) continue;
            tiles[c.y][c.x] = 2;
            if (placementSafe()) {
                for (let dx = -THREAT_SPACING; dx <= THREAT_SPACING; dx++) {
                    usedColumns.add(c.x + dx);
                }
                placed++;
            } else {
                tiles[c.y][c.x] = 0;
            }
        }
    }

    // True when cell (x,y) is a painted canyon-canopy cell (canonical space
    // while generating; see exposeCeilingSpans). Empty list everywhere else.
    inCeilingCell(x, y) {
        const spans = this.ceilingSpans;
        if (!spans || spans.length === 0) return false;
        for (const s of spans) {
            if (x >= s.x0 && x <= s.x1 && y >= s.yTop && y <= s.yBot) {
                return true;
            }
        }
        return false;
    }

    // Single-cell enemy marker site predicate, shared by placeEnemyMarkers'
    // candidate scan and placeSpikes' keep-if-harmless gate (I2): allowed
    // coordinate band (rows on vertical), air on solid ground, off the
    // constructed route, reachable in the given set, and a patrol span of at
    // least two columns after clamping to the direction's band — one column
    // would spawn a body that fits its bounds exactly and never moves. One
    // spelling so the gate cannot drift from placement while both report
    // success (same reasoning as deriveEnemySpawns sharing spawnEnemies).
    isMarkerSite(tiles, x, y, reachable, opts = {}) {
        if (!this.hazardPlacementAllowed(
            this.direction === 'vertical' ? y : x)) {
            return false;
        }
        // Forced-boarding fairness (deck bridges): no enemy site within two
        // columns of either lip — a hostile patrolling the approach to a
        // REQUIRED boarding point is an ambush on a move the player cannot
        // skip (shelf ruling lineage). The corridor columns themselves can
        // never host a site anyway (no solid support beneath them), so this
        // window closes the whole approach. Evaluated in canonical space
        // during generation; deployed markers mirror with the grid.
        if (this.bridgeGap &&
            x >= this.bridgeGap.a - BRIDGE_LIP_BAN_COLS &&
            x <= this.bridgeGap.b + BRIDGE_LIP_BAN_COLS) {
            return false;
        }
        // Forced-boarding fairness (elevator shafts): no enemy site in the
        // stop-ledge approach windows — a hostile at a REQUIRED ride's
        // boarding point is the same ambush the bridge lip ban exists for.
        if (this.inShaftWindow(x, y)) return false;
        if (tiles[y][x] !== 0 || tiles[y + 1][x] !== 1) return false;
        // Canyon canopy tops are no patrol ground: overhead rock measured
        // +47% deployed enemies on canyon maps, every extra body walking a
        // roof slab one row over the corridor — unreachable, unstompable,
        // and a contact vector from a surface the fairness rules were never
        // sized for (hostile-shelf lineage). Corridor-floor surfaces around
        // and beneath the canopy stay fully legal.
        if (this.inCeilingCell(x, y + 1)) return false;
        if (this.pathCells && this.pathCells.has(y * this.width + x)) {
            return false;
        }
        if (!reachable.has(y * this.width + x)) return false;
        // Patrols must not share a walking surface with the climb route's
        // landing spots: a body one tile from a forced jump target is a
        // free death on the approach (same ruling as spike clearance).
        // Relaxed only by placeEnemyMarkers' fallback pass, which prefers
        // an adjacent patrol over throwing the whole construction.
        if (this.pathCells && !opts.allowRouteAdjacent) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                if (nx >= 0 && nx < this.width &&
                    this.pathCells.has(y * this.width + nx)) return false;
            }
        }
        // No spike-enemy ambush combos: a patrol standing next to a tooth
        // turns "dodge the enemy" into "land on the spike" (playtest bot:
        // this pairing alone accounted for every level-5 death). Checks the
        // marker row AND the row above it — a spike on the shelf beside the
        // patrol stands one row higher than the marker cell itself. THREAT_
        // SPACING matches placeSpikes' claim window: one jump decision at
        // a time, never a chained frame-perfect sequence.
        for (let dx = -4; dx <= 4; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= this.width) continue;
            if (tiles[y][nx] === 2) return false;
            if (y > 0 && tiles[y - 1][nx] === 2) return false;
        }
        const span = this.patrolSpan(tiles, x, y);
        if (!span) return false;
        const [bandMin, bandMax] = this.patrolBandBounds();
        // Strict sites patrol at least two columns. The fallback pass also
        // accepts a one-column shelf — a stationary enemy, which derive-
        // EnemySpawns deploys happily (it only needs a span) and the player
        // can see, wait out, or stomp. Starving these last sites is what
        // burned whole 200-attempt budgets on tight climb grids.
        const minSpan = opts.allowRouteAdjacent ? 1 : 2;
        return Math.min(span.right, bandMax) -
            Math.max(span.left, bandMin) + 1 >= minSpan;
    }

    placeEnemyMarkers(tiles) {
        // Same Phase 2 gate as spikes: no enemies below the tier boundary.
        if (!DIFFICULTY.hasPhase2Content(this.levelNumber)) return;

        // Tier cap from difficulty.js is the single source of truth. Per spec
        // Difficulty Parameters the cap intentionally allows growth on
        // advanced levels: target rises past the old constant 5 from level 12
        // toward the cap of 8.
        const target = Math.min(
            DIFFICULTY.getMaxEnemies(this.levelNumber),
            Math.floor(this.levelNumber / 2)
        );

        // Markers need a standable air tile whose FREE patrol span beneath
        // is at least 3 columns wide, so every spawned enemy gets a real
        // walkable patrol (patrolSpan: rock and spikes on the walk row end
        // a run; support alone does not make one). The direction's spawn
        // zone and portal band are both excluded (see
        // hazardPlacementAllowed); markers never overwrite spike tiles
        // (those are no longer air), and vertical route cells are off
        // limits: an enemy sweeping a jump-off/landing cell makes the only
        // validated climb periodically lethal with no stomp mechanic (S10).
        // isMarkerSite adds reachability (I2): deriveEnemySpawns drops
        // unreachable markers, so placing on one buys a raw marker count
        // while the guard demands deployed spawns — on vertical maps every
        // marker could land on an off-route ledge and burn the whole
        // 200-attempt budget. Requiring reach here makes placed ≈ deployed.
        const collectSites = (allowRouteAdjacent) => {
            const sites = [];
            for (let y = 0; y < this.height - 1; y++) {
                for (let x = 0; x < this.width; x++) {
                    if (this.isMarkerSite(tiles, x, y,
                        this.generationReachable, { allowRouteAdjacent })) {
                        sites.push({ x, y });
                    }
                }
            }
            return sites;
        };
        let candidates = collectSites(false);

        shuffle(candidates, this.rng);

        let placed = 0;
        for (const c of candidates) {
            if (placed >= target) break;
            tiles[c.y][c.x] = 4;
            placed++;
        }
        if (placed === 0 && this.pathCells) {
            // Fallback pass on climb maps: an enemy adjacent to the route
            // beats a construction throw (the guard demands deployed
            // spawns; strict fairness can starve on tight late-level grids).
            candidates = collectSites(true);
            shuffle(candidates, this.rng);
            for (const c of candidates) {
                if (placed >= Math.min(target, 1)) break;
                tiles[c.y][c.x] = 4;
                placed++;
            }
        }
    }

    // Portal band in canonical right-facing space — the space generateLevel
    // (and therefore placeSpikes' keep-if-harmless validation) operates in,
    // before the 'left' column flip. The single spelling of the band numbers;
    // horizontal bands avoid the extreme edge column (design doc: portal is
    // "not placed at extreme edges"); the vertical band is the top rows
    // (y <= VERTICAL_PORTAL_MAX_Y), reachable only via the ledge chain.
    inCanonicalPortalBand(x, y) {
        return this.direction === 'vertical'
            ? y <= VERTICAL_PORTAL_MAX_Y
            : x >= this.width - 4 && x <= this.width - 2;
    }

    // Band as consumed by pickPortalTile on the final (post-mirror) grid:
    // 'left' mirrors [w-4, w-2] to [2, 4].
    inPortalBand(x, y) {
        switch (this.direction) {
            case 'left':
                return x >= 2 && x <= 4;
            default:
                return this.inCanonicalPortalBand(x, y);
        }
    }

    pickPortalTile() {
        const candidates = [];
        for (const key of this.reachableTiles) {
            const x = key % this.width;
            const y = Math.floor(key / this.width);
            if (x === this.spawnTile.x && y === this.spawnTile.y) {
                continue;
            }
            if (this.inPortalBand(x, y)) {
                candidates.push({ x, y });
            }
        }

        if (candidates.length === 0) {
            return null;
        }
        return candidates[Math.floor(this.rng() * candidates.length)];
    }

    extractPlatforms() {
        const platforms = [];

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.tiles[y][x] === 1) {
                    platforms.push({
                        x: x * this.tileSize,
                        y: y * this.tileSize,
                        width: this.tileSize,
                        height: this.tileSize,
                        type: 'solid'
                    });
                }
            }
        }

        return platforms;
    }

    extractCoins() {
        // Uncapped this ramp reads 104 coins at L99 — more reachable tiles
        // than late maps offer on some rolls, and pure noise against the
        // 20% density spec. Plateaued at COIN_TARGET_CAP (see constant).
        const target = Math.min(
            Math.max(5 + this.levelNumber, 5),
            COIN_TARGET_CAP
        );
        const coins = [];
        const used = new Set();

        const spawnKey = this.spawnTile.y * this.width + this.spawnTile.x;
        const portalKey = this.portalTile
            ? this.portalTile.y * this.width + this.portalTile.x
            : -1;

        // Only place coins on tiles the player can actually reach — and
        // never under an enemy patrol: the game loop's death check precedes
        // collection, so a coin inside a sweep is bait for a kill (before
        // this exclusion ~18% of coins sat on the enemy's own marker tile).
        const patrolCovered = new Set();
        for (const s of this.deriveEnemySpawns()) {
            for (let cx = s.left; cx <= s.right; cx++) {
                patrolCovered.add(s.y * this.width + cx);
            }
        }
        const spikeNear = (x, y) => {
            for (let dy = -COIN_SPIKE_MARGIN; dy <= COIN_SPIKE_MARGIN; dy++) {
                for (let dx = -COIN_SPIKE_MARGIN; dx <= COIN_SPIKE_MARGIN; dx++) {
                    const cx = x + dx;
                    const cy = y + dy;
                    if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height &&
                        this.tiles[cy][cx] === 2) {
                        return true;
                    }
                }
            }
            return false;
        };
        const candidates = [];
        for (const key of this.reachableTiles) {
            if (key === spawnKey || key === portalKey) continue;
            if (patrolCovered.has(key)) continue;
            const x = key % this.width;
            const y = Math.floor(key / this.width);
            candidates.push({ x, y, safe: !spikeNear(x, y) });
        }

        // Fisher-Yates shuffle: bounded, no unbounded random retry loop.
        shuffle(candidates, this.rng);

        const addCoin = (x, y) => {
            const key = y * this.width + x;
            if (used.has(key)) return false;
            used.add(key);
            coins.push({
                x: x * this.tileSize,
                y: y * this.tileSize,
                width: 16,
                height: 16,
                collected: false
            });
            return true;
        };

        // Safe candidates first; only if they cannot fill the target does
        // the margin relax (a slightly exposed coin beats an uncollectable
        // shortfall against the all-coins gate).
        for (const tile of candidates) {
            if (coins.length >= target) break;
            if (tile.safe) addCoin(tile.x, tile.y);
        }
        for (const tile of candidates) {
            if (coins.length >= Math.min(target, 5)) break;
            addCoin(tile.x, tile.y);
        }

        // No unreachable-tile fallback: it was unreachable-by-construction
        // dead code. Every direction forces a walk-connected band of at
        // least six standable tiles (the x < 6 flat spawn zone on
        // horizontal maps; the full-width standing row above the ground
        // band on vertical maps), and the constructor only accepts a level
        // once pickPortalTile found a reachable tile distinct from spawn.
        // Candidates therefore always number >= 6, past the 5-coin floor —
        // anything the old fallback could add would sit outside
        // reachableTiles, i.e. an uncollectable coin.
        // Spec §Error Handling (Difficulty Scaling): coin placement must not
        // exceed 20% of level tiles. Current tuning can't approach that
        // (target ≤ 20 coins on ≥300-tile grids; observed worst ~3.4%), so
        // this guards future retuning: warn and trim to the cap rather than
        // ship a broken-density level.
        const densityCap = Math.floor(this.width * this.height * 0.2);
        if (coins.length > densityCap) {
            console.warn('Coin density exceeds 20% of level tiles:',
                coins.length, '>', densityCap, '- trimming');
            coins.length = densityCap;
        }
        return coins;
    }

    countTilesOfType(type) {
        let n = 0;
        for (const row of this.tiles) {
            for (const t of row) {
                if (t === type) n++;
            }
        }
        return n;
    }

    extractHazards() {
        // Re-extraction replaces the list so repeated calls stay idempotent.
        this.hazards.clear();

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.tiles[y][x] === 2) {
                    this.hazards.addSpike(x * this.tileSize, y * this.tileSize);
                }
            }
        }
    }

    spawnEnemies() {
        // Re-spawning replaces the list so repeated calls stay idempotent.
        this.enemyManager.clear();

        // Derived fresh from the current grid every call (never cached):
        // bounds come from walkable patrol spans clamped to the direction's
        // band, so no patrol ever sweeps the spawn tile or the portal band,
        // and none walks through rock or spikes.
        const spawns = this.deriveEnemySpawns();

        // Kind assignment rides the SAME marker sites/spans as walkers —
        // placement fairness rules are untouched, only what stands on a site
        // varies. Rolls consume this.rng here, AFTER every geometry, spike,
        // marker, portal and coin consumption in the constructor has
        // finished (spawnEnemies is the last rng consumer and affects no
        // grid cell), so generation streams stay byte-identical and same
        // seed still replays the exact map AND the exact kind sequence.
        const spinyChance = kindChance(
            this.levelNumber, SPINY_FIRST_LEVEL, SPINY_RAMP_LEVELS,
            SPINY_CHANCE_MAX);
        const chargerChance = kindChance(
            this.levelNumber, CHARGER_FIRST_LEVEL, CHARGER_RAMP_LEVELS,
            CHARGER_CHANCE_MAX);
        const spinyCap = Math.ceil(spawns.length / SPINY_CAP_DIVISOR);
        let spinies = 0;

        for (const s of spawns) {
            let kind = 'walker';
            const roll = this.rng();
            if (roll < spinyChance && spinies < spinyCap) {
                kind = 'spiny';
            } else if (roll >= spinyChance &&
                roll < spinyChance + chargerChance) {
                kind = 'charger';
            }
            // Shelf fairness gate (see HOSTILE_MIN_RUN): a hostile roll on a
            // narrow pillar demotes to walker — stomp-immune patrols on runs
            // <= 3 tiles make mandatory landings unwinnable (screenshot
            // ruling 2026-11-03). Demotion follows the SAME no-re-roll
            // discipline as cap overflow below: one consumed draw per
            // enemy, so rng stream ORDER stays identical; legal-site
            // kinds may still shift because the spiny cap counts
            // DEPLOYED spinies (the header's "of the deployed enemies")
            // — a demoted roll frees its budget slot for a later site.
            if (kind !== 'walker' && solidRunWidth(
                this.tiles, this.width, s.x, s.y + 1) < HOSTILE_MIN_RUN) {
                kind = 'walker';
            }
            if (kind === 'spiny') spinies++;
            // Cap overflow falls through to walker: the roll that wanted a
            // fourth spiny on a three-site map buys nothing, never a
            // re-roll (one consumed draw per enemy keeps sequences stable).
            // Same placement convention as the player spawn point: the
            // body rests inside the standable air tile, its bottom edge
            // on the solid tile below.
            this.enemyManager.addEnemy(
                s.x * this.tileSize,
                s.y * this.tileSize,
                s.left * this.tileSize,
                (s.right + 1) * this.tileSize,
                kind
            );
        }
    }

    // First solid row of a column, or null when the column is entirely air
    // (a pit on the heightmap). Moving-platform flank measurement.
    columnTopRow(x) {
        for (let y = 0; y < this.height; y++) {
            if (this.tiles[y][x] === 1) return y;
        }
        return null;
    }

    /**
     * Hard validation of the declared bridge corridor against the FINAL
     * grid (post-mirror), run inside the constructor's validity loop so a
     * broken bridge rejects the whole construction instead of shipping a
     * soft-locked required crossing:
     *  - exactly one gap per map, width within [MIN_DECK_GAP, MAX_DECK_GAP]
     *    (> the physical jump envelope — see the MIN_DECK_GAP WHY-comment);
     *  - flanks EXACTLY flush at row S (a far flank one row lower makes
     *    even a 6-wide pit coyote-jumpable per Step 0);
     *  - pure void pit: every cell of every gap column, top to bottom, is
     *    air — no solids, no spike support, nothing to land on;
     *  - spawn and portal outside the corridor columns.
     * Maps without a bridge (roll missed, vertical, or L1..7) pass trivially.
     */
    bridgeIntact() {
        const g = this.bridgeGap;
        if (!g) return true;
        const { a, b, S } = g;
        const w = b - a + 1;
        if (w < MIN_DECK_GAP || w > MAX_DECK_GAP) return false;
        if (S < 1 || S >= this.height) return false;
        if (this.columnTopRow(a - 1) !== S || this.columnTopRow(b + 1) !== S) {
            return false;
        }
        for (let x = a; x <= b; x++) {
            for (let y = 0; y < this.height; y++) {
                if (this.tiles[y][x] !== 0) return false;
            }
        }
        if ((this.spawnTile.x >= a && this.spawnTile.x <= b) ||
            (this.portalTile &&
                this.portalTile.x >= a && this.portalTile.x <= b)) {
            return false;
        }
        // Swept-volume legality (patrols / spawn / portal cells against the
        // deck's full shuttle band) is decided HERE, inside the retry loop,
        // so deriveMovingPlatforms at the constructor tail can never see a
        // different verdict and ship a validated bridge without its deck.
        return this.movingDeckLegal(a, b, S);
    }

    /**
     * Descriptor pass for deck bridges AND elevator cabins (see the
     * DECK_BRIDGE_* and ELEVATOR_* constant headers). Runs LAST so speed/
     * phase draws consume rng only after every geometry/marker/portal/coin/
     * kind stream — schedule-only noise, never terrain noise. Exactly one
     * shuttle per map (caps MAX_DECK_BRIDGES / MAX_SHAFTS); the swept volume
     * is re-checked like any deck candidate before shipping (defense-in-
     * depth over bridgeIntact/shaftIntact: patrols, spawn/portal cells).
     * Collision height is a full tile while the drawn plank is ~half that:
     * at max fall speed 600 px/s against the 0.05 s dt cap a body sinks
     * ~30 px/frame, and a half-tile collider would risk tunnelling straight
     * through a falling player. For axis 'v' the min/max bounds are pixel-
     * exact flush with the stop ledges (min = top ledge surface, max =
     * bottom ledge surface), and BOTH stops hold for DECK_DWELL_S.
     */
    deriveMovingPlatforms() {
        const out = [];
        if (this.direction === 'vertical') {
            const g = this.shaftGap;
            if (!g) return out;
            if (!this.shaftLegal(g.sx, g.A, g.B)) return out;
            const T = this.tileSize;
            const speed = V_DECK_SPEED_MIN + this.rng() * V_DECK_SPEED_RANGE;
            const phase = this.rng();
            out.push({
                x: g.sx * T,
                y: g.A * T,
                width: SHAFT_COLS * T,
                height: T,
                axis: 'v',
                min: g.A * T,
                max: g.B * T,
                speed,
                phase,
                dwell: DECK_DWELL_S,
                vx: 0,
                vy: 0
            });
            return out.slice(0, MAX_SHAFTS);
        }
        const g = this.bridgeGap;
        if (!g) return out;
        const T = this.tileSize;
        const S = Math.max(this.columnTopRow(g.a - 1), this.columnTopRow(g.b + 1));
        if (!this.movingDeckLegal(g.a, g.b, S)) return out;
        const speed = MP_SPEED_MIN + this.rng() * MP_SPEED_RANGE;
        const phase = this.rng();
        out.push({
            x: g.a * T,
            y: S * T,
            width: MP_DECK_TILES * T,
            height: T,
            axis: 'h',
            min: g.a * T,
            max: (g.b + 1) * T - MP_DECK_TILES * T,
            speed,
            phase,
            dwell: DECK_DWELL_S,
            vx: 0,
            vy: 0
        });
        return out.slice(0, MAX_DECK_BRIDGES);
    }

    // Swept-volume legality for one gap candidate [a..b] with flush flank
    // top row S (deck occupies rows S..S+1 across the gap for its whole
    // shuttle). Returns false on any contact with terrain, teeth, patrols,
    // spawn or portal — such candidates never ship.
    movingDeckLegal(a, b, S) {
        const inGrid = (cx, cy) => cx >= 0 && cx < this.width &&
            cy >= 0 && cy < this.height;
        // Deck band + clearance above it must be pure air across the sweep.
        for (let cx = a; cx <= b; cx++) {
            for (let cy = S; cy <= S + 1; cy++) {
                if (!inGrid(cx, cy) || this.tiles[cy][cx] !== 0) return false;
            }
            for (let cy = S - MP_CLEARANCE_ROWS; cy < S; cy++) {
                if (!inGrid(cx, cy) || this.tiles[cy][cx] !== 0) return false;
            }
        }
        // No patrol may sweep the deck's rows within the gap columns.
        const overlapsX = (l, r, l2, r2) => l < r2 && l2 < r;
        for (const s of this.deriveEnemySpawns()) {
            if ((s.y === S || s.y === S + 1) &&
                overlapsX(s.left, s.right + 1, a, b + 1)) {
                return false;
            }
        }
        // Spawn and portal cells stay clear of the swept volume.
        for (const cell of [this.spawnTile, this.portalTile]) {
            if (cell && cell.x >= a && cell.x <= b &&
                (cell.y === S || cell.y === S + 1)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Hard validation of the declared elevator shaft against the FINAL grid,
     * run inside the constructor's validity loop so a broken shaft rejects
     * the whole construction instead of shipping a soft-locked required
     * climb (the vertical analogue of bridgeIntact):
     *  - vertical maps only, never below ELEVATOR_FIRST_LEVEL, exactly one
     *    shaft per map (single descriptor field), lift within
     *    [MIN_SHAFT_LIFT, MAX_SHAFT_LIFT] (> the measured physical apex —
     *    see the MIN_SHAFT_LIFT WHY-comment);
     *  - chimney purity: rows 0..B+1 across both columns are pure air — no
     *    solids, no spike support, no footholds (nothing to climb instead
     *    of riding, and one pocket-free row under the parked cabin);
     *  - barrier slab continuous at row A (only breach = the chimney),
     *    bottom shelf full width at row B flush with the cabin extremes,
     *    boarding/egress stands air with clear heads;
     *  - approach windows marker/spike-free after every placement pass;
     *  - spawn and portal outside the chimney columns;
     *  - LOAD-BEARING: portal unreachable without the cabin corridor;
     *  - swept-volume legality (patrol bands vs cabin rows) via shaftLegal.
     * Maps without a shaft (roll missed, horizontal, or below-gate) pass
     * trivially.
     */
    shaftIntact() {
        const g = this.shaftGap;
        if (!g) return true;
        if (this.direction !== 'vertical') return false;
        if (this.levelNumber < ELEVATOR_FIRST_LEVEL) return false;
        const { sx, ex, A, B } = g;
        if (B - A < MIN_SHAFT_LIFT || B - A > MAX_SHAFT_LIFT) return false;
        if (sx < SHAFT_LEDGE_W || ex > this.width - 1 - SHAFT_LEDGE_W) {
            return false;
        }
        if (A < VERTICAL_PORTAL_MAX_Y + 2 || B > SHAFT_BOTTOM_MAX_ROW) {
            return false;
        }
        for (let y = 0; y <= B + 1; y++) {
            for (let cx = sx; cx <= ex; cx++) {
                if (this.tiles[y][cx] !== 0) return false;
            }
        }
        // Barrier slab continuous across row A except at the chimney, and
        // the bottom floor solid under both shaft flanks (flush stop
        // surfaces: top face of row A == cabin min, top face of row B ==
        // cabin max — pixel-exact by tile-row convention).
        for (let cx = 0; cx < this.width; cx++) {
            if (cx >= sx && cx <= ex) continue;
            if (this.tiles[A][cx] !== 1) return false;
        }
        // Bottom floor carries the full stop shelf (>= SHAFT_LEDGE_W stand
        // columns each side of the chimney — forgiving boarding), flush with
        // the cabin's bottom stop.
        for (const lx of shaftLedgeCols(sx, ex)) {
            if (this.tiles[B][lx] !== 1) return false;
        }
        // Boarding stands air with clear heads at both bottom flanks, and
        // at the egress flank on the slab top (the chain seam guarantees
        // that one side; the other may legitimately carry terrain).
        const side = shaftBoardSide(sx, this.width);
        for (const [row, col] of [
            [B - 1, sx - 1], [B - 2, sx - 1], [B - 1, ex + 1], [B - 2, ex + 1],
            [A - 1, side < 0 ? sx - 1 : ex + 1],
            [A - 2, side < 0 ? sx - 1 : ex + 1]
        ]) {
            if (this.tiles[row][col] !== 0) return false;
        }
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const t = this.tiles[y][x];
                if ((t === 2 || t === 4) && this.inShaftWindow(x, y)) return false;
            }
        }
        for (const cell of [this.spawnTile, this.portalTile]) {
            if (cell && cell.x >= sx && cell.x <= ex) return false;
        }
        // LOAD-BEARING requirement: without the cabin corridor the portal
        // must be UNREACHABLE — the shaft carries the route, mirroring how
        // MIN_DECK_GAP makes a bridge pit unjumpable. The barrier slab plus
        // foothold-free chimney is the structural guarantee; this plain BFS
        // proves it against the final grid (same headroom rule as the
        // constructor's pass). A terrain bypass rejects the construction.
        const plain = computeReachable(
            this.tiles, this.width, this.height, this.spawnTile, true,
            null, null);
        if (this.portalTile &&
            plain.has(this.portalTile.y * this.width + this.portalTile.x)) {
            return false;
        }
        return this.shaftLegal(sx, A, B);
    }

    // Cabin swept-volume legality for the shaft spanning columns sx..sx+1
    // with rider/cabin rows A-1..B: no patrol may cross the chimney at those
    // rows, and spawn/portal cells stay clear of the swept band. Decided
    // inside the retry loop (via shaftIntact) and re-checked defensively by
    // deriveMovingPlatforms, mirroring movingDeckLegal.
    shaftLegal(sx, A, B) {
        const overlapsX = (l, r, l2, r2) => l < r2 && l2 < r;
        for (const s of this.deriveEnemySpawns()) {
            if (s.y >= A - 1 && s.y <= B &&
                overlapsX(s.left, s.right + 1, sx, sx + SHAFT_COLS)) {
                return false;
            }
        }
        for (const cell of [this.spawnTile, this.portalTile]) {
            if (cell && cell.x >= sx && cell.x <= sx + SHAFT_COLS - 1 &&
                cell.y >= A - 1 && cell.y <= B) {
                return false;
            }
        }
        return true;
    }

    getSpawnPoint() {
        return this.spawnPoint;
    }

    getPlatforms() {
        return this.platforms;
    }

    // Descriptor list for optional traversal decks ([] when none). Live
    // positions/velocities live in main.js's MovingPlatformManager, built
    // fresh per published level from these descriptors.
    getMovingPlatforms() {
        return this.movingPlatforms;
    }

    getCoins() {
        return this.collectibles.getCoins();
    }

    getCollectibles() {
        return this.collectibles;
    }

    getHazards() {
        return this.hazards;
    }

    getEnemyManager() {
        return this.enemyManager;
    }

    getPortal() {
        return this.portal;
    }

    hasValidPath() {
        if (!this.portalTile || !this.reachableTiles) {
            return false;
        }
        const key = this.portalTile.y * this.width + this.portalTile.x;
        return this.reachableTiles.has(key);
    }

    // Optional `sprites`: when the Kenney sheets are loaded, terrain tiles
    // and spikes come from Game's culled grid pass (Sprites.drawWorld) and
    // this method only owns entities; without them every element falls back
    // to the legacy flat-shape renderer (tests, missing files).
    draw(ctx, sprites = null) {
        const art = sprites && sprites.ready();

        if (!art) {
            // Draw platforms
            ctx.fillStyle = '#8B4513'; // Brown

            for (const platform of this.platforms) {
                ctx.fillRect(platform.x, platform.y, platform.width, platform.height);

                // Add platform border
                ctx.strokeStyle = '#654321';
                ctx.lineWidth = 2;
                ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
            }
        }

        // Draw coins
        if (art) {
            sprites.drawCoins(ctx, this.coins);
        } else {
            ctx.fillStyle = '#FFD700'; // Gold

            for (const coin of this.coins) {
                if (!coin.collected) {
                    ctx.beginPath();
                    ctx.arc(coin.x + coin.width / 2, coin.y + coin.height / 2, 8, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Draw hazards (spikes). Art path: the tooth tile was painted by
        // drawWorld straight from the grid — nothing left to do here.
        if (!art) {
            ctx.fillStyle = '#ff4444';

            for (const spike of this.hazards.getSpikes()) {
                ctx.beginPath();
                ctx.moveTo(spike.x, spike.y + spike.height);
                ctx.lineTo(spike.x + spike.width / 2, spike.y);
                ctx.lineTo(spike.x + spike.width, spike.y + spike.height);
                ctx.fill();
            }
        }

        // Draw enemies (EnemyManager owns per-enemy drawing).
        this.enemyManager.drawAll(ctx, sprites);

        // Draw portal; ghosted until the all-coins gate is met.
        if (art) {
            sprites.drawPortal(ctx, this.portal, this.collectibles.meetsPortalRequirement());
        } else if (this.portal && this.collectibles.meetsPortalRequirement()) {
            ctx.fillStyle = '#9400D3'; // Purple

            ctx.fillRect(
                this.portal.x,
                this.portal.y,
                this.portal.width,
                this.portal.height
            );

            // Portal border
            ctx.strokeStyle = '#DA70D6';
            ctx.lineWidth = 3;
            ctx.strokeRect(
                this.portal.x,
                this.portal.y,
                this.portal.width,
                this.portal.height
            );
        }
    }
}

// Verification-harness hook for canyonRouteFair (see its comment): sweeps
// assign a function (level) => boolean that answers "is the portal reachable
// from spawn using ONLY physics-simulated landed edges (plus trusted deck /
// lift crossings and harvested grounded landings)?" Runtime play leaves it
// unset, keeping the shipped module zero-dependency.
Level.physRoute = null;
