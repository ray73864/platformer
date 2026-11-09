import { Collectibles } from './collectibles.js';
import { Difficulty, PHASE2_FIRST_LEVEL, tierIndexFor } from './difficulty.js';
import { EnemyManager, ENEMY_WIDTH } from './enemies.js';
import { Hazards } from './hazards.js';
import { Physics, aabbOverlap } from './physics.js';
import { Player } from './player.js';
import { ProjectileManager } from './projectiles.js';
import { PAD_APEX_CELLS } from './pads.js';

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
// Bombardier (player request 2026-11-04: "enemies that charge and shoot :)",
// gated deep like the charger's grandchild): arrives at L40 — past every
// melee threat's ramp, because its ranged leg punishes the *standing still*
// habits the earlier kinds teach, and ramps to ~15% by L60 (mirrors the
// kindChance pattern; gentler plateau than spiny/charger because it is a
// DUAL threat — every one of its rolls can open two attack lanes).
const BOMBARDIER_FIRST_LEVEL = 40;
const BOMBARDIER_RAMP_LEVELS = 21;   // L40..L60 inclusive reach the plateau
const BOMBARDIER_CHANCE_MAX = 0.15;
// Own density cap: max ceil(n/4) bombardiers per map (on top of counting as
// HOSTILE for runW>=4, one-per-support-run and the approach-window bans).
// WHY tighter than the spiny cap (ceil(n/3)): a gun extends its threat from
// its own body to an 8-column lane, so four guns on one screen can cover
// most of a shelf map simultaneously — the "wall not challenge" reasoning
// behind SPINY_CAP_DIVISOR applies with extra force. ACCOUNTING ORDER (kept
// consistent with the spiny cap, pinned by tests): caps count DEPLOYED
// survivors, measured against legalSpawns.length sites; the roll bands are
// checked BEFORE the demotion gates, and every demotion (narrow run, buried
// firing lane, shared run) falls through to walker WITHOUT re-rolling and
// WITHOUT consuming its cap slot — so a bombardier roll blocked by ANY gate
// leaves both budgets exactly as if the roll had landed on walker. Gates
// run narrow-run -> firing-lane -> shared-run so a site demoted by the
// lane rule never claims the run key a later legal hostile could use.
const BOMBARDIER_CAP_DIVISOR = 4;
// A map of pure spinies is a wall, not a challenge (no stompable route
// through a gauntlet you can only outrun): cap spinies at ceil(n/3) of the
// deployed enemies per map.
const SPINY_CAP_DIVISOR = 3;
// --- Spiny debut on-ramp (difficulty-curve wave 2026-11-06) -----------------
// During the debut window [SPINY_FIRST_LEVEL .. SPINY_ONRAMP_LAST_LEVEL]
// hostile rolls face an escalated shelf-width bar: HOSTILE_MIN_RUN_ONRAMP
// generally, HOSTILE_ROUTE_MIN_RUN_ONRAMP when the body's final span sweeps
// a MUST-PASS cell (routeModelEdges articulation cells — same computation as
// the gauntlet gate, shared here). Demotion to walker follows every existing
// no-re-roll discipline: terrain byte-identical, enemy COUNT per map
// unchanged (lethality swaps to spectacle), kinds never re-rolled — no
// promotions beyond the pre-existing cap-slot/run-key release semantics
// (level.js demotion block), which can flip a WALKER into a hostile slot
// only after it passes these same stricter bars (observed 0/1040 review
// sample; self-limiting by construction).
// WHY (measured, fresh disjoint band s=lvl*40000+24601+i, L5..30 x 10 seeds):
// the round-2/round-3 browser curve reproduces a decade-2 wall (L11-20
// clears 1/10 r2 + 2/10 r3 vs 6/10 in decade 1), and the node-bot A/B at HEAD
// reproduces low teen win rates (horizontal first-try 12/70 vs decade-1
// 12/40). Attribution refuted the strong spiny hypothesis — first-death
// classes are spike 61% / walker-contact 36% / void 13% / spiny 4%, mostly
// OFF the must-pass route, and both spiny-dominant browser caps (r3 L15
// s3872247221, r2 L18 s3738974344) sat on runs 11/13 WITH waiting pockets
// (driver skill ceiling, not generator morphology). What DID confirm: every
// single spiny deployed in-window (15/15 over L10..16 x 30 seeds) stands on
// the mandatory traverse, and half of them on support runs < 6 — a stomp-
// immune debut guarding geometry the player cannot skip, at the exact tier
// step where enemy presence jumps 1.68 -> 2.95 -> 3.38 hostiles/map
// (L9/L10 -> L11 -> L12+, attribution table). The two pocket-based
// alternatives were MEASURED DEAD (zero-pocket approach configs: 0 hits;
// off-route-only would ship zero debut spinies because the marker economy
// rides routes). This window is the minimum that graduates debut exposure:
// post-rule, sampled in-window spinyOnMP drops from 100% to 53% and every
// surviving route guard sits on >= 8 columns (double the steady-state pass-
// by arc). Window end 18 covers the measured tail (node patrol:spiny deaths
// at L17, r2 cap at L18); past it the linear chance ramp continues untouched.
// Honest limit: this smooths the DEBUT MORPHOLOGY, not the density step —
// the latter is protected by the decade-2 presence floor (±15%) ruling.
const SPINY_ONRAMP_LAST_LEVEL = 18;
const HOSTILE_MIN_RUN_ONRAMP = 6;      // was HOSTILE_MIN_RUN (4) in-window
const HOSTILE_ROUTE_MIN_RUN_ONRAMP = 8; // route-sweeping hostiles in-window
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
// Joint-hostile shelf rule (player reports 2026-11-04, screenshots L34 day
// band + L23 dusk band): at most ONE hostile (spiny|charger) may deploy per
// contiguous solid support run. WHY: a hostile patrols its whole run by
// construction (patrolSpan clamps at ledges), so two hostiles on one run are
// a moving lethal carpet with no timing window — HOSTILE_MIN_RUN=4 sizes the
// pass-by arc for exactly ONE body (see above); a second body removes the
// wait-for-the-far-bound room the ruling depends on. The leak was structural:
// placeEnemyMarkers has NO inter-marker spacing rule (the ±4 THREAT_SPACING
// claim covers spike-vs-spike only; isMarkerSite vetoes spikes within ±4 but
// never other markers), and every kind gate is PER SITE, so each hostile on
// a wide run passed individually. Attribution sweep @8802355, L5..100 x 10
// seeds: 216/960 maps (22.5%) deployed >=2 hostiles sharing one run (493
// pairs); blocking the shared surface under computeReachable proves 79 of
// those runs MANDATORY (portal disconnects) — the reported unwinnable class.
// Walkers stay exempt: stompable/dodgeable, sharing is fair play. Adjacent-
// run chains were measured too: ZERO of 960 maps had two distinct hostile-
// bearing runs jointly cutting the route (gap <=2 cols, simultaneous surface
// block disconnects while neither alone does), so no cross-run separation
// constant is introduced — revisit only if new data shows chains biting
// on-route after this rule lands.
// Player ruling 2026-11-04: "Enemies that are on a single tile wide block
// just bounce back and forth really super fast, I don't think they should be
// able to spawn on a single wide block." The vibration is exact arithmetic:
// a 32px body inside bounds [x*32,(x+1)*32] has ZERO px of travel, so
// _patrolStep clamp-flips its heading every frame (sprite shivers in place
// at frame rate). Repro sweep L5..100 x 10 seeds at HEAD f18725e: 419/3268
// deployed enemies (12.8%) across 409/960 maps (42.6%) ended with final
// bounds narrower than one tile of travel. Leak paths measured: 165 shaft
// approach-window clamps + 70 bridge-lip clamps + 38 patrol-band clamps in
// deriveEnemySpawns (a legal >=2-column site shrinks to its own column when
// a fairness window clips it), plus 146 raw single-column markers from
// isMarkerSite's route-adjacent fallback pass (minSpan=1) and post-marker
// motif edits. EVERY deployed enemy of EVERY kind now requires BOTH a solid
// support run >= ENEMY_MIN_RUN under the spawn column AND >= one full tile
// of travel between its FINAL (post-clamp) bounds; illegal sites are dropped
// before any kind roll (see spawnEnemies' stream note).
const ENEMY_MIN_RUN = 2;

// --- Stacked-patrol gauntlets: individually-legal placements that jointly
// wall a mandatory traverse -----------------------------------------------
// Player report 2026-11-05: L30 seed 4104669369 stuck "because of where the
// purple enemy is positioned". Machine proof: the kind-aware autopilot died
// attempts there (~25 patrol deaths per run) — every rule passed PER SITE
// (ENEMY_MIN_RUN ✓, HOSTILE_MIN_RUN ✓ spiny's run is 4-wide, one hostile
// per run ✓, firing-lane n/a), but JOINTLY three stacked shelves (staging
// walkers above, walker+SPINY+walker on the mandatory middle shelf, walkers
// on the landing below) left ZERO uncovered standable cells near the route:
// every pause point patrolled, every landing hot.
// WHY 3 (GAUNTLET_MIN_BODIES): two bodies sweeping one walk-row always
// leave a timing gap a waiting player can exploit on runs >= 2 (the pass-by
// ruling at HOSTILE_MIN_RUN); the third body removes the last wait-in-the-
// open option when the neighborhood has no uncovered pocket. Measured
// attribution sweep (this wave, L5..100 x 10 seeds, shipped metric below):
// 101/960 maps (10.5%; 101/640 = 15.8% of routed horizontal maps) host
// >=1 gauntlet configuration — canyon 31.1%, hills 28.5%, archipelago
// 14.6%, standard 6.3%, pillars 3.3% (the staggered-shelf hypothesis did
// NOT hold: pillars is LOW; wide-stair motifs are the manufacturers),
// atrium/terraces/zigzag 0%. Bot validation (20 flagged + 20 motif-matched
// controls, deterministic single attempt each): flagged-with-hostile cleared
// 1/17 vs control 3/20, and 8 of 13 patrol deaths on flagged maps landed
// INSIDE a flagged box averaging only 2.4% of map area — the geometry
// predicts the pain site, not just density. Walkers-only flags (1/3 cleared)
// sit in noise, but the pre-roll check cannot see kinds (it runs BEFORE the
// rolls by design), so the gate is kind-blind: any >=3-body zero-pocket
// stack on a must-pass neighborhood drops its last-completing site. Density
// cost measured in the wave report; do NOT loosen to protect density.
// SUPERSESSION of the 3348d60 Rule-2 deferral: that note (see
// HOSTILE_MIN_RUN above) deferred adjacent-run separation because
// hostile+hostile joint-mandatory chains measured 0/960. That measurement
// scoped TWO HOSTILES only; this MIXED-kind, stacked-row class measures
// 101/960 with bot-depressed clears — the deferral rationale no longer
// holds for this class, and this rule closes exactly it (cross-run
// neighborhoods rows ±1, spans overlapping ±1), while pure hostile+hostile
// pairs remain covered by the one-hostile-per-run rule.
// The metric (exported below, unit-tested on hand-built fixtures):
//   A support run R hosting deployed bodies is a GAUNTLET when
//   (a) the neighborhood box (enemy stand rows ±1, R's span columns ±2)
//       contains a MUST-PASS cell — a cell whose removal disconnects
//       spawn->portal in the movement-model graph (routeModelEdges), i.e.
//       the traverse under threat is genuinely mandatory;
//   (b) UNCOVERED standable reachable cells inside the box number ZERO —
//       coverage is row-exact: cell (c,r) is covered iff a group enemy
//       standing on row r sweeps column c (a patrol on another row does not
//       make this cell lethal); the group is R's own bodies plus bodies on
//       runs in rows ±1 whose patrol intervals overlap R's span ±1; and
//   (c) the group totals >= GAUNTLET_MIN_BODIES.
// Known approximation (honest): static spans, no phase/timing-gap modeling
// (a cell is treated as unsafe for the whole patrol period). This mirrors
// the house style of the shelf rulings (patrolSpan bounds every body;
// HOSTILE_MIN_RUN sizes ONE body's pass-by arc statically) and errs toward
// flagging. Vertical maps are exempt here: the model graph cannot see shaft
// rides (their virtual corridor is invisible to routeModelEdges). EXPOSURE
// OF THAT EXEMPTION MEASURED 2026-11-06 (shaft-fairness wave; scratch mirror
// of routeModelEdges WITH virtual shaft edges per computeReachable's rider
// conventions; 886 fresh-seed shaft maps L13..100, seeds lvl*10000+1000+i):
// blind must-pass is NULL on 886/886 — shafts are load-bearing, so today's
// exempt filter sees no mandatory traverse on any shaft map — while the
// shaft-aware graph finds 12..17 must-pass cells per map (outside the
// patrol-ban window on 757/886) and 627/886 maps host an enemy neighborhood
// touching one. Flags anyway ZERO: max crossing group = 2 bodies with >=2
// pockets vs the >=3-bodies-zero-pockets bar, because the vertical marker
// economy (placeEnemyMarkers) ships <=2 bodies on 881/886 maps. The residual
// exposure is bounded by threat DENSITY, not model blindness — re-measure
// before wiring shaft edges into routeModelEdges; the pin
// (tests/unit/enemy_shaft_gauntlet_fairness.test.js) fails loudly if
// vertical density drifts toward the horizontal norm and the class reopens.
const GAUNTLET_MIN_BODIES = 3;

