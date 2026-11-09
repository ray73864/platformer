/**
 * Interestingness metrics (capability program M4) — PURE functions computed
 * POST-generation over a finished Level. Nothing here is read by the
 * generator itself: generation, validation and the retry-exact-map contract
 * stay byte-identical; the candidate chain in main.js only ever USES these
 * numbers to PREFERENCE among candidates it constructed anyway (R6: prefer-
 * never-reject, zero extra retries).
 *
 * Metrics (each documented with its exact formula):
 *
 * ROUTE FORKS — maximum number of internally vertex-disjoint spawn→portal
 * paths over the base reachability digraph. Node-splitting max-flow: every
 * reachable cell v becomes v_in→v_out with capacity 1 (spawn and portal get
 * capacity ∞ so they may carry every path); every recorded base-BFS
 * transition a→b becomes a_out→b_in with capacity 1. Integral capacities ⇒
 * Edmonds-Karp returns an integral max-flow = the disjoint-path count
 * (Menger). Grids are ≤ 40×30 so this is microseconds-to-milliseconds.
 *
 * GREED GRADIENT — spread of coin distances-from-shortest-route. Over the
 * same digraph: s(v) = hop distance from spawn, p(v) = hop distance TO the
 * portal (reverse BFS), R = s(portal). A cell lies ON a shortest route iff
 * s(v)+p(v) === R; D(c) = multi-source forward BFS distance from the route
 * set to coin cell c (non-secret coins only — their cells are guaranteed
 * members of the reachable set by extractCoins; secret coins live off-graph
 * and are covered by the SECRET flag instead). With σ = std-dev of the D
 * values:
 *     greed = 0.6·min(σ/GREED_SIGMA_REF, 1) + 0.2·near + 0.2·far
 * near = ∃ coin with D ≤ GREED_NEAR_D, far = ∃ coin with D ≥ GREED_FAR_D.
 * A tight cluster around the route scores low (σ≈0, no outliers); a free
 * near-cluster PLUS pricey outliers scores high — exactly the distribution
 * the owner prefers over a uniform ring.
 *
 * ENEMY-AS-TOOL — count of canonical stomp-tool setups: a standable shelf
 * cell S with open headroom whose floor line sits EXACTLY two body rows
 * above a walker's patrol floor (slab at S.row+1, walker body row S.row+2),
 * the patrol span passing beneath within TOOL_REACH_COLS of S, and no other
 * standable ground at shelf height within plain-jump reach beside it (the
 * shelf is otherwise walled off). Access model per SPEC M4's continuous
 * math: a plain jump rises JUMP_FORCE²/(2g) ≈ 62.5 px and FAILS the 64 px
 * shelf line; a stomp bounce rises STOMP_BOUNCE²/(2g) ≈ 34.5 px ABOVE the
 * 32 px walker-head bounce point and CLEARS it (66.5 > 64). The repo-side
 * physics test measures the DISCRETE truth (plain 59.6 px, best-case stomp
 * apex ≈ 56–64 px depending on contact penetration) and reports the margin
 * honestly — see tests/unit/alcove_physics.test.js and the Task 6 report;
 * the detector deliberately speaks the spec model so retuning the bounce
 * constant lights it up without a rewrite.
 *
 * SECRET — 1 when the level shipped an alcove (Level.getAlcove()), else 0.
 *
 * PREFERENCE SCORE (R6): weighted sum with the named constants below,
 * reported alongside the components. Weights are modest on purpose:
 * forks dominate (structural route quality is the thing players feel every
 * run), secrets are the rarest single signal (≈ half of eligible maps fail
 * placement outright) so they carry the largest single additive term, the
 * inert-by-physics tool term sits between so a future bounce retune matters
 * without ever dominating. Tie-breaks belong to the CALLER (candidate-chain
 * order), never here — this module is deterministic and stateless.
 */
import { ENEMY_WIDTH } from './enemies.js';

// Continuous-model constants for the ENEMY-AS-TOOL access math (see header).
// These MIRROR main.js's private GRAVITY/JUMP_FORCE/STOMP_BOUNCE — mirrored
// rather than imported because main.js imports THIS module (a cycle would
// form) and those constants are deliberately unexported there. The values
// are pinned against the shipped integrator by tests/unit/alcove_physics.js
// (plain rise 59.6 px discrete vs 62.5 continuous; bounce family documented
// in the Task 5 report), so a silent desync surfaces as a red test.
const GRAVITY = 980;
const JUMP_FORCE = 350;
const STOMP_BOUNCE = 260;

// --- scoring weights (named constants; see header for the rationale) -------
export const WEIGHT_FORKS = 1.0;
export const WEIGHT_GREED = 0.5;
export const WEIGHT_TOOL = 0.75;
export const WEIGHT_SECRET = 1.5;
// Forks normalize against this cap: min(forks, FORK_CAP)/FORK_CAP. Three
// disjoint corridors is already a rich map on these grids (measured max in
// the trend sweep); more than three adds nothing a player perceives.
export const FORK_CAP = 3;

