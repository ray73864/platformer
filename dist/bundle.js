(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  function __accessProp(key) {
    return this[key];
  }
  var __toCommonJS = (from) => {
    var entry = (__moduleCache ??= new WeakMap).get(from), desc;
    if (entry)
      return entry;
    entry = __defProp({}, "__esModule", { value: true });
    if (from && typeof from === "object" || typeof from === "function") {
      for (var key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(entry, key))
          __defProp(entry, key, {
            get: __accessProp.bind(from, key),
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
          });
    }
    __moduleCache.set(from, entry);
    return entry;
  };
  var __moduleCache;
  var __returnValue = (v) => v;
  function __exportSetter(name, newValue) {
    this[name] = __returnValue.bind(null, newValue);
  }
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: __exportSetter.bind(all, name)
      });
  };

  // js/main.js
  var exports_main = {};
  __export(exports_main, {
    Game: () => Game,
    STATE: () => STATE,
    TILE_SIZE: () => TILE_SIZE,
    computeZoom: () => computeZoom,
    destroyAllGames: () => destroyAllGames,
    init: () => init
  });

  // js/input.js
  function isButtonTarget(event) {
    return !!event.target && event.target.tagName === "BUTTON";
  }

  class InputHandler {
    constructor() {
      this.keys = new Set;
      this.onMoveLeftCallback = null;
      this.onMoveRightCallback = null;
      this.onJumpCallback = null;
      this.onReleaseLeftCallback = null;
      this.onReleaseRightCallback = null;
      this._abort = new AbortController;
      this.bindEvents();
    }
    destroy() {
      this._abort.abort();
    }
    bindEvents() {
      const signal = this._abort.signal;
      window.addEventListener("keydown", (e) => this.handleKeyDown(e), { signal });
      window.addEventListener("keyup", (e) => this.handleKeyUp(e), { signal });
      window.addEventListener("blur", () => this.keys.clear(), { signal });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden)
          this.keys.clear();
      }, { signal });
    }
    resolveCode(event) {
      if (event.code)
        return event.code;
      const key = event.key;
      if (!key)
        return "";
      if (key === " ")
        return "Space";
      if (/^[a-zA-Z]$/.test(key))
        return `Key${key.toUpperCase()}`;
      return key;
    }
    handleKeyDown(event) {
      const code = this.resolveCode(event);
      const wasDown = this.keys.has(code);
      this.keys.add(code);
      if (!wasDown) {
        if (code === "ArrowLeft" || code === "KeyA") {
          this.onMoveLeftCallback?.();
        } else if (code === "ArrowRight" || code === "KeyD") {
          this.onMoveRightCallback?.();
        } else if (code === "Space" && !isButtonTarget(event)) {
          this.onJumpCallback?.();
        }
      }
    }
    handleKeyUp(event) {
      const code = this.resolveCode(event);
      this.keys.delete(code);
      if (code === "ArrowLeft" || code === "KeyA") {
        this.onReleaseLeftCallback?.();
      } else if (code === "ArrowRight" || code === "KeyD") {
        this.onReleaseRightCallback?.();
      }
    }
    isLeft() {
      return this.keys.has("ArrowLeft") || this.keys.has("KeyA");
    }
    isRight() {
      return this.keys.has("ArrowRight") || this.keys.has("KeyD");
    }
    isJump() {
      return this.keys.has("Space");
    }
    onMoveLeft(callback) {
      this.onMoveLeftCallback = callback;
    }
    onMoveRight(callback) {
      this.onMoveRightCallback = callback;
    }
    onJump(callback) {
      this.onJumpCallback = callback;
    }
    onReleaseLeft(callback) {
      this.onReleaseLeftCallback = callback;
    }
    onReleaseRight(callback) {
      this.onReleaseRightCallback = callback;
    }
  }

  // js/physics.js
  function aabbOverlap(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width && rect1.x + rect1.width > rect2.x && rect1.y < rect2.y + rect2.height && rect1.y + rect1.height > rect2.y;
  }
  var LANDING_TOLERANCE = 0.5;

  class Physics {
    constructor(gravity = 980, maxFallSpeed = 600) {
      this.gravity = gravity;
      this.maxFallSpeed = maxFallSpeed;
    }
    applyGravity(entity, dt) {
      entity.vy += this.gravity * dt;
      if (entity.vy > this.maxFallSpeed) {
        entity.vy = this.maxFallSpeed;
      }
      entity.y += entity.vy * dt;
    }
    checkAABB(rect1, rect2) {
      return aabbOverlap(rect1, rect2);
    }
    checkCollisions(player, platforms) {
      const collisions = [];
      for (const platform of platforms) {
        if (this.checkAABB(player, platform)) {
          collisions.push(platform);
        }
      }
      return collisions;
    }
    resolveCollisions(player, collisions) {
      player.grounded = false;
      this.resolveYCollision(player, collisions);
      this.resolveXCollision(player, collisions);
    }
    resolveXCollision(player, platforms) {
      for (const platform of platforms) {
        if (this.checkAABB(player, platform)) {
          const overlapX = player.x + player.width / 2 - (platform.x + platform.width / 2);
          const combinedHalfWidths = player.width / 2 + platform.width / 2;
          if (Math.abs(overlapX) < combinedHalfWidths) {
            const overlap = combinedHalfWidths - Math.abs(overlapX);
            if (overlapX > 0) {
              player.x += overlap;
            } else {
              player.x -= overlap;
            }
            player.vx = 0;
          }
        }
      }
    }
    resolveYCollision(player, platforms) {
      for (const platform of platforms) {
        if (this.checkAABB(player, platform)) {
          const overlapY = player.y + player.height / 2 - (platform.y + platform.height / 2);
          const combinedHalfHeights = player.height / 2 + platform.height / 2;
          if (Math.abs(overlapY) < combinedHalfHeights) {
            const overlap = combinedHalfHeights - Math.abs(overlapY);
            if (overlapY > 0) {
              player.y += overlap;
              player.vy = 0;
            } else {
              if (player.prevY !== undefined) {
                const prevBottom = player.prevY + player.height;
                if (prevBottom > platform.y + LANDING_TOLERANCE) {
                  continue;
                }
                const prevXOverlap = player.prevX === undefined || player.prevX < platform.x + platform.width && player.prevX + player.width > platform.x;
                if (!prevXOverlap && prevBottom >= platform.y - LANDING_TOLERANCE) {
                  continue;
                }
              }
              player.y -= overlap;
              player.vy = 0;
              player.grounded = true;
            }
          }
        }
      }
    }
  }

  // js/entities.js
  class Entity {
    constructor(x, y, width, height) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.vx = 0;
      this.vy = 0;
      this.grounded = false;
    }
    update(dt, _moveLeft = false, _moveRight = false) {
      this.x += this.vx * dt;
    }
    isGrounded() {
      return this.grounded;
    }
  }

  // js/player.js
  var PLAYER_STOP_DECEL = 2400;

  class Player extends Entity {
    constructor(x, y, speed, jumpForce) {
      super(x, y, 32, 32);
      this.speed = speed;
      this.jumpForce = jumpForce;
      this.reachedPortal = false;
    }
    update(dt, left = false, right = false) {
      super.update(dt, left, right);
      if (left && !right) {
        this.vx = -this.speed;
      } else if (right && !left) {
        this.vx = this.speed;
      } else if (this.grounded) {
        const drop = PLAYER_STOP_DECEL * dt;
        this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
      }
    }
    moveLeft() {
      this.vx = -this.speed;
    }
    moveRight() {
      this.vx = this.speed;
    }
    stopLeft() {}
    stopRight() {}
    jump() {
      this.vy = -this.jumpForce;
      this.grounded = false;
    }
    hasReachedPortal() {
      return this.reachedPortal;
    }
    markPortalReached() {
      this.reachedPortal = true;
    }
    draw(ctx, sprites = null, squash = 1) {
      if (sprites && sprites.ready()) {
        sprites.drawPlayer(ctx, this, squash);
        return;
      }
      ctx.fillStyle = "#0066ff";
      ctx.fillRect(this.x, this.y, this.width, this.height);
      ctx.fillStyle = "#fff";
      const eyeOffset = this.vx >= 0 ? 18 : 6;
      ctx.fillRect(this.x + eyeOffset, this.y + 8, 4, 4);
      ctx.fillRect(this.x + eyeOffset + 6, this.y + 8, 4, 4);
    }
  }

  // js/collectibles.js
  var COIN_WIDTH = 16;
  var COIN_HEIGHT = 16;
  var COIN_POINTS = 10;

  class Collectibles {
    constructor() {
      this.coins = [];
      this.score = 0;
    }
    loadCoins(coins) {
      this.coins = coins;
    }
    addCoin(x, y) {
      this.coins.push({
        x,
        y,
        width: COIN_WIDTH,
        height: COIN_HEIGHT,
        collected: false
      });
    }
    collectCoin(index) {
      if (index < 0 || index >= this.coins.length)
        return;
      const coin = this.coins[index];
      if (coin.collected)
        return;
      coin.collected = true;
      this.score += COIN_POINTS;
    }
    getScore() {
      return this.score;
    }
    getCoins() {
      return this.coins;
    }
    getUncollectedCoins() {
      return this.coins.filter((coin) => !coin.collected);
    }
    meetsPortalRequirement() {
      const total = this.coins.length;
      if (total === 0)
        return true;
      const collected = this.coins.filter((coin) => coin.collected).length;
      return collected >= total;
    }
    checkCollection(player) {
      let collectedNow = 0;
      for (let i = 0;i < this.coins.length; i++) {
        const coin = this.coins[i];
        if (coin.collected)
          continue;
        if (aabbOverlap(player, coin)) {
          this.collectCoin(i);
          collectedNow++;
        }
      }
      return collectedNow;
    }
  }

  // js/difficulty.js
  var PHASE2_FIRST_LEVEL = 5;
  var LEVEL_CONFIGS = {
    basic: {
      width: 20,
      height: 15,
      maxEnemies: 0,
      hasTimer: false
    },
    intermediate: {
      width: 24,
      height: 18,
      maxEnemies: 5,
      hasTimer: true
    },
    advanced: {
      width: 28,
      height: 21,
      maxEnemies: 8,
      hasTimer: true
    }
  };
  function configFor(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
      console.warn("Invalid level number for difficulty scaling:", levelNumber, "- defaulting to basic tier");
      return LEVEL_CONFIGS.basic;
    }
    if (levelNumber >= 10)
      return LEVEL_CONFIGS.advanced;
    if (levelNumber >= PHASE2_FIRST_LEVEL)
      return LEVEL_CONFIGS.intermediate;
    return LEVEL_CONFIGS.basic;
  }

  class Difficulty {
    getLevelSize(levelNumber) {
      const config = configFor(levelNumber);
      return { width: config.width, height: config.height };
    }
    getMaxEnemies(levelNumber) {
      return configFor(levelNumber).maxEnemies;
    }
    isTimerEnabled(levelNumber) {
      return configFor(levelNumber).hasTimer;
    }
    hasPhase2Content(levelNumber) {
      return Number.isInteger(levelNumber) && levelNumber >= PHASE2_FIRST_LEVEL;
    }
  }

  // js/enemies.js
  var ENEMY_WIDTH = 32;
  var ENEMY_HEIGHT = 32;
  var ENEMY_SPEED = 40;
  var ENEMY_HITBOX_INSET_X = 4;
  var ENEMY_HITBOX_INSET_TOP = 4;
  var ENEMY_STOMP_TOLERANCE = 18;

  class Enemy {
    constructor(x, y, minX, maxX) {
      this.x = x;
      this.y = y;
      this.width = ENEMY_WIDTH;
      this.height = ENEMY_HEIGHT;
      this.speed = ENEMY_SPEED;
      this.minX = minX;
      this.maxX = maxX;
      this.vx = this.speed;
      this.dead = false;
    }
    update(dt) {
      if (this.dead)
        return;
      this.x += this.vx * dt;
      if (this.x <= this.minX) {
        this.x = this.minX;
        this.vx = Math.abs(this.vx);
      } else if (this.x + this.width >= this.maxX) {
        this.x = this.maxX - this.width;
        this.vx = -Math.abs(this.vx);
      }
    }
    checkCollision(player) {
      return aabbOverlap(player, {
        x: this.x + ENEMY_HITBOX_INSET_X,
        y: this.y + ENEMY_HITBOX_INSET_TOP,
        width: this.width - 2 * ENEMY_HITBOX_INSET_X,
        height: this.height - ENEMY_HITBOX_INSET_TOP
      });
    }
    die() {
      this.dead = true;
    }
    isDead() {
      return this.dead;
    }
    draw(ctx, sprites = null, index = 0) {
      if (this.dead)
        return;
      if (sprites && sprites.ready()) {
        sprites.drawEnemy(ctx, this, index);
        return;
      }
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(this.x, this.y, this.width, this.height);
      ctx.fillStyle = "#fff";
      const eyeOffset = this.vx >= 0 ? 18 : 6;
      ctx.fillRect(this.x + eyeOffset, this.y + 8, 4, 4);
    }
  }

  class EnemyManager {
    constructor() {
      this.enemies = [];
    }
    addEnemy(x, y, minX, maxX) {
      this.enemies.push(new Enemy(x, y, minX, maxX));
    }
    updateAll(dt) {
      for (const enemy of this.enemies) {
        enemy.update(dt);
      }
    }
    checkPlayerCollisions(player) {
      for (const enemy of this.enemies) {
        if (!enemy.isDead() && enemy.checkCollision(player)) {
          return true;
        }
      }
      return false;
    }
    resolvePlayerContact(player) {
      let stomped = 0;
      let deadly = false;
      const prevBottom = (player.prevY !== undefined ? player.prevY : player.y) + player.height;
      for (const enemy of this.enemies) {
        if (enemy.isDead())
          continue;
        if (!enemy.checkCollision(player))
          continue;
        if (player.vy > 0 && prevBottom <= enemy.y + ENEMY_STOMP_TOLERANCE) {
          enemy.die();
          stomped++;
        } else {
          deadly = true;
        }
      }
      return { stomped, deadly };
    }
    getActiveEnemies() {
      return this.enemies.filter((enemy) => !enemy.isDead());
    }
    clear() {
      this.enemies.length = 0;
    }
    drawAll(ctx, sprites = null) {
      this.enemies.forEach((enemy, index) => enemy.draw(ctx, sprites, index));
    }
  }

  // js/hazards.js
  var SPIKE_WIDTH = 32;
  var SPIKE_HEIGHT = 32;
  var SPIKE_HITBOX_INSET = 4;
  var PIT_DEATH_MARGIN_PX = 100;

  class Hazards {
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
      const hitbox = {
        x: spike.x + SPIKE_HITBOX_INSET,
        y: spike.y + SPIKE_HITBOX_INSET,
        width: spike.width - 2 * SPIKE_HITBOX_INSET,
        height: spike.height - 2 * SPIKE_HITBOX_INSET
      };
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
      return player.y > levelHeightPx + PIT_DEATH_MARGIN_PX;
    }
    clear() {
      this.spikes.length = 0;
    }
    getSpikes() {
      return this.spikes;
    }
  }

  // js/level.js
  var DIFFICULTY = new Difficulty;
  var MAX_GENERATION_ATTEMPTS = 200;
  var SPAWN_TILE_X = 2;
  var MAX_H_JUMP = 4;
  var VERTICAL_WIDTH = 15;
  var VERTICAL_HEIGHT = 24;
  var VERTICAL_PORTAL_MAX_Y = 4;
  var VERTICAL_SPAWN_EXCL_ROWS = 6;
  var COIN_SPIKE_MARGIN = 2;
  var HAZARD_SPAWN_EXCLUDE_COLS = 9;
  function directionForLevel(levelNumber) {
    if (levelNumber < PHASE2_FIRST_LEVEL)
      return "right";
    return ["right", "left", "vertical"][(levelNumber - PHASE2_FIRST_LEVEL) % 3];
  }
  function makeRng(seed) {
    let s = seed >>> 0;
    return function() {
      s = s + 1831565813 >>> 0;
      let t = s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(items, rng = Math.random) {
    for (let i = items.length - 1;i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
  function computeReachable(tiles, width, height, startTile, requireOpenHead = false) {
    const solid = (x, y) => {
      if (x < 0 || x >= width)
        return true;
      if (y < 0 || y >= height)
        return false;
      return tiles[y][x] === 1;
    };
    const hazard = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height)
        return false;
      return tiles[y][x] === 2;
    };
    const freeCell = (x, y) => !solid(x, y) && !hazard(x, y);
    const standable = (x, y) => freeCell(x, y) && solid(x, y + 1) && (!requireOpenHead || !solid(x, y - 1));
    const key = (x, y) => y * width + x;
    const reachable = new Set;
    if (!standable(startTile.x, startTile.y)) {
      return reachable;
    }
    const queue = [[startTile.x, startTile.y]];
    reachable.add(key(startTile.x, startTile.y));
    while (queue.length > 0) {
      const [x, y] = queue.shift();
      for (const dir of [-1, 1]) {
        for (let dist = 1;dist <= MAX_H_JUMP; dist++) {
          let blocked = false;
          let hazardRun = 0;
          for (let m = 1;m < dist; m++) {
            const midX = x + dir * m;
            if (solid(midX, y)) {
              blocked = true;
              break;
            }
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
          if (blocked)
            continue;
          const c = x + dir * dist;
          for (let ly = y;ly < height; ly++) {
            if (hazard(c, ly))
              break;
            if (standable(c, ly) && !reachable.has(key(c, ly))) {
              reachable.add(key(c, ly));
              queue.push([c, ly]);
            }
            if (solid(c, ly))
              break;
          }
        }
        for (const dist of [1, 2]) {
          const c = x + dir * dist;
          const ty = y - 1;
          if (!standable(c, ty))
            continue;
          let clear = true;
          if (dist === 2) {
            const midX = x + dir;
            if ((solid(midX, ty) || hazard(midX, ty)) && solid(midX, y)) {
              clear = false;
            }
          }
          if (clear && !reachable.has(key(c, ty))) {
            reachable.add(key(c, ty));
            queue.push([c, ty]);
          }
        }
      }
    }
    return reachable;
  }
  class Level {
    constructor(levelNumber, tileSize, seed) {
      this.levelNumber = levelNumber;
      this.tileSize = tileSize;
      this.rng = makeRng(seed === undefined ? Math.random() * 4294967295 >>> 0 : seed >>> 0);
      this.direction = directionForLevel(levelNumber);
      if (this.direction === "vertical") {
        this.width = VERTICAL_WIDTH;
        this.height = VERTICAL_HEIGHT;
      } else {
        const size = DIFFICULTY.getLevelSize(levelNumber);
        this.width = size.width;
        this.height = size.height;
      }
      let attempt = 0;
      let valid = false;
      while (attempt < MAX_GENERATION_ATTEMPTS && !valid) {
        this.tiles = this.generateLevel();
        this.spawnTile = this.getSpawnTile();
        this.reachableTiles = computeReachable(this.tiles, this.width, this.height, this.spawnTile, this.direction === "vertical");
        this.portalTile = this.pickPortalTile();
        valid = this.portalTile !== null;
        if (valid && DIFFICULTY.hasPhase2Content(this.levelNumber)) {
          valid = this.deriveEnemySpawns().length > 0 && this.countTilesOfType(2) > 0;
        }
        attempt++;
      }
      if (!valid) {
        throw new Error(`Level ${levelNumber}: no reachable portal position after ` + `${MAX_GENERATION_ATTEMPTS} generation attempts`);
      }
      this.spawnPoint = {
        x: this.spawnTile.x * tileSize,
        y: this.spawnTile.y * tileSize
      };
      this.platforms = this.extractPlatforms();
      this.portal = this.portalTile ? {
        x: this.portalTile.x * tileSize,
        y: this.portalTile.y * tileSize,
        width: 32,
        height: 48
      } : null;
      this.collectibles = new Collectibles;
      this.collectibles.loadCoins(this.extractCoins());
      this.coins = this.collectibles.getCoins();
      this.hazards = new Hazards;
      this.extractHazards();
      this.enemyManager = new EnemyManager;
      this.spawnEnemies();
    }
    getSpawnTile() {
      const y = this.height - 4;
      switch (this.direction) {
        case "left":
          return { x: this.width - 3, y };
        case "vertical":
          return { x: Math.floor(this.width / 2), y };
        default:
          return { x: SPAWN_TILE_X, y };
      }
    }
    canonicalSpawnTile() {
      return this.direction === "vertical" ? this.getSpawnTile() : { x: SPAWN_TILE_X, y: this.height - 4 };
    }
    generateLevel() {
      const tiles = Array(this.height).fill(null).map(() => Array(this.width).fill(0));
      this.pathCells = null;
      if (this.direction === "vertical") {
        this.generateVertical(tiles);
      } else {
        this.generatePlatforms(tiles);
      }
      this.placeSpikes(tiles);
      this.generationReachable = computeReachable(tiles, this.width, this.height, this.canonicalSpawnTile(), this.direction === "vertical");
      this.placeEnemyMarkers(tiles);
      if (this.direction === "left") {
        for (const row of tiles)
          row.reverse();
      }
      return tiles;
    }
    generateVertical(tiles) {
      const w = this.width;
      const h = this.height;
      for (let x = 0;x < w; x++) {
        for (let y = h - 3;y < h; y++) {
          tiles[y][x] = 1;
        }
      }
      this.pathCells = new Set;
      let x = Math.floor(w / 2);
      let dir = this.rng() < 0.5 ? 1 : -1;
      for (let row = h - 4;row >= VERTICAL_PORTAL_MAX_Y + 1; row--) {
        let c = x + dir * (this.rng() < 0.4 ? 2 : 1);
        if (c < 1 || c > w - 2) {
          dir = -dir;
          c = x + dir;
        }
        const ext = 2 + Math.floor(this.rng() * 4);
        const lo = dir === 1 ? c : c - ext;
        const hi = dir === 1 ? c + ext : c;
        for (let cx = Math.max(0, lo);cx <= Math.min(w - 1, hi); cx++) {
          if (this.pathCells.has((row + 1) * w + cx))
            continue;
          tiles[row][cx] = 1;
        }
        this.pathCells.add(row * w + x);
        this.pathCells.add((row - 1) * w + c);
        x = c;
      }
    }
    generatePlatforms(tiles) {
      const isPhase2 = DIFFICULTY.hasPhase2Content(this.levelNumber);
      const maxGap = this.levelNumber >= 3 ? 3 : 2;
      const gapChance = isPhase2 ? 0.22 + 0.02 * (this.levelNumber - 4) : 0.18 + 0.04 * this.levelNumber;
      let segRemaining = 0;
      let currentY = this.height - 3;
      let gapStreak = 0;
      for (let x = 0;x < this.width; x++) {
        const isSpawnZone = x < 6;
        const isEndZone = x >= this.width - 5;
        if (!isSpawnZone && !isEndZone && gapStreak < maxGap && segRemaining === 0 && this.rng() < gapChance) {
          gapStreak++;
          continue;
        }
        const resumedAfterWideGap = gapStreak >= 2;
        gapStreak = 0;
        if (isSpawnZone) {
          currentY = this.height - 3;
          segRemaining = 0;
        } else if (segRemaining > 0) {
          segRemaining--;
        } else {
          const atTop = currentY <= 3;
          const atFloor = currentY >= this.height - 3;
          let step;
          if (resumedAfterWideGap)
            step = 1;
          else if (atTop)
            step = 1;
          else if (atFloor)
            step = -1;
          else
            step = this.rng() < 0.55 ? 1 : -1;
          currentY = Math.min(this.height - 3, Math.max(3, currentY + step));
          segRemaining = 1 + Math.floor(this.rng() * 4);
        }
        for (let y = currentY;y < this.height; y++) {
          tiles[y][x] = 1;
        }
      }
      return tiles;
    }
    hazardPlacementAllowed(coord) {
      if (this.direction === "vertical") {
        return coord > VERTICAL_PORTAL_MAX_Y && coord < this.height - VERTICAL_SPAWN_EXCL_ROWS;
      }
      return coord >= HAZARD_SPAWN_EXCLUDE_COLS && coord <= this.width - 6;
    }
    patrolBandBounds() {
      if (this.direction === "left") {
        return [5, this.width - 1 - HAZARD_SPAWN_EXCLUDE_COLS];
      }
      if (this.direction === "vertical") {
        return [0, this.width - 1];
      }
      return [HAZARD_SPAWN_EXCLUDE_COLS, this.width - 6];
    }
    patrolSpan(tiles, x, y) {
      const solidAt = (cx, cy) => cx >= 0 && cx < this.width && cy >= 0 && cy < this.height && tiles[cy][cx] === 1;
      const blockedByRoute = (cx, cy) => this.pathCells !== null && this.pathCells.has(cy * this.width + cx);
      const walkable = (cx, cy) => cx >= 0 && cx < this.width && cy >= 0 && cy < this.height && tiles[cy][cx] !== 1 && tiles[cy][cx] !== 2 && !blockedByRoute(cx, cy);
      if (!solidAt(x, y + 1) || blockedByRoute(x, y))
        return null;
      let left = x;
      while (solidAt(left - 1, y + 1) && walkable(left - 1, y))
        left--;
      let right = x;
      while (solidAt(right + 1, y + 1) && walkable(right + 1, y))
        right++;
      return { left, right };
    }
    deriveEnemySpawns() {
      const spawns = [];
      const [bandMin, bandMax] = this.patrolBandBounds();
      for (let y = 0;y < this.height; y++) {
        for (let x = 0;x < this.width; x++) {
          if (this.tiles[y][x] !== 4)
            continue;
          if (x < bandMin || x > bandMax)
            continue;
          if (!this.reachableTiles.has(y * this.width + x))
            continue;
          const span = this.patrolSpan(this.tiles, x, y);
          if (!span)
            continue;
          spawns.push({
            x,
            y,
            left: Math.max(span.left, bandMin),
            right: Math.min(span.right, bandMax)
          });
        }
      }
      return spawns;
    }
    placeSpikes(tiles) {
      if (!DIFFICULTY.hasPhase2Content(this.levelNumber))
        return;
      const target = Math.min(2 + Math.floor((this.levelNumber - PHASE2_FIRST_LEVEL) / 2), Math.floor(this.width * this.height * 0.1));
      const surfaceTop = [];
      for (let x = 0;x < this.width; x++) {
        surfaceTop[x] = -1;
        for (let y = 0;y < this.height; y++) {
          if (tiles[y][x] === 1) {
            surfaceTop[x] = y;
            break;
          }
        }
      }
      const besideDropOff = (x) => {
        const base = surfaceTop[x] < 0 ? this.height : surfaceTop[x];
        for (let dx = -3;dx <= 3; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= this.width)
            continue;
          if (dx !== 0 && surfaceTop[nx] < 0)
            return true;
          if (dx !== 0 && surfaceTop[nx] >= 0 && surfaceTop[nx] <= base - 2)
            return true;
        }
        return false;
      };
      const candidates = [];
      for (let y = 0;y < this.height - 1; y++) {
        for (let x = 0;x < this.width; x++) {
          if (tiles[y][x] !== 0 || tiles[y + 1][x] !== 1)
            continue;
          if (!this.hazardPlacementAllowed(this.direction === "vertical" ? y : x)) {
            continue;
          }
          if (this.pathCells && this.pathCells.has(y * this.width + x)) {
            continue;
          }
          if (this.direction !== "vertical" && besideDropOff(x))
            continue;
          candidates.push({ x, y });
        }
      }
      shuffle(candidates, this.rng);
      const headroom = this.direction === "vertical";
      const spawn = this.canonicalSpawnTile();
      const placementSafe = () => {
        const reachable = computeReachable(tiles, this.width, this.height, spawn, headroom);
        let portalBand = false;
        for (const key of reachable) {
          const x = key % this.width;
          const y = Math.floor(key / this.width);
          if (this.inCanonicalPortalBand(x, y)) {
            portalBand = true;
            break;
          }
        }
        if (!portalBand)
          return false;
        for (const key of reachable) {
          if (this.isMarkerSite(tiles, key % this.width, Math.floor(key / this.width), reachable)) {
            return true;
          }
        }
        return false;
      };
      let placed = 0;
      const usedColumns = new Set;
      const THREAT_SPACING = 4;
      for (const c of candidates) {
        if (placed >= target)
          break;
        let blocked = false;
        for (let dx = -THREAT_SPACING;dx <= THREAT_SPACING && !blocked; dx++) {
          if (usedColumns.has(c.x + dx))
            blocked = true;
        }
        if (blocked)
          continue;
        tiles[c.y][c.x] = 2;
        if (placementSafe()) {
          for (let dx = -THREAT_SPACING;dx <= THREAT_SPACING; dx++) {
            usedColumns.add(c.x + dx);
          }
          placed++;
        } else {
          tiles[c.y][c.x] = 0;
        }
      }
    }
    isMarkerSite(tiles, x, y, reachable) {
      if (!this.hazardPlacementAllowed(this.direction === "vertical" ? y : x)) {
        return false;
      }
      if (tiles[y][x] !== 0 || tiles[y + 1][x] !== 1)
        return false;
      if (this.pathCells && this.pathCells.has(y * this.width + x)) {
        return false;
      }
      if (!reachable.has(y * this.width + x))
        return false;
      for (let dx = -4;dx <= 4; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= this.width)
          continue;
        if (tiles[y][nx] === 2)
          return false;
        if (y > 0 && tiles[y - 1][nx] === 2)
          return false;
      }
      const span = this.patrolSpan(tiles, x, y);
      if (!span)
        return false;
      const [bandMin, bandMax] = this.patrolBandBounds();
      return Math.min(span.right, bandMax) - Math.max(span.left, bandMin) + 1 >= 2;
    }
    placeEnemyMarkers(tiles) {
      if (!DIFFICULTY.hasPhase2Content(this.levelNumber))
        return;
      const target = Math.min(DIFFICULTY.getMaxEnemies(this.levelNumber), Math.floor(this.levelNumber / 2));
      const candidates = [];
      for (let y = 0;y < this.height - 1; y++) {
        for (let x = 0;x < this.width; x++) {
          if (this.isMarkerSite(tiles, x, y, this.generationReachable)) {
            candidates.push({ x, y });
          }
        }
      }
      shuffle(candidates, this.rng);
      let placed = 0;
      for (const c of candidates) {
        if (placed >= target)
          break;
        tiles[c.y][c.x] = 4;
        placed++;
      }
    }
    inCanonicalPortalBand(x, y) {
      return this.direction === "vertical" ? y <= VERTICAL_PORTAL_MAX_Y : x >= this.width - 4 && x <= this.width - 2;
    }
    inPortalBand(x, y) {
      switch (this.direction) {
        case "left":
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
      for (let y = 0;y < this.height; y++) {
        for (let x = 0;x < this.width; x++) {
          if (this.tiles[y][x] === 1) {
            platforms.push({
              x: x * this.tileSize,
              y: y * this.tileSize,
              width: this.tileSize,
              height: this.tileSize,
              type: "solid"
            });
          }
        }
      }
      return platforms;
    }
    extractCoins() {
      const target = Math.max(5 + this.levelNumber, 5);
      const coins = [];
      const used = new Set;
      const spawnKey = this.spawnTile.y * this.width + this.spawnTile.x;
      const portalKey = this.portalTile ? this.portalTile.y * this.width + this.portalTile.x : -1;
      const patrolCovered = new Set;
      for (const s of this.deriveEnemySpawns()) {
        for (let cx = s.left;cx <= s.right; cx++) {
          patrolCovered.add(s.y * this.width + cx);
        }
      }
      const spikeNear = (x, y) => {
        for (let dy = -COIN_SPIKE_MARGIN;dy <= COIN_SPIKE_MARGIN; dy++) {
          for (let dx = -COIN_SPIKE_MARGIN;dx <= COIN_SPIKE_MARGIN; dx++) {
            const cx = x + dx;
            const cy = y + dy;
            if (cx >= 0 && cx < this.width && cy >= 0 && cy < this.height && this.tiles[cy][cx] === 2) {
              return true;
            }
          }
        }
        return false;
      };
      const candidates = [];
      for (const key of this.reachableTiles) {
        if (key === spawnKey || key === portalKey)
          continue;
        if (patrolCovered.has(key))
          continue;
        const x = key % this.width;
        const y = Math.floor(key / this.width);
        candidates.push({ x, y, safe: !spikeNear(x, y) });
      }
      shuffle(candidates, this.rng);
      const addCoin = (x, y) => {
        const key = y * this.width + x;
        if (used.has(key))
          return false;
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
      for (const tile of candidates) {
        if (coins.length >= target)
          break;
        if (tile.safe)
          addCoin(tile.x, tile.y);
      }
      for (const tile of candidates) {
        if (coins.length >= Math.min(target, 5))
          break;
        addCoin(tile.x, tile.y);
      }
      const densityCap = Math.floor(this.width * this.height * 0.2);
      if (coins.length > densityCap) {
        console.warn("Coin density exceeds 20% of level tiles:", coins.length, ">", densityCap, "- trimming");
        coins.length = densityCap;
      }
      return coins;
    }
    countTilesOfType(type) {
      let n = 0;
      for (const row of this.tiles) {
        for (const t of row) {
          if (t === type)
            n++;
        }
      }
      return n;
    }
    extractHazards() {
      this.hazards.clear();
      for (let y = 0;y < this.height; y++) {
        for (let x = 0;x < this.width; x++) {
          if (this.tiles[y][x] === 2) {
            this.hazards.addSpike(x * this.tileSize, y * this.tileSize);
          }
        }
      }
    }
    spawnEnemies() {
      this.enemyManager.clear();
      for (const s of this.deriveEnemySpawns()) {
        this.enemyManager.addEnemy(s.x * this.tileSize, s.y * this.tileSize, s.left * this.tileSize, (s.right + 1) * this.tileSize);
      }
    }
    getSpawnPoint() {
      return this.spawnPoint;
    }
    getPlatforms() {
      return this.platforms;
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
    draw(ctx, sprites = null) {
      const art = sprites && sprites.ready();
      if (!art) {
        ctx.fillStyle = "#8B4513";
        for (const platform of this.platforms) {
          ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
          ctx.strokeStyle = "#654321";
          ctx.lineWidth = 2;
          ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
        }
      }
      if (art) {
        sprites.drawCoins(ctx, this.coins);
      } else {
        ctx.fillStyle = "#FFD700";
        for (const coin of this.coins) {
          if (!coin.collected) {
            ctx.beginPath();
            ctx.arc(coin.x + coin.width / 2, coin.y + coin.height / 2, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      if (!art) {
        ctx.fillStyle = "#ff4444";
        for (const spike of this.hazards.getSpikes()) {
          ctx.beginPath();
          ctx.moveTo(spike.x, spike.y + spike.height);
          ctx.lineTo(spike.x + spike.width / 2, spike.y);
          ctx.lineTo(spike.x + spike.width, spike.y + spike.height);
          ctx.fill();
        }
      }
      this.enemyManager.drawAll(ctx, sprites);
      if (art) {
        sprites.drawPortal(ctx, this.portal, this.collectibles.meetsPortalRequirement());
      } else if (this.portal && this.collectibles.meetsPortalRequirement()) {
        ctx.fillStyle = "#9400D3";
        ctx.fillRect(this.portal.x, this.portal.y, this.portal.width, this.portal.height);
        ctx.strokeStyle = "#DA70D6";
        ctx.lineWidth = 3;
        ctx.strokeRect(this.portal.x, this.portal.y, this.portal.width, this.portal.height);
      }
    }
  }

  // js/camera.js
  class Camera {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.x = 0;
      this.y = 0;
      this.initialized = false;
    }
    follow(player, levelWidthPx, levelHeightPx, dt = 1 / 60) {
      const targetX = player.x - this.width / 2;
      const targetY = this.height / 2 - (player.y + player.height / 2);
      if (!this.initialized) {
        this.x = targetX;
        this.y = targetY;
        this.initialized = true;
      } else {
        const alpha = 1 - Math.exp(-12 * (dt || 1 / 60));
        this.x += (targetX - this.x) * alpha;
        this.y += (targetY - this.y) * alpha;
        if (Math.abs(targetX - this.x) < 0.5)
          this.x = targetX;
        if (Math.abs(targetY - this.y) < 0.5)
          this.y = targetY;
      }
      if (levelWidthPx <= this.width) {
        this.x = (levelWidthPx - this.width) / 2;
      } else {
        this.x = Math.max(0, Math.min(this.x, levelWidthPx - this.width));
      }
      if (levelHeightPx !== undefined) {
        if (levelHeightPx <= this.height) {
          this.y = (this.height - levelHeightPx) / 2;
        } else {
          const minCamY = -(levelHeightPx - this.height);
          this.y = Math.min(Math.max(this.y, minCamY), 0);
        }
      } else {
        this.y = Math.min(this.y, 0);
      }
    }
    reset() {
      this.x = 0;
      this.y = 0;
      this.initialized = false;
    }
  }

  // js/ui.js
  class UI {
    constructor() {
      this.scoreElement = this.ensureElement("score-display");
      this.levelElement = this.ensureElement("level-display");
      this.coinsElement = this.ensureElement("coins-display");
      this.finalScoreElement = this.ensureElement("final-score");
      this.gameCompleteScoreElement = this.ensureElement("game-complete-score");
      this.highScoreElement = this.ensureElement("high-score");
      this.timerElement = this.ensureElement("timer-display");
      this.hudElement = this.ensureElement("hud");
      for (const id of ["menu-screen", "game-over-screen", "level-complete-screen", "pause-screen", "game-complete-screen"]) {
        this.ensureElement(id, "overlay");
      }
      this._scoreHudFailed = false;
      this._levelHudFailed = false;
      this._timerHudFailed = false;
    }
    ensureElement(id, className) {
      let element = document.getElementById(id);
      if (!element) {
        element = document.createElement("div");
        element.id = id;
        if (className) {
          element.className = className;
        }
        document.body.appendChild(element);
      }
      return element;
    }
    showHUD() {
      const hud = document.getElementById("hud");
      if (hud)
        hud.style.display = "flex";
    }
    hideHUD() {
      const hud = document.getElementById("hud");
      if (hud)
        hud.style.display = "none";
    }
    setPauseLabel(paused) {
      const button = document.getElementById("pause-btn");
      if (!button)
        return;
      button.setAttribute("aria-label", paused ? "Resume Game" : "Pause Game");
      button.textContent = paused ? "Resume" : "Pause";
    }
    setPauseEnabled(enabled) {
      const button = document.getElementById("pause-btn");
      if (!button)
        return;
      button.disabled = !enabled;
    }
    focusPauseMenu() {
      const first = document.querySelector("#pause-screen button");
      if (first)
        first.focus();
    }
    cyclePauseFocus(forward) {
      const buttons = [...document.querySelectorAll("#pause-screen button")];
      if (buttons.length === 0)
        return;
      const current = buttons.indexOf(document.activeElement);
      const next = current === -1 ? 0 : (current + (forward ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
    blurPauseControls() {
      const active = document.activeElement;
      if (!active || typeof active.closest !== "function")
        return;
      if (active.closest("#pause-screen") || active.id === "pause-btn") {
        active.blur();
      }
    }
    showErrorMessage(text, durationMs = 3000) {
      const element = this.ensureElement("error-message", "hidden");
      if (!element.getAttribute("role"))
        element.setAttribute("role", "alert");
      element.textContent = text;
      element.classList.remove("hidden");
      clearTimeout(this._errorToastTimer);
      this._errorToastTimer = setTimeout(() => this.hideErrorMessage(), durationMs);
    }
    hideErrorMessage() {
      clearTimeout(this._errorToastTimer);
      const element = document.getElementById("error-message");
      if (element)
        element.classList.add("hidden");
    }
    updateCoins(collected, total) {
      if (this.coinsElement && this.coinsElement.isConnected) {
        const text = `Coins: ${collected}/${total}`;
        if (this.coinsElement.textContent !== text) {
          this.coinsElement.textContent = text;
        }
        this.coinsElement.classList.toggle("coins-done", collected >= total);
      }
    }
    updateScore(score) {
      if (this.scoreElement && this.scoreElement.isConnected) {
        this.scoreElement.textContent = `Score: ${score}`;
        this._scoreHudFailed = false;
      } else if (!this._scoreHudFailed) {
        this._scoreHudFailed = true;
        console.error("HUD score display unavailable; score:", score);
      }
    }
    updateLevel(level) {
      if (this.levelElement && this.levelElement.isConnected) {
        this.levelElement.textContent = `Level: ${level}`;
        this._levelHudFailed = false;
      } else if (!this._levelHudFailed) {
        this._levelHudFailed = true;
        console.error("HUD level display unavailable; level:", level);
      }
    }
    setTimerVisible(visible) {
      if (this.timerElement) {
        this.timerElement.classList.toggle("hidden", !visible);
      }
    }
    updateTimer(timeRemaining) {
      if (this.timerElement && this.timerElement.isConnected) {
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = Math.floor(timeRemaining % 60);
        this.timerElement.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, "0")}`;
        this._timerHudFailed = false;
      } else if (!this._timerHudFailed) {
        this._timerHudFailed = true;
        console.error("HUD timer display unavailable; time remaining:", timeRemaining);
      }
    }
    showOverlay(id) {
      const overlay = document.getElementById(id);
      if (overlay) {
        overlay.classList.remove("hidden");
      }
    }
    hideOverlay(id) {
      const overlay = document.getElementById(id);
      if (overlay) {
        overlay.classList.add("hidden");
      }
    }
    static DEATH_CAUSE_TEXT = {
      time: "Time ran out",
      enemy: "Touched a patrol",
      spike: "Landed on spikes",
      pit: "Fell into the void"
    };
    showGameOver(score, cause) {
      if (this.finalScoreElement) {
        this.finalScoreElement.textContent = `Score: ${score}`;
      }
      const causeEl = document.getElementById("death-cause");
      if (causeEl) {
        const text = UI.DEATH_CAUSE_TEXT[cause] || "";
        causeEl.textContent = text;
        causeEl.hidden = !text;
      }
      this.showOverlay("game-over-screen");
    }
    showGameComplete(score, highScore) {
      if (this.gameCompleteScoreElement) {
        this.gameCompleteScoreElement.textContent = `Score: ${score}`;
      }
      if (this.highScoreElement) {
        this.highScoreElement.textContent = `High Score: ${highScore}`;
      }
      this.showOverlay("game-complete-screen");
    }
    showLevelComplete() {
      this.showOverlay("level-complete-screen");
    }
    getScore() {
      if (this.scoreElement) {
        return parseInt(this.scoreElement.textContent.replace("Score: ", "")) || 0;
      }
      return 0;
    }
    getLevel() {
      if (this.levelElement) {
        return parseInt(this.levelElement.textContent.replace("Level: ", "")) || 1;
      }
      return 1;
    }
  }

  // js/timer.js
  var DEFAULT_BASE_TIME = 60;

  class Timer {
    constructor(baseTime = DEFAULT_BASE_TIME) {
      this.baseTime = baseTime;
      this.timeRemaining = baseTime;
    }
    update(dt) {
      if (!Number.isFinite(this.timeRemaining)) {
        this.timeRemaining = Number.isFinite(this.baseTime) ? this.baseTime : DEFAULT_BASE_TIME;
      }
      this.timeRemaining = Math.min(9999, Math.max(0, this.timeRemaining - dt));
    }
    getTimeRemaining() {
      return this.timeRemaining;
    }
    isTimeUp() {
      return this.timeRemaining <= 0;
    }
    addCoinBonus() {
      this.timeRemaining = Math.min(9999, this.timeRemaining + 2);
    }
  }

  // js/sprites.js
  var SHEETS = {
    tiles: { src: "./assets/kenney_pixel-platformer/tiles.png", cols: 20, cell: 18 },
    characters: { src: "./assets/kenney_pixel-platformer/characters.png", cols: 9, cell: 24 },
    backgrounds: { src: "./assets/kenney_pixel-platformer/backgrounds.png" }
  };
  var TILES = {
    GRASS_TOP: 2,
    DIRT: 104,
    SPIKE: 68,
    COIN: 151,
    FLAG_A: 111,
    FLAG_B: 112
  };
  var SPIKE_BAND_Y = 9;
  var SPIKE_BAND_H = 9;
  var GRASS_BAND_Y = 2;
  var GRASS_BAND_H = 7;
  var GRASS_BAND_SRC = 18;
  var PORTAL_CELL = 32;
  var CHARS = {
    PLAYER_IDLE: 9,
    PLAYER_RUN: 10,
    SLIME: [15, 16, 17],
    BAT: [24, 25, 26]
  };
  var THEMES = [
    { x: 0, w: 96, sky: "#dff6f5", ground: "#c2e3e8" },
    { x: 96, w: 48, sky: "#fbc97b", ground: "#cb815e" },
    { x: 144, w: 48, sky: "#7ff0a5", ground: "#2eb082" }
  ];
  function sheetRect(sheetKey, index) {
    const { cols, cell } = SHEETS[sheetKey];
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`sprite index must be a non-negative integer: ${index}`);
    }
    return {
      sx: index % cols * cell,
      sy: Math.floor(index / cols) * cell,
      sw: cell,
      sh: cell
    };
  }
  var SHEET_TILE_COUNTS = { tiles: 20 * 9, characters: 9 * 3 };

  class Sprites {
    constructor() {
      this.images = {};
      this.loaded = false;
      this.clock = 0;
      this._facing = new WeakMap;
      if (typeof Image === "undefined")
        return;
      let pending = Object.keys(SHEETS).length;
      for (const [key, spec] of Object.entries(SHEETS)) {
        const img = new Image;
        img.onload = () => {
          this.images[key] = img;
          if (--pending === 0)
            this.loaded = true;
        };
        img.onerror = () => {};
        img.src = spec.src;
      }
    }
    ready() {
      return this.loaded;
    }
    advance(dt) {
      this.clock += dt;
    }
    _drawSheet(ctx, sheetKey, index, dx, dy, dw, dh) {
      const img = this.images[sheetKey];
      const { sx, sy, sw, sh } = sheetRect(sheetKey, index);
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    drawBackground(ctx, levelNumber, cameraX, viewW, viewH, worldBottomScreen = Infinity) {
      const theme = THEMES[(Math.max(1, levelNumber) - 1) % THEMES.length];
      ctx.fillStyle = theme.sky;
      ctx.fillRect(0, 0, viewW, viewH);
      if (!this.images.backgrounds)
        return;
      const img = this.images.backgrounds;
      const decoH = 16 * 2;
      const decoY = viewH * 0.42 - decoH;
      this._tileStrip(ctx, img, theme.x, 32, theme.w, 16, decoH, cameraX * 0.25, decoY, viewW);
      const groundH = 24 * 2;
      const bandY = Math.min(viewH - groundH, worldBottomScreen);
      this._tileStrip(ctx, img, theme.x, 48, theme.w, 24, groundH, cameraX * 0.5, bandY, viewW);
      if (bandY + groundH < viewH) {
        ctx.fillStyle = theme.ground;
        ctx.fillRect(0, bandY + groundH, viewW, viewH - bandY - groundH);
      }
    }
    _tileStrip(ctx, img, sx, sy, srcW, srcH, chunkH, scrollX, y, viewW) {
      const chunkW = srcW * 2;
      const offset = -((scrollX % chunkW + chunkW) % chunkW);
      for (let x = offset;x < viewW; x += chunkW) {
        ctx.drawImage(img, sx, sy, srcW, srcH, x, y, chunkW, chunkH);
      }
    }
    drawWorld(ctx, level, cameraX, cameraY, viewW, viewH) {
      const size = level.tileSize;
      const drawn = size + 1;
      const c0 = Math.max(0, Math.floor(cameraX / size));
      const c1 = Math.min(level.width - 1, Math.ceil((cameraX + viewW) / size));
      const r0 = Math.max(0, Math.floor(-cameraY / size));
      const r1 = Math.min(level.height - 1, Math.ceil((-cameraY + viewH) / size));
      for (let ty = r0;ty <= r1; ty++) {
        for (let tx = c0;tx <= c1; tx++) {
          const t = level.tiles[ty][tx];
          if (t === 1) {
            const above = ty > 0 ? level.tiles[ty - 1][tx] : 0;
            this._drawSheet(ctx, "tiles", TILES.DIRT, tx * size, ty * size, drawn, drawn);
            if (above !== 1) {
              const cap = sheetRect("tiles", TILES.GRASS_TOP);
              ctx.drawImage(this.images.tiles, cap.sx, cap.sy + GRASS_BAND_Y, cap.sw, GRASS_BAND_H, tx * size, ty * size, drawn, size * GRASS_BAND_H / GRASS_BAND_SRC);
            }
          } else if (t === 2) {
            const spike = sheetRect("tiles", TILES.SPIKE);
            ctx.drawImage(this.images.tiles, spike.sx, spike.sy + SPIKE_BAND_Y, spike.sw, SPIKE_BAND_H, tx * size, ty * size, drawn, drawn);
          }
        }
      }
    }
    drawCoins(ctx, coins) {
      const bobPhase = this.clock * 3;
      for (const coin of coins) {
        if (coin.collected)
          continue;
        const phase = coin.x * 0.11 + coin.y * 0.07;
        const cx = coin.x + coin.width / 2;
        const cy = coin.y + coin.height / 2 + Math.sin(bobPhase + phase) * 3;
        const spin = Math.max(0.35, Math.abs(Math.cos(this.clock * 4 + phase)));
        const s = 26;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(spin, 1);
        this._drawSheet(ctx, "tiles", TILES.COIN, -s / 2, -s / 2, s, s);
        ctx.restore();
      }
    }
    drawPortal(ctx, portal, unlocked) {
      if (!portal)
        return;
      const frame = this.clock % 0.8 < 0.4 ? TILES.FLAG_A : TILES.FLAG_B;
      const w = 36;
      const h = 52;
      const feetY = portal.y + PORTAL_CELL;
      ctx.save();
      if (!unlocked)
        ctx.globalAlpha = 0.35;
      this._drawSheet(ctx, "tiles", frame, portal.x + portal.width / 2 - w / 2, feetY - h, w, h);
      ctx.restore();
    }
    _faceOf(entity) {
      if (entity.vx > 1) {
        this._facing.set(entity, 1);
        return 1;
      }
      if (entity.vx < -1) {
        this._facing.set(entity, -1);
        return -1;
      }
      return this._facing.get(entity) ?? 1;
    }
    drawPlayer(ctx, player, squash = 1) {
      const moving = Math.abs(player.vx) > 5;
      let frame = CHARS.PLAYER_IDLE;
      if (!player.grounded) {
        frame = CHARS.PLAYER_RUN;
      } else if (moving) {
        frame = Math.floor(this.clock * 8) % 2 === 0 ? CHARS.PLAYER_RUN : CHARS.PLAYER_IDLE;
      }
      const face = this._faceOf(player);
      const w = 44;
      const h = 44 * squash;
      const cx = player.x + player.width / 2;
      const bob = moving && player.grounded ? Math.abs(Math.sin(this.clock * 8 * Math.PI)) * 2 : 0;
      const feet = player.y + player.height - bob;
      ctx.save();
      ctx.translate(cx, feet);
      ctx.scale(face, 1);
      this._drawSheet(ctx, "characters", frame, -w / 2, -h, w, h);
      ctx.restore();
    }
    drawEnemy(ctx, enemy, index) {
      if (enemy.dead)
        return;
      const frames = index % 2 === 0 ? CHARS.SLIME : CHARS.BAT;
      const frame = frames[Math.floor(this.clock * 6 + index * 1.7) % frames.length];
      const face = this._faceOf(enemy);
      const w = 42;
      const h = 42;
      const cx = enemy.x + enemy.width / 2;
      const feet = enemy.y + enemy.height;
      ctx.save();
      ctx.translate(cx, feet);
      ctx.scale(face, 1);
      this._drawSheet(ctx, "characters", frame, -w / 2, -h, w, h);
      ctx.restore();
    }
  }

  // js/particles.js
  var MAX_PARTICLES = 120;
  function spawnBurst(list, x, y, color, count = 10) {
    for (let i = 0;i < count; i++) {
      const angle = Math.PI * 2 * i / count + Math.random() * 0.5;
      const speed = 60 + Math.random() * 90;
      list.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        size: 3 + Math.random() * 3,
        color
      });
    }
    if (list.length > MAX_PARTICLES) {
      list.splice(0, list.length - MAX_PARTICLES);
    }
    return list;
  }
  function stepParticles(list, dt) {
    for (let i = list.length - 1;i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) {
        list.splice(i, 1);
        continue;
      }
      p.vy += 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    return list;
  }
  function drawParticles(ctx, list) {
    for (const p of list) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // js/main.js
  var TILE_SIZE = 32;
  function computeZoom(viewportHeight) {
    return Math.max(1, Math.min(3, Math.round(viewportHeight / 540)));
  }
  var GRAVITY = 980;
  var PLAYER_SPEED = 200;
  var JUMP_FORCE = 350;
  var MAX_FALL_SPEED = 600;
  var JUMP_BUFFER_TIME = 0.12;
  var COYOTE_TIME = 0.1;
  var LEDGE_FALL_SEED = 140;
  var STOMP_BOUNCE = 260;
  var FINAL_LEVEL = 15;
  var HIGH_SCORE_KEY = "platformerHighScore";
  var PAUSE_MENU_ARROWS = { ArrowUp: false, ArrowLeft: false, ArrowDown: true, ArrowRight: true };
  var LOOP_ERROR_RECOVERY_FRAMES = 30;
  var LEVEL_TRANSITION_MAX_STALL_FRAMES = 120;
  var liveGames = new Set;
  function destroyAllGames() {
    for (const game of liveGames)
      game.destroy();
    liveGames.clear();
  }
  var STATE = {
    MENU: "MENU",
    PLAYING: "PLAYING",
    PAUSED: "PAUSED",
    GAME_OVER: "GAME_OVER",
    LEVEL_COMPLETE: "LEVEL_COMPLETE",
    GAME_COMPLETE: "GAME_COMPLETE"
  };

  class Game {
    constructor() {
      this.canvas = document.getElementById("game-canvas");
      if (!this.canvas) {
        throw new Error("Game requires a #game-canvas element in the page");
      }
      this.ctx = this.canvas.getContext("2d");
      this._abort = new AbortController;
      this.resize();
      window.addEventListener("resize", () => this.resize(), { signal: this._abort.signal });
      this.input = new InputHandler;
      this.physics = new Physics(GRAVITY, MAX_FALL_SPEED);
      this.zoom = computeZoom(window.innerHeight);
      this.camera = new Camera(window.innerWidth / this.zoom, window.innerHeight / this.zoom);
      this.ui = new UI;
      this.ui.hideHUD();
      this.ui.setPauseEnabled(false);
      this.difficulty = new Difficulty;
      this.timer = new Timer(60);
      this.timerActive = false;
      this.sprites = new Sprites;
      this.particles = [];
      this.shakeTime = 0;
      this.squashTimer = 0;
      this._prevGrounded = true;
      this.state = STATE.MENU;
      this.level = null;
      this.runSeed = 1;
      this.player = null;
      this.enemyManager = null;
      this.collectibles = null;
      this.hazards = null;
      this.score = 0;
      this.levelStartScore = 0;
      this.currentLevel = 1;
      this.lastTime = 0;
      this.levelCompleteTimer = 0;
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this._loopErrorStreak = 0;
      this._recoveryAttempted = false;
      liveGames.add(this);
      this.bindEvents();
      requestAnimationFrame((time) => this.loop(time));
    }
    destroy() {
      liveGames.delete(this);
      this._destroyed = true;
      this._abort.abort();
      this.input.destroy();
    }
    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = window.innerWidth * dpr;
      this.canvas.height = window.innerHeight * dpr;
      this.canvas.style.width = window.innerWidth + "px";
      this.canvas.style.height = window.innerHeight + "px";
      this.ctx.scale(dpr, dpr);
      this.ctx.imageSmoothingEnabled = false;
      if (this.camera) {
        this.zoom = computeZoom(window.innerHeight);
        this.camera.width = window.innerWidth / this.zoom;
        this.camera.height = window.innerHeight / this.zoom;
      }
    }
    bindEvents() {
      const startBtn = document.getElementById("start-btn");
      const retryBtn = document.getElementById("retry-btn");
      const playAgainBtn = document.getElementById("play-again-btn");
      const pauseBtn = document.getElementById("pause-btn");
      const resumeBtn = document.getElementById("resume-btn");
      const restartLevelBtn = document.getElementById("restart-level-btn");
      const quitMenuBtn = document.getElementById("quit-menu-btn");
      if (!startBtn || !retryBtn || !playAgainBtn || !pauseBtn || !resumeBtn || !restartLevelBtn || !quitMenuBtn) {
        throw new Error("Game requires #start-btn, #retry-btn, #play-again-btn, " + "#pause-btn, #resume-btn, #restart-level-btn and #quit-menu-btn elements in the page");
      }
      const onClick = (el, fn) => el.addEventListener("click", fn, { signal: this._abort.signal });
      onClick(startBtn, () => this.startGame());
      onClick(retryBtn, () => this.retryLevel());
      onClick(playAgainBtn, () => {
        if (this.startGame())
          this.ui.hideOverlay("game-complete-screen");
      });
      onClick(pauseBtn, () => {
        this.togglePause();
        pauseBtn.blur();
      });
      onClick(resumeBtn, () => {
        this.togglePause();
        resumeBtn.blur();
      });
      onClick(restartLevelBtn, () => {
        this.restartCurrentLevel("pause-screen");
        restartLevelBtn.blur();
      });
      onClick(quitMenuBtn, () => {
        this.quitToMenu();
        quitMenuBtn.blur();
      });
      this.input.onJump(() => {
        if (this.state !== STATE.PLAYING || !this.player)
          return;
        if (this.player.grounded || this.coyoteTimer > 0) {
          this.player.jump();
        } else {
          this.jumpBufferTimer = JUMP_BUFFER_TIME;
        }
      });
      const moveIfPlaying = (fn) => () => {
        if (this.state === STATE.PLAYING)
          fn();
      };
      this.input.onMoveLeft(moveIfPlaying(() => this.player?.moveLeft()));
      this.input.onMoveRight(moveIfPlaying(() => this.player?.moveRight()));
      this.input.onReleaseLeft(() => this.player?.stopLeft());
      this.input.onReleaseRight(() => this.player?.stopRight());
      window.addEventListener("keydown", (e) => {
        const code = e.code || e.key;
        if (code === "Escape" && !e.repeat) {
          if (this.state === STATE.GAME_OVER || this.state === STATE.GAME_COMPLETE) {
            this.returnToMenu();
          } else {
            this.togglePause();
          }
        } else if (this.state === STATE.PAUSED && code in PAUSE_MENU_ARROWS) {
          e.preventDefault();
          this.ui.cyclePauseFocus(PAUSE_MENU_ARROWS[code]);
        }
      }, { signal: this._abort.signal });
    }
    setState(next) {
      if (!Object.values(STATE).includes(next)) {
        console.error("Invalid game state transition requested:", next);
        return false;
      }
      this.state = next;
      return true;
    }
    togglePause() {
      if (this.state === STATE.PLAYING) {
        this.setState(STATE.PAUSED);
        this.ui.showOverlay("pause-screen");
        this.ui.setPauseLabel(true);
        this.ui.focusPauseMenu();
      } else if (this.state === STATE.PAUSED) {
        this.setState(STATE.PLAYING);
        this.ui.hideOverlay("pause-screen");
        this.ui.setPauseLabel(false);
        this.ui.blurPauseControls();
      }
    }
    returnToMenu() {
      this.setState(STATE.MENU);
      this.ui.hideOverlay("game-over-screen");
      this.ui.hideOverlay("game-complete-screen");
      this.ui.showOverlay("menu-screen");
      this.ui.hideHUD();
    }
    quitToMenu() {
      this.ui.blurPauseControls();
      this.ui.hideOverlay("pause-screen");
      this.returnToMenu();
    }
    startGame() {
      this.runSeed = Math.random() * 4294967295 >>> 0;
      const level = this.tryConstructLevel(1);
      if (!level)
        return false;
      this.score = 0;
      this.currentLevel = 1;
      this.timer.timeRemaining = this.timer.baseTime;
      this.publishLevel(level);
      this.ui.showHUD();
      this.ui.hideOverlay("menu-screen");
      return true;
    }
    seedFor(levelNumber) {
      return this.runSeed + Math.imul(levelNumber, 2654435761) >>> 0;
    }
    tryConstructLevel(levelNumber) {
      try {
        return new Level(levelNumber, TILE_SIZE, this.seedFor(levelNumber));
      } catch (first) {
        console.error("Level generation failed; re-attempting once:", first);
      }
      try {
        return new Level(levelNumber, TILE_SIZE, this.seedFor(levelNumber));
      } catch (second) {
        console.error("Level generation failed again:", second);
        this.ui.showErrorMessage("Could not prepare that level — try again.");
        return null;
      }
    }
    startLevel() {
      const level = new Level(this.currentLevel, TILE_SIZE, this.seedFor(this.currentLevel));
      this.publishLevel(level);
    }
    publishLevel(level) {
      this.level = level;
      const spawn = level.getSpawnPoint();
      this.player = new Player(spawn.x, spawn.y, PLAYER_SPEED, JUMP_FORCE);
      this.enemyManager = level.getEnemyManager();
      this.collectibles = level.getCollectibles();
      this.hazards = level.getHazards();
      this.ui.updateCoins(this.collectibles.getCoins().length - this.collectibles.getUncollectedCoins().length, this.collectibles.getCoins().length);
      this.levelStartScore = this.score;
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.levelCompleteTimer = 0;
      if (!Number.isFinite(this.timer.timeRemaining) || this.timer.timeRemaining < 0 || this.timer.timeRemaining > 9999) {
        console.warn("Run clock invalid at level transition; using default", this.timer.baseTime, "seconds");
        this.timer.timeRemaining = this.timer.baseTime;
      }
      if (this.collectibles.getCoins().length < 3) {
        console.warn("Level generated with fewer than 3 coins:", this.collectibles.getCoins().length);
      }
      this.timerActive = this.difficulty.isTimerEnabled(this.currentLevel);
      this.ui.setTimerVisible(this.timerActive);
      this.ui.updateTimer(this.timer.getTimeRemaining());
      this.setState(STATE.PLAYING);
      this.ui.setPauseLabel(false);
      this.ui.setPauseEnabled(true);
      this.camera.reset();
      this.camera.follow(this.player, level.width * level.tileSize, level.height * level.tileSize);
    }
    retryLevel() {
      this.restartCurrentLevel("game-over-screen");
    }
    restartCurrentLevel(overlayId) {
      const keptIndices = this.collectibles ? this.collectibles.getCoins().map((coin, i) => coin.collected ? i : -1).filter((i) => i >= 0) : [];
      const level = this.tryConstructLevel(this.currentLevel);
      if (!level)
        return;
      const replayCoins = level.getCollectibles().getCoins();
      for (const i of keptIndices) {
        if (replayCoins[i])
          level.getCollectibles().collectCoin(i);
      }
      this.levelStartScore = this.score;
      this.timer.timeRemaining = this.timer.baseTime;
      this.ui.hideOverlay(overlayId);
      this.publishLevel(level);
    }
    handleWin() {
      this.setState(STATE.LEVEL_COMPLETE);
      this.ui.setPauseEnabled(false);
      this.levelCompleteTimer = 2;
      this.levelTransitionStalled = false;
      this.levelTransitionStallFrames = 0;
      this.ui.showOverlay("level-complete-screen");
    }
    handleGameOver(cause) {
      this.setState(STATE.GAME_OVER);
      this.shakeTime = 0.35;
      if (this.player) {
        spawnBurst(this.particles, this.player.x + this.player.width / 2, this.player.y + this.player.height / 2, "#ff5a5a", 16);
      }
      this.ui.setPauseEnabled(false);
      this.ui.showGameOver(this.score, cause);
    }
    handleGameComplete() {
      this.setState(STATE.GAME_COMPLETE);
      this.ui.setPauseEnabled(false);
      let highScore = this.score;
      try {
        const stored = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0;
        if (this.score > stored) {
          localStorage.setItem(HIGH_SCORE_KEY, String(this.score));
        }
        highScore = Math.max(this.score, stored);
      } catch (error) {
        console.warn("High score unavailable (localStorage failed):", error);
      }
      this.ui.showGameComplete(this.score, highScore);
    }
    update(dt) {
      this.sprites.advance(dt);
      stepParticles(this.particles, dt);
      if (this.shakeTime > 0)
        this.shakeTime = Math.max(0, this.shakeTime - dt);
      if (this.squashTimer > 0)
        this.squashTimer = Math.max(0, this.squashTimer - dt);
      if (this.state === STATE.PLAYING) {
        if (this.timerActive) {
          this.timer.update(dt);
          this.ui.updateTimer(this.timer.getTimeRemaining());
          if (this.timer.isTimeUp()) {
            this.handleGameOver("time");
            return;
          }
        }
        this.player.prevX = this.player.x;
        this.player.prevY = this.player.y;
        this.player.update(dt, this.input.isLeft(), this.input.isRight());
        this.physics.applyGravity(this.player, dt);
        const collisions = this.physics.checkCollisions(this.player, this.level.getPlatforms());
        this.physics.resolveCollisions(this.player, collisions);
        this.coyoteTimer = this.player.grounded ? COYOTE_TIME : this.coyoteTimer - dt;
        if (this.player.grounded && !this._prevGrounded) {
          this.squashTimer = 0.12;
          if (!this.input.isLeft() && !this.input.isRight()) {
            this.player.vx = 0;
          }
        } else if (!this.player.grounded && this._prevGrounded && this.player.vy >= 0) {
          this.player.vy = Math.max(this.player.vy, LEDGE_FALL_SEED);
        }
        this._prevGrounded = this.player.grounded;
        if (this.jumpBufferTimer > 0) {
          this.jumpBufferTimer -= dt;
          if (this.player.grounded) {
            this.player.jump();
            this.jumpBufferTimer = 0;
          }
        }
        this.enemyManager.updateAll(dt);
        const contact = this.enemyManager.resolvePlayerContact(this.player);
        if (contact.stomped > 0) {
          this.player.vy = -STOMP_BOUNCE;
          spawnBurst(this.particles, this.player.x + this.player.width / 2, this.player.y + this.player.height, "#c96bf5", 10);
        }
        if (contact.deadly) {
          this.handleGameOver("enemy");
          return;
        }
        if (this.hazards.checkPlayerSpikes(this.player)) {
          this.handleGameOver("spike");
          return;
        }
        if (this.hazards.checkPitFall(this.player, this.level.height * this.level.tileSize)) {
          this.handleGameOver("pit");
          return;
        }
        const collectedCoins = this.collectibles.checkCollection(this.player);
        if (collectedCoins > 0) {
          spawnBurst(this.particles, this.player.x + this.player.width / 2, this.player.y + this.player.height / 2, "#ffd23f", 12);
          this.score = Math.min(this.score + collectedCoins * COIN_POINTS, Number.MAX_SAFE_INTEGER);
          for (let i = 0;i < collectedCoins; i++)
            this.timer.addCoinBonus();
          this.ui.updateCoins(this.collectibles.getCoins().length - this.collectibles.getUncollectedCoins().length, this.collectibles.getCoins().length);
        }
        const portal = this.level.getPortal();
        if (portal && !this.player.hasReachedPortal() && this.collectibles.meetsPortalRequirement() && this.physics.checkAABB(this.player, portal)) {
          this.player.markPortalReached();
        }
        if (this.player.hasReachedPortal()) {
          this.handleWin();
        }
        this.camera.follow(this.player, this.level.width * this.level.tileSize, this.level.height * this.level.tileSize, dt);
        this.ui.updateScore(this.score);
        this.ui.updateLevel(this.currentLevel);
      } else if (this.state === STATE.LEVEL_COMPLETE) {
        this.levelCompleteTimer -= dt;
        if (this.levelCompleteTimer <= 0) {
          if (this.currentLevel >= FINAL_LEVEL) {
            this.handleGameComplete();
            this.ui.hideOverlay("level-complete-screen");
          } else {
            const next = this.currentLevel + 1;
            try {
              const level = new Level(next, TILE_SIZE, this.seedFor(next));
              this.currentLevel = next;
              this.publishLevel(level);
              this.ui.hideOverlay("level-complete-screen");
            } catch (error) {
              this.levelTransitionStallFrames++;
              if (this.levelTransitionStallFrames > LEVEL_TRANSITION_MAX_STALL_FRAMES) {
                console.error("Level transition failed persistently; returning to menu:", error);
                this.ui.hideOverlay("level-complete-screen");
                this.returnToMenu();
                this.ui.showErrorMessage("Something went wrong. Returning to main menu.");
              } else if (!this.levelTransitionStalled) {
                console.error("Level transition stalled; retrying:", error);
                this.levelTransitionStalled = true;
              }
            }
          }
        }
      }
    }
    draw() {
      const sprites = this.sprites.ready() ? this.sprites : null;
      this.ctx.fillStyle = "#87CEEB";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.state === STATE.PLAYING || this.state === STATE.LEVEL_COMPLETE || this.state === STATE.PAUSED) {
        this.ctx.save();
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const zoom = this.zoom;
        const effW = viewW / zoom;
        const effH = viewH / zoom;
        if (sprites) {
          const worldBottom = this.level.height * this.level.tileSize;
          const worldBottomScreen = (worldBottom + this.camera.y - effH / 2) * zoom + viewH / 2;
          sprites.drawBackground(this.ctx, this.currentLevel, this.camera.x, viewW, viewH, worldBottomScreen);
        }
        let shakeX = 0;
        let shakeY = 0;
        if (this.shakeTime > 0) {
          const mag = 9 * (this.shakeTime / 0.35);
          shakeX = (Math.random() * 2 - 1) * mag;
          shakeY = (Math.random() * 2 - 1) * mag;
        }
        this.ctx.translate(viewW / 2 + shakeX, viewH / 2 + shakeY);
        this.ctx.scale(zoom, zoom);
        this.ctx.translate(-(this.camera.x + effW / 2), this.camera.y - effH / 2);
        if (sprites)
          sprites.drawWorld(this.ctx, this.level, this.camera.x, this.camera.y, effW, effH);
        this.level.draw(this.ctx, sprites);
        const squash = this.squashTimer > 0 ? 1 - 0.25 * (this.squashTimer / 0.12) : 1;
        this.player.draw(this.ctx, sprites, squash);
        if (this.particles.length)
          drawParticles(this.ctx, this.particles);
        this.ctx.restore();
      }
    }
    loop(time) {
      if (this._destroyed)
        return;
      const dt = (time - this.lastTime) / 1000;
      this.lastTime = time;
      const cappedDt = Math.min(dt, 0.05);
      requestAnimationFrame((t) => this.loop(t));
      try {
        this.update(cappedDt);
        this.draw();
        this._loopErrorStreak = 0;
        this._recoveryAttempted = false;
      } catch (error) {
        console.error("Game loop error:", error);
        this._handleLoopError();
      }
    }
    _handleLoopError() {
      this._loopErrorStreak++;
      const inRun = this.state === STATE.PLAYING || this.state === STATE.PAUSED;
      if (!inRun)
        return;
      if (!this._recoveryAttempted) {
        if (this._loopErrorStreak >= LOOP_ERROR_RECOVERY_FRAMES) {
          this._attemptLoopRecovery();
        }
      } else if (this._loopErrorStreak >= 2 * LOOP_ERROR_RECOVERY_FRAMES) {
        console.error("Game loop errors persisted after recovery; returning to menu");
        this.ui.hideOverlay("pause-screen");
        this.returnToMenu();
        this.ui.showErrorMessage("Something went wrong. Returning to main menu.");
      }
    }
    _attemptLoopRecovery() {
      this._recoveryAttempted = true;
      console.error("Attempting recovery from repeated game loop errors");
      try {
        const level = new Level(this.currentLevel, TILE_SIZE, this.seedFor(this.currentLevel));
        this.ui.showErrorMessage("Something went wrong — recovering…");
        this.ui.blurPauseControls();
        this.ui.hideOverlay("pause-screen");
        this.publishLevel(level);
      } catch (inner) {
        console.error("Recovery failed; returning to menu:", inner);
        this.ui.hideOverlay("pause-screen");
        this.returnToMenu();
        this.ui.showErrorMessage("Something went wrong. Returning to main menu.");
      }
    }
  }
  function init() {
    const game = new Game;
    if (typeof window !== "undefined") {
      window.game = game;
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      init();
    });
  }
})();