// --- Bodies-per-run cap + portal-shelf protection (owner ruling 2026-11-08) -
// Playtest report, L20 seed 3906687302: two walkers share-patrol cols 21..22
// of the 5-tile top shelf holding the portal (portal col 24 row 14; spike on
// the fallback terrace below-left), and a spiny + 2 walkers pack cols 10..14
// of the run below. Survivability witnesses exist at certain patrol phases
// but every window is pixel-tight: a precision-tax wall, not a soft-lock —
// and the stacked-patrol gauntlet metric cannot see it, because cols 24..25
// count as safe pockets BEHIND the sweep. Owner ruling: "enemies moving too
// quickly and not far enough away from the edge... ensure enemies can't group
// so much, especially on smaller ledges."
// RULE A — BODIES-PER-RUN CAP: max(1, floor(runTiles / 3)) bodies may deploy
// per SHARED PATROL RUN: bodies whose maximal WALKABLE run matches share a
// sweep (walkRunExtent — solid support below, rock/spike/route-free body
// row; the same extent patrolSpan bounds every body by), and runTiles is
// that run's width. Measured on the ledge as the PLAYER walks it, so a wide
// rock mass whose standable surface is cut to 5 columns by a tooth still
// caps at 1, while the pre-existing 6-wide/two-walkers fixture morphology
// stays legal exactly as ruled 2026-11-04. A 3-wide ledge gets 1 body,
// 6-wide gets 2, 9-wide 3.
// This narrows the old walker exemption ("sharing is fair play", see
// HOSTILE_MIN_RUN): that ruling sized ONE body's pass-by arc statically;
// a second body on a <=5-wide sweep removes the wait-for-the-far-bound room
// the arc depends on — the exact morphology the owner reported, kind-blind
// because two stomped-together walkers on a 3-col sweep still force a pixel-
// perfect double dodge. Runs BEFORE the kind rolls (same precedence as the
// gauntlet gate, which cannot see kinds either): greedy keep-first in derive
// order, excess bodies are SKIPPED PLACEMENTS consuming zero rng draws
// beyond the established drop-before-rolls discipline (spawnEnemies' stream
// note). Fairness ADDITIVE: no existing gate loosens; this only removes
// compositions.
// RULE B — PORTAL-SHELF PROTECTION: on the standable run containing the
// portal cell (the traverse ends there, so the approach cells up to 2 tiles
// before it are mandatory ground), at most ONE patroller may deploy AND its
// span must leave >= PORTAL_SHELF_CLEAR_COLS clear cells between its edge
// and the portal column — the portal-adjacent cell stays sweep-free, so
// entering the portal is never a timed dodge ON the goal tile. Direction-
// aware: 'right' protects cols portalX-1..portalX, 'left' protects
// portalX..portalX+1; vertical maps require the lone body to stay entirely
// to one side (both flanks free — the climb arrives from below, so no single
// approach column exists). Vertical exposure is currently NULL anyway
// (measured 0/333 vertical maps below), so this costs nothing today and
// closes the class before the vertical marker economy grows.
// Measured prevalence @8a9109f BEFORE the rules (fresh disjoint band
// s=(20261108+i*7919)>>>0, L5..100, 1000 seeds): Rule A flags 548/1000 maps
// (54.8%, 881 groups; all horizontal — the vertical marker economy ships <=1
// body per run today), Rule B flags 76/1000 (7.6%, 11.4% of horizontal
// maps). Post-rule both measure ZERO; enemy-count cost by tier, bot A/B on
// the reported seed, and terrain byte-identity are quantified in
// .superpowers/sdd/PLAN/task-2-report.md.
const BODIES_PER_RUN_DIVISOR = 3;
const PORTAL_SHELF_CLEAR_COLS = 1;

// Spawn->portal articulation cells in the movement-model graph: cells on
// one shortest path whose REMOVAL disconnects goal from spawn (any cell on
// ALL paths is on every shortest path, so candidates are exactly the cells
// of one found path). Returns null when no route exists (nothing is then
// provably mandatory — conservative no-flag). Deck corridors are modeled
// cells of routeModelEdges and count like any other node; enemies can never
// stand on them anyway (no solid support), so they only ever satisfy the
// crossing condition, never the pocket count.
export function computeMustPassCells(tiles, width, height, spawnTile,
    portalTile, bridgeGap = null) {
    const key = (x, y) => y * width + x;
    const view = { tiles, width, height, spawnTile, bridgeGap };
    const startK = key(spawnTile.x, spawnTile.y);
    const goalK = key(portalTile.x, portalTile.y);
    const reach = (blocked) => {
        const adj = new Map();
        for (const e of routeModelEdges(view, blocked)) {
            const a = key(e.ax, e.ay);
            const b = key(e.bx, e.by);
            if (!adj.has(a)) adj.set(a, new Set());
            adj.get(a).add(b);
        }
        const prev = new Map([[startK, null]]);
        const q = [startK];
        while (q.length) {
            const k = q.shift();
            if (k === goalK) break;
            for (const n of adj.get(k) || []) {
                if (!prev.has(n)) { prev.set(n, k); q.push(n); }
            }
        }
        return prev.has(goalK) ? prev : null;
    };
    const first = reach(null);
    if (!first) return null;
    const path = [];
    for (let k = goalK; k !== null; k = first.get(k)) path.push(k);
    const mustPass = new Set();
    for (const k of path) {
        if (k === startK || k === goalK) continue;
        if (!reach(new Set([k]))) mustPass.add(k);
    }
    return mustPass;
}

// The shipped gauntlet metric. `bodies`: [{col, row, left, right}] — final
// patrol bounds in tile columns (row-exact coverage uses `row`), col the
// spawn column (identifies the support run). `mustPass`: Set from
// computeMustPassCells (null/empty -> nothing mandatory -> no violations).
// `reachable` (optional Set of keys): when given, only reachable standable
// cells count as safe pockets — an unreachable ledge is not a waiting spot.
// Returns [{runKey, row, lo, hi, members}] for every violating run.
export function gauntletViolations(tiles, width, height, bodies, mustPass,
    reachable = null) {
    if (!mustPass || mustPass.size === 0 || bodies.length < GAUNTLET_MIN_BODIES) {
        return [];
    }
    const key = (x, y) => y * width + x;
    const solid = (x, y) => {
        if (x < 0 || x >= width) return true;
        if (y < 0 || y >= height) return false;
        return tiles[y][x] === 1;
    };
    const hazard = (x, y) => (x < 0 || x >= width || y < 0 || y >= height)
        ? false : tiles[y][x] === 2;
    const standable = (x, y) => !solid(x, y) && !hazard(x, y) && solid(x, y + 1);
    // Group bodies by support run (support row + run's left edge), same
    // identity convention as solidRunKey.
    const runs = new Map();
    for (const b of bodies) {
        const supRow = b.row + 1;
        const row = tiles[supRow];
        if (!row || row[b.col] !== 1) continue;
        let l = b.col;
        while (l > 0 && row[l - 1] === 1) l--;
        const rk = `${supRow}:${l}`;
        if (!runs.has(rk)) runs.set(rk, []);
        runs.get(rk).push(b);
    }
    const spanOf = (list) => {
        let lo = Infinity, hi = -Infinity;
        for (const b of list) { lo = Math.min(lo, b.left); hi = Math.max(hi, b.right); }
        return { lo, hi };
    };
    const violations = [];
    for (const [rk, base] of runs) {
        const s = spanOf(base);
        const group = [...base];
        for (const [k2, list2] of runs) {
            if (k2 === rk) continue;
            const s2 = spanOf(list2);
            if (Math.abs(list2[0].row - base[0].row) !== 1) continue;
            if (s2.hi < s.lo - 1 || s2.lo > s.hi + 1) continue;
            group.push(...list2);
        }
        if (group.length < GAUNTLET_MIN_BODIES) continue;
        const boxRowLo = base[0].row - 1, boxRowHi = base[0].row + 1;
        const boxColLo = s.lo - 2, boxColHi = s.hi + 2;
        let pockets = 0;
        let crosses = false;
        for (let r = boxRowLo; r <= boxRowHi; r++) {
            if (r < 0 || r >= height) continue;
            for (let c = boxColLo; c <= boxColHi; c++) {
                if (c < 0 || c >= width) continue;
                if (mustPass.has(key(c, r))) crosses = true;
                if (!standable(c, r)) continue;
                if (reachable && !reachable.has(key(c, r))) continue;
                let covered = false;
                for (const e of group) {
                    if (e.row === r && c >= e.left && c <= e.right) {
                        covered = true;
                        break;
                    }
                }
                if (!covered) pockets++;
            }
        }
        if (crosses && pockets === 0) {
            violations.push({
                runKey: rk, row: base[0].row, lo: s.lo, hi: s.hi, members: group
            });
        }
    }
    return violations;
}

// Shared patrol runs for the density cap (see BODIES_PER_RUN_DIVISOR): the
// run a body patrols is its maximal WALKABLE run — contiguous columns with
// solid support below and a rock/spike/route-free body row (exactly what
// patrolSpan bounds every body by). Two sites share a run exactly when that
// extent matches, so a solid mass split by a tooth or route cell counts as
// two runs (its halves never share a sweep). Returns [{key, items}] with
// derive-ordered item indices; pure: no rng, no grid writes.
export function walkRunExtent(tiles, width, height, x, y, blocked = null) {
    const solidAt = (cx, cy) =>
        cx >= 0 && cx < width && cy >= 0 && cy < height &&
        tiles[cy][cx] === 1;
    const blockedAt = (cx, cy) => blocked !== null &&
        blocked.has(cy * width + cx);
    const walkable = (cx, cy) =>
        cx >= 0 && cx < width && cy >= 0 && cy < height &&
        tiles[cy][cx] !== 1 && tiles[cy][cx] !== 2 && !blockedAt(cx, cy);
    if (!solidAt(x, y + 1) || blockedAt(x, y)) return null;
    let left = x;
    while (solidAt(left - 1, y + 1) && walkable(left - 1, y)) left--;
    let right = x;
    while (solidAt(right + 1, y + 1) && walkable(right + 1, y)) right++;
    return { left, right };
}