// Greed formula constants (see header).
export const GREED_SIGMA_REF = 4;   // σ of a strong bimodal layout (hops)
export const GREED_NEAR_D = 1;      // "free" coin: one hop off the route
export const GREED_FAR_D = 6;       // "pricey" outlier (hops)

// Enemy-as-tool geometry constants (see header).
export const TOOL_SHELF_DROP_ROWS = 2;          // shelf floor vs patrol floor
export const TOOL_REACH_COLS = 2;               // drift budget over the slab edge
export const TOOL_ISOLATION_COLS = 4;           // "no other way up" band
export const PLAIN_RISE_PX = (JUMP_FORCE * JUMP_FORCE) / (2 * GRAVITY);
export const STOMP_APEX_PX = ENEMY_WIDTH + (STOMP_BOUNCE * STOMP_BOUNCE) / (2 * GRAVITY);

/**
 * Base-model digraph of a finished level: the accepted attempt's recorded
 * transitions (computeReachable's observation channel) restricted to the
 * reachable set. Returns { cells, adj, radj, spawnKey, portalKey, T }.
 */
export function buildBaseGraph(level) {
    const w = level.width;
    const cells = level.reachableTiles;
    const adj = new Map();
    const radj = new Map();
    for (const t of level.modelTransitions || []) {
        const a = t.ay * w + t.ax;
        const b = t.by * w + t.bx;
        if (!cells.has(a) || !cells.has(b)) continue;
        if (!adj.has(a)) adj.set(a, []);
        adj.get(a).push(b);
        if (!radj.has(b)) radj.set(b, []);
        radj.get(b).push(a);
    }
    const sk = level.spawnTile ? level.spawnTile.y * w + level.spawnTile.x : -1;
    const pk = level.portalTile ? level.portalTile.y * w + level.portalTile.x : -1;
    return { cells, adj, radj, spawnKey: sk, portalKey: pk, w };
}

/**
 * Multi-source BFS hop distances over an adjacency map (B1: exported for the
 * pad-value pass in level.js; semantics unchanged).
 */
export function hopDistances(startKeys, adj) {
    const dist = new Map();
    const queue = [];
    for (const s of startKeys) {
        if (!dist.has(s)) {
            dist.set(s, 0);
            queue.push(s);
        }
    }
    for (let qi = 0; qi < queue.length; qi++) {
        const v = queue[qi];
        const d = dist.get(v) + 1;
        for (const n of adj.get(v) || []) {
            if (!dist.has(n)) {
                dist.set(n, d);
                queue.push(n);
            }
        }
    }
    return dist;
}

/**
 * ROUTE FORKS: internally vertex-disjoint spawn→portal path count via
 * node-splitting max-flow (Edmonds-Karp on implicit residual lists; node ids
 * are key*2 (in) / key*2+1 (out)). Returns the raw integer count.
 */
export function routeForks(graph) {
    const { cells, adj, spawnKey, portalKey } = graph;
    if (!cells.has(spawnKey) || !cells.has(portalKey) || spawnKey === portalKey) {
        return 0;
    }
    // Residual graph over split nodes, built once.
    const CAP_INF = cells.size + 1;
    const edges = new Map(); // node -> Array<[to, cap]>
    const addEdge = (u, v, cap) => {
        if (!edges.has(u)) edges.set(u, []);
        edges.get(u).push([v, cap]);
        if (!edges.has(v)) edges.set(v, []);
        edges.get(v).push([u, 0]);
    };
    for (const v of cells) {
        addEdge(v * 2, v * 2 + 1, v === spawnKey || v === portalKey ? CAP_INF : 1);
    }
    for (const [a, outs] of adj) {
        for (const b of outs) addEdge(a * 2 + 1, b * 2, 1);
    }
    const src = spawnKey * 2 + 1; // spawn OUT node (skip its own unit cap)
    const dst = portalKey * 2;    // portal IN node
    let flow = 0;
    for (;;) {
        // BFS for an augmenting path.
        const prev = new Map([[src, null]]);
        const q = [src];
        let found = false;
        for (let qi = 0; qi < q.length && !found; qi++) {
            const u = q[qi];
            for (const e of edges.get(u) || []) {
                if (e[1] > 0 && !prev.has(e[0])) {
                    prev.set(e[0], [u, e]);
                    if (e[0] === dst) { found = true; break; }
                    q.push(e[0]);
                }
            }
        }
        if (!found) break;
        for (let at = dst; at !== src;) {
            const [u, e] = prev.get(at);
            e[1] -= 1;
            // reverse residual edge lives in edges.get(e[0])'s sibling list;
            // find the paired back-edge (to === u) created by addEdge.
            const back = edges.get(at).find((b) => b[0] === u && b[1] === 0);
            back[1] += 1;
            at = u;
        }
        flow++;
    }
    return flow;
}

/**
 * GREED GRADIENT component. Returns { score, sigma, near, far, distances }
 * where distances are the per-coin D values (non-secret coins whose centre
 * cell is in the base graph; others are skipped — documented in the header).
 */
export function greedGradient(level, graph = buildBaseGraph(level)) {
    const { cells, adj, radj, spawnKey, portalKey } = graph;
    const empty = { score: 0, sigma: 0, near: false, far: false, distances: [] };
    if (!cells.has(spawnKey) || !cells.has(portalKey)) return empty;
    const s = hopDistances([spawnKey], adj);
    const p = hopDistances([portalKey], radj);
    const R = s.get(portalKey);
    if (R === undefined) return empty;
    const route = [];
    for (const v of cells) {
        if ((s.get(v) ?? Infinity) + (p.get(v) ?? Infinity) === R) route.push(v);
    }
    const dRoute = hopDistances(route, adj);
    const T = level.tileSize;
    const distances = [];
    for (const coin of level.coins) {
        if (coin.secret) continue;
        const cx = Math.floor((coin.x + coin.width / 2) / T);
        const cy = Math.floor((coin.y + coin.height / 2) / T);
        const k = cy * level.width + cx;
        const d = dRoute.get(k);
        if (d === undefined) continue; // off-graph coin cell (defensive)
        distances.push(d);
    }
    if (distances.length === 0) return empty;
    const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
    const variance = distances.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
        distances.length;
    const sigma = Math.sqrt(variance);
    const near = distances.some((d) => d <= GREED_NEAR_D);
    const far = distances.some((d) => d >= GREED_FAR_D);
    const score = 0.6 * Math.min(sigma / GREED_SIGMA_REF, 1) +
        (near ? 0.2 : 0) + (far ? 0.2 : 0);
    return { score, sigma, near, far, distances };
}

/**
 * ENEMY-AS-TOOL component. Returns { count, shelves } listing the qualifying
 * shelf cells (row/col + the walker patrol bounds beneath). Geometry only —
 * see the header for the access model and the discrete-physics caveat.
 */
export function enemyAsTool(level) {
    const T = level.tileSize;
    const w = level.width, h = level.height;
    const tiles = level.tiles;
    const free = (r, c) => r >= 0 && r < h && c >= 0 && c < w && tiles[r][c] === 0;
    const solid = (r, c) => r >= 0 && r < h && c >= 0 && c < w && tiles[r][c] === 1;
    const standable = (r, c) => free(r, c) && solid(r + 1, c);
    const walkers = (level.enemyManager?.enemies || []).filter((e) => e.kind === 'walker');
    const shelves = [];
    for (const e of walkers) {
        const rw = Math.floor(e.y / T);
        const pc0 = Math.floor(e.minX / T);
        const pc1 = Math.floor((e.maxX - 1) / T);
        const sr = rw - TOOL_SHELF_DROP_ROWS; // shelf body row
        if (sr < 1) continue;
        // Patrol-under-shelf window, widened by the drift budget.
        for (let c = Math.max(0, pc0 - TOOL_REACH_COLS); c <= Math.min(w - 1, pc1 + TOOL_REACH_COLS); c++) {
            if (!standable(sr, c)) continue;          // free cell on the slab
            if (!free(sr - 1, c)) continue;           // headroom for the landing
            if (!free(sr + 2, c) || !solid(sr + 3, c)) continue; // walker lane + its floor
            // Isolation: no OTHER standable ground at shelf height within
            // plain-jump reach beside this shelf's own run (rows sr-1..sr+1,
            // cols c±TOOL_ISOLATION_COLS, excluding contiguous shelf run).
            let isolated = true;
            for (let dr = -1; dr <= 1 && isolated; dr++) {
                for (let dc = -TOOL_ISOLATION_COLS; dc <= TOOL_ISOLATION_COLS && isolated; dc++) {
                    const rr = sr + dr, cc = c + dc;
                    if (!standable(rr, cc)) continue;
                    // Same contiguous slab at shelf row: part of THIS shelf.
                    if (dr === 0 && solid(sr + 1, cc)) continue;
                    // One row below at the slab's own underside is the walker
                    // lane, already checked; anything else is another way up.
                    isolated = false;
                }
            }
            if (isolated) shelves.push({ row: sr, col: c, patrol: [pc0, pc1], patrolRow: rw });
        }
    }
    return { count: shelves.length, shelves };
}

/**
 * Full interestingness profile of a finished level. Deterministic; reads no
 * rng; safe to call on every candidate the chain constructs.
 */
export function interestingnessProfile(level) {
    const graph = buildBaseGraph(level);
    const forks = routeForks(graph);
    const greed = greedGradient(level, graph);
    const tool = enemyAsTool(level);
    const secret = level.getAlcove ? level.getAlcove() !== null : false;
    const score = WEIGHT_FORKS * Math.min(forks, FORK_CAP) / FORK_CAP +
        WEIGHT_GREED * greed.score +
        WEIGHT_TOOL * Math.min(tool.count, 1) +
        WEIGHT_SECRET * (secret ? 1 : 0);
    return { forks, greed, tool, secret, score };
}

/** Preference scalar used by the candidate chain (see main.js seedFor). */
export function interestingnessScore(level) {
    return interestingnessProfile(level).score;
}