export function patrolRunGroups(tiles, width, height, spawns,
    pathCells = null) {
    const byKey = new Map();
    spawns.forEach((s, i) => {
        const ext = walkRunExtent(tiles, width, height, s.x, s.y, pathCells);
        if (ext === null) return; // unsupported site: nothing to group
        const k = `${s.y}:${ext.left}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(i);
    });
    return [...byKey.entries()].map(([key, items]) => ({ key, items }));
}

// Rule A filter (see BODIES_PER_RUN_DIVISOR): drop every body beyond its
// shared run's capacity max(1, floor(runTiles / divisor)), runTiles the
// WALKABLE RUN width (walkRunExtent) — the ledge as the player perceives it,
// which is also what the pre-existing 6-wide/two-walkers ruling measured on
// its fixtures. Greedy keep-first in derive order — the last body that walls
// the sweep goes, mirroring the gauntlet gate's convention. Consumes no rng.
export function capBodiesPerPatrolRun(tiles, width, height, spawns,
    pathCells = null, divisor = BODIES_PER_RUN_DIVISOR) {
    const drop = new Set();
    for (const g of patrolRunGroups(tiles, width, height, spawns, pathCells)) {
        const first = spawns[g.items[0]];
        const ext = walkRunExtent(tiles, width, height, first.x, first.y,
            pathCells);
        const cap = Math.max(1, Math.floor((ext.right - ext.left + 1) / divisor));
        for (let i = cap; i < g.items.length; i++) drop.add(g.items[i]);
    }
    return spawns.filter((_, i) => !drop.has(i));
}

// Rule B filter (see PORTAL_SHELF_CLEAR_COLS): on the standable run holding
// the portal cell, keep at most ONE patroller and only when its span leaves
// >= CLEAR clear cells between its edge and the portal column (approach side
// for horizontal travel; both flanks on vertical climbs). Offenders are
// skipped placements, never re-rolled elsewhere; consumes no rng. Sites on
// other runs never sweep the portal cell (patrolSpan clamps at ledges), so
// they pass untouched.
export function protectPortalShelf(tiles, width, height, portalTile,
    direction, spawns, pathCells = null) {
    if (!portalTile) return spawns;
    const px = portalTile.x;
    const ext = walkRunExtent(tiles, width, height, px, portalTile.y,
        pathCells);
    if (ext === null) return spawns; // unsupported/floating portal: no run
    const key = `${portalTile.y}:${ext.left}`;
    let loneClaimed = false;
    return spawns.filter(s => {
        const se = walkRunExtent(tiles, width, height, s.x, s.y, pathCells);
        if (se === null || `${s.y}:${se.left}` !== key) return true;
        if (loneClaimed) return false;
        const clearance = PORTAL_SHELF_CLEAR_COLS;
        const keepsClear = direction === 'left'
            ? s.left - clearance >= px + 1
            : direction === 'vertical'
                ? (s.right + clearance < px || s.left - clearance > px)
                : s.right + clearance <= px - 1;
        if (!keepsClear) return false;
        loneClaimed = true;
        return true;
    });
}

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
// Raw per-attempt roll. Realized coverage lands lower than the roll because
// a shaft-bearing construction competes with plain ones through the retry
// loop: its steered delivery tail + clamped marker seating accept at only
// ~0.25x the plain-attempt rate (measured post-wave: realized f=0.529 at
// c=0.82 implies accept_shaft/accept_plain = f/(1-f)·(1-c)/c ≈ 0.246), so
// the chance must be pushed well past the target to win enough retries.
// RETUNED 0.7 -> 0.82 (M1 fix, 2026-11-05): the sx-slot exclusion + stop-row
// raise above halved that acceptance ratio and collapsed realized hosting
// 0.540 (HEAD da8c8c9 population) -> 0.354 (n=900 verticals L13+, fresh
// seeds s=100..129) at the old 0.7. At 0.82 the same probe measures 0.529
// (n=3000, thrown=0) — back inside the 40-60% design target and within one
// binomial sigma of HEAD parity. Parity comes from attempt ECONOMICS only:
// every shaft fairness gate and reachability validation is untouched.
const SHAFT_CHANCE = 0.82;
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
// so the top stop (B - lift >= 16 - 6 = 10) stays clear of the portal band
// (y <= VERTICAL_PORTAL_MAX_Y) with a buffer row.
// RAISED 12 -> 16 (vertical threat-layer restoration wave): with B drawn as
// low as 12, BOTH ends of the ride were starved — the steered lower climb
// had to cross up to 8 rows of open map (measured @da8c8c9: ~90% of shaft
// attempts died no-portal, frozen below the floor: 194 cell-solid + 172
// no-support + 128 capped route cells below the boarding row across
// L13..60 x 4 seeds), and the upper segment above row A = B - lift shrank
// to 1-2 links, too short to seat a marker pocket below the approach-window
// ban rows (A-1, A-2). Holding the stop at 16..18 keeps the approach 3-5
// rows AND guarantees a >= 5-link upper segment. Retries hid the low-B tax
// while plain attempts failed often too; once marker seating made plain
// attempts much cheaper to accept, realized shaft hosting collapsed
// 0.60 -> 0.18 against the level_motifs band (> 0.35).
const SHAFT_BOTTOM_MIN_ROW = 16;
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
//     routeFair() re-validates every ACCEPTED construction by RUNNING
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
// Route physics simulation (routeFair support; see its comment on the
// Level class). Two module-local helpers, kept out of the class to hold the
// simulation surface small and dependency-free (Player/Physics are shipped
// runtime modules — the gate exercises the SAME code the game runs).

// Model-edge scan mirroring computeReachable's transition set without the
// reachability bookkeeping: enumerates consecutive-cell edges so the route's
// shortest path can be reconstructed and each hop simulated. Deck corridors
// emit trusted 'deck' edges (rider suites validate the ride itself).
// `blocked` (optional Set of y*width+x keys) removes cells from the graph —
// used by computeMustPassCells' articulation test; every shipped caller
// passes nothing and gets byte-identical behavior.
function routeModelEdges(level, blocked = null) {
    const tiles = level.tiles;
    const w = level.width, h = level.height;
    const blk = (x, y) => blocked !== null && blocked.has(y * w + x);
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
    const standable = (x, y) => freeCell(x, y) && solid(x, y + 1) && !blk(x, y);
    const corr = level.bridgeGap;
    const isCorr = (x, y) => corr !== null && corr !== undefined &&
        y === corr.S - 1 && x >= corr.a && x <= corr.b && !blk(x, y);
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
                    if (solid(midX, y) || blk(midX, y)) { blocked = true; break; }
                    // Mirror of computeReachable's spike wall (soft-lock wave
                    // 2026-11-05): tooth directly ahead or a >=3 run blocks.
                    if (hazard(midX, y)) {
                        hazardRun++;
                        if (m === 1 || hazardRun >= 3) { blocked = true; break; }
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
                    if (solid(midX, ty) || hazard(midX, ty) || blk(midX, ty)) {
                        clear = false;
                    }
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
            // OOB harvest clamp (soft-lock wave 2026-11-05): a body half off
            // the map edge still overlaps edge-column support and grounds
            // with center column -1 or w; keying that into bodyRow*w+cx
            // aliases the opposite edge column (26*40-1 === (39,25)) — the
            // phantom foothold that made routeFair accept soft-locked
            // L83 s1514804096. A half-off stance is support-equivalent to the
            // edge column, so CLAMP it; never credit an off-grid cell.
            const cx = Math.max(0, Math.min(w - 1,
                Math.floor((player.x + player.width / 2) / T)));
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

// Identity of the contiguous solid support run beneath (x, supportY):
// support row + left edge. Two spawns share a patrol surface exactly when
// their keys match (patrolSpan bounds every body on the run by its ledges).
// Null when the column has no solid support.
function solidRunKey(tiles, width, x, supportY) {
    const row = tiles[supportY];
    if (!row || row[x] !== 1) return null;
    let left = x;
    while (left > 0 && row[left - 1] === 1) left--;
    return `${supportY}:${left}`;
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
// Out-of-bounds columns: modelled as SOLID for scan purposes. Shipped physics
// has no x walls — walking off the left/right edge commits the player to pit
// death (death is y-only, main.js checkPitFall) — so a side-exit-to-void is a
// real DEATH edge, never a safe route edge: refusing every edge that crosses
// the boundary is exactly right, and no survivable route ever needs one. The
// convention must NOT leak into foothold bookkeeping though: off-grid stances
// exist in simulation (a body half off the map edge still overlaps edge-
// column support), and keying cx=-1 into row*w+x aliases column w-1 — the
// phantom foothold that fooled the acceptance gate on L83 s1514804096. See
// simTransition's harvest clamp. Sky above is open; falling below the grid
// bottom (a pit with no floor) kills, so it offers no landing.
//
// Spike tiles (type 2) are treated conservatively as death, never as terrain:
// they are NOT standable, they provide no support (standing on a spike tip
// is impossible), and they terminate downward landing scans (falling into a
// spike column kills rather than passing through). Aerial pass-through is
// bounded by simulation against Physics + Hazards, tightened by the soft-lock
// wave 2026-11-05 into two wall clauses: (1) a tooth DIRECTLY AHEAD of the
// launch cell walls any walk/fall crossing — from an adjacent stance the inset
// core engages within ~4px of travel while the arc needs ~17px (0.083s at
// speed 200) to rise the required 28px, and every simulated policy dies (old
// failure census: 0 landings across the mid-tooth classes, ~75k attempts);
// (2) runs of >=3 consecutive teeth stay a wall (descent re-entry beyond hang
// time). Backed crossings (>=1 free column between launch and tooth) remain
// modelled: continuous-time clearance holds there and the old sweep landed
// them — but with single-digit-pixel margins that flight-path rock can erase
// (a head-bonk zeroes vy mid-rise and drops the body onto the teeth: canyon
// L83 s1514804096, proven dead under the shipped Player/Physics with an action
// set incl. jump-cut and Shift-walk), so routeFair() physics-executes EVERY
// accepted horizontal route as the second line of defence. A spike CAPPING a
// riser (sitting on a column whose top is one tile above the launch row) is
// full wall for step-ups (core forces feet ≥60px above launch vs max rise
// ~62.5px: 0/4539 survived). Generation keeps spikes ≥2 columns apart; the
// adjacency clause costs measured attempt economy (soft-lock wave report),
// never correctness: reachability of coins, portal, and enemy spawns never
// routes THROUGH death. Grids without type-2 tiles behave bit-identically to
// the pre-hazard model (hazard() is constant false there).
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
//
// Optional `transitions` (coin safe-hub, fairness wave 2026-11-04): an array
// that receives EVERY modelled transition {ax,ay,bx,by} the flood considers
// from an expanded cell — including ones whose target was already visited.
// Pure observation: it cannot alter the reachable set (the coin safe-hub
// reverse-BFS runs over this record; see computeCoinSafeHub). Callers passing
// null (every pre-existing caller) pay nothing and behave byte-identically.
export function computeReachable(
    tiles,
    width,
    height,
    startTile,
    requireOpenHead = false,
    corridor = null,
    shaft = null,
    transitions = null
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
                    if (transitions) transitions.push({ ax: x, ay: y, bx: nx, by: y });
                    if (!reachable.has(key(nx, y))) {
                        reachable.add(key(nx, y));
                        queue.push([nx, y]);
                    }
                    continue;
                }
                for (const ny of [y, y - 1]) {
                    if (standable(nx, ny)) {
                        if (transitions) transitions.push({ ax: x, ay: y, bx: nx, by: ny });
                        if (!reachable.has(key(nx, ny))) {
                            reachable.add(key(nx, ny));
                            queue.push([nx, ny]);
                        }
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
                    if (transitions) transitions.push({ ax: x, ay: y, bx: nx, by: ny });
                    if (!reachable.has(key(nx, ny))) {
                        reachable.add(key(nx, ny));
                        queue.push([nx, ny]);
                    }
                } else if (isShaftStopRow(y) && ny === y && standable(nx, ny)) {
                    if (transitions) transitions.push({ ax: x, ay: y, bx: nx, by: ny });
                    if (!reachable.has(key(nx, ny))) {
                        reachable.add(key(nx, ny));
                        queue.push([nx, ny]);
                    }
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
                    // Physics-verified spike wall (see header; soft-lock wave
                    // 2026-11-05). Two clauses:
                    //  - a tooth DIRECTLY AHEAD (m=1) walls the scan: from an
                    //    adjacent stance the inset core engages within ~4px of
                    //    travel while the arc needs ~17px to rise the required
                    //    28px. A faithful late-steer policy CAN still thread it
                    //    with ~23px clearance (review measurement, stable
                    //    1/30..1/240 dt), so this is a deliberate CONSERVATIVE
                    //    wall — pixel-perfect apex control is not a fairness
                    //    contract. (The earlier 'every policy dies / 0 of 75k
                    //    attempts' census predated the faithful validator and
                    //    lacked deep takeoff policies; superseded.)
                    //  - runs of >=3 consecutive teeth stay a wall (descent
                    //    re-entry beyond hang time, the pre-existing rule).
                    // Backed crossings (first free column between launch and
                    // tooth) keep their old modelling because simulation lands
                    // them — measured clearance ~23-24px across dt 1/30..1/240
                    // — but flight-path rock can truncate the apex onto the
                    // teeth (L83 s1514804096), so routeFair() physics-executes
                    // EVERY accepted horizontal route as the second line of
                    // defence. Gate sims run fixed dt=1/60; the backed-crossing
                    // class is dt-insensitive per fixture evidence above.
                    if (hazard(midX, y)) {
                        hazardRun++;
                        if (m === 1 || hazardRun >= 3) {
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
                    if (standable(c, ly)) {
                        if (transitions) transitions.push({ ax: x, ay: y, bx: c, by: ly });
                        if (!reachable.has(key(c, ly))) {
                            reachable.add(key(c, ly));
                            queue.push([c, ly]);
                        }
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
                if (clear) {
                    if (transitions) transitions.push({ ax: x, ay: y, bx: c, by: ty });
                    if (!reachable.has(key(c, ty))) {
                        reachable.add(key(c, ty));
                        queue.push([c, ty]);
                    }
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
                if (ny >= 0) {
                    if (transitions) transitions.push({ ax: x, ay: y, bx: nx, by: ny });
                    if (!reachable.has(key(nx, ny))) {
                        reachable.add(key(nx, ny));
                        queue.push([nx, ny]);
                    }
                }
            }
        }

        // Boarding edge (shaft): stepping off an adjacent ledge column onto
        // the dwelling cabin AT A STOP ROW — flush only (the generator forces
        // pixel-exact ledges, so the corridor's one-row-down variant has no
        // analogue here). Every other cell treats the shaft as air.
        if (shaft !== null && isShaftStopRow(y)) {
            for (const nx of [x - 1, x + 1]) {
                if (isShaft(nx, y)) {
                    if (transitions) transitions.push({ ax: x, ay: y, bx: nx, by: y });
                    if (!reachable.has(key(nx, y))) {
                        reachable.add(key(nx, y));
                        queue.push([nx, y]);
                    }
                }
            }
        }
    }

    return reachable;
}

// Coin safe-hub: the subset of `reachable` from which the portal is still
// reachable under the SAME movement model that produced it. Forward
// reachability alone does not promise a survivable RETURN — a ledge you can
// drop onto but not jump back off (vertical zigzag shelves behind >=2-tile
// walls: entry fall, no <=1-row exit) passes the forward test and traps the
// player after the grab, making death the collection mechanic (player report
// 2026-11-04, L25: "the only way is to die after collecting the 3 coins so
// that you can finish the level"). Coins must only sit where spawn->cell AND
// cell->portal both hold.
//
// Method: BFS over the REVERSED transition relation recorded by
// computeReachable's `transitions` out-param. Every source of a recorded edge
// is forward-reachable by construction, so intersecting with `reachable` is
// belt-and-braces; deck/lift edges are bidirectional in the model, so riding
// back is credited exactly as riding in. Cost: O(V+E) extra over one flood —
// same order as the flood itself, no physics simulation, no retries.
//
// Model-vs-physics fidelity (documented limits): the model is CONSERVATIVE
// against physics wherever an escape needs more than its vocabulary (stomp
// bounces, mid-shaft boarding, late-steer arcs) — those cells are excluded
// from the hub even though a skilled player could leave, costing coin count,
// never fairness. It can only lie optimistically where the model over-claims
// an edge physics fails (~2.4% of claimed edges per the edgecheck sweep,
// mostly long fall arcs); routeFair physics-verifies the spawn->portal
// route, and coin cells sit on or beside validated route surface, so residual
// trap risk beyond this guard stays small.
export function computeCoinSafeHub(width, goalTile, reachable, transitions) {
    if (!goalTile || !transitions) return null;
    const goalKey = goalTile.y * width + goalTile.x;
    const rev = new Map();
    for (const t of transitions) {
        const bk = t.by * width + t.bx;
        let list = rev.get(bk);
        if (!list) { list = []; rev.set(bk, list); }
        list.push(t.ay * width + t.ax);
    }
    const toPortal = new Set([goalKey]);
    const queue = [goalKey];
    while (queue.length > 0) {
        const k = queue.pop();
        for (const pk of (rev.get(k) || [])) {
            if (!toPortal.has(pk)) {
                toPortal.add(pk);
                queue.push(pk);
            }
        }
    }
    const hub = new Set();
    for (const k of reachable) {
        if (toPortal.has(k)) hub.add(k);
    }
    return hub;
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

// --- Capability objects: launch pads + crates (M3, owner-approved) ----------
// Placement-only pass at the CONSTRUCTOR TAIL (after deriveMovingPlatforms):
// zero tile writes, zero draws consumed by anything upstream, so terrain,
// spikes, coins, spawn/portal, direction, attempt counts AND the deck
// schedule stay byte-identical versus pre-M3 builds for every seed — only
// the new entity sets (this.pads / this.crates) grow. Rng-stream contract:
// an eligible map consumes exactly two rolls (pad chance, crate chance)
// plus one pick draw per object actually placed; nothing reads rng after
// this pass, so there is no stream shift anywhere else (the deck-schedule
// precedent in spawnEnemies' header documents what shifting WOULD cost —
// this pass deliberately pays none of it).
// Budget: max 1 pad + 1 crate per level, tiers >= 2 only (tierIndexFor, the
// same boundary authority the score economy reads).
const CAPABILITY_TIER_MIN = 2;
const PAD_CHANCE = 0.5;
const CRATE_CHANCE = 0.5;
// Seat-relative travel budget: from the midpoint seat, neither push
// direction may exceed this many cells before the crate meets its blocker
// (rejects runs of 8+; see the guard in _findCrateCandidates). Convention
// documented there: bound the SHOVE so every push outcome stays short,
// readable, and inside the pocket's sightline.
const CRATE_MAX_TRAVEL_PAST_END = 3;

// ── M4 secret alcoves (SPEC M4 / Task 6) ───────────────────────────────────
// The generator carves AT MOST ONE alcove per map, tiers >= 2 only (the same
// tierIndexFor boundary authority the pads/crates pass reads): a chimney of
// EXACTLY 2 cells width, ALCOVE_H_MIN..ALCOVE_H_MAX rows tall, capped on top,
// solid walls on both sides, entered through a one-cell TUNNEL mouth cut at
// the base of the shaft, flush onto an existing standable surface (the
// "floor/wall junction" of SPEC M4). Coins inside carry secret:true and are
// excluded from the portal gate (R4 ruling).
//
// Why the tunnel mouth: the shipped horizontal generator is a PURE HEIGHTMAP
// (measured: zero solid-with-air-below cells across sampled maps), so no
// natural cave mouth or overhang exists for a bottom-open shaft to hide in.
// The carve therefore cuts into cliff bodies: shaft columns sit inside the
// massif (their side walls and cap are surrounding rock), and a one-cell
// tunnel connects the shaft floor to a terrace cell at the same row. The
// left flank wall keeps every row ABOVE the tunnel, so the alternating-kick
// chain has both walls from its first exchange — the repo-side physics test
// family pins THIS shipped shape (plus plain 2-walled chimneys) across
// h=3..5 with the real engine (wjchimney doctrine, R5), never per-generation.
//
// Base-model effect of the carve (the fairness story, property-tested):
// flipping tunnel+shaft cells ADDS the shaft-floor standable pair and
// removes no support from any previously standable cell (every flipped
// cell's up-neighbour is either another flipped cell or the pinned-solid
// cap/wall rock; heightmap columns are solid below every surface). The
// TUNNEL cell does NOT become standable in practice: the headroom-aware
// base BFS drops it (rock directly overhead at the flank row), so the
// measured shipped delta on verticals is +2/-0, not the naive +3/-0 —
// a STRONGER guarantee than "three dead-end cells". Interior cells (rows
// above the shaft floor) stay NON-standable forever — the base BFS only ever
// marks standable cells, so every interior cell and every secret coin inside
// is unreachable in the base model BY CONSTRUCTION, independently asserted
// per shipped alcove against a fresh computeReachable on the carved grid.
// All validators consume that base BFS: gauntlet articulation points cannot
// shift (adding leaf cells never changes which OLD cells separate spawn from
// portal), safe-hub reverse-BFS keeps every existing coin's portal path, and
// routeFair routes stay byte-valid. Secret coins are exempt from safe-hub
// membership for the documented reason of R4: secrets are never required.
//
// Climbability is the cheap geometric predicate R5 (alcoveGeometryValid):
// width exactly 2, side walls solid over the shaft height (left flank above
// the tunnel row), cap solid, tunnel + shaft floors solid, terrace cell free
// + floored, height bounds enforced. Entry reachability and hazard clearance
// are placement policy (_findAlcoveCandidates).
//
// Carve sites keep Chebyshev clearance >= ALCOVE_FORBID_MARGIN+1 from spikes,
// the portal, deployed patrol spans, pads, crates and coin bodies (zone set
// below marks +/- margin rects around each; footprint must miss every zone).
// Route/must-pass cells need NO ban: the dead-end argument above means the
// carve cannot alter any validated route.
//
// RNG discipline: this pass is the LAST consumer of this.rng (it runs after
// placeCapabilityObjects; nothing reads rng afterwards), mirroring the pads/
// crates precedent — terrain, decks, enemies, coins, pads and crates stay
// byte-identical versus BASE for every seed, and the deck-schedule ruling
// applies unchanged: deck PRESENCE is untouched because the draw sits behind
// every upstream consumer. Terrain byte-identity vs BASE intentionally ENDS
// here for carved maps only (documented delta: the Task 6 report enumerates
// % maps changed and tiles flipped). Retry-exact-map holds: same seed => the
// same rolls => the same site and carve.
// NO budget roll at the finder itself: natural eligible sites are ZERO on
// horizontal heightmaps (steps <= 1 row) and ZERO on verticals too (the full
// fix-round study — see the CRAG_ header); what hosts alcoves is the crag
// STAMP, whose own chance gate (CRAG_CHANCE, shipped 1.0) lives upstream in
// the attempt loop. Measured shipped prevalence with the stamp: ~2.4-3.2% of
// tier>=2 maps carry a carved alcove (bands in the Task 6 report fix-round
// section). The "<= 1 per map" budget is structural (one pick), and
// candidate preference scoring still differentiates seeds by SITE PRESENCE.
const ALCOVE_TIER_MIN = 2;
const ALCOVE_H_MIN = 3;   // shaft rows (interior above the shaft floor = h-1)
const ALCOVE_H_MAX = 5;
const ALCOVE_FORBID_MARGIN = 2;
const SECRET_COIN_MIN = 1;
const SECRET_COIN_MAX = 3;

// R8 crag stamp (controller ruling, Task 6 follow-up): the horizontal grammar
// is a pure heightmap (surface steps 0/±1 between solid columns), so NO
// natural site satisfies alcoveGeometryValid — measured 0 sites / 1,017,120
// windows over 1200 tier>=2 maps. The stamp therefore manufactures the host
// INSIDE generateLevel's consumer chain BEFORE computeReachable/routeFair run,
// so every validator adjudicates the FINAL grid (validated == shipped holds;
// this is what rules out any post-validation stamp). Stream position: called
// once per generation attempt immediately after generateLevel returns (post
// mirror, post markers); with the fix-round hash protocol it draws NOTHING
// from the main stream ever (decision/site-pick/fork-seed come from cragHash;
// stamped validation runs on a fork and a failed stamp is UNDONE), so maps
// that do not ship a stamp replay BASE bit-for-bit — terrain, floats AND
// attempt counts. Deck discipline follows the pads/crates precedent read
// backwards: deck PRESENCE and gap geometry are decided inside generateLevel
// upstream of the trial, so they are untouched; downstream floats (deck
// speed/phase, coin placement, pad/crate picks) draw from the fork on
// STAMPED maps only — documented intentional delta.
// SHIPPED VALUE (fix round 1 frontier under the fork/undo protocol,
// L10..60 x 20 numeric seeds/tree + disjoint 2040-seed exhaustion band,
// /tmp/opencode/t6-alcove): chance {0.25, 0.55, 1.0} all satisfy mean
// attempts <= BASE+1.0 and ms < 15% with ZERO exhaustion; 1.0 maximizes
// prevalence (~3% of tier>=2 maps ship a carved alcove — vertical habitat).
// Stamped maps INTENTIONALLY differ from BASE; unstamped maps are verified
// byte-identical on the unstamped subset (report fix-round gate (a)).
const CRAG_CHANCE = 1;

// Hash for the stamp's decision/site-pick/fork-seed (fix round 1): a pure
// avalanche mix, NOT the level rng — the stamp must never consume main-
// stream draws so unstamped maps replay BASE bit-for-bit.
function cragHash(v) {
    v ^= v >>> 16;
    v = Math.imul(v, 0x7feb352d);
    v ^= v >>> 15;
    v = Math.imul(v, 0x846ca68b);
    return (v ^ (v >>> 16)) >>> 0;
}

/**
 * R5 climbability predicate — PURE geometry on the pre-carve grid. A site is
 * { col, entryRow, h, side }: shaft columns col..col+1 rise h rows ending at
 * the shaft-floor row entryRow INSIDE solid massif; side (-1 | +1) names the
 * direction of the terrace, whose cell (col+side*2, entryRow) is free and
 * floored; the tunnel cell (col+side, entryRow) is solid rock to cut. The
 * flank wall on the terrace side stays solid for every shaft row ABOVE the
 * tunnel; the far wall spans the full shaft height; the cap row closes the
 * top. Exported for tests; reachability/clearance live in the finder.
 */
export function alcoveGeometryValid(tiles, width, height, site) {
    const { col: c, entryRow: e, h, side } = site;
    if (!Number.isInteger(h) || h < ALCOVE_H_MIN || h > ALCOVE_H_MAX) {
        return false;
    }
    if (side !== -1 && side !== 1) return false;
    const t = (r, x) =>
        (r >= 0 && r < height && x >= 0 && x < width) ? tiles[r][x] : -1;
    // Columns relative to the shaft (which occupies c and c+1): the tunnel
    // cuts the flank NEAREST the terrace, the far wall is the opposite one.
    const tunnelX = side === -1 ? c - 1 : c + 2;
    const terraceX = side === -1 ? c - 2 : c + 3;
    const flankX = side === -1 ? c + 2 : c - 1;
    // Bounds: everything referenced must sit in-grid.
    if (terraceX < 0 || terraceX > width - 1) return false;
    if (flankX < 0 || flankX > width - 1) return false;
    if (e - h < 0 || e + 1 > height - 1) return false;
    // Terrace: free cell standing on solid ground (the existing surface).
    if (t(e, terraceX) !== 0 || t(e + 1, terraceX) !== 1) return false;
    // Tunnel mouth: solid rock to cut, solid floor beneath it.
    if (t(e, tunnelX) !== 1 || t(e + 1, tunnelX) !== 1) return false;
    // Shaft columns: solid massif from the shaft floor up through interior.
    for (let r = e - h + 1; r <= e; r++) {
        if (t(r, c) !== 1 || t(r, c + 1) !== 1) return false;
    }
    // Shaft floors stay rock under the flipped cells (newly standable).
    if (t(e + 1, c) !== 1 || t(e + 1, c + 1) !== 1) return false;
    // Terrace-side flank wall: solid for every shaft row ABOVE the tunnel.
    for (let r = e - h + 1; r <= e - 1; r++) {
        if (t(r, tunnelX) !== 1) return false;
    }
    // Far wall: solid over the FULL shaft height (first kick needs it at the
    // bottom row).
    for (let r = e - h + 1; r <= e; r++) {
        if (t(r, flankX) !== 1) return false;
    }
    // Cap solid above both shaft columns.
    if (t(e - h, c) !== 1 || t(e - h, c + 1) !== 1) return false;
    return true;
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
        // Post-deployment fairness (see routeFair): an accepted horizontal
        // construction whose SHIPPED grid fails the physics-executed route
        // check regenerates. Retry tiers, cheapest first:
        //   1) canyon ONLY — main-stream REWIND (same terrain, hazard and
        //      enemy economy rebuilt identically) while the canopy side
        //      stream advances via _canopyCalls — each retry re-rolls only
        //      ceiling placement; non-canyon maps have no side stream, so a
        //      rewind would replay byte-identical terrain and re-reject: they
        //      jump straight to tier 2 on their first physics rejection;
        //   2) genuinely new terrain via an attempt-seeded stream root.
        // Seeds the gate never bites keep the ORIGINAL pre-gate stream
        // semantics exactly (invalid attempts simply continue consuming),
        // so byte identity holds for every construction accepted without a
        // physics rejection — including all golden-pinned L1..7 maps.
        let fair = false;
        let physRejects = 0;
        let gateEngaged = false;
        const REWIND_BUDGET = 4;
        // One validation pass over the CURRENT grid (reachability BFS,
        // portal pick, integrity + Phase-2 presence gates, physics route).
        // Extracted verbatim from the loop body so the R8 stamp trial can
        // run it twice (stamped, then rolled-back unstamped) without any
        // semantic drift. Consumes this.rng exactly like the old inline
        // code did; returns { valid, fair }.
        const evaluateAttempt = () => {
            this.spawnTile = this.getSpawnTile();
            // Coin safe-hub record (see computeCoinSafeHub): every modelled
            // transition of THIS attempt's flood. The accepted attempt's
            // record is the shipped grid's; extractCoins intersects its pool
            // with the reverse-reachable-to-portal subset so no coin can sit
            // in a one-way pocket. Pure observation — reachableTiles and the
            // attempt economy are untouched.
            this.modelTransitions = [];
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
                this.shaftGap,
                this.modelTransitions
            );
            this.portalTile = this.pickPortalTile();
            let valid = this.portalTile !== null && this.bridgeIntact() &&
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
            return { valid, fair: valid && this.routeFair() };
        };
        while (!fair && attempt < MAX_GENERATION_ATTEMPTS) {
            // Terrain, spike tiles (type 2), and enemy markers (type 4) are
            // all laid down before computeReachable runs, so the validation
            // BFS sees the final geometry. If spikes wall off the map, no
            // portal candidate survives and the retry regenerates.
            this.tiles = this.generateLevel();
            // R8: crag stamp runs BEFORE computeReachable so every validator
            // below adjudicates the FINAL shipped grid (see the CRAG_ header).
            // Stream discipline (fix round 1): the decision + site pick come
            // from a DERIVED HASH (zero main-stream draws), the stamped
            // validation chain runs on a FORKED rng, and a failed stamp is
            // UNDONE before the unstamped chain re-runs on the untouched
            // main stream. Consequences, all measured in the Task 6 report:
            //  * maps that never ship a stamp replay BASE bit-for-bit
            //    (same stream position, same acceptance decisions, same
            //    attempt count);
            //  * stamped maps INTENTIONALLY differ (terrain + downstream
            //    floats draw from the fork);
            //  * a failing stamp costs NO generation attempt (the unstamped
            //    verdict for the same terrain still stands), so the stamp
            //    cannot burn the retry budget.
            const stampTrial = this._beginStampCrag(attempt);
            const mainRng = this.rng;
            if (stampTrial) this.rng = makeRng(stampTrial.forkSeed);
            let outcome = evaluateAttempt();
            if (stampTrial && !outcome.fair) {
                this._undoStampCrag(stampTrial);
                this.rng = mainRng;
                outcome = evaluateAttempt();
            } else if (stampTrial) {
                this.cragSite = stampTrial.site;
                this.cragFilled = stampTrial.filled;
            } else {
                this.cragSite = null;
                this.cragFilled = null;
            }
            valid = outcome.valid;
            attempt++;
            if (valid) {
                if (outcome.fair) {
                    fair = true; // shipped grid walks clean
                } else {
                    valid = false;
                    physRejects++;
                    gateEngaged = true;
                    if (this.motif === 'canyon' &&
                        physRejects <= REWIND_BUDGET) {
                        // Tier 1: same terrain, next canopy variant. The
                        // side-stream ordinal (_canopyCalls) intentionally
                        // survives the rewind so ceiling placement re-rolls.
                        this.rng = makeRng(this.seedResolved);
                    } else if (this.motif !== 'canyon') {
                        // Non-canyon rejection: no side stream exists, so a
                        // rewind would replay byte-identical terrain and
                        // re-reject it — draw a fresh stream root at once.
                        this.rng = makeRng((this.seedResolved ^ Math.imul(
                            attempt + 1, 0x01000193)) >>> 0);
                        physRejects = 0;
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

        // Coin safe-hub (see computeCoinSafeHub): the cells of the accepted
        // flood from which the portal stays reachable under the same model.
        // Derived ONCE post-acceptance; extractCoins intersects its candidate
        // pool with it so no deployed coin can sit in a one-way pocket.
        this.coinSafeHub = computeCoinSafeHub(
            this.width, this.portalTile, this.reachableTiles,
            this.modelTransitions);

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
        // Bombardier cannonballs live per-Level next to their gunners: one
        // manager per rebuilt Level, so a retry starts with an empty air.
        // The terrain adapter reads THIS level LIVE through closures (not
        // a snapshot): test fixtures legitimately swap tiles/width after
        // construction before re-running spawnEnemies, and map edges block
        // shots while open sky above and the void below do not — spike
        // teeth never stop a ball.
        const terrainView = this;
        this.projectileManager = new ProjectileManager({
            get tileSize() { return terrainView.tileSize; },
            get width() { return terrainView.width; },
            get height() { return terrainView.height; },
            isSolidPx(px, py) {
                const c = Math.floor(px / terrainView.tileSize);
                const r = Math.floor(py / terrainView.tileSize);
                if (c < 0 || c >= terrainView.width) return true;
                if (r < 0 || r >= terrainView.height) return false;
                return terrainView.tiles[r][c] === 1;
            }
        });
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
        // Capability objects (M3 pads + crates): LAST consumer of this.rng,
        // pure placement over the accepted grid — see the constant header.
        this.placeCapabilityObjects();
        // Secret alcoves (M4): the true last consumer of this.rng — see the
        // alcove constant header for the stream-position and invariance
        // contract.
        this.placeAlcove();
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
        // ones); flipChance biases how often the snake REVERSES direction
        // (see the patrol-pocket note in chainLink). The route mechanics
        // (rise <= 1 per jump, pathCells protection, wall bounce, chimney
        // exclusion, steered shaft delivery tail) are untouched, so elevators,
        // spikes, markers and coins keep their exact fairness contracts.
        // 'standard' reproduces the shipped EXTENSION draws verbatim
        // (ext = 2 + floor(rng*4)); its stream still reshuffles from this
        // wave because every motif now rolls the flip draw. A forced direction
        // flip for zigzag was TRIED AND REMOVED long ago: reversing EVERY
        // link parks the next span inside the previous hop's intermediate
        // column at target height (strict dist-2 rule) and starves the
        // attempt budget (avg 35.6 attempts, ~1/1000 throws); short shelves
        // alone measured avg 14.5 with 0 throws over 400 maps while reading
        // visibly denser. A PROBABILISTIC flip is different: mean forward run
        // stays multi-link, and the constructor BFS stays the safety net.
        const kv = this.motif === 'atrium'
            ? { extMin: 4, extMax: 8, flipChance: 0.12, flipCap: 7, standardStream: false }
            : this.motif === 'zigzag'
                ? { extMin: 1, extMax: 2, flipChance: 0.45, flipCap: 4, standardStream: false }
                : { extMin: 2, extMax: 5, flipChance: 0.16, flipCap: 6, standardStream: true };

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
            // Ledges need SHAFT_LEDGE_W columns each side (stop shelves and
            // their stand cells stay on the map); the delivery tail runs
            // OUTWARD from the boarding flank, which the widened slot below
            // always leaves room for because its two extremes board toward
            // the centre. THE SPAWN COLUMN IS EXCLUDED: shaftIntact bans the
            // spawn from the chimney columns outright, so a chimney covering
            // the bottom-center spawn column was a DOOMED roll — measured at
            // this wave, that tax burned HALF of all shaft attempts before
            // geometry even ran, and once marker seating made plain
            // attempts cheaper to accept, the doomed half collapsed realized
            // shaft hosting from ~0.6 to ~0.15 (retry competition). Drawing
            // only feasible columns keeps one rng draw here and restores
            // hosting while widening placement variety (2..9, was 5..8).
            const spawnX = Math.floor(w / 2);
            const sxSlots = [];
            for (let cx = SHAFT_LEDGE_W; cx <= w - 3 - SHAFT_COLS; cx++) {
                if (cx === spawnX || cx === spawnX - 1) continue;
                sxSlots.push(cx);
            }
            const sx = sxSlots[Math.floor(this.rng() * sxSlots.length)];
            let B = SHAFT_BOTTOM_MIN_ROW + Math.floor(
                this.rng() * (SHAFT_BOTTOM_MAX_ROW - SHAFT_BOTTOM_MIN_ROW + 1));
            // (An older guard nudged B down when A = B - lift would sit too
            // high for the upper segment; SHAFT_BOTTOM_MIN_ROW = 16 against
            // MAX_SHAFT_LIFT = 6 leaves A >= 10 > VERTICAL_PORTAL_MAX_Y + 4
            // unconditionally, so the branch could never fire and is gone.)
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
        // Column whose cell AT THE CURRENT PAINT ROW must stay air: the
        // intermediate cell of the PREVIOUS link's dist-2 rise-jump (that
        // hop passes through (row, prevMid) at target height — see
        // computeReachable's strict dist-2 rule). Only non-steered links
        // record or read it; steered segments reset it to -1 because their
        // delivery geometry is fixed and validated separately.
        let prevMid = -1;
        // Straight non-steered links since the last reversal (flip or wall
        // bounce); kv.flipCap forces a pocket once this runs out. Restarted
        // at each segment seam so short upper segments still force one.
        let sinceFlip = 0;

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
                // Patrol-pocket bias (vertical threat-layer restoration
                // 2026-11-04): the chain paints one ledge per row, so a
                // straight-forward run BURIES each ledge's walking surface
                // under the next ledge's mass — measured at HEAD da8c8c9,
                // ZERO strict marker sites existed on 320/320 vertical maps
                // and 96.6% shipped no enemies at all (the route-adjacent
                // fallback's single-cell seats die at the ENEMY_MIN_RUN
                // deploy filter). A direction REVERSAL at the next link
                // extends its ledge BACKWARD, leaving this link's decorative
                // run open as a genuine >=2-column patrol shelf above clear
                // headroom; flipChance sizes how often that happens and
                // flipCap FORCES one after that many straight links, so
                // every multi-link segment carries at least one pocket
                // instead of leaving the threat layer to chance (wall
                // bounces reset the counter too — they reverse travel just
                // the same). On shaft maps the upper segment uses a cap of
                // 2: its rows A-1/A-2 sit inside the approach-window ban, so
                // the pocket must come from link 2's landing row (A-3) or
                // higher above the window. Mean forward run stays multi-link
                // (unlike the removed forced flip), walls still bounce, and
                // the constructor BFS stays the authority on the climb.
                const flip = kv.flipChance > 0 &&
                    (this.rng() < kv.flipChance ||
                        sinceFlip >= (g === null ? kv.flipCap : 2));
                step = (flip ? -dir : dir) * (this.rng() < 0.15 ? 2 : 1);
                sinceFlip = flip ? 0 : sinceFlip + 1;
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
                    sinceFlip = 0; // a bounce reverses travel like a flip
                }
                // Support-punch / mid-cell guard: two collisions freeze the
                // climb at this landing. (a) A landing column whose cell-
                // below (row + 1, c) already carries the route gets its
                // support (row, c) PUNCHED by the never-cap rule below — the
                // landing would float. (b) A landing exactly on prevMid sits
                // where the PREVIOUS dist-2 hop needs clear air at target
                // height; painting its support (row, prevMid) severs that
                // hop (flipChance reversals make this collision frequent).
                // Mirrored step first, then unit sidesteps; the constructor
                // BFS stays the final authority if all fail. The pre-flip
                // wave gated the punch half off for 'standard' (its byte-
                // identity contract predates this file's flip draws); with
                // vertical streams intentionally reshuffled by the pocket
                // bias, every motif shares one guard.
                if (this.pathCells.has((row + 1) * w + c) || c === prevMid) {
                    // Unit sidesteps first (cheapest visual break), then
                    // two-column escapes: at a wall a U-turn collision has
                    // NO legal unit neighbour (both sides collide or leave
                    // the map) while a dist-2 landing always fits — its
                    // support rides the fresh span, and the hop's mid cell
                    // is exactly the air the never-cap rule already keeps
                    // open at the turn.
                    for (const alt of [x - step, x + 1, x - 1, x + 2, x - 2]) {
                        if (alt >= 1 && alt <= w - 2 && !inShaftCols(alt) &&
                            !this.pathCells.has((row + 1) * w + alt) &&
                            alt !== prevMid) {
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
                // Never bury the previous dist-2 hop's intermediate cell:
                // it sits at THIS row and must stay air for that hop to
                // validate (leaving a hole here is cosmetic — support runs
                // and patrol spans own walkability, the BFS owns the route).
                if (cx === prevMid) continue;
                tiles[row][cx] = 1;
            }
            // Jump-off and landing cells carry the route: protect them from
            // spikes AND enemy markers (a patrol sweeping a route cell
            // makes the only validated climb periodically lethal, S10).
            this.pathCells.add(row * w + x);
            this.pathCells.add((row - 1) * w + c);
            // Record this hop's mid cell for the NEXT link's paint row;
            // dist-1 hops carry none. Steered hops record it too (their
            // dist-2 option can bury its own mid under the next link's
            // span); the steered branch never READS prevMid for landing
            // selection — its delivery geometry is fixed and validated by
            // construction — it only keeps the air clear.
            prevMid = Math.abs(step) === 2 ? x + Math.sign(step) : -1;
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
            sinceFlip = 0; // the upper segment owes itself a pocket too
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
        // one launch column either side, and routeFair() rejects
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
    // call site is routeFair below — post-deployment, on the shipped
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

    // Post-deployment fairness check for HORIZONTAL constructions (renamed
    // from canyonRouteFair by the soft-lock wave 2026-11-05: three shipped
    // soft-locks L32/32010, L44/44019, L83/1514804096 were canyon-class, but
    // the lie it guards against — a model route physics cannot fly — is not
    // canyon-specific, and the OOB phantom foothold that fooled the old early
    // return for non-canyon motifs proves narrower scope buys nothing).
    // The authoritative verdict runs once per accepted construction, AFTER
    // deployment, because the pre-placement gates run before spikes/markers
    // land and their removals re-open cells the shipped route later walks as
    // a flat fall — L48 s48001 carried exactly such a construction whose pre-
    // placement gates ALL passed while every physical crossing of the pit at
    // 7..9 died in void or on the spike at 15,19. Fail => clear the board and
    // regenerate (attempts consume the same streams, so terrain stays
    // deterministic per attempt ordinal). Two tiers:
    //   1) geometry (canyon) — headroom-aware walk must reach the portal;
    //   2) physics (when Level.physRoute is injected by the verification
    //      harness) — the portal must be reachable using ONLY edges the
    //      shipped player/physics simulation lands, deck/lift crossings
    //      trusted, plus grounded landings harvested mid-flight. This is
    //      edgecheck's soft-lock cross-check moved inside the accept loop;
    //      runtime play never injects it (zero-dependency rule), and the
    //      sweeps prove zero soft-locks ship.
    // Vertical maps stay exempt from THIS GATE, honestly documented: their
    // BFS is already headroom-aware, shaft rides are trusted edges validated
    // by the rider suites, and the reduced battery below was never calibrated
    // against climb geometry — extending it blind risks attempt-economy
    // collapse without a measured soft-lock class to justify it (fresh-
    // catalog sweep found none vertical, pre or post fix). NOTE (review):
    // the exemption covers ONLY this physics gate — the R1' spike-wall clause
    // lives in the SHARED computeReachable scan and conservatively reshapes
    // spiked verticals (~8% of sampled climbs >=L28 drift vs older builds;
    // edge-removal only, determinism intact, no fairness hole).
    routeFair() {
        if (this.direction === 'vertical') return true;
        if (this.motif === 'canyon' && !this.validateCanyonRoute()) {
            return false;
        }
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
        // Same maximal-walkable-run arithmetic the density cap groups by
        // (walkRunExtent, module scope) — one definition, no drift.
        return walkRunExtent(tiles, this.width, this.height, x, y,
            this.pathCells);
    }

    // One geometry pass over the grid's type-4 markers producing every
    // valid enemy deployment: standable marker tile, reachable from the
    // player spawn, free patrol span (patrolSpan), clamped to the
    // direction's band (patrolBandBounds). Consumed by spawnEnemies (which
    // additionally drops sub-ENEMY_MIN_RUN sites before rolling kinds) and
    // by the constructor's validity guard; note the fairness-window clamps
    // below can shrink a placement-legal span to one column, which is
    // exactly why the deploy filter re-checks final travel (ENEMY_MIN_RUN).
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
        let left = Math.max(span.left, bandMin);
        let right = Math.min(span.right, bandMax);
        // Predict the shaft approach-window clamp that deriveEnemySpawns
        // applies AFTER placement (mirror of its column-scoped rule): a legal
        // site just outside the window whose span reaches INTO it arrives at
        // deployment narrower than it looked here — historically the largest
        // single leak class (165 of 419 sub-tile patrols @f18725e). Seating
        // markers only on sites that survive the predicted clamp makes the
        // ENEMY_MIN_RUN deploy filter a formality instead of a reaper.
        // Shaft gaps never co-occur with horizontal or 'left' maps, so this
        // block is a provable no-op there and their streams stay byte-exact.
        if (this.shaftGap) {
            const wLo = this.shaftGap.sx - SHAFT_LEDGE_W - SHAFT_WINDOW_PAD;
            const wHi = this.shaftGap.ex + SHAFT_LEDGE_W + SHAFT_WINDOW_PAD;
            if (x < wLo) right = Math.min(right, wLo - 1);
            else if (x > wHi) left = Math.max(left, wHi + 1);
        }
        // Strict sites patrol at least two columns. The fallback pass also
        // accepts a one-column shelf ON HORIZONTAL MAPS: it still saves the
        // CONSTRUCTION from being thrown (the validity guard reads raw
        // deriveEnemySpawns, and starving these last sites is what burned
        // whole 200-attempt budgets on tight climb grids), but since ruling
        // 2026-11-04 the deploy filter in spawnEnemies drops such sites
        // instead of shipping a body with sub-tile travel that clamp-flips
        // every frame (the old "stationary enemy" claim was never true — it
        // vibrates). On VERTICAL maps the fallback now demands the same >=2
        // final span as the strict pass: cramped seats could never deploy
        // anyway, so accepting them only burned the marker budget on a body
        // the filter reaps — the vertical layout machine (flipChance pockets,
        // see generateVertical) guarantees real ledges exist instead. The
        // constructor's derive-guard keeps its teeth: attempts without any
        // legal site still reroll, which is the selection pressure that made
        // pre-rescue measurements ship enemies on every accepted map.
        // Horizontal fallback behavior is byte-identical to before.
        const minSpan = opts.allowRouteAdjacent &&
            this.direction !== 'vertical' ? 1 : 2;
        return right - left + 1 >= minSpan;
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

        // One marker per support run on VERTICAL maps: a wide pocket ledge
        // offers several legal columns, and seating a marker on each packs
        // 3+ patrols onto one shelf — a wall-of-enemies read that the tier
        // caps were never meant to deliver on climbs ("patrols are
        // seasoning; the climb is the difficulty"). Mirrors the joint-hostile
        // one-run rule's economics for ALL kinds: one shelf, one patrol.
        // Horizontal maps keep multi-site shelves (their corridor width IS
        // the threat space) and byte-exact streams.
        const markedRuns = new Set();
        let placed = 0;
        for (const c of candidates) {
            if (placed >= target) break;
            if (this.direction === 'vertical') {
                const runKey = solidRunKey(
                    tiles, this.width, c.x, c.y + 1);
                if (markedRuns.has(runKey)) continue;
                markedRuns.add(runKey);
            }
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
                if (this.direction === 'vertical') {
                    const runKey = solidRunKey(
                        tiles, this.width, c.x, c.y + 1);
                    if (markedRuns.has(runKey)) continue;
                    markedRuns.add(runKey);
                }
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

        // Only place coins on tiles the player can actually reach. Coins MAY
        // sit inside an enemy patrol (player ruling 2026-11-04: "Enemies
        // can't walk through coins, I think they should be able to, it's
        // only me that collides with them to pick them up") — enemies have
        // zero interaction with coins at runtime: Collectibles.checkCollection
        // tests the PLAYER AABB only (collectibles.js), and no enemy code
        // path reads or blocks coins. The old exclusion (~18% of coins had
        // been sitting on marker tiles before it) also cost candidate pool
        // on every enemy-bearing map; removing it reshuffles coin layouts
        // there (accepted design change; L1..4 keep byte-identical layouts
        // — those maps deploy no enemies so the excluded set was empty).
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
        // Safe-hub restriction (fairness wave 2026-11-04, see
        // computeCoinSafeHub): a coin must sit where the player can STILL
        // reach the portal alive after grabbing it. Forward-reachable-only
        // pools let vertical zigzag shelves host coins behind >=2-tile walls
        // (drop in, never jump out) — collecting them made DEATH the only
        // exit and, with coins persisting across retries, the completion
        // mechanic (player report L25). Pool filtering happens HERE, after
        // acceptance, so generation attempt counts are untouched; maps whose
        // hub pool cannot fill the target degrade gracefully to fewer coins
        // (never throw, never re-attempt). Fixtures that swap
        // reachableTiles outside a constructor run clear coinSafeHub to
        // keep the old unrestricted-pool behaviour.
        const hub = this.coinSafeHub;
        for (const key of this.reachableTiles) {
            if (key === spawnKey || key === portalKey) continue;
            if (hub !== null && hub !== undefined && !hub.has(key)) continue;
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

        // Narrow-shelf deploy filter (player ruling 2026-11-04, see
        // ENEMY_MIN_RUN): drop every site whose final bounds cannot carry a
        // real patrol — support run < 2 under the spawn column, OR less than
        // one full tile of body travel between the FINAL (post band/bridge/
        // shaft-clamp) bounds. This catches all four leak paths at their
        // confluence: markers are validated pre-clamp (and pre-mirror for
        // 'left'), while the fairness windows clip spans only here, so a
        // site that was legal at placement can arrive here as a single
        // vibrating column. Filtering AFTER derive (never inside it) keeps
        // terrain byte-identical: the constructor's validity guard still
        // sees raw derive results, generation attempts never change, and no
        // seed newly throws. Stream effects stated honestly: enemy COUNT may
        // drop on affected maps (measured pre-fix: ~37% of L5+ maps held
        // ONLY illegal sites and now ship zero enemies — and for VERTICAL
        // maps specifically the rate is 96.6%: their sole markers came from
        // the cramped route-adjacent fallback, so the vertical threat layer
        // awaits an upstream placement wave that seats >=2-col ledges at
        // MARKER time); dropping BEFORE the rolls consumes fewer rng draws,
        // so kind assignments shift versus old builds on mixed maps AND the
        // later deriveMovingPlatforms draws shift with them (deck speed /
        // phase differ vs old builds on ~22% of maps — deterministic per
        // seed, fairness-neutral since gap geometry validates pre-roll);
        // cross-build comparability is broken by design — fix 2's
        // coin-exclusion removal already reshapes the stream upstream via
        // extractCoins' shuffle, and grew realized coin yield ~29% (the
        // patrol cells were mostly safe surface), which the clear-bonus
        // calibration notes in main.js should be re-checked against.
        const legalSpawns = spawns.filter(s =>
            solidRunWidth(this.tiles, this.width, s.x, s.y + 1) >= ENEMY_MIN_RUN &&
            (s.right - s.left + 1) * this.tileSize - ENEMY_WIDTH >= this.tileSize);

        // Stacked-patrol gauntlet gate (see GAUNTLET_MIN_BODIES): drop sites
        // BEFORE any kind roll so terrain stays byte-identical and kinds are
        // never re-rolled — same stream discipline as the narrow-shelf filter
        // above (enemy COUNT may drop on affected maps; later rng consumers
        // shift with it, deterministic per seed). Greedy in derive order: a
        // site is kept unless its deployment COMPLETES a gauntlet config
        // (must-pass neighborhood with zero uncovered pockets and >=3
        // sweeping bodies); the last body that walls the traverse goes, the
        // earlier ones keep their patrol. Vertical maps skip the pass — the
        // exemption's shaft-blind exposure was MEASURED zero 2026-11-06
        // (see the GAUNTLET_MIN_BODIES header + the pin in
        // tests/unit/enemy_shaft_gauntlet_fairness.test.js).
        // Route articulation cells, hoisted so BOTH post-roll consumers
        // share one computation (no rng involved): the stacked-patrol
        // gauntlet gate below (>=GAUNTLET_MIN_BODIES sites) and the spiny
        // debut on-ramp demotion in the roll loop (SPINY_ONRAMP_LAST_LEVEL).
        const inOnrampWindow = this.levelNumber >= SPINY_FIRST_LEVEL &&
            this.levelNumber <= SPINY_ONRAMP_LAST_LEVEL;
        let routeMustPass = null;
        if (this.direction !== 'vertical' && this.portalTile &&
            (legalSpawns.length >= GAUNTLET_MIN_BODIES || inOnrampWindow)) {
            routeMustPass = computeMustPassCells(
                this.tiles, this.width, this.height,
                this.spawnTile, this.portalTile, this.bridgeGap);
        }
        let deploySpawns = legalSpawns;
        if (routeMustPass && routeMustPass.size > 0 &&
            legalSpawns.length >= GAUNTLET_MIN_BODIES) {
            const mustPass = routeMustPass;
            const kept = [];
            for (const s of legalSpawns) {
                kept.push(s);
                const probe = kept.map(k => ({
                    col: k.x, row: k.y, left: k.left, right: k.right
                }));
                if (gauntletViolations(this.tiles, this.width, this.height,
                    probe, mustPass, this.reachableTiles).length > 0) {
                    kept.pop();
                }
            }
            deploySpawns = kept;
        }

        // Density/grouping fairness (owner ruling 2026-11-08, see the
        // BODIES_PER_RUN_DIVISOR + PORTAL_SHELF_CLEAR_COLS headers): bodies-
        // per-run cap first (shared-surface math), portal-shelf protection
        // second (its one-body bar subsumes the cap on that run). BOTH run
        // BEFORE any kind roll as pure geometry on the final spans: zero
        // extra draws, and excess bodies are skipped placements, so affected
        // maps consume FEWER rolls — kinds shift downstream exactly like the
        // narrow-shelf and gauntlet drops above (deterministic per seed),
        // while tiles/spikes/coins stay byte-identical because this runs
        // after extractCoins and touches no grid cell. The constructor's
        // validity guard reads RAW derive results, so generation attempt
        // counts and terrain selection cannot move either.
        deploySpawns = capBodiesPerPatrolRun(
            this.tiles, this.width, this.height, deploySpawns,
            this.pathCells);
        deploySpawns = protectPortalShelf(
            this.tiles, this.width, this.height, this.portalTile,
            this.direction, deploySpawns, this.pathCells);

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
        const bombardierChance = kindChance(
            this.levelNumber, BOMBARDIER_FIRST_LEVEL, BOMBARDIER_RAMP_LEVELS,
            BOMBARDIER_CHANCE_MAX);
        const spinyCap = Math.ceil(deploySpawns.length / SPINY_CAP_DIVISOR);
        const bombardierCap = Math.ceil(
            deploySpawns.length / BOMBARDIER_CAP_DIVISOR);
        let spinies = 0;
        let bombardiers = 0;
        // Support-run keys that already hold a DEPLOYED hostile (see the
        // joint-hostile shelf rule at HOSTILE_MIN_RUN). Checked after the
        // roll like every other gate: no extra draw, demotion frees the
        // spiny-cap slot exactly as the narrow-shelf demotion does.
        const hostileRuns = new Set();

        for (const s of deploySpawns) {
            let kind = 'walker';
            const roll = this.rng();
            if (roll < spinyChance && spinies < spinyCap) {
                kind = 'spiny';
            } else if (roll >= spinyChance &&
                roll < spinyChance + chargerChance) {
                kind = 'charger';
            } else if (roll >= spinyChance + chargerChance &&
                roll < spinyChance + chargerChance + bombardierChance &&
                bombardiers < bombardierCap) {
                kind = 'bombardier';
            }
            // Shelf fairness gate (see HOSTILE_MIN_RUN): a hostile roll on a
            // narrow pillar demotes to walker — stomp-immune patrols on runs
            // <= 3 tiles make mandatory landings unwinnable (screenshot
            // ruling 2026-11-03). During the debut window the floor rises to
            // HOSTILE_MIN_RUN_ONRAMP for first-contact headroom (see the
            // SPINY_ONRAMP header). Demotion follows the SAME no-re-roll
            // discipline as cap overflow below: one consumed draw per
            // enemy, so rng stream ORDER stays identical; legal-site
            // kinds may still shift because the spiny cap counts
            // DEPLOYED spinies (the header's "of the deployed enemies")
            // — a demoted roll frees its budget slot for a later site.
            // Bombardiers inherit this gate in full: they ARE hostile
            // (stomp-immune contact death like a spiny's body threat, dash
            // like a charger's) plus a gun on top.
            const hostileMinRun = inOnrampWindow
                ? HOSTILE_MIN_RUN_ONRAMP : HOSTILE_MIN_RUN;
            const runW = solidRunWidth(
                this.tiles, this.width, s.x, s.y + 1);
            if (kind !== 'walker' && runW < hostileMinRun) {
                kind = 'walker';
            }
            // Spiny debut on-ramp, route clause (see SPINY_ONRAMP_*):
            // during the debut window a hostile sweeping a MUST-PASS cell
            // needs the escalated shelf width — meeting the stomp-immune
            // debut on the one traverse you cannot skip, on a shelf with
            // sub-double pass-by room, is the morphology the curve wave
            // measured (every sampled debut spiny stood on the mandatory
            // traverse; half sat on runs < 6). Runs BEFORE the shared-run
            // gate so a stand-down never claims the run key; vertical maps
            // skip it with the gauntlet gate's shaft-blind exemption.
            if (kind !== 'walker' && inOnrampWindow && routeMustPass &&
                routeMustPass.size > 0) {
                let sweepsRoute = false;
                for (let c = s.left; c <= s.right; c++) {
                    if (routeMustPass.has(s.y * this.width + c)) {
                        sweepsRoute = true; break;
                    }
                }
                if (sweepsRoute && runW < HOSTILE_ROUTE_MIN_RUN_ONRAMP) {
                    kind = 'walker';
                }
            }
            // Firing-lane gate (bombardier only): the site needs >= 2 open
            // walk-row cells in FRONT of at least ONE heading so it can't
            // be buried in a nook with no usable lane at all. Expressed via
            // the FINAL span data (left/right are post-clamp walkable
            // columns, every cell of which is open air by construction).
            // WHY one side, not both (measured @this wave, L40..60 x 10
            // seeds): markers overwhelmingly seat near span edges — the
            // both-sided check passed only 57/579 legal sites (10%), which
            // starved the kind to ~4 deployments across 210 maps (a dead
            // feature); the at-least-one-heading check passes 418/579
            // (72%). The runtime line-of-fire veto in enemies.js is what
            // actually prevents a point-blank shot into a wall on EITHER
            // heading; this placement rule only bans the fully-buried
            // morphology. Honest gap: a gun facing its wall mid-patrol
            // simply never gets a clear arc on that heading — it looks
            // idle, never unfair.
            if (kind === 'bombardier' &&
                s.x - s.left < 2 && s.right - s.x < 2) {
                kind = 'walker';
            }
            // Joint-hostile shelf gate (see the rule at HOSTILE_MIN_RUN):
            // a hostile roll on a run that already carries one demotes to
            // walker — two stomp-immune patrols sweeping the same surface
            // leave no safe tile mid-crossing (screenshot ruling 2026-11-04:
            // twin spinies evenly spaced on one wide shelf; a spiny/charger
            // quad packed into five tiles). Same no-re-roll discipline.
            // Runs LAST (after the firing-lane demotion above) so a
            // bombardier stand-down never claims the run key.
            if (kind !== 'walker') {
                const runKey = solidRunKey(
                    this.tiles, this.width, s.x, s.y + 1);
                if (hostileRuns.has(runKey)) kind = 'walker';
                else hostileRuns.add(runKey);
            }
            if (kind === 'spiny') spinies++;
            if (kind === 'bombardier') bombardiers++;
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
                kind,
                // Combat context: only bombardiers read it (their cannon
                // pushes into this Level's projectile manager and raycasts
                // this grid); every other kind ignores the argument.
                { projectiles: this.projectileManager,
                    terrain: this.projectileManager.terrain }
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

    /**
     * M3 placement pass (see the capability-objects constant header). Runs
     * at the constructor tail over the ACCEPTED grid: reads tiles/reachability/
     * coins/enemies/decks, writes only this.pads / this.crates descriptor
     * arrays ([] when nothing qualifies). Deterministic per seed like
     * everything else — a retry rebuilds byte-identical objects.
     */
    placeCapabilityObjects() {
        this.pads = [];
        this.crates = [];
        if (tierIndexFor(this.levelNumber) < CAPABILITY_TIER_MIN) return;

        const forbidden = this._capabilityForbiddenCells();

        // Pad: roll, then pick uniformly among candidates in scan order.
        if (this.rng() < PAD_CHANCE) {
            const cands = this._findPadCandidates(forbidden);
            if (cands.length > 0) {
                const cell = cands[Math.floor(this.rng() * cands.length)];
                this.pads.push({
                    x: cell.col * this.tileSize,
                    y: cell.row * this.tileSize,
                    col: cell.col,
                    row: cell.row
                });
            }
        }
        // Crate: same discipline; initial seat is the stand-run midpoint so
        // the bounded travel stays symmetric around a visible resting spot.
        if (this.rng() < CRATE_CHANCE) {
            const cands = this._findCrateCandidates(
                this._capabilityForbiddenCells(true));
            if (cands.length > 0) {
                const pocket = cands[Math.floor(this.rng() * cands.length)];
                const mid = pocket.L + Math.floor((pocket.R - pocket.L) / 2);
                this.crates.push({
                    x: mid * this.tileSize,
                    y: pocket.row * this.tileSize,
                    col: mid,
                    row: pocket.row,
                    // Containment contract for tests/sweeps: the crate may
                    // never leave columns [BL..BR] on its spawn row.
                    channelLeft: pocket.BL,
                    channelRight: pocket.BR
                });
            }
        }
    }

    /**
     * Cells pads AND crate channels must stay out of (keyed y*width+x):
     * route articulation (must-pass cells horizontal via computeMustPassCells
     * — the exact set the gauntlet gate consumes; vertical maps have no
     * articulation model, so their forced pathCells carry the ban), spawn
     * neighborhood, portal approach band, every coin body cell, every
     * DEPLOYED patrol span (final minX/maxX bounds, enemy row), and the deck
     * corridor / shaft swept bands plus one column of flank. Conservative by
     * design: an over-ban costs one missed pad, never a broken proof.
     */
    _capabilityForbiddenCells(includeCoinHub = false) {
        const w = this.width, h = this.height;
        const key = (x, y) => y * w + x;
        const bad = new Set();
        const addRect = (x0, y0, x1, y1) => {
            for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
                for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
                    bad.add(key(x, y));
                }
            }
        };
        // Route cells: articulation points (horizontal) or the constructed
        // climb's jump-off/landing set (vertical). Null-safe both ways.
        if (this.direction === 'vertical') {
            if (this.pathCells) for (const k of this.pathCells) bad.add(k);
        } else if (this.portalTile) {
            const mustPass = computeMustPassCells(
                this.tiles, w, h, this.spawnTile, this.portalTile,
                this.bridgeGap);
            if (mustPass) for (const k of mustPass) bad.add(k);
        }
        // Coin safe-hub cells — CRATE CHANNELS ONLY per the brief's rule list
        // (pads only owe the route-waiting-spot ban): a shoved crate must
        // never occupy a cell on a portal-preserving coin route — the body
        // ban alone would let it sit one step off a coin's safe line.
        // Null-safe: hub is null when no model exists.
        if (includeCoinHub && this.coinSafeHub) {
            for (const k of this.coinSafeHub) bad.add(k);
        }
        // Spawn neighborhood (+/-2) and portal approach (+/-1 around the
        // portal body rows).
        addRect(this.spawnTile.x - 2, this.spawnTile.y - 2,
            this.spawnTile.x + 2, this.spawnTile.y + 2);
        if (this.portalTile) {
            addRect(this.portalTile.x - 1, this.portalTile.y - 1,
                this.portalTile.x + 1, this.portalTile.y + 1);
        }
        // Coins: a crate sliding through a coin cell buries it; a pad under
        // a coin is fine (the bounce delivers), but the SHARED forbidden set
        // keeps both simple — coin body cells only.
        const T = this.tileSize;
        for (const c of this.coins) {
            const cx = Math.floor((c.x + c.width / 2) / T);
            const cy = Math.floor((c.y + c.height / 2) / T);
            bad.add(key(cx, cy));
        }
        // Deployed patrols: final travel bounds on the enemy's own row.
        for (const e of this.enemyManager.enemies) {
            const row = Math.floor(e.y / T);
            const c0 = Math.floor(e.minX / T);
            const c1 = Math.floor((e.maxX - 1) / T);
            addRect(c0, row, c1, row);
        }
        // Deck corridor swept band (+1 flank column); elevator cabin band.
        if (this.bridgeGap) {
            const g = this.bridgeGap;
            addRect(g.a - 1, g.S - 2, g.b + 1, g.S);
        }
        if (this.shaftGap) {
            const g = this.shaftGap;
            addRect(g.sx - 1, g.A - 2, g.ex + 1, g.B + 1);
        }
        return bad;
    }

    // Pad candidates: standable floor cell, reachable, NOT on a forbidden
    // cell (R1: never a must-pass waiting spot), with the full rise column
    // clear of rock and teeth for PAD_APEX_CELLS rows (a bounce into solid
    // ceiling or a spike throat would trade a mobility aid for a death
    // trap). Scan order row-major for determinism.
    _findPadCandidates(forbidden) {
        const out = [];
        const w = this.width, h = this.height;
        for (let r = 0; r <= h - 2; r++) {
            for (let c = 0; c < w; c++) {
                if (this.tiles[r][c] !== 0 || this.tiles[r + 1][c] !== 1) {
                    continue;
                }
                const k = r * w + c;
                if (forbidden.has(k)) continue;
                if (!this.reachableTiles.has(k)) continue;
                let clear = true;
                for (let dr = 1; dr <= PAD_APEX_CELLS; dr++) {
                    const rr = r - dr;
                    if (rr < 0) { clear = false; break; }
                    const t = this.tiles[rr][c];
                    if (t === 1 || t === 2) { clear = false; break; }
                }
                if (clear) out.push({ col: c, row: r });
            }
        }
        return out;
    }

    // Crate pockets: maximal flat stand runs (open body row over continuous
    // solid floor) of >= 2 cells whose slide range ends at a SOLID body
    // blocker or the map edge within CRATE_MAX_TRAVEL_PAST_END cells on both
    // sides — a run that merely falls away (missing floor) is rejected, the
    // crate would gravity out of its pocket. Every channel cell must dodge
    // the forbidden set, no spike may sit within one cell below the channel
    // floor (a pushed crate must never create spike cover), and at least one
    // channel cell must be player-reachable (an assist nobody can find is
    // just scenery).
    _findCrateCandidates(forbidden) {
        const out = [];
        const w = this.width, h = this.height;
        const bodyFree = (r, c) => c >= 0 && c < w && this.tiles[r][c] === 0;
        const floored = (r, c) => c >= 0 && c < w && this.tiles[r + 1][c] === 1;
        for (let r = 0; r <= h - 2; r++) {
            let c = 0;
            while (c < w) {
                if (!(bodyFree(r, c) && floored(r, c))) { c++; continue; }
                let L = c;
                while (bodyFree(r, L - 1) && floored(r, L - 1)) L--;
                let R = c;
                while (bodyFree(r, R + 1) && floored(r, R + 1)) R++;
                // Slide range == stand run here by construction: coasting
                // needs the SAME open-body-plus-floor predicate the run scan
                // just exhausted, so BL/BR cannot extend past L/R on a static
                // grid. They stay named separately because the descriptor's
                // containment contract speaks in channel terms, and the
                // travel-budget checks below are what would loosen if crates
                // ever coast (e.g. onto slopes).
                const BL = L;
                const BR = R;
                // Containment: each end must stop at edge or SOLID blocker
                // (not a floor gap), within the travel budget.
                const leftBlocked = BL - 1 < 0 || this.tiles[r][BL - 1] === 1;
                const rightBlocked =
                    BR + 1 >= w || this.tiles[r][BR + 1] === 1;
                const contained = leftBlocked && rightBlocked &&
                    L - BL <= CRATE_MAX_TRAVEL_PAST_END &&
                    BR - R <= CRATE_MAX_TRAVEL_PAST_END;
                if (contained && R - L + 1 >= 2) {
                    // Seat-relative travel budget (REAL conjunct since the
                    // BL≡L cleanup made the old past-end checks vacuous):
                    // from the midpoint seat, neither direction may exceed
                    // CRATE_MAX_TRAVEL_PAST_END cells of shove, so a run of
                    // 8+ is rejected outright. Convention: bound the SHOVE,
                    // not the geometry — max(seat-L, R-seat) <= 3 keeps every
                    // push outcome short enough to stay readable and inside
                    // the pocket's sightline.
                    const midSeat = L + Math.floor((R - L) / 2);
                    if (midSeat - L > CRATE_MAX_TRAVEL_PAST_END ||
                        R - midSeat > CRATE_MAX_TRAVEL_PAST_END) { c = R + 1; continue; }
                    // Pockets are NATURAL bounded trenches (zero terrain
                    // carving). Measured across two independent seed families
                    // of tier>=2 maps (~3200 builds incl. vertical): channel
                    // length histogram ~{2:60, 3:11, 4:35, 5:35} — most
                    // channels are 3..5 cells and LONGER channels live mostly
                    // on vertical maps. The midpoint seat leaves a free cell
                    // beside the crate in every run >= 3, so the player can
                    // drop in behind it and shove it up to
                    // CRATE_MAX_TRAVEL_PAST_END cells before its blocker
                    // (verified player-driven 64 px push on L25 s607974);
                    // flush 2-cell seats give strain feedback plus a static
                    // step-up instead. Crates are therefore a WORKING bounded
                    // assist, never route-required (R2).
                    let ok = true;
                    for (let x = BL; x <= BR && ok; x++) {
                        if (forbidden.has(r * w + x)) ok = false;
                    }
                    // Spike cover check: rows r+1 (channel floor itself) and
                    // r+2 under any channel column.
                    for (let x = BL; x <= BR && ok; x++) {
                        if (this.tiles[r + 1][x] === 2) { ok = false; break; }
                        if (r + 2 < h && this.tiles[r + 2][x] === 2) {
                            ok = false; break;
                        }
                    }
                    if (ok && !this._channelReachable(r, BL, BR)) ok = false;
                    if (ok) out.push({ row: r, L, R, BL, BR });
                }
                c = R + 1;
            }
        }
        return out;
    }

    _channelReachable(row, bl, br) {
        for (let x = bl; x <= br; x++) {
            if (this.reachableTiles.has(row * this.width + x)) return true;
        }
        return false;
    }

    // ── M4 secret alcoves ───────────────────────────────────────────────────
    // Uniform site pick in scan order (house discipline; no budget roll — see
    // the constant header). An empty candidate list simply ships no alcove —
    // the map is NEVER invalidated by carving (zero extra generation
    // attempts, R6 economy rule), and every rng draw sits behind all other
    // consumers.
    /**
     * R8 crag stamp — manufactures the ONE alcove host shape the pure-height
     * grammar cannot produce (see CRAG_ header). FIX ROUND 1 protocol (no
     * main-stream rng, ever):
     *   1. enumerate legal host sites on the fresh grid (pure read);
     *   2. decide + pick via HASH32(seedResolved, attempt ordinal) — zero
     *      draws, so an un-fired or rolled-back stamp leaves the stream at
     *      EXACTLY the position BASE would have it;
     *   3. the caller validates the stamped grid on a FORKED rng
     *      (forkSeed), then either keeps it (shipped stamped map, floats
     *      draw from the fork — documented intentional delta) or calls
     *      _undoStampCrag and re-validates the untouched unstamped grid on
     *      the main stream (bit-for-bit BASE replay for every unstamped
     *      map, including attempt counts).
     * Fills only air/solid rock cells — spike (2) and marker (4) cells are
     * never overwritten (a footprint touching one is rejected), and bridge
     * corridors stay untouched.
     */
    _beginStampCrag(attempt) {
        // Inert guard FIRST: at chance 0 nothing here may even enumerate —
        // byte identity vs BASE must hold for EVERY map.
        if (CRAG_CHANCE <= 0) return null;
        // Measured habitat study (Task 6 + fix round 1, full data in the
        // report): horizontal flat-ground massifs and void-gap islands fail
        // the validators structurally (single-file corridors sealed by the
        // predicate's full-height far wall); VERTICAL wide ledges are the
        // viable habitat (multi-path ascents, >= 5-column flats on every
        // sampled map), so the stamp targets vertical maps only.
        if (tierIndexFor(this.levelNumber) < ALCOVE_TIER_MIN) return null;
        if (this.direction !== 'vertical') return null;
        const w = this.width, hgt = this.height, tiles = this.tiles;
        const ground = new Array(w);
        for (let x = 0; x < w; x++) {
            let r = 0;
            while (r < hgt && tiles[r][x] !== 1) r++;
            ground[x] = r;
        }
        const fillable = (r, x) => tiles[r][x] === 0 || tiles[r][x] === 1;
        const sites = [];
        for (const side of [-1, 1]) {
            for (let c = 2; c <= w - 3; c++) {
                const tunnelX = side === -1 ? c - 1 : c + 2;
                const terraceX = side === -1 ? c - 2 : c + 3;
                const farX = side === -1 ? c + 2 : c - 1;
                if (terraceX < 1 || terraceX > w - 2) continue;
                const p = ground[c];
                if (p >= hgt) continue;
                if (ground[c + 1] !== p || ground[tunnelX] !== p ||
                    ground[farX] !== p || ground[terraceX] !== p) continue;
                const e = p - 1;                       // entry row
                if (e < ALCOVE_H_MAX + 1) continue;    // cap headroom
                for (let h = ALCOVE_H_MIN; h <= ALCOVE_H_MAX; h++) {
                    let ok = true;
                    for (let r = e - h; r <= e && ok; r++) {
                        if (!fillable(r, c) || !fillable(r, c + 1)) ok = false;
                    }
                    for (let r = e - h + 1; r <= e && ok; r++) {
                        if (!fillable(r, tunnelX) || !fillable(r, farX)) {
                            ok = false;
                        }
                    }
                    if (ok) sites.push({ col: c, entryRow: e, h, side });
                }
            }
        }
        if (sites.length === 0) return null;           // zero everything
        const base = cragHash((this.seedResolved ^
            Math.imul(attempt + 1, 0x9E3779B1)) >>> 0);
        if (base / 0x100000000 >= CRAG_CHANCE) return null;
        const site = sites[cragHash((base ^ sites.length ^
            0xC0FFEE) >>> 0) % sites.length];
        const { col: c, entryRow: e, h, side } = site;
        const tunnelX = side === -1 ? c - 1 : c + 2;
        const farX = side === -1 ? c + 2 : c - 1;
        const saved = [];
        for (let r = e - h; r <= e; r++) {
            for (const x of [c, c + 1]) {
                saved.push({ r, x, prev: tiles[r][x] });
                tiles[r][x] = 1;
            }
        }
        for (let r = e - h + 1; r <= e; r++) {
            for (const x of [tunnelX, farX]) {
                saved.push({ r, x, prev: tiles[r][x] });
                tiles[r][x] = 1;
            }
        }
        const filled = new Set(saved.map((s) => s.r * w + s.x));
        return { site, saved, filled, forkSeed: cragHash((base ^ 0xF0DBAD) >>> 0) };
    }

    // Roll a failed stamp back exactly (every written cell restored to its
    // prior value); the grid becomes bit-identical to the pre-trial state.
    _undoStampCrag(trial) {
        for (const s of trial.saved) this.tiles[s.r][s.x] = s.prev;
    }

    placeAlcove() {
        this.alcove = null;
        if (tierIndexFor(this.levelNumber) < ALCOVE_TIER_MIN) return;
        // M-1 EXEMPTION + SAFETY PROOF (fix round 1, controller-mandated):
        // a stamped host's new shelf ATTRACTS coin placement onto the cap —
        // those coins' +/- margin proximity rects then veto the very site
        // the stamp manufactured (measured: 45/45 validator survivors died
        // here). The exemption binds the EXACT host-candidate geometry
        // (col, entryRow, h, side — matched in _findAlcoveCandidates): only
        // the candidate identical to the stamped site skips the footprint
        // forbidden test; the forbidden set itself is never loosened. Why
        // that is safe:
        //  1. _carveAlcove flips ONLY solid rock to air (tunnel cell + shaft
        //     columns rows entry-h+1..entry); every hazard body (enemy/pad/
        //     crate/deck band/spike/portal/spawn/coin) occupies a FREE cell
        //     pre-carve, so no body can physically be inside a flipped cell.
        //  2. No body loses support either: bodies standing on the stamped
        //     surfaces rest on the CAP row (entry-h) or on ground at/below
        //     the shaft floor row — carve never touches the cap row, and
        //     nothing ever stood ON the shaft-floor pair pre-carve because
        //     those cells were solid rock until the flip.
        //  3. Every OTHER candidate keeps full protection: a looser co-
        //     located geometry (e.g. a taller shaft whose carve would flip
        //     the cap under a shelf coin) still has its WHOLE footprint
        //     tested, and a body sitting at the mouth APPROACH still vetoes.
        // Property-pinned per shipped alcove (tests/unit/alcove_predicate
        // .test.js sweep): no hazard body center lands in a carved cell;
        // standable delta is pure addition (+2/-0 on verticals — headroom-
        // aware BFS drops the tunnel cell, see m-1 note in ALCOVE header);
        // secret coins stay base-BFS-unreachable; meetsPortalRequirement
        // counts required (non-secret) coins only.
        const forbidden = this._alcoveForbiddenCells();
        const cands = this._findAlcoveCandidates(forbidden, this.cragSite);
        if (cands.length === 0) return;
        const site = cands[Math.floor(this.rng() * cands.length)];
        this._carveAlcove(site);
    }

    /**
     * Hazard zones an alcove footprint must stay out of: +/- ALCOVE_FORBID_
     * MARGIN rects around every spike tile, the portal body column band
     * (+1 row of approach above), each DEPLOYED patrol span on its own row,
     * each placed pad cell, each crate channel cell, each coin body cell and
     * the spawn neighbourhood. Conservative by design (over-ban costs one
     * missed alcove, never a broken proof). Route cells deliberately absent
     * — see the carve-invariance argument in the constant header.
     */
    _alcoveForbiddenCells() {
        const w = this.width, h = this.height;
        const m = ALCOVE_FORBID_MARGIN;
        const bad = new Set();
        const addRect = (x0, y0, x1, y1) => {
            for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
                for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
                    bad.add(y * w + x);
                }
            }
        };
        for (let r = 0; r < h; r++) {
            for (let c = 0; c < w; c++) {
                if (this.tiles[r][c] === 2) addRect(c - m, r - m, c + m, r + m);
            }
        }
        if (this.portalTile) {
            // Portal body spans its cell plus half a row up (32x48 anchor):
            // ban the union expanded by the margin.
            const p = this.portalTile;
            addRect(p.x - m, p.y - m - 1, p.x + m, p.y + m);
        }
        const T = this.tileSize;
        for (const e of this.enemyManager.enemies) {
            const row = Math.floor(e.y / T);
            const c0 = Math.floor(e.minX / T);
            const c1 = Math.floor((e.maxX - 1) / T);
            addRect(c0 - m, row - m, c1 + m, row + m);
        }
        for (const pad of this.pads) {
            addRect(pad.col - m, pad.row - m, pad.col + m, pad.row + m);
        }
        for (const crate of this.crates) {
            addRect(crate.channelLeft - m, crate.row - m,
                crate.channelRight + m, crate.row + m);
        }
        for (const coin of this.coins) {
            const cx = Math.floor((coin.x + coin.width / 2) / T);
            const cy = Math.floor((coin.y + coin.height / 2) / T);
            addRect(cx - m, cy - m, cx + m, cy + m);
        }
        addRect(this.spawnTile.x - 2, this.spawnTile.y - 2,
            this.spawnTile.x + 2, this.spawnTile.y + 2);
        return bad;
    }

    // Candidate enumeration in deterministic scan order (row, col, height,
    // side). The TERRACE cell must be base-reachable (R5: the mouth opens
    // onto ground the player already stands on); geometry via the exported
    // predicate; footprint (terrace through far wall, cap through shaft
    // floor) must miss every hazard zone — except, for the candidate that IS
    // the stamped host (`stamp` = {site, cells}), hits landing on stamp-written
    // cells (see placeAlcove SAFETY PROOF; the exemption is bound to the
    // stamped geometry so no OTHER candidate — e.g. a taller co-located shaft
    // whose carve would flip the cap under a shelf coin — inherits it).
    _findAlcoveCandidates(forbidden, stamp = null) {
        const out = [];
        const w = this.width, hgt = this.height;
        const key = (x, y) => y * w + x;
        for (let e = 1; e <= hgt - 2; e++) {
            for (let c = 1; c <= w - 3; c++) {
                for (const side of [-1, 1]) {
                    const terraceX = side === -1 ? c - 2 : c + 3;
                    if (terraceX < 0 || terraceX > w - 1) continue;
                    if (!this.reachableTiles.has(key(terraceX, e))) continue;
                    for (let hh = ALCOVE_H_MIN; hh <= ALCOVE_H_MAX; hh++) {
                        const site = { col: c, entryRow: e, h: hh, side };
                        if (!alcoveGeometryValid(this.tiles, w, hgt, site)) continue;
                        // M-1 exemption (see placeAlcove SAFETY PROOF): the
                        // candidate that IS the stamped host skips the hazard
                        // proximity rects over its own footprint. Bound to
                        // the EXACT stamped geometry (col, entryRow, h, side)
                        // so no other candidate inherits it.
                        if (stamp !== null && stamp.col === c &&
                            stamp.entryRow === e && stamp.h === hh &&
                            stamp.side === side) {
                            out.push(site);
                            continue;
                        }
                        let ok = true;
                        // Footprint rect: far wall .. terrace, cap .. shaft floor.
                        const fx0 = side === -1 ? c - 2 : c - 1;
                        const fx1 = side === -1 ? c + 2 : c + 3;
                        for (let r = e - hh; r <= e && ok; r++) {
                            for (let x = fx0; x <= fx1 && ok; x++) {
                                if (forbidden.has(key(x, r))) ok = false;
                            }
                        }
                        if (ok) out.push(site);
                    }
                }
            }
        }
        return out;
    }

    // Execute the carve: flip the tunnel cell plus the shaft columns from
    // the shaft floor up through the interior (all solid rock pre-carve),
    // re-derive the platform colliders from the carved grid (extractPlatforms
    // is a pure scan — without this the chimney would ship ghost-rock AABBs
    // exactly where the shaft now is), then drop 1..3 secret coins into
    // distinct INTERIOR cells (rows above the shaft floor — the floor pair
    // and tunnel are reachable dead-end cells, secrets live out of the base
    // BFS's standable-only view). rng order: k roll, then the house Fisher-
    // Yates over the interior pool.
    _carveAlcove(site) {
        const { col: c, entryRow: e, h, side } = site;
        const tunnelX = side === -1 ? c - 1 : c + 2;
        const flipped = [{ x: tunnelX, r: e }];
        for (let r = e - h + 1; r <= e; r++) {
            for (const x of [c, c + 1]) {
                this.tiles[r][x] = 0;
                flipped.push({ x, r });
            }
        }
        this.tiles[e][tunnelX] = 0;
        this.platforms = this.extractPlatforms();
        const interior = flipped.filter((f) => f.r < e);
        const k = SECRET_COIN_MIN +
            Math.floor(this.rng() * (SECRET_COIN_MAX - SECRET_COIN_MIN + 1));
        shuffle(interior, this.rng);
        for (let i = 0; i < Math.min(k, interior.length); i++) {
            this.coins.push({
                x: interior[i].x * this.tileSize,
                y: interior[i].r * this.tileSize,
                width: 16,
                height: 16,
                collected: false,
                secret: true
            });
        }
        this.alcove = {
            col: c,
            entryRow: e,
            topRow: e - h + 1,
            h,
            side,
            tunnel: { x: tunnelX, r: e },
            flipped,
            coins: Math.min(k, interior.length)
        };
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

    // M3 capability-object descriptors ([] when nothing qualified). Static
    // data: live pad squash clocks / crate kinematics live in main.js, built
    // fresh per publish so a retry replays identical objects.
    getPads() {
        return this.pads;
    }

    getCrates() {
        return this.crates;
    }

    // M4 secret alcove descriptor ({col, entryRow, topRow, h, flipped,
    // coins}) or null when this map ships none. See the constant header.
    getAlcove() {
        return this.alcove;
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

    // Bombardier cannonballs for this Level instance (empty until a gun
    // fires; fresh with every rebuilt Level, so retries start clean).
    getProjectileManager() {
        return this.projectileManager;
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
    draw(ctx, sprites = null, player = null) {
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

        // Draw enemies (EnemyManager owns per-enemy drawing). Wave B threads
        // the player through as read-only proximity context for telegraphs.
        this.enemyManager.drawAll(ctx, sprites, player);

        // Draw coins AFTER enemies (ruling 2026-11-04: patrols may cross
        // coins again). Coins used to draw first, so a body mid-sweep fully
        // hid the 16px pickup — that read as "enemy in FRONT of the coin",
        // never as "walking THROUGH it". Keeping the collectible on top
        // makes the pass-through legible frame by frame AND keeps every
        // coin findable under the all-coins portal gate: a slime sweeping
        // in front would blink out a coin the player must hunt down.
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

// Verification-harness hook for routeFair (see its comment): sweeps
// assign a function (level) => boolean that answers "is the portal reachable
// from spawn using ONLY physics-simulated landed edges (plus trusted deck /
// lift crossings and harvested grounded landings)?" Runtime play leaves it
// unset, keeping the shipped module zero-dependency.
Level.physRoute = null;
