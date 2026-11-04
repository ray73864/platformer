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
    CHARGER_STOMP_POINTS: () => CHARGER_STOMP_POINTS,
    CLEAR_BONUS_BASE: () => CLEAR_BONUS_BASE,
    CLEAR_BONUS_REDUCED_RATE: () => CLEAR_BONUS_REDUCED_RATE,
    CLEAR_BONUS_TIER_STEP: () => CLEAR_BONUS_TIER_STEP,
    DEATH_SCORE_PENALTY_RATE: () => DEATH_SCORE_PENALTY_RATE,
    DODGE_POINTS: () => DODGE_POINTS,
    FINAL_LEVEL: () => FINAL_LEVEL,
    Game: () => Game,
    STATE: () => STATE,
    STOMP_POINTS: () => STOMP_POINTS,
    TILE_SIZE: () => TILE_SIZE,
    clearBonusFor: () => clearBonusFor,
    computeZoom: () => computeZoom,
    deathScorePenalty: () => deathScorePenalty,
    destroyAllGames: () => destroyAllGames,
    init: () => init2,
    layoutSignature: () => layoutSignature,
    layoutSimilarity: () => layoutSimilarity,
    seedCandidate: () => seedCandidate
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
      this.onReleaseJumpCallback = null;
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
      } else if (code === "Space") {
        this.onReleaseJumpCallback?.();
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
    isWalk() {
      return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
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
    onReleaseJump(callback) {
      this.onReleaseJumpCallback = callback;
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
                const topRef = platform.dy !== undefined && platform.dy < 0 ? platform.prevY : platform.y;
                if (prevBottom > topRef + LANDING_TOLERANCE) {
                  continue;
                }
                const prevXOverlap = player.prevX === undefined || player.prevX < platform.x + platform.width && player.prevX + player.width > platform.x;
                if (!prevXOverlap && prevBottom >= topRef - LANDING_TOLERANCE) {
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
  var AIR_BRAKE_DECEL = 900;
  var JUMP_BUFFER_TIME = 0.12;
  var COYOTE_TIME = 0.1;
  var COYOTE_MAX_FALL_SPEED = 120;
  var JUMP_CUT_FACTOR = 0.45;
  var WALK_SPEED = 110;
  var LEDGE_FALL_SEED = 140;

  class Player extends Entity {
    constructor(x, y, speed, jumpForce) {
      super(x, y, 32, 32);
      this.speed = speed;
      this.jumpForce = jumpForce;
      this.reachedPortal = false;
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.jumpCutAvailable = false;
    }
    update(dt, left = false, right = false, opts = {}) {
      super.update(dt, left, right);
      const walk = !!opts.walk && this.grounded;
      if (left && !right) {
        this.vx = -(walk ? WALK_SPEED : this.speed);
      } else if (right && !left) {
        this.vx = walk ? WALK_SPEED : this.speed;
      } else if (this.grounded) {
        const drop = PLAYER_STOP_DECEL * dt;
        this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
      } else {
        const drop = AIR_BRAKE_DECEL * dt;
        this.vx = Math.abs(this.vx) <= drop ? 0 : this.vx - Math.sign(this.vx) * drop;
      }
      if (this.grounded) {
        this.coyoteTimer = COYOTE_TIME;
      } else if (this.coyoteTimer > 0) {
        this.coyoteTimer -= dt;
        if (this.coyoteTimer <= 0 && this.vy >= 0) {
          this.vy = Math.max(this.vy, LEDGE_FALL_SEED);
        }
      }
      if (this.jumpBufferTimer > 0) {
        this.jumpBufferTimer -= dt;
        if (this.grounded)
          this.jump();
      }
    }
    moveLeft(walk = false) {
      this.vx = -(walk && this.grounded ? WALK_SPEED : this.speed);
    }
    moveRight(walk = false) {
      this.vx = walk && this.grounded ? WALK_SPEED : this.speed;
    }
    stopLeft() {}
    stopRight() {}
    pressJump() {
      if (this.grounded || this.coyoteTimer > 0 && this.vy < COYOTE_MAX_FALL_SPEED) {
        this.jump();
      } else {
        this.jumpBufferTimer = JUMP_BUFFER_TIME;
      }
    }
    jump() {
      this.vy = -this.jumpForce;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.jumpCutAvailable = true;
    }
    releaseJump() {
      if (this.vy < 0 && this.jumpCutAvailable) {
        this.vy *= JUMP_CUT_FACTOR;
        this.jumpCutAvailable = false;
      }
    }
    cancelJumpFeel() {
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
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
    },
    expert: {
      width: 32,
      height: 24,
      maxEnemies: 10,
      hasTimer: true
    },
    master: {
      width: 36,
      height: 27,
      maxEnemies: 12,
      hasTimer: true
    },
    legend: {
      width: 40,
      height: 30,
      maxEnemies: 14,
      hasTimer: true
    }
  };
  var TIER_BOUNDARIES = [PHASE2_FIRST_LEVEL, 10, 25, 50, 75];
  var TIER_ORDER = ["basic", "intermediate", "advanced", "expert", "master", "legend"];
  function tierIndexFor(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1)
      return 0;
    let index = 0;
    for (const boundary of TIER_BOUNDARIES) {
      if (levelNumber >= boundary)
        index++;
    }
    return index;
  }
  function configFor(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
      console.warn("Invalid level number for difficulty scaling:", levelNumber, "- defaulting to basic tier");
      return LEVEL_CONFIGS.basic;
    }
    return LEVEL_CONFIGS[TIER_ORDER[tierIndexFor(levelNumber)]];
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

  // js/projectiles.js
  var PROJ_RADIUS = 5;
  var PROJ_GRAVITY = 520;
  var PROJ_MAX_VX = 150;
  var PROJECTILE_TERMINAL_VY = 600;
  var PROJ_MIN_FLIGHT = 0.5;
  function ballisticLaunch(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(PROJ_MIN_FLIGHT, Math.abs(dx) / PROJ_MAX_VX);
    return {
      vx: dx / t,
      vy: (dy - 0.5 * PROJ_GRAVITY * t * t) / t
    };
  }

  class Projectile {
    constructor(x, y, vx, vy, owner) {
      this.x = x;
      this.y = y;
      this.vx = vx;
      this.vy = vy;
      this.r = PROJ_RADIUS;
      this.dead = false;
      this.owner = owner || null;
      this._sfxCounted = false;
    }
  }

  class ProjectileManager {
    constructor(terrain) {
      this.terrain = terrain;
      this.list = [];
    }
    spawn(x, y, vx, vy, owner = null) {
      const p = new Projectile(x, y, vx, vy, owner);
      this.list.push(p);
      return p;
    }
    updateAll(dt, player = null) {
      const events = { fired: 0, impacts: [], hitPlayer: false };
      const T = this.terrain.tileSize;
      const maxX = (this.terrain.width + 2) * T;
      const minX = -2 * T;
      const maxY = (this.terrain.height + 3) * T;
      for (const p of this.list) {
        if (p.dead)
          continue;
        p.vy = Math.min(p.vy + PROJ_GRAVITY * dt, PROJECTILE_TERMINAL_VY);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (this.terrain.isSolidPx(p.x, p.y)) {
          p.dead = true;
          events.impacts.push({ x: p.x, y: p.y });
          continue;
        }
        if (player && aabbOverlap(player, {
          x: p.x - p.r,
          y: p.y - p.r,
          width: 2 * p.r,
          height: 2 * p.r
        })) {
          p.dead = true;
          events.hitPlayer = true;
          continue;
        }
        if (p.x < minX || p.x > maxX || p.y > maxY)
          p.dead = true;
        if (!p.dead && !p._sfxCounted) {
          p._sfxCounted = true;
          events.fired++;
        }
      }
      if (this.list.some((p) => p.dead)) {
        this.list = this.list.filter((p) => !p.dead);
      }
      return events;
    }
    getActive() {
      return this.list.filter((p) => !p.dead);
    }
    clear() {
      this.list.length = 0;
    }
    drawAll(ctx) {
      for (const p of this.list) {
        if (p.dead)
          continue;
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = "#23232c";
        ctx.beginPath();
        ctx.arc(p.x - p.vx * 0.07, p.y - p.vy * 0.07, p.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(p.x - p.vx * 0.035, p.y - p.vy * 0.035, p.r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#23232c";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8b8b9a";
        ctx.fillRect(p.x - 3, p.y - 3, 2, 2);
      }
    }
  }

  // js/enemies.js
  var ENEMY_WIDTH = 32;
  var ENEMY_HEIGHT = 32;
  var ENEMY_SPEED = 40;
  var ENEMY_HITBOX_INSET_X = 4;
  var ENEMY_HITBOX_INSET_TOP = 4;
  var ENEMY_STOMP_TOLERANCE = 18;
  var CHARGER_WINDUP_TIME = 0.45;
  var CHARGER_DASH_TIME = 1.2;
  var CHARGER_COOLDOWN_TIME = 1;
  var CHARGER_DASH_SPEED_MULT = 2.2;
  var CHARGER_TRIGGER_COLS = 6;
  var CHARGER_TRIGGER_ROW_TOLERANCE = 32;
  var BOMBARDIER_WINDUP_RANGED_TIME = 0.6;
  var BOMBARDIER_COOLDOWN_RANGED_TIME = 1.4;
  var BOMBARDIER_RANGE_MIN_COLS = 3;
  var BOMBARDIER_RANGE_MAX_COLS = 8;
  var BOMBARDIER_RANGED_ROW_TOLERANCE = 48;
  var BOMBARDIER_CLOSE_TRIGGER_COLS = 2.5;
  class Enemy {
    constructor(x, y, minX, maxX, kind = "walker", context = null) {
      this.x = x;
      this.y = y;
      this.width = ENEMY_WIDTH;
      this.height = ENEMY_HEIGHT;
      this.speed = ENEMY_SPEED;
      this.minX = minX;
      this.maxX = maxX;
      this.vx = this.speed;
      this.dead = false;
      this.kind = kind;
      this.state = "patrol";
      this.stateTime = 0;
      this._projectiles = context && context.projectiles ? context.projectiles : null;
      this._terrain = context && context.terrain ? context.terrain : null;
      this.liveShot = null;
      this.dodged = false;
      this._dodgePrevSide = 0;
      this._dodgePrevPx = 0;
    }
    update(dt, player = null) {
      if (this.dead)
        return;
      if (this.kind === "charger") {
        this._updateCharger(dt, player);
        return;
      }
      if (this.kind === "bombardier") {
        this._updateBombardier(dt, player);
        return;
      }
      this._patrolStep(dt);
    }
    _patrolStep(dt) {
      this.x += this.vx * dt;
      if (this.x <= this.minX) {
        this.x = this.minX;
        this.vx = Math.abs(this.vx);
      } else if (this.x + this.width >= this.maxX) {
        this.x = this.maxX - this.width;
        this.vx = -Math.abs(this.vx);
      }
    }
    _triggeredBy(player, facing = this.vx) {
      if (!player)
        return false;
      const dx = player.x + player.width / 2 - (this.x + this.width / 2);
      if (dx === 0 || facing === 0)
        return false;
      if (Math.sign(dx) !== Math.sign(facing))
        return false;
      if (Math.abs(dx) > CHARGER_TRIGGER_COLS * 32)
        return false;
      const dyFeet = Math.abs(player.y + player.height - (this.y + this.height));
      return dyFeet <= CHARGER_TRIGGER_ROW_TOLERANCE;
    }
    _updateCharger(dt, player) {
      this.stateTime += dt;
      switch (this.state) {
        case "patrol":
          this._patrolStep(dt);
          if (this._triggeredBy(player)) {
            this._enterCloseWindup();
          }
          break;
        default:
          this._chargeLeg(dt, player);
      }
    }
    _enterCloseWindup(keepHeading = null) {
      this.state = "windup";
      this.stateTime = 0;
      this._preWindupVx = keepHeading !== null ? keepHeading : this.vx;
      this.vx = 0;
    }
    _chargeLeg(dt, player) {
      switch (this.state) {
        case "windup":
          if (!this._triggeredBy(player, this._preWindupVx)) {
            this.state = "patrol";
            this.stateTime = 0;
            this.vx = this._preWindupVx || Math.abs(this.speed);
            break;
          }
          if (this.stateTime >= CHARGER_WINDUP_TIME) {
            this.state = "dash";
            this.stateTime = 0;
            const dir = player.x + player.width / 2 >= this.x + this.width / 2 ? 1 : -1;
            this.vx = dir * this.speed * CHARGER_DASH_SPEED_MULT;
          }
          break;
        case "dash":
          this.x += this.vx * dt;
          if (this.x <= this.minX) {
            this.x = this.minX;
            this._endDash(1);
          } else if (this.x + this.width >= this.maxX) {
            this.x = this.maxX - this.width;
            this._endDash(-1);
          } else if (this.stateTime >= CHARGER_DASH_TIME) {
            this._endDash(Math.sign(this.vx) || 1);
          }
          break;
        case "cooldown":
          this._patrolStep(dt);
          if (this.stateTime >= CHARGER_COOLDOWN_TIME) {
            this.state = "patrol";
            this.stateTime = 0;
          }
          break;
      }
    }
    _endDash(inwardDir) {
      this.state = "cooldown";
      this.stateTime = 0;
      this.vx = inwardDir * this.speed;
    }
    _facingDir() {
      if (this.vx !== 0)
        return Math.sign(this.vx);
      return Math.sign(this._preWindupVx || 1);
    }
    _muzzlePoint() {
      const face = this._facingDir();
      return {
        x: this.x + this.width / 2 + face * 22,
        y: this.y + 14
      };
    }
    _lineOfFireClear(player) {
      if (!this._terrain)
        return true;
      const m = this._muzzlePoint();
      const tx = player.x + player.width / 2;
      const ty = player.y + player.height / 2;
      const v = ballisticLaunch(m.x, m.y, tx, ty);
      const flight = Math.max(0.5, Math.abs(tx - m.x) / PROJ_MAX_VX);
      const steps = 14;
      for (let i = 1;i <= steps; i++) {
        const t = i / steps * flight;
        const sx = m.x + v.vx * t;
        const sy = m.y + v.vy * t + 0.5 * PROJ_GRAVITY * t * t;
        if (Math.abs(sx - (this.x + this.width / 2)) < 20 && Math.abs(sy - (this.y + this.height / 2)) < 20)
          continue;
        if (this._terrain.isSolidPx(sx, sy))
          return false;
      }
      return true;
    }
    _rangedTriggeredBy(player, facing = this._facingDir()) {
      if (!player || facing === 0)
        return false;
      if (this.liveShot && !this.liveShot.dead)
        return false;
      const dx = player.x + player.width / 2 - (this.x + this.width / 2);
      if (dx === 0 || Math.sign(dx) !== Math.sign(facing))
        return false;
      const adx = Math.abs(dx);
      if (adx < BOMBARDIER_RANGE_MIN_COLS * 32)
        return false;
      if (adx > BOMBARDIER_RANGE_MAX_COLS * 32)
        return false;
      const dyFeet = Math.abs(player.y + player.height - (this.y + this.height));
      if (dyFeet > BOMBARDIER_RANGED_ROW_TOLERANCE)
        return false;
      return this._lineOfFireClear(player);
    }
    _closeTriggeredBy(player, facing = this._facingDir()) {
      if (!player || facing === 0)
        return false;
      const dx = player.x + player.width / 2 - (this.x + this.width / 2);
      if (dx === 0 || Math.sign(dx) !== Math.sign(facing))
        return false;
      if (Math.abs(dx) > BOMBARDIER_CLOSE_TRIGGER_COLS * 32)
        return false;
      const dyFeet = Math.abs(player.y + player.height - (this.y + this.height));
      return dyFeet <= CHARGER_TRIGGER_ROW_TOLERANCE;
    }
    _updateBombardier(dt, player) {
      this.stateTime += dt;
      switch (this.state) {
        case "patrol":
          this._patrolStep(dt);
          if (this._closeTriggeredBy(player)) {
            this._enterCloseWindup();
          } else if (this._rangedTriggeredBy(player)) {
            this.state = "windup_ranged";
            this.stateTime = 0;
            this._preWindupVx = this.vx;
            this.vx = 0;
          }
          break;
        case "windup_ranged": {
          const facing = Math.sign(this._preWindupVx || 1);
          if (this._closeTriggeredBy(player, facing)) {
            this._enterCloseWindup(this._preWindupVx);
          } else if (!this._rangedTriggeredBy(player, facing)) {
            this.state = "patrol";
            this.stateTime = 0;
            this.vx = this._preWindupVx || Math.abs(this.speed);
          } else if (this.stateTime >= BOMBARDIER_WINDUP_RANGED_TIME) {
            this._fireRanged(player);
            this.state = "cooldown_ranged";
            this.stateTime = 0;
          }
          break;
        }
        case "cooldown_ranged":
          this._patrolStep(dt);
          if (this.stateTime >= BOMBARDIER_COOLDOWN_RANGED_TIME) {
            this.state = "patrol";
            this.stateTime = 0;
          }
          break;
        default:
          this._chargeLeg(dt, player);
      }
    }
    _fireRanged(player) {
      if (!this._projectiles)
        return;
      const m = this._muzzlePoint();
      const v = ballisticLaunch(m.x, m.y, player.x + player.width / 2, player.y + player.height / 2);
      this.liveShot = this._projectiles.spawn(m.x, m.y, v.vx, v.vy, this);
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
      let body = "#ff0000";
      if (this.kind === "spiny")
        body = "#7b4fa0";
      else if (this.kind === "charger")
        body = "#c8503c";
      else if (this.kind === "bombardier")
        body = "#4a1f52";
      ctx.fillStyle = body;
      ctx.fillRect(this.x, this.y, this.width, this.height);
      const drawnFace = this.state === "windup" || this.state === "windup_ranged" ? Math.sign(this._preWindupVx || 1) : this.vx >= 0 ? 1 : -1;
      if (this.kind === "spiny") {
        ctx.fillStyle = "#1c1c24";
        for (let i = 0;i < 4; i++) {
          ctx.fillRect(this.x + 3 + i * 7, this.y - 0, 5, 5);
        }
      } else if (this.kind === "charger") {
        const face = this.state === "windup" ? Math.sign(this._preWindupVx || 1) : this.vx >= 0 ? 1 : -1;
        const hornX = face > 0 ? this.x + this.width - 7 : this.x + 1;
        ctx.fillStyle = "#e8d8b0";
        ctx.fillRect(hornX, this.y + 5, 6, 5);
        if (this.state === "windup") {
          ctx.fillStyle = "rgba(255,232,170,0.55)";
          ctx.fillRect(this.x, this.y, this.width, this.height);
        }
      } else if (this.kind === "bombardier") {
        const muzzleX = drawnFace > 0 ? this.x + this.width - 2 : this.x - 10;
        ctx.fillStyle = "#b0803a";
        ctx.fillRect(muzzleX, this.y + 11, 12, 6);
        if (this.state === "windup_ranged") {
          const k = Math.min(1, this.stateTime / 0.6);
          ctx.fillStyle = `rgba(255,180,80,${0.25 + 0.5 * k})`;
          const gx = drawnFace > 0 ? this.x + this.width : this.x - 4 - 4 * k;
          ctx.fillRect(gx, this.y + 9 - 2 * k, 4 + 4 * k, 10 + 4 * k);
        } else if (this.state === "cooldown_ranged" && this.stateTime < 0.08) {
          ctx.fillStyle = "rgba(255,232,170,0.9)";
          const fx = drawnFace > 0 ? this.x + this.width : this.x - 6;
          ctx.fillRect(fx, this.y + 8, 6, 12);
        }
      }
      ctx.fillStyle = "#fff";
      const eyeOffset = drawnFace >= 0 ? 18 : 6;
      ctx.fillRect(this.x + eyeOffset, this.y + 8, 4, 4);
    }
  }

  class EnemyManager {
    constructor() {
      this.enemies = [];
    }
    addEnemy(x, y, minX, maxX, kind = "walker", context = null) {
      this.enemies.push(new Enemy(x, y, minX, maxX, kind, context));
    }
    updateAll(dt, player = null) {
      for (const enemy of this.enemies) {
        enemy.update(dt, player);
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
      let deadlyBySpiny = false;
      const stompedEnemies = [];
      const prevBottom = (player.prevY !== undefined ? player.prevY : player.y) + player.height;
      for (const enemy of this.enemies) {
        if (enemy.isDead())
          continue;
        if (!enemy.checkCollision(player))
          continue;
        if (enemy.kind === "spiny") {
          deadly = true;
          deadlyBySpiny = true;
        } else if (player.vy > 0 && prevBottom <= enemy.y + ENEMY_STOMP_TOLERANCE) {
          enemy.die();
          stomped++;
          stompedEnemies.push(enemy);
        } else {
          deadly = true;
        }
      }
      return { stomped, deadly, deadlyBySpiny, stompedEnemies };
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
  var GAP_CHANCE_CAP = 0.64;
  var SPIKE_TARGET_CAP = 20;
  var COIN_TARGET_CAP = 30;
  var SPINY_FIRST_LEVEL = 10;
  var SPINY_RAMP_LEVELS = 21;
  var SPINY_CHANCE_MAX = 0.25;
  var CHARGER_FIRST_LEVEL = 20;
  var CHARGER_RAMP_LEVELS = 21;
  var CHARGER_CHANCE_MAX = 0.2;
  var BOMBARDIER_FIRST_LEVEL = 40;
  var BOMBARDIER_RAMP_LEVELS = 21;
  var BOMBARDIER_CHANCE_MAX = 0.15;
  var BOMBARDIER_CAP_DIVISOR = 4;
  var SPINY_CAP_DIVISOR = 3;
  var HOSTILE_MIN_RUN = 4;
  var ENEMY_MIN_RUN = 2;
  var DECK_BRIDGE_FIRST_LEVEL = 8;
  var MAX_DECK_BRIDGES = 1;
  var BRIDGE_CHANCE = 0.6;
  var MIN_DECK_GAP = 6;
  var MAX_DECK_GAP = 7;
  var BRIDGE_MIN_START_COL = 7;
  var DECK_DWELL_S = 0.8;
  var MP_DECK_TILES = 2;
  var MP_CLEARANCE_ROWS = 3;
  var MP_SPEED_MIN = 26;
  var MP_SPEED_RANGE = 18;
  var BRIDGE_LIP_BAN_COLS = 3;
  var ELEVATOR_FIRST_LEVEL = 13;
  var MAX_SHAFTS = 1;
  var SHAFT_CHANCE = 0.82;
  var MIN_SHAFT_LIFT = 4;
  var MAX_SHAFT_LIFT = 6;
  var SHAFT_COLS = 2;
  var SHAFT_LEDGE_W = 2;
  var SHAFT_WINDOW_PAD = 2;
  var V_DECK_SPEED_MIN = 20;
  var V_DECK_SPEED_RANGE = 5;
  var SHAFT_BOTTOM_MIN_ROW = 16;
  var SHAFT_BOTTOM_MAX_ROW = 18;
  function routeModelEdges(level) {
    const tiles = level.tiles;
    const { width: w, height: h } = level;
    const solid = (x, y) => {
      if (x < 0 || x >= w)
        return true;
      if (y < 0 || y >= h)
        return false;
      return tiles[y][x] === 1;
    };
    const hazard = (x, y) => {
      if (x < 0 || x >= w || y < 0 || y >= h)
        return false;
      return tiles[y][x] === 2;
    };
    const freeCell = (x, y) => !solid(x, y) && !hazard(x, y);
    const standable = (x, y) => freeCell(x, y) && solid(x, y + 1);
    const corr = level.bridgeGap;
    const isCorr = (x, y) => corr !== null && corr !== undefined && y === corr.S - 1 && x >= corr.a && x <= corr.b;
    const key = (x, y) => y * w + x;
    const edges = [];
    if (!standable(level.spawnTile.x, level.spawnTile.y))
      return edges;
    const seen = new Set([key(level.spawnTile.x, level.spawnTile.y)]);
    const queue = [[level.spawnTile.x, level.spawnTile.y]];
    while (queue.length) {
      const [x, y] = queue.shift();
      if (isCorr(x, y)) {
        for (const dir of [-1, 1]) {
          const nx = x + dir;
          if (isCorr(nx, y)) {
            edges.push({
              ax: x,
              ay: y,
              bx: nx,
              by: y,
              kind: "deck",
              dist: 1,
              dir
            });
            if (!seen.has(key(nx, y))) {
              seen.add(key(nx, y));
              queue.push([nx, y]);
            }
            continue;
          }
          for (const ny of [y, y - 1]) {
            if (standable(nx, ny)) {
              edges.push({
                ax: x,
                ay: y,
                bx: nx,
                by: ny,
                kind: "deck",
                dist: 1,
                dir
              });
              if (!seen.has(key(nx, ny))) {
                seen.add(key(nx, ny));
                queue.push([nx, ny]);
              }
            }
          }
        }
        continue;
      }
      for (const dir of [-1, 1]) {
        for (let dist = 1;dist <= MAX_H_JUMP; dist++) {
          let blocked = false, hazardRun = 0;
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
            } else
              hazardRun = 0;
          }
          if (blocked)
            continue;
          const c = x + dir * dist;
          for (let ly = y;ly < h; ly++) {
            if (hazard(c, ly))
              break;
            if (standable(c, ly)) {
              edges.push({
                ax: x,
                ay: y,
                bx: c,
                by: ly,
                kind: ly === y ? "walk" : "fall",
                dist,
                dir
              });
              if (!seen.has(key(c, ly))) {
                seen.add(key(c, ly));
                queue.push([c, ly]);
              }
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
            if (solid(midX, ty) || hazard(midX, ty))
              clear = false;
          }
          if (clear) {
            edges.push({
              ax: x,
              ay: y,
              bx: c,
              by: ty,
              kind: "stepup",
              dist,
              dir
            });
            if (!seen.has(key(c, ty))) {
              seen.add(key(c, ty));
              queue.push([c, ty]);
            }
          }
        }
      }
      if (corr !== null && corr !== undefined) {
        for (const nx of [x - 1, x + 1]) {
          const ny = isCorr(nx, y) ? y : isCorr(nx, y + 1) ? y + 1 : -1;
          if (ny >= 0) {
            edges.push({
              ax: x,
              ay: y,
              bx: nx,
              by: ny,
              kind: "deck",
              dist: 1,
              dir: Math.sign(nx - x)
            });
            if (!seen.has(key(nx, ny))) {
              seen.add(key(nx, ny));
              queue.push([nx, ny]);
            }
          }
        }
      }
    }
    return edges;
  }
  function simTransition(e, pol, ctx) {
    const {
      T,
      w,
      DT,
      SIM_FRAMES,
      PLAYER_SPEED,
      JUMP_FORCE,
      physicsFactory,
      collect,
      cores,
      pitY
    } = ctx;
    const harvests = new Set;
    const fail = () => ({ ok: false, harvests });
    const dir = Math.sign(e.bx - e.ax);
    const physics = physicsFactory();
    const player = new Player(e.ax * T + (pol.off || 0) * dir, e.ay * T, PLAYER_SPEED, JUMP_FORCE);
    player.prevX = player.x;
    player.prevY = player.y;
    const candidates = [];
    const step = (left, right) => {
      player.prevX = player.x;
      player.prevY = player.y;
      player.update(DT, left, right);
      physics.applyGravity(player, DT);
      physics.resolveCollisions(player, collect(player, candidates));
    };
    step(false, false);
    step(false, false);
    if (!player.grounded)
      return fail();
    const dirFrom = pol.from || 0;
    const dirUntil = pol.until === undefined ? Infinity : pol.until;
    let prevGrounded = true;
    for (let f = 0;f < SIM_FRAMES; f++) {
      const held = f >= dirFrom && f < dirUntil;
      if (pol.j !== null && f === pol.j && player.grounded)
        player.jump();
      step(held && dir < 0, held && dir > 0);
      if (player.grounded && !prevGrounded && !held) {
        player.vx = 0;
      }
      prevGrounded = player.grounded;
      for (const core of cores) {
        if (aabbOverlap(player, core))
          return fail();
      }
      if (player.y > pitY + 100)
        return fail();
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
  var MOTIF_KNOBS = {
    standard: { gapMul: 1, gapMinW: 1 },
    hills: { gapMul: 0.55, gapMinW: 2 },
    terraces: { gapMul: 0.45, gapMinW: 1 },
    archipelago: { gapMul: 1, gapMinW: 1 },
    canyon: { gapMul: 1, gapMinW: 1 },
    pillars: { gapMul: 0.8, gapMinW: 1 }
  };
  var ARCH_MIN_ISLAND_RUN = 4;
  function solidRunWidth(tiles, width, x, supportY) {
    const row = tiles[supportY];
    if (!row || row[x] !== 1)
      return 0;
    let left = x;
    while (left > 0 && row[left - 1] === 1)
      left--;
    let right = x;
    while (right < width - 1 && row[right + 1] === 1)
      right++;
    return right - left + 1;
  }
  function solidRunKey(tiles, width, x, supportY) {
    const row = tiles[supportY];
    if (!row || row[x] !== 1)
      return null;
    let left = x;
    while (left > 0 && row[left - 1] === 1)
      left--;
    return `${supportY}:${left}`;
  }
  function shaftLedgeCols(sx, ex) {
    const cols = [];
    for (let k = 1;k <= SHAFT_LEDGE_W; k++)
      cols.push(sx - k, ex + k);
    return cols;
  }
  function shaftBoardSide(sx, width) {
    return sx >= Math.floor(width / 2) ? -1 : 1;
  }
  function kindChance(levelNumber, firstLevel, rampLevels, maxChance) {
    if (!Number.isInteger(levelNumber) || levelNumber < firstLevel)
      return 0;
    const t = Math.min(1, (levelNumber - firstLevel + 1) / rampLevels);
    return maxChance * t;
  }
  function directionForLevel(levelNumber) {
    if (levelNumber < PHASE2_FIRST_LEVEL)
      return "right";
    return ["right", "left", "vertical"][(levelNumber - PHASE2_FIRST_LEVEL) % 3];
  }
  var MOTIF_GATES = {
    hills: 12,
    terraces: 16,
    archipelago: 20,
    canyon: 25,
    pillars: 30,
    atrium: 16,
    zigzag: 19
  };
  function motifHash(levelNumber) {
    let h = Math.imul(levelNumber, 2654435761) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 2246822507) >>> 0;
    h ^= h >>> 13;
    return h >>> 0;
  }
  function motifSlots(levelNumber, direction) {
    if (direction === "vertical") {
      const pool = ["standard"];
      if (levelNumber >= MOTIF_GATES.atrium)
        pool.push("atrium");
      if (levelNumber >= MOTIF_GATES.zigzag)
        pool.push("zigzag");
      return pool;
    }
    const tier = tierIndexFor(levelNumber);
    const slots = [];
    const push = (name, gate) => {
      if (levelNumber < gate)
        return;
      const weight = name === "standard" ? levelNumber < 16 ? 3 : levelNumber < 25 ? 2 : 1 : tier >= 3 ? 2 : 1;
      for (let i = 0;i < weight; i++)
        slots.push(name);
    };
    push("standard", 1);
    push("hills", MOTIF_GATES.hills);
    push("terraces", MOTIF_GATES.terraces);
    push("archipelago", MOTIF_GATES.archipelago);
    push("canyon", MOTIF_GATES.canyon);
    push("pillars", MOTIF_GATES.pillars);
    return slots;
  }
  function prevSameDirectionMotif(levelNumber, direction) {
    for (let n = levelNumber - 1;n >= 1; n--) {
      if (directionForLevel(n) === direction)
        return motifForLevel(n);
    }
    return null;
  }
  function motifForLevel(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1)
      return "standard";
    const direction = directionForLevel(levelNumber);
    const slots = motifSlots(levelNumber, direction);
    let idx = motifHash(levelNumber) % slots.length;
    const prev = prevSameDirectionMotif(levelNumber, direction);
    let guard = 0;
    while (prev !== null && slots[idx] === prev && guard++ < slots.length) {
      idx = (idx + 1) % slots.length;
    }
    return slots[idx];
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
  function computeReachable(tiles, width, height, startTile, requireOpenHead = false, corridor = null, shaft = null, transitions = null) {
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
    const isCorr = (x, y) => corridor !== null && y === corridor.S - 1 && x >= corridor.a && x <= corridor.b;
    const isShaft = (x, y) => shaft !== null && x >= shaft.sx && x <= shaft.ex && y >= shaft.A - 1 && y <= shaft.B - 1;
    const isShaftStopRow = (y) => shaft !== null && (y === shaft.A - 1 || y === shaft.B - 1);
    const key = (x, y) => y * width + x;
    const reachable = new Set;
    if (!standable(startTile.x, startTile.y)) {
      return reachable;
    }
    const queue = [[startTile.x, startTile.y]];
    reachable.add(key(startTile.x, startTile.y));
    while (queue.length > 0) {
      const [x, y] = queue.shift();
      if (isCorr(x, y)) {
        for (const dir of [-1, 1]) {
          const nx = x + dir;
          if (isCorr(nx, y)) {
            if (transitions)
              transitions.push({ ax: x, ay: y, bx: nx, by: y });
            if (!reachable.has(key(nx, y))) {
              reachable.add(key(nx, y));
              queue.push([nx, y]);
            }
            continue;
          }
          for (const ny of [y, y - 1]) {
            if (standable(nx, ny)) {
              if (transitions)
                transitions.push({ ax: x, ay: y, bx: nx, by: ny });
              if (!reachable.has(key(nx, ny))) {
                reachable.add(key(nx, ny));
                queue.push([nx, ny]);
              }
            }
          }
        }
        continue;
      }
      if (isShaft(x, y)) {
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (isShaft(nx, ny)) {
            if (transitions)
              transitions.push({ ax: x, ay: y, bx: nx, by: ny });
            if (!reachable.has(key(nx, ny))) {
              reachable.add(key(nx, ny));
              queue.push([nx, ny]);
            }
          } else if (isShaftStopRow(y) && ny === y && standable(nx, ny)) {
            if (transitions)
              transitions.push({ ax: x, ay: y, bx: nx, by: ny });
            if (!reachable.has(key(nx, ny))) {
              reachable.add(key(nx, ny));
              queue.push([nx, ny]);
            }
          }
        }
        continue;
      }
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
            if (standable(c, ly)) {
              if (transitions)
                transitions.push({ ax: x, ay: y, bx: c, by: ly });
              if (!reachable.has(key(c, ly))) {
                reachable.add(key(c, ly));
                queue.push([c, ly]);
              }
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
            if (solid(midX, ty) || hazard(midX, ty)) {
              clear = false;
            }
          }
          if (clear) {
            if (transitions)
              transitions.push({ ax: x, ay: y, bx: c, by: ty });
            if (!reachable.has(key(c, ty))) {
              reachable.add(key(c, ty));
              queue.push([c, ty]);
            }
          }
        }
      }
      if (corridor !== null) {
        for (const nx of [x - 1, x + 1]) {
          const ny = isCorr(nx, y) ? y : isCorr(nx, y + 1) ? y + 1 : -1;
          if (ny >= 0) {
            if (transitions)
              transitions.push({ ax: x, ay: y, bx: nx, by: ny });
            if (!reachable.has(key(nx, ny))) {
              reachable.add(key(nx, ny));
              queue.push([nx, ny]);
            }
          }
        }
      }
      if (shaft !== null && isShaftStopRow(y)) {
        for (const nx of [x - 1, x + 1]) {
          if (isShaft(nx, y)) {
            if (transitions)
              transitions.push({ ax: x, ay: y, bx: nx, by: y });
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
  function computeCoinSafeHub(width, goalTile, reachable, transitions) {
    if (!goalTile || !transitions)
      return null;
    const goalKey = goalTile.y * width + goalTile.x;
    const rev = new Map;
    for (const t of transitions) {
      const bk = t.by * width + t.bx;
      let list = rev.get(bk);
      if (!list) {
        list = [];
        rev.set(bk, list);
      }
      list.push(t.ay * width + t.ax);
    }
    const toPortal = new Set([goalKey]);
    const queue = [goalKey];
    while (queue.length > 0) {
      const k = queue.pop();
      for (const pk of rev.get(k) || []) {
        if (!toPortal.has(pk)) {
          toPortal.add(pk);
          queue.push(pk);
        }
      }
    }
    const hub = new Set;
    for (const k of reachable) {
      if (toPortal.has(k))
        hub.add(k);
    }
    return hub;
  }
  class Level {
    constructor(levelNumber, tileSize, seed) {
      this.levelNumber = levelNumber;
      this.tileSize = tileSize;
      const resolvedSeed = seed === undefined ? Math.random() * 4294967295 >>> 0 : seed >>> 0;
      this.rng = makeRng(resolvedSeed);
      this.seedResolved = resolvedSeed;
      this.seed = seed === undefined ? null : resolvedSeed;
      this.direction = directionForLevel(levelNumber);
      this.motif = motifForLevel(levelNumber);
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
      let fair = false;
      let physRejects = 0;
      let gateEngaged = false;
      const REWIND_BUDGET = 4;
      while (!fair && attempt < MAX_GENERATION_ATTEMPTS) {
        this.tiles = this.generateLevel();
        this.spawnTile = this.getSpawnTile();
        this.modelTransitions = [];
        this.reachableTiles = computeReachable(this.tiles, this.width, this.height, this.spawnTile, this.direction === "vertical", this.bridgeGap, this.shaftGap, this.modelTransitions);
        this.portalTile = this.pickPortalTile();
        valid = this.portalTile !== null && this.bridgeIntact() && this.shaftIntact();
        if (valid && DIFFICULTY.hasPhase2Content(this.levelNumber)) {
          valid = this.deriveEnemySpawns().length > 0 && (this.direction === "vertical" || this.countTilesOfType(2) > 0);
        }
        attempt++;
        if (valid) {
          if (this.canyonRouteFair()) {
            fair = true;
          } else {
            valid = false;
            physRejects++;
            gateEngaged = true;
            if (physRejects <= REWIND_BUDGET) {
              this.rng = makeRng(this.seedResolved);
            }
          }
        } else if (gateEngaged && physRejects > REWIND_BUDGET) {
          this.rng = makeRng((this.seedResolved ^ Math.imul(attempt + 1, 16777619)) >>> 0);
          this._canopyCalls = 0;
          physRejects = 0;
        }
      }
      this.generationAttempts = attempt;
      if (!valid) {
        throw new Error(`Level ${levelNumber}: no reachable portal position after ` + `${MAX_GENERATION_ATTEMPTS} generation attempts`);
      }
      this.coinSafeHub = computeCoinSafeHub(this.width, this.portalTile, this.reachableTiles, this.modelTransitions);
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
      const terrainView = this;
      this.projectileManager = new ProjectileManager({
        get tileSize() {
          return terrainView.tileSize;
        },
        get width() {
          return terrainView.width;
        },
        get height() {
          return terrainView.height;
        },
        isSolidPx(px, py) {
          const c = Math.floor(px / terrainView.tileSize);
          const r = Math.floor(py / terrainView.tileSize);
          if (c < 0 || c >= terrainView.width)
            return true;
          if (r < 0 || r >= terrainView.height)
            return false;
          return terrainView.tiles[r][c] === 1;
        }
      });
      this.spawnEnemies();
      this.movingPlatforms = this.deriveMovingPlatforms();
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
      this.bridgeGap = null;
      this.shaftGap = null;
      this.ceilingSpans = null;
      if (this.direction === "vertical") {
        this.generateVertical(tiles);
      } else {
        this.generatePlatforms(tiles);
      }
      this.placeSpikes(tiles);
      this.generationReachable = computeReachable(tiles, this.width, this.height, this.canonicalSpawnTile(), this.direction === "vertical", this.bridgeGap, this.shaftGap);
      this.placeEnemyMarkers(tiles);
      if (this.direction === "left") {
        for (const row of tiles)
          row.reverse();
        if (this.bridgeGap) {
          const { a, b, S } = this.bridgeGap;
          this.bridgeGap = { a: this.width - 1 - b, b: this.width - 1 - a, S };
        }
        if (this.ceilingSpans && this.ceilingSpans.length > 0) {
          this.ceilingSpans = this.ceilingSpans.map((s) => ({
            x0: this.width - 1 - s.x1,
            x1: this.width - 1 - s.x0,
            yTop: s.yTop,
            yBot: s.yBot
          }));
        }
      }
      return tiles;
    }
    generateVertical(tiles) {
      const w = this.width;
      const h = this.height;
      const kv = this.motif === "atrium" ? { extMin: 4, extMax: 8, flipChance: 0.12, flipCap: 7, standardStream: false } : this.motif === "zigzag" ? { extMin: 1, extMax: 2, flipChance: 0.45, flipCap: 4, standardStream: false } : { extMin: 2, extMax: 5, flipChance: 0.16, flipCap: 6, standardStream: true };
      for (let x = 0;x < w; x++) {
        for (let y = h - 3;y < h; y++) {
          tiles[y][x] = 1;
        }
      }
      if (this.levelNumber >= ELEVATOR_FIRST_LEVEL && this.rng() < SHAFT_CHANCE) {
        const lift = MIN_SHAFT_LIFT + Math.floor(this.rng() * (MAX_SHAFT_LIFT - MIN_SHAFT_LIFT + 1));
        const spawnX = Math.floor(w / 2);
        const sxSlots = [];
        for (let cx = SHAFT_LEDGE_W;cx <= w - 3 - SHAFT_COLS; cx++) {
          if (cx === spawnX || cx === spawnX - 1)
            continue;
          sxSlots.push(cx);
        }
        const sx = sxSlots[Math.floor(this.rng() * sxSlots.length)];
        let B = SHAFT_BOTTOM_MIN_ROW + Math.floor(this.rng() * (SHAFT_BOTTOM_MAX_ROW - SHAFT_BOTTOM_MIN_ROW + 1));
        this.shaftGap = { sx, ex: sx + SHAFT_COLS - 1, A: B - lift, B };
      }
      this.pathCells = new Set;
      let x = Math.floor(w / 2);
      let dir = this.rng() < 0.5 ? 1 : -1;
      const g = this.shaftGap;
      const boardSide = g === null ? 0 : shaftBoardSide(g.sx, w);
      const boardCol = g === null ? -1 : boardSide < 0 ? g.sx - 1 : g.ex + 1;
      let steerCol = -1;
      let prevMid = -1;
      let sinceFlip = 0;
      const chainLink = (row, steered, forceCol = 0) => {
        let step;
        if (steered) {
          const delta = forceCol || steerCol - x;
          if (delta === 0)
            step = boardSide;
          else
            step = Math.sign(delta) * (Math.abs(delta) > 1 && this.rng() < 0.15 ? 2 : 1);
          if (forceCol && Math.abs(forceCol - x) <= 2)
            step = forceCol - x;
        } else {
          const flip = kv.flipChance > 0 && (this.rng() < kv.flipChance || sinceFlip >= (g === null ? kv.flipCap : 2));
          step = (flip ? -dir : dir) * (this.rng() < 0.15 ? 2 : 1);
          sinceFlip = flip ? 0 : sinceFlip + 1;
        }
        let c = x + step;
        const inShaftCols = (cx) => g !== null && row <= g.B + 1 && cx >= g.sx && cx <= g.ex;
        if (!steered) {
          if (c < 1 || c > w - 2 || inShaftCols(c)) {
            step = -Math.sign(step || 1);
            c = x + step;
            sinceFlip = 0;
          }
          if (this.pathCells.has((row + 1) * w + c) || c === prevMid) {
            for (const alt of [x - step, x + 1, x - 1, x + 2, x - 2]) {
              if (alt >= 1 && alt <= w - 2 && !inShaftCols(alt) && !this.pathCells.has((row + 1) * w + alt) && alt !== prevMid) {
                step = alt - x;
                c = alt;
                break;
              }
            }
          }
        }
        dir = Math.sign(step) || dir;
        const ext = kv.extMin + Math.floor(this.rng() * (kv.extMax - kv.extMin + 1));
        const lo = dir === 1 ? c : c - ext;
        const hi = dir === 1 ? c + ext : c;
        for (let cx = Math.max(0, lo);cx <= Math.min(w - 1, hi); cx++) {
          if (this.pathCells.has((row + 1) * w + cx))
            continue;
          if (cx === prevMid)
            continue;
          tiles[row][cx] = 1;
        }
        this.pathCells.add(row * w + x);
        this.pathCells.add((row - 1) * w + c);
        prevMid = Math.abs(step) === 2 ? x + Math.sign(step) : -1;
        return c;
      };
      if (g === null) {
        for (let row = h - 4;row >= VERTICAL_PORTAL_MAX_Y + 1; row--) {
          x = chainLink(row, false);
        }
      } else {
        const { sx, ex } = g;
        const flankCol = boardSide < 0 ? sx - 1 : ex + 1;
        const tOut = flankCol + boardSide * SHAFT_LEDGE_W;
        const tOut2 = tOut + boardSide;
        const inner = flankCol + boardSide * (SHAFT_LEDGE_W - 1);
        steerCol = tOut;
        for (let row = h - 4;row >= g.B + 2; row--) {
          x = chainLink(row, true, row === g.B + 2 ? tOut : 0);
        }
        tiles[g.B + 2][tOut] = 1;
        tiles[g.B + 1][tOut2] = 1;
        for (const [ty, tx] of [
          [g.B + 1, tOut],
          [g.B, tOut],
          [g.B, tOut2],
          [g.B - 1, tOut2],
          [g.B - 1, tOut],
          [g.B - 1, inner],
          [g.B - 2, inner]
        ])
          tiles[ty][tx] = 0;
        for (const [ty, tx] of [
          [g.B + 1, tOut],
          [g.B, tOut2],
          [g.B - 1, inner],
          [g.B - 2, inner]
        ])
          this.pathCells.add(ty * w + tx);
        for (let k = 0;k <= SHAFT_LEDGE_W - 1; k++) {
          this.pathCells.add((g.B - 1) * w + (inner + boardSide * k));
        }
        x = boardCol;
        dir = boardSide;
        sinceFlip = 0;
        for (let row = g.A - 1;row >= VERTICAL_PORTAL_MAX_Y + 1; row--) {
          x = chainLink(row, false);
        }
      }
      if (g !== null) {
        const { sx, ex, A, B } = g;
        for (let cx = 0;cx < w; cx++) {
          if (cx >= sx && cx <= ex)
            continue;
          tiles[A][cx] = 1;
        }
        for (let cx = sx - SHAFT_LEDGE_W;cx <= ex + SHAFT_LEDGE_W; cx++) {
          if (cx < 0 || cx >= w || cx >= sx && cx <= ex)
            continue;
          tiles[B][cx] = 1;
        }
        for (let y = 0;y <= B + 1; y++) {
          for (let cx = sx;cx <= ex; cx++)
            tiles[y][cx] = 0;
        }
      }
    }
    generatePlatforms(tiles) {
      const isPhase2 = DIFFICULTY.hasPhase2Content(this.levelNumber);
      const maxGap = this.levelNumber >= 3 ? 3 : 2;
      const gapChance = isPhase2 ? Math.min(0.22 + 0.02 * (this.levelNumber - 4), GAP_CHANCE_CAP) : 0.18 + 0.04 * this.levelNumber;
      let segRemaining = 0;
      let currentY = this.height - 3;
      let gapStreak = 0;
      let bridgeA = -1;
      let bridgeW = 0;
      let bridgeS = -1;
      if (this.levelNumber >= DECK_BRIDGE_FIRST_LEVEL && this.rng() < BRIDGE_CHANCE) {
        const bandLo = HAZARD_SPAWN_EXCLUDE_COLS;
        const bandHi = this.width - 6;
        const slots = [];
        for (let wGap = MIN_DECK_GAP;wGap <= MAX_DECK_GAP; wGap++) {
          for (let s = BRIDGE_MIN_START_COL;s + wGap - 1 <= this.width - 6; s++) {
            const leftSeg = Math.max(0, Math.min(s - 4, bandHi) - bandLo + 1);
            const rightSeg = Math.max(0, bandHi - Math.max(s + wGap - 1 + 4, bandLo) + 1);
            if (leftSeg >= 2 && rightSeg >= 2)
              slots.push({ s, wGap });
          }
        }
        if (slots.length > 0) {
          const pick = slots[Math.floor(this.rng() * slots.length)];
          bridgeA = pick.s;
          bridgeW = pick.wGap;
        }
      }
      const motif = this.motif;
      const KM = MOTIF_KNOBS[motif] ?? MOTIF_KNOBS.standard;
      const hill = motif === "hills" ? {
        amp: 2 + Math.floor(this.rng() * 3),
        lambda: 10 + Math.floor(this.rng() * 7)
      } : null;
      const ter = motif === "terraces" ? (() => {
        const d = 2 + Math.floor(this.rng() * 2);
        const bands = this.rng() < 0.5 ? [
          this.height - 3,
          this.height - 3 - d,
          Math.max(3, this.height - 3 - 2 * d)
        ] : [this.height - 3, this.height - 3 - d];
        return { bands, bandY: bands[bands.length - 1] };
      })() : null;
      const pil = motif === "pillars" ? { queue: [] } : null;
      if (pil !== null) {
        const k = 2 + Math.floor(this.rng() * 3);
        const hold = 2 + Math.floor(this.rng() * 3);
        for (let i = 0;i < k; i++)
          pil.queue.push(-1);
        for (let i = 0;i < hold; i++)
          pil.queue.push(0);
        for (let i = 0;i < k; i++)
          pil.queue.push(1);
      }
      const arch = motif === "archipelago" ? { depth: 3, run: 0 } : null;
      for (let x = 0;x < this.width; x++) {
        if (bridgeA >= 0 && x === bridgeA)
          bridgeS = currentY;
        if (bridgeA >= 0 && x >= bridgeA && x < bridgeA + bridgeW) {
          continue;
        }
        if (bridgeA >= 0 && x === bridgeA + bridgeW) {
          for (let y = currentY;y < this.height; y++)
            tiles[y][x] = 1;
          segRemaining = 1 + Math.floor(this.rng() * 4);
          continue;
        }
        const isSpawnZone = x < 6;
        const isEndZone = x >= this.width - 5;
        let doGap = false;
        if (!isSpawnZone && !isEndZone && gapStreak < maxGap && segRemaining === 0 && !(bridgeA >= 0 && x === bridgeA - 1) && !(pil !== null && pil.queue.length > 0)) {
          if (KM.gapMinW > 1 && gapStreak > 0 && gapStreak < KM.gapMinW) {
            doGap = true;
          } else if (arch !== null && gapStreak === 0 && arch.run < ARCH_MIN_ISLAND_RUN) {
            doGap = false;
          } else {
            doGap = this.rng() < gapChance * KM.gapMul;
          }
        }
        if (doGap) {
          gapStreak++;
          if (arch !== null)
            arch.run = 0;
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
          let step;
          let popped = false;
          let terMoving = false;
          if (resumedAfterWideGap)
            step = motif === "archipelago" ? 0 : 1;
          else if (motif === "hills") {
            const target = this.height - 3 - Math.round(hill.amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * x / hill.lambda)));
            const delta = target - currentY;
            if (delta !== 0)
              step = Math.sign(delta);
            else
              step = this.rng() < 0.3 ? this.rng() < 0.5 ? 1 : -1 : 0;
          } else if (motif === "terraces") {
            if (ter.bandY === currentY) {
              const others = ter.bands.filter((b) => b !== ter.bandY);
              if (others.length > 0 && this.rng() < 0.55) {
                ter.bandY = others[Math.floor(this.rng() * others.length)];
              }
            }
            const delta = ter.bandY - currentY;
            step = delta === 0 ? 0 : Math.sign(delta);
            terMoving = delta !== 0;
          } else if (motif === "pillars") {
            if (pil.queue.length === 0 && this.rng() < 0.35) {
              const k = 2 + Math.floor(this.rng() * 3);
              const hold = 2 + Math.floor(this.rng() * 3);
              for (let i = 0;i < k; i++)
                pil.queue.push(-1);
              for (let i = 0;i < hold; i++)
                pil.queue.push(0);
              for (let i = 0;i < k; i++)
                pil.queue.push(1);
            }
            if (pil.queue.length > 0) {
              step = pil.queue.shift();
              popped = true;
            } else {
              step = this.rng() < 0.15 ? this.rng() < 0.5 ? 1 : -1 : 0;
            }
          } else if (motif === "archipelago") {
            const hiRow = Math.max(3, this.height - 8);
            const loRow = this.height - 5;
            if (currentY <= hiRow)
              step = 1;
            else if (currentY >= loRow)
              step = -1;
            else
              step = this.rng() < 0.5 ? 1 : -1;
          } else {
            const atTop = currentY <= 3;
            const atFloor = currentY >= this.height - 3;
            if (atTop)
              step = 1;
            else if (atFloor)
              step = -1;
            else
              step = this.rng() < 0.55 ? 1 : -1;
          }
          currentY = Math.min(this.height - 3, Math.max(3, currentY + step));
          if (popped) {
            segRemaining = 0;
          } else if (motif === "terraces") {
            segRemaining = terMoving ? 0 : 4 + Math.floor(this.rng() * 5);
          } else if (arch !== null && resumedAfterWideGap) {
            segRemaining = 0;
          } else {
            segRemaining = 1 + Math.floor(this.rng() * 4);
          }
          if (arch !== null)
            arch.depth = 2 + (this.rng() < 0.3 ? 1 : 0);
        }
        let paintBottom = this.height;
        if (arch !== null && !isSpawnZone) {
          paintBottom = Math.min(currentY + arch.depth, this.height - 3);
        }
        for (let y = currentY;y < paintBottom; y++) {
          tiles[y][x] = 1;
        }
        if (arch !== null)
          arch.run++;
      }
      if (bridgeA >= 0) {
        this.bridgeGap = { a: bridgeA, b: bridgeA + bridgeW - 1, S: bridgeS };
      }
      if (motif === "canyon")
        this.paintCanyonCeilings(tiles);
      return tiles;
    }
    paintCanyonCeilings(tiles) {
      const w = this.width;
      const crng = makeRng(((this.seedResolved ?? 0) ^ Math.imul(2654435761, this._canopyCalls = (this._canopyCalls ?? 0) + 1)) >>> 0);
      const topRow = (x) => {
        for (let y = 0;y < this.height; y++) {
          if (tiles[y][x] === 1)
            return y;
        }
        return null;
      };
      const cellSafe = (x, r) => r >= 1 && tiles[r + 2]?.[x] !== 1 && tiles[r + 3]?.[x] !== 1;
      const bwLo = this.bridgeGap ? this.bridgeGap.a - 1 : -1;
      const bwHi = this.bridgeGap ? this.bridgeGap.b + 1 : -1;
      this.ceilingSpans = [];
      const surfTop = [];
      for (let x = 0;x < w; x++)
        surfTop.push(topRow(x));
      const pitNear = new Array(w).fill(false);
      for (let x = 0;x < w; x++) {
        if (surfTop[x] !== null)
          continue;
        for (let k = Math.max(0, x - 1);k <= Math.min(w - 1, x + 1); k++) {
          pitNear[k] = true;
        }
      }
      const targetSpans = 2 + (crng() < 0.5 ? 1 : 0);
      let guard = 0;
      const paintedKeys = new Set;
      while ((this.ceilingSpans.length < targetSpans || this.ceilingSpans.length === 0) && guard++ < 8) {
        const len = 8 + Math.floor(crng() * 7);
        const maxStart = w - 6 - len;
        if (maxStart < 8)
          break;
        const start = 8 + Math.floor(crng() * (maxStart - 8 + 1));
        const thick = 1 + Math.floor(crng() * 2);
        const hr = 2 + (crng() < 0.5 ? 1 : 0);
        const tops = [];
        for (let x = start;x < start + len; x++)
          tops.push(surfTop[x]);
        for (let k = 1;k < tops.length; k++) {
          if (tops[k] === null)
            tops[k] = tops[k - 1];
        }
        for (let k = tops.length - 2;k >= 0; k--) {
          if (tops[k] === null)
            tops[k] = tops[k + 1];
        }
        if (tops[0] === null)
          continue;
        let painted = 0, yTop = this.height, yBot = -1, x0 = -1, x1 = -1;
        for (let x = start;x < start + len; x++) {
          if (x >= bwLo && x <= bwHi)
            continue;
          if (pitNear[x])
            continue;
          const t = tops[x - start];
          const bottom = t - hr - 2;
          for (let rr = Math.max(2, bottom - thick + 1);rr <= bottom; rr++) {
            if (rr < 1 || rr >= this.height)
              continue;
            if (tiles[rr][x] === 1 || !cellSafe(x, rr))
              continue;
            tiles[rr][x] = 1;
            painted++;
            paintedKeys.add(rr * w + x);
            if (x0 < 0)
              x0 = x;
            x1 = x;
            if (rr < yTop)
              yTop = rr;
            if (rr > yBot)
              yBot = rr;
          }
          if (crng() < 0.3) {
            const rr = bottom + 1;
            if (rr >= 2 && rr < this.height && tiles[rr][x] !== 1 && cellSafe(x, rr)) {
              tiles[rr][x] = 1;
              painted++;
              paintedKeys.add(rr * w + x);
              if (x0 < 0)
                x0 = x;
              x1 = x;
              if (rr < yTop)
                yTop = rr;
              if (rr > yBot)
                yBot = rr;
            }
          }
        }
        if (painted > 0)
          this.ceilingSpans.push({ x0, x1, yTop, yBot });
      }
      let dirty = true;
      while (dirty) {
        dirty = false;
        for (const key of paintedKeys) {
          const x = key % w;
          const y = (key - x) / w;
          for (const dy of [1, 2]) {
            const sy = y + dy;
            if (sy < this.height && tiles[sy][x] === 0 && tiles[sy + 1]?.[x] === 1) {
              tiles[y][x] = 0;
              paintedKeys.delete(key);
              dirty = true;
              break;
            }
          }
        }
      }
    }
    exposeCeilingSpans() {
      return this.ceilingSpans ?? [];
    }
    validateCanyonRoute() {
      if (this.motif !== "canyon" || this.direction === "vertical") {
        return true;
      }
      const strict = computeReachable(this.tiles, this.width, this.height, this.spawnTile, true, this.bridgeGap, this.shaftGap);
      return strict.has(this.portalTile.y * this.width + this.portalTile.x);
    }
    canyonRouteFair() {
      if (this.motif !== "canyon" || this.direction === "vertical") {
        return true;
      }
      if (!this.validateCanyonRoute())
        return false;
      if (Level.physRoute) {
        return Level.physRoute(this);
      }
      return this.routePhysicallyExecutable();
    }
    routePhysicallyExecutable() {
      const T = this.tileSize;
      const w = this.width, h = this.height;
      const policies = [{ j: null }];
      for (const j of [0, 1, 2, 3, 4, 6, 8])
        policies.push({ j });
      for (const j of [0, 2]) {
        for (const from of [8, 12, 16, 20, 24]) {
          policies.push({ j, from });
        }
      }
      for (const until of [10, 16, 24])
        policies.push({ j: 0, until });
      for (const j of [0, 2, 4]) {
        for (const off of [6, 12, 18])
          policies.push({ j, off });
      }
      const rectGrid = [];
      for (let y = 0;y < h; y++) {
        const row = [];
        for (let x = 0;x < w; x++) {
          row.push(this.tiles[y][x] === 1 ? { x: x * T, y: y * T, width: T, height: T } : null);
        }
        rectGrid.push(row);
      }
      const INSET = 4;
      const cores = [];
      for (let y = 0;y < h; y++) {
        for (let x = 0;x < w; x++) {
          if (this.tiles[y][x] === 2) {
            cores.push({
              x: x * T + INSET,
              y: y * T + INSET,
              width: T - 2 * INSET,
              height: T - 2 * INSET
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
        for (let ty = y0;ty <= y1; ty++) {
          if (ty < 0 || ty >= h)
            continue;
          for (let tx = x0;tx <= x1; tx++) {
            if (tx < 0 || tx >= w)
              continue;
            const r = rectGrid[ty][tx];
            if (r)
              out.push(r);
          }
        }
        return out;
      };
      const ctx = {
        T,
        DT: 1 / 60,
        SIM_FRAMES: 180,
        PLAYER_SPEED: 200,
        JUMP_FORCE: 350,
        physicsFactory: () => new Physics,
        collect,
        cores,
        pitY,
        w
      };
      const routeEdges = routeModelEdges(this);
      const adj = new Map;
      const addAdj = (ak, bk) => {
        if (!adj.has(ak))
          adj.set(ak, []);
        adj.get(ak).push(bk);
      };
      const startK = this.spawnTile.y * w + this.spawnTile.x;
      const goalK = this.portalTile.y * w + this.portalTile.x;
      const seen = new Set;
      let anyLanded = false;
      const sim = (e, pol) => simTransition(e, pol, ctx);
      for (const e of routeEdges) {
        const ak = e.ay * w + e.ax;
        if (e.kind === "deck" || e.kind === "lift") {
          addAdj(ak, e.by * w + e.bx);
          continue;
        }
        const ek = `${e.ax},${e.ay}->${e.bx},${e.by}`;
        if (seen.has(ek))
          continue;
        seen.add(ek);
        let landedHere = false;
        for (const pol of policies) {
          const r = sim(e, pol);
          if (r.ok) {
            landedHere = true;
            addAdj(ak, e.by * w + e.bx);
          }
          for (const hk of r.harvests)
            addAdj(ak, hk);
        }
        if (landedHere)
          anyLanded = true;
      }
      if (!anyLanded)
        return false;
      const vis = new Set([startK]);
      const q = [startK];
      while (q.length) {
        const k = q.pop();
        if (k === goalK)
          return true;
        for (const n of adj.get(k) ?? []) {
          if (!vis.has(n)) {
            vis.add(n);
            q.push(n);
          }
        }
      }
      return false;
    }
    hazardPlacementAllowed(coord) {
      if (this.direction === "vertical") {
        return coord > VERTICAL_PORTAL_MAX_Y && coord < this.height - VERTICAL_SPAWN_EXCL_ROWS;
      }
      return coord >= HAZARD_SPAWN_EXCLUDE_COLS && coord <= this.width - 6;
    }
    inShaftWindow(x, y) {
      const g = this.shaftGap;
      if (!g)
        return false;
      if (x < g.sx - SHAFT_LEDGE_W - SHAFT_WINDOW_PAD || x > g.ex + SHAFT_LEDGE_W + SHAFT_WINDOW_PAD)
        return false;
      return y === g.A - 1 || y === g.A - 2 || y === g.B - 1 || y === g.B - 2;
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
          let left = Math.max(span.left, bandMin);
          let right = Math.min(span.right, bandMax);
          if (this.bridgeGap) {
            const wLo = this.bridgeGap.a - BRIDGE_LIP_BAN_COLS;
            const wHi = this.bridgeGap.b + BRIDGE_LIP_BAN_COLS;
            if (x < wLo)
              right = Math.min(right, wLo - 1);
            else if (x > wHi)
              left = Math.max(left, wHi + 1);
          }
          if (this.shaftGap) {
            const wLo = this.shaftGap.sx - SHAFT_LEDGE_W - SHAFT_WINDOW_PAD;
            const wHi = this.shaftGap.ex + SHAFT_LEDGE_W + SHAFT_WINDOW_PAD;
            if (x < wLo)
              right = Math.min(right, wLo - 1);
            else if (x > wHi)
              left = Math.max(left, wHi + 1);
          }
          spawns.push({ x, y, left, right });
        }
      }
      return spawns;
    }
    placeSpikes(tiles) {
      if (!DIFFICULTY.hasPhase2Content(this.levelNumber))
        return;
      const target = Math.min(2 + Math.floor((this.levelNumber - PHASE2_FIRST_LEVEL) / 2), SPIKE_TARGET_CAP, Math.floor(this.width * this.height * 0.1));
      const besideDropOff = (x, y) => {
        for (let dx = -3;dx <= 3; dx++) {
          if (dx === 0)
            continue;
          const nx = x + dx;
          if (nx < 0 || nx >= this.width)
            continue;
          let ground = false;
          for (let r = y + 1;r <= y + 4 && r < this.height; r++) {
            if (tiles[r][nx] === 1) {
              ground = true;
              break;
            }
          }
          if (!ground)
            return true;
          if (tiles[y][nx] === 1 || y > 0 && tiles[y - 1][nx] === 1) {
            return true;
          }
        }
        return false;
      };
      const nearRouteCell = (x, y) => {
        if (!this.pathCells)
          return false;
        for (let dx = -2;dx <= 2; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < this.width && this.pathCells.has(y * this.width + nx))
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
          if (nearRouteCell(x, y))
            continue;
          if (this.inCeilingCell(x, y + 1))
            continue;
          if (this.inShaftWindow(x, y))
            continue;
          if (this.direction === "vertical") {
            if (x < 1 || x > this.width - 2 || tiles[y + 1][x - 1] !== 1 || tiles[y + 1][x + 1] !== 1)
              continue;
          } else if (besideDropOff(x, y))
            continue;
          candidates.push({ x, y });
        }
      }
      shuffle(candidates, this.rng);
      const headroom = this.direction === "vertical";
      const spawn = this.canonicalSpawnTile();
      const placementSafe = () => {
        const reachable = computeReachable(tiles, this.width, this.height, spawn, headroom, this.bridgeGap, this.shaftGap);
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
    inCeilingCell(x, y) {
      const spans = this.ceilingSpans;
      if (!spans || spans.length === 0)
        return false;
      for (const s of spans) {
        if (x >= s.x0 && x <= s.x1 && y >= s.yTop && y <= s.yBot) {
          return true;
        }
      }
      return false;
    }
    isMarkerSite(tiles, x, y, reachable, opts = {}) {
      if (!this.hazardPlacementAllowed(this.direction === "vertical" ? y : x)) {
        return false;
      }
      if (this.bridgeGap && x >= this.bridgeGap.a - BRIDGE_LIP_BAN_COLS && x <= this.bridgeGap.b + BRIDGE_LIP_BAN_COLS) {
        return false;
      }
      if (this.inShaftWindow(x, y))
        return false;
      if (tiles[y][x] !== 0 || tiles[y + 1][x] !== 1)
        return false;
      if (this.inCeilingCell(x, y + 1))
        return false;
      if (this.pathCells && this.pathCells.has(y * this.width + x)) {
        return false;
      }
      if (!reachable.has(y * this.width + x))
        return false;
      if (this.pathCells && !opts.allowRouteAdjacent) {
        for (let dx = -1;dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < this.width && this.pathCells.has(y * this.width + nx))
            return false;
        }
      }
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
      let left = Math.max(span.left, bandMin);
      let right = Math.min(span.right, bandMax);
      if (this.shaftGap) {
        const wLo = this.shaftGap.sx - SHAFT_LEDGE_W - SHAFT_WINDOW_PAD;
        const wHi = this.shaftGap.ex + SHAFT_LEDGE_W + SHAFT_WINDOW_PAD;
        if (x < wLo)
          right = Math.min(right, wLo - 1);
        else if (x > wHi)
          left = Math.max(left, wHi + 1);
      }
      const minSpan = opts.allowRouteAdjacent && this.direction !== "vertical" ? 1 : 2;
      return right - left + 1 >= minSpan;
    }
    placeEnemyMarkers(tiles) {
      if (!DIFFICULTY.hasPhase2Content(this.levelNumber))
        return;
      const target = Math.min(DIFFICULTY.getMaxEnemies(this.levelNumber), Math.floor(this.levelNumber / 2));
      const collectSites = (allowRouteAdjacent) => {
        const sites = [];
        for (let y = 0;y < this.height - 1; y++) {
          for (let x = 0;x < this.width; x++) {
            if (this.isMarkerSite(tiles, x, y, this.generationReachable, { allowRouteAdjacent })) {
              sites.push({ x, y });
            }
          }
        }
        return sites;
      };
      let candidates = collectSites(false);
      shuffle(candidates, this.rng);
      const markedRuns = new Set;
      let placed = 0;
      for (const c of candidates) {
        if (placed >= target)
          break;
        if (this.direction === "vertical") {
          const runKey = solidRunKey(tiles, this.width, c.x, c.y + 1);
          if (markedRuns.has(runKey))
            continue;
          markedRuns.add(runKey);
        }
        tiles[c.y][c.x] = 4;
        placed++;
      }
      if (placed === 0 && this.pathCells) {
        candidates = collectSites(true);
        shuffle(candidates, this.rng);
        for (const c of candidates) {
          if (placed >= Math.min(target, 1))
            break;
          if (this.direction === "vertical") {
            const runKey = solidRunKey(tiles, this.width, c.x, c.y + 1);
            if (markedRuns.has(runKey))
              continue;
            markedRuns.add(runKey);
          }
          tiles[c.y][c.x] = 4;
          placed++;
        }
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
      const target = Math.min(Math.max(5 + this.levelNumber, 5), COIN_TARGET_CAP);
      const coins = [];
      const used = new Set;
      const spawnKey = this.spawnTile.y * this.width + this.spawnTile.x;
      const portalKey = this.portalTile ? this.portalTile.y * this.width + this.portalTile.x : -1;
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
      const hub = this.coinSafeHub;
      for (const key of this.reachableTiles) {
        if (key === spawnKey || key === portalKey)
          continue;
        if (hub !== null && hub !== undefined && !hub.has(key))
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
      const spawns = this.deriveEnemySpawns();
      const legalSpawns = spawns.filter((s) => solidRunWidth(this.tiles, this.width, s.x, s.y + 1) >= ENEMY_MIN_RUN && (s.right - s.left + 1) * this.tileSize - ENEMY_WIDTH >= this.tileSize);
      const spinyChance = kindChance(this.levelNumber, SPINY_FIRST_LEVEL, SPINY_RAMP_LEVELS, SPINY_CHANCE_MAX);
      const chargerChance = kindChance(this.levelNumber, CHARGER_FIRST_LEVEL, CHARGER_RAMP_LEVELS, CHARGER_CHANCE_MAX);
      const bombardierChance = kindChance(this.levelNumber, BOMBARDIER_FIRST_LEVEL, BOMBARDIER_RAMP_LEVELS, BOMBARDIER_CHANCE_MAX);
      const spinyCap = Math.ceil(legalSpawns.length / SPINY_CAP_DIVISOR);
      const bombardierCap = Math.ceil(legalSpawns.length / BOMBARDIER_CAP_DIVISOR);
      let spinies = 0;
      let bombardiers = 0;
      const hostileRuns = new Set;
      for (const s of legalSpawns) {
        let kind = "walker";
        const roll = this.rng();
        if (roll < spinyChance && spinies < spinyCap) {
          kind = "spiny";
        } else if (roll >= spinyChance && roll < spinyChance + chargerChance) {
          kind = "charger";
        } else if (roll >= spinyChance + chargerChance && roll < spinyChance + chargerChance + bombardierChance && bombardiers < bombardierCap) {
          kind = "bombardier";
        }
        if (kind !== "walker" && solidRunWidth(this.tiles, this.width, s.x, s.y + 1) < HOSTILE_MIN_RUN) {
          kind = "walker";
        }
        if (kind === "bombardier" && s.x - s.left < 2 && s.right - s.x < 2) {
          kind = "walker";
        }
        if (kind !== "walker") {
          const runKey = solidRunKey(this.tiles, this.width, s.x, s.y + 1);
          if (hostileRuns.has(runKey))
            kind = "walker";
          else
            hostileRuns.add(runKey);
        }
        if (kind === "spiny")
          spinies++;
        if (kind === "bombardier")
          bombardiers++;
        this.enemyManager.addEnemy(s.x * this.tileSize, s.y * this.tileSize, s.left * this.tileSize, (s.right + 1) * this.tileSize, kind, {
          projectiles: this.projectileManager,
          terrain: this.projectileManager.terrain
        });
      }
    }
    columnTopRow(x) {
      for (let y = 0;y < this.height; y++) {
        if (this.tiles[y][x] === 1)
          return y;
      }
      return null;
    }
    bridgeIntact() {
      const g = this.bridgeGap;
      if (!g)
        return true;
      const { a, b, S } = g;
      const w = b - a + 1;
      if (w < MIN_DECK_GAP || w > MAX_DECK_GAP)
        return false;
      if (S < 1 || S >= this.height)
        return false;
      if (this.columnTopRow(a - 1) !== S || this.columnTopRow(b + 1) !== S) {
        return false;
      }
      for (let x = a;x <= b; x++) {
        for (let y = 0;y < this.height; y++) {
          if (this.tiles[y][x] !== 0)
            return false;
        }
      }
      if (this.spawnTile.x >= a && this.spawnTile.x <= b || this.portalTile && this.portalTile.x >= a && this.portalTile.x <= b) {
        return false;
      }
      return this.movingDeckLegal(a, b, S);
    }
    deriveMovingPlatforms() {
      const out = [];
      if (this.direction === "vertical") {
        const g = this.shaftGap;
        if (!g)
          return out;
        if (!this.shaftLegal(g.sx, g.A, g.B))
          return out;
        const T = this.tileSize;
        const speed = V_DECK_SPEED_MIN + this.rng() * V_DECK_SPEED_RANGE;
        const phase = this.rng();
        out.push({
          x: g.sx * T,
          y: g.A * T,
          width: SHAFT_COLS * T,
          height: T,
          axis: "v",
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
      if (!g)
        return out;
      const T = this.tileSize;
      const S = Math.max(this.columnTopRow(g.a - 1), this.columnTopRow(g.b + 1));
      if (!this.movingDeckLegal(g.a, g.b, S))
        return out;
      const speed = MP_SPEED_MIN + this.rng() * MP_SPEED_RANGE;
      const phase = this.rng();
      out.push({
        x: g.a * T,
        y: S * T,
        width: MP_DECK_TILES * T,
        height: T,
        axis: "h",
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
    movingDeckLegal(a, b, S) {
      const inGrid = (cx, cy) => cx >= 0 && cx < this.width && cy >= 0 && cy < this.height;
      for (let cx = a;cx <= b; cx++) {
        for (let cy = S;cy <= S + 1; cy++) {
          if (!inGrid(cx, cy) || this.tiles[cy][cx] !== 0)
            return false;
        }
        for (let cy = S - MP_CLEARANCE_ROWS;cy < S; cy++) {
          if (!inGrid(cx, cy) || this.tiles[cy][cx] !== 0)
            return false;
        }
      }
      const overlapsX = (l, r, l2, r2) => l < r2 && l2 < r;
      for (const s of this.deriveEnemySpawns()) {
        if ((s.y === S || s.y === S + 1) && overlapsX(s.left, s.right + 1, a, b + 1)) {
          return false;
        }
      }
      for (const cell of [this.spawnTile, this.portalTile]) {
        if (cell && cell.x >= a && cell.x <= b && (cell.y === S || cell.y === S + 1)) {
          return false;
        }
      }
      return true;
    }
    shaftIntact() {
      const g = this.shaftGap;
      if (!g)
        return true;
      if (this.direction !== "vertical")
        return false;
      if (this.levelNumber < ELEVATOR_FIRST_LEVEL)
        return false;
      const { sx, ex, A, B } = g;
      if (B - A < MIN_SHAFT_LIFT || B - A > MAX_SHAFT_LIFT)
        return false;
      if (sx < SHAFT_LEDGE_W || ex > this.width - 1 - SHAFT_LEDGE_W) {
        return false;
      }
      if (A < VERTICAL_PORTAL_MAX_Y + 2 || B > SHAFT_BOTTOM_MAX_ROW) {
        return false;
      }
      for (let y = 0;y <= B + 1; y++) {
        for (let cx = sx;cx <= ex; cx++) {
          if (this.tiles[y][cx] !== 0)
            return false;
        }
      }
      for (let cx = 0;cx < this.width; cx++) {
        if (cx >= sx && cx <= ex)
          continue;
        if (this.tiles[A][cx] !== 1)
          return false;
      }
      for (const lx of shaftLedgeCols(sx, ex)) {
        if (this.tiles[B][lx] !== 1)
          return false;
      }
      const side = shaftBoardSide(sx, this.width);
      for (const [row, col] of [
        [B - 1, sx - 1],
        [B - 2, sx - 1],
        [B - 1, ex + 1],
        [B - 2, ex + 1],
        [A - 1, side < 0 ? sx - 1 : ex + 1],
        [A - 2, side < 0 ? sx - 1 : ex + 1]
      ]) {
        if (this.tiles[row][col] !== 0)
          return false;
      }
      for (let y = 0;y < this.height; y++) {
        for (let x = 0;x < this.width; x++) {
          const t = this.tiles[y][x];
          if ((t === 2 || t === 4) && this.inShaftWindow(x, y))
            return false;
        }
      }
      for (const cell of [this.spawnTile, this.portalTile]) {
        if (cell && cell.x >= sx && cell.x <= ex)
          return false;
      }
      const plain = computeReachable(this.tiles, this.width, this.height, this.spawnTile, true, null, null);
      if (this.portalTile && plain.has(this.portalTile.y * this.width + this.portalTile.x)) {
        return false;
      }
      return this.shaftLegal(sx, A, B);
    }
    shaftLegal(sx, A, B) {
      const overlapsX = (l, r, l2, r2) => l < r2 && l2 < r;
      for (const s of this.deriveEnemySpawns()) {
        if (s.y >= A - 1 && s.y <= B && overlapsX(s.left, s.right + 1, sx, sx + SHAFT_COLS)) {
          return false;
        }
      }
      for (const cell of [this.spawnTile, this.portalTile]) {
        if (cell && cell.x >= sx && cell.x <= sx + SHAFT_COLS - 1 && cell.y >= A - 1 && cell.y <= B) {
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
  Level.physRoute = null;

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
    setMuteLabel(muted) {
      const button = document.getElementById("mute-btn");
      if (!button)
        return;
      button.textContent = muted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
      button.setAttribute("aria-pressed", muted ? "true" : "false");
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
      spiny: "A spiny’s back is spiked — no stomping",
      spike: "Landed on spikes",
      pit: "Fell into the void",
      projectile: "Took a bombardier shot"
    };
    showGameOver(score, cause, penalty = 0) {
      if (this.finalScoreElement) {
        this.finalScoreElement.textContent = `Score: ${score}`;
      }
      const causeEl = document.getElementById("death-cause");
      if (causeEl) {
        const text = UI.DEATH_CAUSE_TEXT[cause] || "";
        causeEl.textContent = text;
        causeEl.hidden = !text;
      }
      const penaltyEl = document.getElementById("score-penalty");
      if (penaltyEl) {
        penaltyEl.textContent = penalty > 0 ? `-${penalty} points` : "";
        penaltyEl.hidden = !(penalty > 0);
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
    setLevelCompleteBreakdown(breakdown) {
      const {
        clearBonus = 0,
        enemiesBested = 0,
        deaths = 0,
        flawless = false
      } = breakdown || {};
      const bonusEl = document.getElementById("clear-bonus");
      if (bonusEl) {
        const text = clearBonus > 0 ? flawless ? `Flawless clear +${clearBonus}` : `Cleared after ${deaths} death${deaths === 1 ? "" : "s"} +${clearBonus}` : "";
        bonusEl.textContent = text;
        bonusEl.hidden = !text;
      }
      const bestedEl = document.getElementById("enemies-bested");
      if (bestedEl) {
        bestedEl.textContent = enemiesBested > 0 ? `Enemies bested +${enemiesBested}` : "";
        bestedEl.hidden = !(enemiesBested > 0);
      }
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
  var CAP_OVER = 4;
  var CAP_H = CAP_OVER + 9;
  var PORTAL_CELL = 32;
  var CHARS = {
    SLIME: [15, 16, 17],
    BAT: [24, 25, 26]
  };
  var THEMES = [
    {
      x: 0,
      w: 96,
      sky: "#dff6f5",
      ground: "#c2e3e8",
      skyTop: "#7cc0da",
      skyBottom: "#e8faf7",
      disc: { x: 0.74, y: 0.14, r: 26, core: "#fff6cf", halo: "#ffeeae" },
      cloud: "#ffffff",
      hillFar: "#aedbe1",
      hillNear: "#84c2cd",
      mote: "#fffbe0",
      fireflies: false,
      rim: "rgba(255,255,255,0.28)",
      mood: "rgba(255,246,214,0.045)",
      haze: "#eafcff",
      portalGlow: "#b06cf0",
      ink: "#1c2a17",
      dust: "#cbb98a",
      vignette: 0.1
    },
    {
      x: 96,
      w: 48,
      sky: "#fbc97b",
      ground: "#cb815e",
      skyTop: "#c76e79",
      skyBottom: "#fdd79b",
      disc: { x: 0.66, y: 0.46, r: 34, core: "#ffe7ad", halo: "#ffbf7a" },
      cloud: "#ffdcae",
      hillFar: "#b5727c",
      hillNear: "#93546a",
      mote: "#ffd9a8",
      fireflies: false,
      rim: "rgba(255,226,170,0.30)",
      mood: "rgba(255,120,54,0.11)",
      haze: "#ffd9a0",
      portalGlow: "#ef7fae",
      ink: "#2b150c",
      dust: "#c9986a",
      vignette: 0.12
    },
    {
      x: 144,
      w: 48,
      sky: "#7ff0a5",
      ground: "#2eb082",
      skyTop: "#1f9d79",
      skyBottom: "#9ff3c3",
      disc: { x: 0.78, y: 0.12, r: 22, core: "#f2fff5", halo: "#c9f7dd" },
      cloud: "#d9fce6",
      hillFar: "#4fbe93",
      hillNear: "#2f9c78",
      mote: "#d6ffa8",
      fireflies: true,
      rim: "rgba(206,244,208,0.22)",
      mood: "rgba(24,104,66,0.12)",
      haze: "#b8ffd9",
      portalGlow: "#5fe8bc",
      ink: "#0d2317",
      dust: "#7fae7a",
      vignette: 0.12
    }
  ];
  var TERRAIN_MATS = [
    {
      veil: null,
      grain: "dark",
      interiorVeil: "rgba(24,14,6,0.24)"
    },
    {
      veil: "rgba(226,146,78,0.40)",
      grain: "strata",
      interiorVeil: "rgba(74,32,12,0.26)"
    },
    {
      veil: "rgba(26,88,56,0.42)",
      grain: "vertical",
      interiorVeil: "rgba(4,30,16,0.30)"
    }
  ];
  var PLATFORM_METALS = [
    { plate: "#8a97ab", plateDark: "#5d6a80", band: "#3f4a5e", bolt: "#252d3c", rim: "#c3cfdf" },
    { plate: "#b08a5a", plateDark: "#7d5c36", band: "#57402a", bolt: "#33261a", rim: "#e8c795" },
    { plate: "#6f9a80", plateDark: "#48705a", band: "#2f4c3e", bolt: "#182a22", rim: "#b9dcc4" }
  ];
  var FLOWER_COLORS = ["#ffd7e8", "#fff3b0", "#ffffff"];
  var HERO_PALETTE = {
    ".": null,
    o: "#2a2118",
    c: "#d4374a",
    d: "#a02a3c",
    l: "#ef6672",
    s: "#f2d8b0",
    k: "#d9b98c",
    w: "#2fb3a6",
    n: "#1e857c",
    v: "#8a5230",
    b: "#64391f",
    h: "#efe0bd",
    p: "#3f4a5e",
    t: "#6e4a2e",
    u: "#9c6b3f",
    y: "#ffd76e"
  };
  var HERO_W = 20;
  var HERO_H = 20;
  var HERO_FRAMES = {
    idle0: [
      "....................",
      ".......ccccc........",
      "......cllllccc......",
      ".....cclllccccc.....",
      "....cccccccccccc....",
      "..cc.dddddddddd.....",
      "..ccd.ssssssks......",
      "...cc.ssssssks......",
      "....c.ssoososs......",
      "......ssoososs......",
      "......ssssssks......",
      "......nnwwwwww......",
      "....nnvvvvvvu.......",
      "...nwhvvbbvvvh......",
      ".....hvvbbvvvh......",
      "....uuvvvvvvv.......",
      "....uypppyppp.......",
      "......ppppppp.......",
      ".......tt.tt........",
      "......ttt.ttt......."
    ],
    idle1: [
      "....................",
      "....................",
      ".......ccccc........",
      "......cllllccc......",
      ".....cclllccccc.....",
      "....cccccccccccc....",
      "..cc.dddddddddd.....",
      "..ccd.ssssssks......",
      "...cc.ssssssks......",
      "....c.ssoososs......",
      "......ssoososs......",
      "......ssssssks......",
      "......nnwwwwww......",
      "....nnvvvvvvu.......",
      "...nwhvvbbvvvh......",
      ".....hvvbbvvvh......",
      "....uuvvvvvvv.......",
      "....uypppyppp.......",
      ".......tt.tt........",
      "......ttt.ttt......."
    ],
    run0: [
      ".......ccccc........",
      ".cccc.cllllccc......",
      ".cccdcclllccccc.....",
      "..c.cccccccccccc....",
      ".....dddddddddd.....",
      "......ssssssks......",
      "......ssssssks......",
      "......ssoososs......",
      "......ssoososs......",
      "......ssssssks......",
      ".wwwn.nnwwwwww......",
      "wwn...vvvvvvuhh.....",
      "......vvbbvvv.......",
      "....hhvvbbvvv.......",
      "....uuvvvvvvv.......",
      "....uypppyppp.......",
      "......ppppppp.......",
      ".......pp..pp.......",
      "......pp....tt......",
      ".....ttt...ttt......"
    ],
    run1: [
      ".......ccccc........",
      "..cc..cllllccc......",
      ".ccd.cclllccccc.....",
      "..c.cccccccccccc....",
      ".....dddddddddd.....",
      "......ssssssks......",
      "......ssssssks......",
      "......ssoososs......",
      "......ssoososs......",
      "......ssssssks......",
      "..wwn.nnwwwwww......",
      ".wn...vvvvvvu.......",
      ".....hvvbbvvvh......",
      "......vvbbvvv.......",
      "....uuvvvvvvv.......",
      "....uypppyppp.......",
      "......ppppppp.......",
      ".......pp...........",
      ".......pptt.........",
      "......ttt..........."
    ],
    run2: [
      ".......ccccc........",
      ".cccc.cllllccc......",
      ".cccdcclllccccc.....",
      "..c.cccccccccccc....",
      ".....dddddddddd.....",
      "......ssssssks......",
      "......ssssssks......",
      "......ssoososs......",
      "......ssoososs......",
      "......ssssssks......",
      ".wwwn.nnwwwwww......",
      "wwn.hhvvvvvvu.......",
      "......vvbbvvv.......",
      "......vvbbvvvhh.....",
      "....uuvvvvvvv.......",
      "....uypppyppp.......",
      "......ppppppp.......",
      "......pp..pp........",
      "....tt....pp........",
      "...ttt...ttt........"
    ],
    run3: [
      ".......ccccc........",
      "..cc..cllllccc......",
      ".ccd.cclllccccc.....",
      "..c.cccccccccccc....",
      ".....dddddddddd.....",
      "......ssssssks......",
      "......ssssssks......",
      "......ssoososs......",
      "......ssoososs......",
      "......ssssssks......",
      "..wwn.nnwwwwww......",
      ".wn...vvvvvvu.......",
      ".....hvvbbvvvh......",
      "......vvbbvvv.......",
      "....uuvvvvvvv.......",
      "....uypppyppp.......",
      "......ppppppp.......",
      ".........pp.........",
      ".......ttpp.........",
      ".........ttt........"
    ],
    jump: [
      ".......ccccc........",
      "......cllllccc......",
      ".....cclllccccc.....",
      "....cccccccccccc....",
      ".....dddddddddd.....",
      "..cc..ssssssks......",
      "..cc..ssssssks......",
      "..cd..ssoososs......",
      "...c..ssoososs......",
      ".....sssssssks......",
      ".....hnnwwwwwh......",
      "....nhvvvvvvuh......",
      "...nw.vvbbvvv.......",
      "...nw.vvbbvvv.......",
      "....uuvvvvvvv.......",
      "....uypppyppp.......",
      "......ppppppp.......",
      ".......pppp.........",
      "......tttttt........",
      "...................."
    ],
    fall: [
      "..c....ccccc........",
      ".ccd..cllllccc......",
      "..cc.cclllccccc.....",
      "....cccccccccccc....",
      ".....dddddddddd.....",
      "......ssssssks......",
      "......ssssssks......",
      "......ssoososs......",
      "...nn.ssoososs......",
      "..wnn.ssssssks......",
      "...nn.nnwwwwww......",
      "....hhvvvvvvuhh.....",
      "......vvbbvvv.......",
      "......vvbbvvv.......",
      "....uuvvvvvvv.......",
      "....uypppyppp.......",
      "......ppppppp.......",
      "......pp...pp.......",
      "....tt.....tt.......",
      "............ttt....."
    ]
  };
  function buildHeroCanvases() {
    if (typeof document === "undefined")
      return null;
    const out = {};
    for (const [name, rows] of Object.entries(HERO_FRAMES)) {
      const c = makeCanvas(HERO_W + 2, HERO_H + 2);
      const g = c.getContext("2d");
      if (!g || typeof g.fillRect !== "function")
        return null;
      const opaque = rows.map((r) => [...r].map((ch) => ch !== "."));
      rows.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch === ".")
            return;
          const hex = HERO_PALETTE[ch];
          if (!hex)
            throw new Error(`hero frame "${name}": unknown palette char "${ch}"`);
          g.fillStyle = hex;
          g.fillRect(x + 1, y + 1, 1, 1);
        });
      });
      const at = (x, y) => x >= 0 && y >= 0 && x < HERO_W && y < HERO_H && opaque[y][x];
      g.fillStyle = HERO_PALETTE.o;
      for (let y = -1;y <= HERO_H; y++) {
        for (let x = -1;x <= HERO_W; x++) {
          if (at(x, y))
            continue;
          if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
            g.fillRect(x + 1, y + 1, 1, 1);
          }
        }
      }
      out[name] = c;
    }
    return out;
  }
  function makeRng2(seed) {
    let s = seed >>> 0;
    return function() {
      s = s + 1831565813 >>> 0;
      let t = s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return (h ^ h >>> 16) >>> 0;
  }
  function withAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  function buildCloudBand(rng, w, h, count, color, alpha) {
    const c = makeCanvas(w, h);
    const g = c.getContext("2d");
    g.globalAlpha = alpha;
    g.fillStyle = color;
    for (let i = 0;i < count; i++) {
      const cx = rng() * w;
      const cy = h * (0.25 + rng() * 0.5);
      const s = 0.6 + rng() * 0.8;
      const puffs = [];
      const n = 4 + Math.floor(rng() * 3);
      for (let p = 0;p < n; p++) {
        puffs.push({
          dx: (p - n / 2) * 16 * s + (rng() - 0.5) * 8,
          dy: (rng() - 0.5) * 10 * s,
          r: (10 + rng() * 10) * s
        });
      }
      for (const shift of [-w, 0, w]) {
        for (const p of puffs) {
          g.beginPath();
          g.arc(cx + shift + p.dx, cy + p.dy, p.r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    return c;
  }
  function buildHills(rng, w, h, farColor, nearColor) {
    const c = makeCanvas(w, h);
    const g = c.getContext("2d");
    const ridge = (color, baseY, amp1, amp2, freq1, freq2) => {
      const p1 = rng() * Math.PI * 2;
      const p2 = rng() * Math.PI * 2;
      const yAt = (x) => baseY - amp1 * Math.sin(x / w * Math.PI * 2 * freq1 + p1) - amp2 * Math.sin(x / w * Math.PI * 2 * freq2 + p2);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0;x <= w; x += 6)
        g.lineTo(x, yAt(x));
      g.lineTo(w, yAt(w));
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    };
    ridge(farColor, h * 0.45, h * 0.26, h * 0.12, 2, 5);
    ridge(nearColor, h * 0.72, h * 0.2, h * 0.1, 3, 7);
    return c;
  }
  var NEARBG_W = 1024;
  var NEARBG_H = 190;
  function buildNearBg(rng, themeIdx) {
    const c = makeCanvas(NEARBG_W, NEARBG_H);
    const g = c.getContext("2d");
    const base = NEARBG_H;
    const PAL = [
      { a: "#4f9e63", b: "#43895a", c: "#c2c896", d: "#8f9a6c" },
      { a: "#c96f4a", b: "#ad5a3a", c: "#bd6a50", d: "#8f4a34" },
      { a: "#2f7d57", b: "#276b4b", c: "#37946a", d: "#2c7d58" }
    ][themeIdx];
    const trunkAt = (x, kind) => {
      if (kind === 0) {
        for (let i = 0;i < 3; i++) {
          const bx = x + (i - 1) * 26;
          const r = 16 + rng() * 10;
          const cy = base - 26 - r;
          g.fillStyle = i === 1 ? PAL.a : PAL.b;
          g.fillRect(bx - 3, base - 26, 6, 26);
          g.beginPath();
          g.arc(bx, cy, r, 0, Math.PI * 2);
          g.fill();
        }
      } else if (kind === 1) {
        const hgt = 90 + rng() * 30;
        g.fillStyle = PAL.d;
        g.beginPath();
        g.moveTo(x - 14, base);
        g.lineTo(x - 8, base - hgt);
        g.lineTo(x + 8, base - hgt);
        g.lineTo(x + 14, base);
        g.closePath();
        g.fill();
        g.fillStyle = PAL.c;
        const hubY = base - hgt - 6;
        for (let b = 0;b < 4; b++) {
          const ang = b * Math.PI / 2 + 0.4;
          g.save();
          g.translate(x, hubY);
          g.rotate(ang);
          g.fillRect(-2, 0, 5, 34);
          g.restore();
        }
      } else if (kind === 2) {
        g.fillStyle = PAL.c;
        g.beginPath();
        g.ellipse(x, base - 14, 20, 14, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = PAL.d;
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(x, base - 14, 11, 8, 0, 0, Math.PI * 2);
        g.stroke();
      } else if (kind === 3) {
        const hgt = 80 + rng() * 50;
        const wHalf = 34 + rng() * 18;
        g.fillStyle = PAL.a;
        g.beginPath();
        g.moveTo(x - wHalf, base);
        g.lineTo(x - wHalf + 8, base - hgt);
        g.lineTo(x + wHalf - 8, base - hgt);
        g.lineTo(x + wHalf, base);
        g.closePath();
        g.fill();
        g.fillStyle = PAL.b;
        g.fillRect(x + wHalf - 14, base - hgt, 8, hgt);
        g.save();
        g.globalCompositeOperation = "destination-out";
        g.beginPath();
        g.arc(x, base, 16, Math.PI, 0);
        g.rect(x - 16, base - 1, 32, 4);
        g.fill();
        g.restore();
      } else if (kind === 4) {
        const hgt = 100 + rng() * 45;
        g.fillStyle = PAL.c;
        g.fillRect(x - 16, base - hgt, 32, hgt);
        for (let n = 0;n < 3; n++) {
          g.clearRect(x - 16 + n * 11 + 2, base - hgt, 6, 8);
        }
        g.fillStyle = PAL.d;
        g.fillRect(x - 3, base - hgt + 22, 6, 12);
      } else if (kind === 5) {
        const hgt = 120 + rng() * 40;
        g.fillStyle = PAL.a;
        g.beginPath();
        g.moveTo(x - 22, base);
        g.lineTo(x - 10, base - hgt * 0.55);
        g.lineTo(x - 12, base - hgt);
        g.lineTo(x + 12, base - hgt);
        g.lineTo(x + 10, base - hgt * 0.55);
        g.lineTo(x + 22, base);
        g.closePath();
        g.fill();
        g.fillStyle = PAL.b;
        g.fillRect(x - 4, base - hgt, 4, hgt);
        g.fillStyle = PAL.c;
        for (let i = 0;i < 3; i++) {
          g.beginPath();
          g.ellipse(x + (i - 1) * 30, base - hgt - 6 + i % 2 * 10, 30, 20, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    };
    const kinds = themeIdx === 0 ? [0, 1, 2, 0] : themeIdx === 1 ? [3, 4, 3] : [5, 5, 0];
    let x = 60 + rng() * 120;
    while (x < NEARBG_W - 60) {
      const kind = kinds[Math.floor(rng() * kinds.length)];
      for (const shift of [-NEARBG_W, 0, NEARBG_W])
        trunkAt(x + shift, kind);
      x += 150 + rng() * 170;
    }
    return c;
  }
  function buildForeArt(themeIdx) {
    const ink = THEMES[themeIdx].ink;
    const mk = (w, h, draw) => {
      const c = makeCanvas(w, h);
      const g = c.getContext("2d");
      g.fillStyle = ink;
      draw(g, w, h);
      return c;
    };
    return [
      mk(96, 64, (g, w, h) => {
        const blades = [[6, 30], [18, 48], [32, 26], [46, 58], [60, 34], [74, 46], [86, 24]];
        for (const [bx, bh] of blades) {
          g.beginPath();
          g.moveTo(bx - 5, h);
          g.lineTo(bx, h - bh);
          g.lineTo(bx + 5, h);
          g.closePath();
          g.fill();
        }
      }),
      mk(84, 46, (g, w, h) => {
        g.beginPath();
        g.moveTo(4, h);
        g.quadraticCurveTo(10, h * 0.35, w * 0.42, h * 0.18);
        g.quadraticCurveTo(w * 0.8, h * 0.3, w - 4, h);
        g.closePath();
        g.fill();
      }),
      mk(110, 78, (g, w, h) => {
        const cx = w / 2;
        for (let i = 0;i < 5; i++) {
          const lean = (i - 2) * (w * 0.16);
          g.beginPath();
          g.moveTo(cx - 4, h);
          g.quadraticCurveTo(cx + lean * 0.5, h * 0.4, cx + lean, h * 0.08);
          g.quadraticCurveTo(cx + lean * 0.5 + 6, h * 0.5, cx + 4, h);
          g.closePath();
          g.fill();
        }
      })
    ];
  }
  var HAZE_H = 80;
  function buildHaze(themeIdx) {
    const c = makeCanvas(4, HAZE_H);
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, HAZE_H);
    grad.addColorStop(0, withAlpha(THEMES[themeIdx].haze, 0));
    grad.addColorStop(1, withAlpha(THEMES[themeIdx].haze, 0.38));
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, HAZE_H);
    return c;
  }
  var PROP_H = 92;
  function buildPropArt(themeIdx) {
    const variants = [];
    for (let v = 0;v < 2; v++) {
      const rng = makeRng2(12513024 + themeIdx * 31 + v * 7);
      if (themeIdx === 0) {
        const c = makeCanvas(64, PROP_H);
        const g = c.getContext("2d");
        g.fillStyle = "#6b4a2e";
        g.fillRect(29, PROP_H - 44, 6, 44);
        g.fillRect(24, PROP_H - 52, 16, 10);
        const blobs = [[20, 30], [40, 26], [30, 16]];
        for (const [bx, by] of blobs) {
          g.fillStyle = by < 20 ? "#4c8f3a" : "#3f7d31";
          g.beginPath();
          g.arc(bx + (rng() - 0.5) * 6, by + (rng() - 0.5) * 6, 17 + rng() * 5, 0, Math.PI * 2);
          g.fill();
        }
        variants.push(c);
      } else if (themeIdx === 1) {
        const c = makeCanvas(44, PROP_H);
        const g = c.getContext("2d");
        g.fillStyle = "#5d8a4e";
        g.fillRect(18, 14, 9, PROP_H - 14);
        g.beginPath();
        g.arc(22.5, 14, 4.5, 0, Math.PI * 2);
        g.fill();
        const arm = (dir) => {
          const ax = dir < 0 ? 8 : 30;
          const ay = 34 + rng() * 18;
          g.fillRect(dir < 0 ? 12 : 26, ay, 12, 6);
          g.fillRect(ax, ay - 16, 6, 22);
          g.beginPath();
          g.arc(ax + 3, ay - 16, 3, 0, Math.PI * 2);
          g.fill();
        };
        arm(-1);
        if (v === 1)
          arm(1);
        g.fillStyle = "rgba(30,52,26,0.35)";
        g.fillRect(21, 16, 1, PROP_H - 18);
        variants.push(c);
      } else {
        const c = makeCanvas(36, PROP_H);
        const g = c.getContext("2d");
        for (let s = 0;s < 3; s++) {
          const sx = 6 + s * 11 + (rng() - 0.5) * 4;
          const top = 6 + rng() * 14;
          g.fillStyle = s === 1 ? "#5f9e52" : "#4c8a46";
          g.fillRect(sx, top, 4, PROP_H - top);
          g.fillStyle = "rgba(20,60,30,0.5)";
          for (let n = top + 8;n < PROP_H - 4; n += 12)
            g.fillRect(sx, n, 4, 2);
          g.fillStyle = "#6fb45e";
          g.fillRect(sx - 4, top + 2, 5, 2);
          g.fillRect(sx + 4, top + 8, 5, 2);
        }
        variants.push(c);
      }
    }
    return variants;
  }
  function buildDisc(disc) {
    const size = disc.r * 4;
    const c = makeCanvas(size, size);
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(size / 2, size / 2, disc.r * 0.5, size / 2, size / 2, size / 2);
    grad.addColorStop(0, withAlpha(disc.halo, 0.55));
    grad.addColorStop(0.45, withAlpha(disc.halo, 0.22));
    grad.addColorStop(1, withAlpha(disc.halo, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.fillStyle = withAlpha(disc.core, 0.95);
    g.beginPath();
    g.arc(size / 2, size / 2, disc.r, 0, Math.PI * 2);
    g.fill();
    return c;
  }
  function buildGlow(color) {
    const size = 64;
    const c = makeCanvas(size, size);
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grad.addColorStop(0, withAlpha(color, 0.5));
    grad.addColorStop(0.5, withAlpha(color, 0.16));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }
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
  function wrapOffset(scrollPx, w) {
    return -((scrollPx % w + w) % w);
  }

  class Sprites {
    constructor() {
      this.images = {};
      this.loaded = false;
      this.clock = 0;
      this._facing = new WeakMap;
      this._skyCache = [null, null, null];
      this._backdrop = null;
      this._terrainArt = [null, null, null];
      this._foreArt = [null, null, null];
      this._propArt = [null, null, null];
      this._vigCache = [null, null, null];
      this._decor = [];
      this._decorSource = null;
      this._level = null;
      this._glows = {};
      this._hero = undefined;
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
    _skyGradient(ctx, themeIdx, viewH) {
      const entry = this._skyCache[themeIdx];
      if (entry && entry.h === viewH)
        return entry.grad;
      const t = THEMES[themeIdx];
      const grad = ctx.createLinearGradient(0, 0, 0, viewH);
      grad.addColorStop(0, t.skyTop);
      grad.addColorStop(0.62, t.sky);
      grad.addColorStop(1, t.skyBottom);
      this._skyCache[themeIdx] = { h: viewH, grad };
      return grad;
    }
    _ensureBackdrop(levelNumber, themeIdx) {
      if (this._backdrop && this._backdrop.levelNumber === levelNumber) {
        return this._backdrop;
      }
      const theme = THEMES[themeIdx];
      const rng = makeRng2(Math.imul(levelNumber, 2654435761) ^ 2709177233);
      const fore = [];
      const foreCount = 5 + Math.floor(rng() * 3);
      for (let i = 0;i < foreCount; i++) {
        fore.push({
          a: Math.floor(rng() * 3),
          x: rng() * NEARBG_W,
          s: 0.65 + rng() * 0.5,
          ph: rng() * Math.PI * 2,
          k: 0.6 + rng() * 0.8
        });
      }
      this._backdrop = {
        levelNumber,
        disc: buildDisc(theme.disc),
        cloudsFar: buildCloudBand(rng, 1024, 110, 5, theme.cloud, 0.5),
        cloudsMid: buildCloudBand(rng, 1024, 130, 7, theme.cloud, 0.72),
        cloudsLow: buildCloudBand(rng, 1024, 80, 6, theme.cloud, 0.45),
        hills: buildHills(rng, 1024, 170, theme.hillFar, theme.hillNear),
        nearBg: buildNearBg(rng, themeIdx),
        fore,
        haze: buildHaze(themeIdx)
      };
      return this._backdrop;
    }
    drawBackground(ctx, levelNumber, cameraX, viewW, viewH, worldBottomScreen = Infinity) {
      const themeIdx = (Math.max(1, levelNumber) - 1) % THEMES.length;
      const theme = THEMES[themeIdx];
      ctx.fillStyle = this._skyGradient(ctx, themeIdx, viewH);
      ctx.fillRect(0, 0, viewW, viewH);
      if (!this.images.backgrounds)
        return;
      const bd = this._ensureBackdrop(levelNumber, themeIdx);
      const groundH = 24 * 2;
      const bandY = Math.min(viewH - groundH, worldBottomScreen);
      const disc = theme.disc;
      ctx.drawImage(bd.disc, viewW * disc.x - cameraX * 0.02 - bd.disc.width / 2, viewH * disc.y - bd.disc.height / 2);
      this._blitWrapped(ctx, bd.cloudsFar, cameraX * 0.1, viewH * 0.06, viewW);
      this._blitWrapped(ctx, bd.cloudsMid, cameraX * 0.25, viewH * 0.2, viewW);
      this._blitWrapped(ctx, bd.hills, cameraX * 0.35, bandY - bd.hills.height + 12, viewW);
      ctx.drawImage(bd.haze, 0, bandY - HAZE_H, viewW, HAZE_H);
      this._blitWrapped(ctx, bd.cloudsLow, cameraX * 0.4, bandY - bd.cloudsLow.height - 10, viewW);
      this._tileStrip(ctx, this.images.backgrounds, theme.x, 48, theme.w, 24, groundH, cameraX * 0.5, bandY, viewW);
      if (bandY + groundH < viewH) {
        ctx.fillStyle = theme.ground;
        ctx.fillRect(0, bandY + groundH, viewW, viewH - bandY - groundH);
      }
      this._blitWrapped(ctx, bd.nearBg, cameraX * 0.55, bandY - bd.nearBg.height + 14, viewW);
    }
    _blitWrapped(ctx, canvas, scrollPx, y, viewW) {
      const w = canvas.width;
      const start = wrapOffset(Math.round(scrollPx), w);
      for (let x = start;x < viewW; x += w) {
        ctx.drawImage(canvas, x, y);
      }
    }
    _tileStrip(ctx, img, sx, sy, srcW, srcH, chunkH, scrollX, y, viewW) {
      const chunkW = srcW * 2;
      const offset = wrapOffset(Math.round(scrollX), chunkW);
      for (let x = offset;x < viewW; x += chunkW) {
        ctx.drawImage(img, sx, sy, srcW, srcH, x, y, chunkW, chunkH);
      }
    }
    drawMoodTint(ctx, levelNumber, cameraX, cameraY, effW, effH) {
      const theme = THEMES[(Math.max(1, levelNumber) - 1) % THEMES.length];
      ctx.fillStyle = theme.mood;
      ctx.fillRect(cameraX - 16, -cameraY - 16, effW + 32, effH + 32);
    }
    drawForeground(ctx, levelNumber, cameraX, viewW, viewH) {
      const themeIdx = (Math.max(1, levelNumber) - 1) % THEMES.length;
      const bd = this._ensureBackdrop(levelNumber, themeIdx);
      const art = this._foreArt[themeIdx] ?? buildForeArt(themeIdx);
      this._foreArt[themeIdx] = art;
      ctx.save();
      ctx.globalAlpha = 0.85;
      const base = wrapOffset(Math.round(cameraX * 1.15), NEARBG_W);
      const reps = Math.ceil(viewW / NEARBG_W) + 1;
      for (const f of bd.fore) {
        const img = art[f.a];
        const w = img.width * f.s;
        const h = img.height * f.s;
        for (let rep = 0;rep <= reps; rep++) {
          const sx = base + f.x + rep * NEARBG_W;
          if (sx < -w || sx > viewW + w)
            continue;
          ctx.save();
          ctx.translate(sx, viewH + 2);
          ctx.rotate(Math.sin(this.clock * f.k + f.ph) * 0.03);
          ctx.drawImage(img, -w / 2, -h + 4, w, h);
          ctx.restore();
        }
      }
      ctx.restore();
    }
    drawVignette(ctx, levelNumber, viewW, viewH) {
      const themeIdx = (Math.max(1, levelNumber) - 1) % THEMES.length;
      const theme = THEMES[themeIdx];
      let entry = this._vigCache[themeIdx];
      if (!entry || entry.w !== viewW || entry.h !== viewH) {
        const grad = ctx.createRadialGradient(viewW / 2, viewH * 0.46, Math.min(viewW, viewH) * 0.42, viewW / 2, viewH * 0.46, Math.max(viewW, viewH) * 0.72);
        grad.addColorStop(0, "rgba(8,10,20,0)");
        grad.addColorStop(1, withAlpha("#0a0e1c", theme.vignette));
        entry = this._vigCache[themeIdx] = { w: viewW, h: viewH, grad };
      }
      ctx.fillStyle = entry.grad;
      ctx.fillRect(0, 0, viewW, viewH);
    }
    _ensureTerrainArt(themeIdx) {
      if (this._terrainArt[themeIdx])
        return this._terrainArt[themeIdx];
      const mat = TERRAIN_MATS[themeIdx];
      const rect = sheetRect("tiles", TILES.DIRT);
      const bakeBody = (v, interior) => {
        const c = makeCanvas(rect.sw, rect.sh);
        const g = c.getContext("2d");
        g.drawImage(this.images.tiles, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
        if (mat.veil) {
          g.fillStyle = mat.veil;
          g.fillRect(0, 0, rect.sw, rect.sh);
        }
        const rng = makeRng2(856446 ^ Math.imul(v + 1 + (interior ? 97 : 0), 2654435761));
        if (mat.grain === "dark") {
          for (let i = 0;i < 4; i++) {
            g.fillStyle = i === 3 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.16)";
            g.fillRect(Math.floor(rng() * (rect.sw - 2)), Math.floor(rng() * (rect.sh - 2)), 2, 2);
          }
        } else if (mat.grain === "strata") {
          for (let i = 0;i < 2; i++) {
            const y = 2 + Math.floor(rng() * (rect.sh - 4));
            g.fillStyle = "rgba(112,54,26,0.30)";
            g.fillRect(0, y, rect.sw, 1 + (rng() < 0.4 ? 1 : 0));
          }
          g.fillStyle = "rgba(255,226,178,0.16)";
          g.fillRect(0, 1 + Math.floor(rng() * (rect.sh - 2)), rect.sw, 1);
          g.fillStyle = "rgba(96,44,20,0.24)";
          g.fillRect(Math.floor(rng() * (rect.sw - 3)), Math.floor(rng() * (rect.sh - 3)), 3, 2);
        } else {
          for (let i = 0;i < 2; i++) {
            g.fillStyle = "rgba(8,42,24,0.18)";
            g.fillRect(Math.floor(rng() * (rect.sw - 2)), 0, 2, rect.sh);
          }
          g.fillStyle = "rgba(198,232,176,0.10)";
          g.fillRect(Math.floor(rng() * rect.sw), 0, 1, rect.sh);
        }
        if (interior) {
          g.fillStyle = mat.interiorVeil;
          g.fillRect(0, 0, rect.sw, rect.sh);
        }
        return c;
      };
      const body = [];
      for (let v = 0;v < 4; v++)
        body.push(bakeBody(v, false));
      const interior = [bakeBody(0, true), bakeBody(1, true)];
      this._terrainArt[themeIdx] = { body, interior, cap: this._buildCapArt(themeIdx) };
      return this._terrainArt[themeIdx];
    }
    _buildCapArt(themeIdx) {
      const c = makeCanvas(18, CAP_H);
      const g = c.getContext("2d");
      const rng = makeRng2(831456 + themeIdx * 7919);
      if (themeIdx === 0) {
        const cap = sheetRect("tiles", TILES.GRASS_TOP);
        g.drawImage(this.images.tiles, cap.sx, cap.sy + GRASS_BAND_Y, cap.sw, GRASS_BAND_H, 0, CAP_OVER, 18, GRASS_BAND_H);
        for (let i = 0;i < 4; i++) {
          g.fillStyle = i % 2 ? "#7cc24e" : "#5aa03c";
          g.fillRect(Math.floor(rng() * 17), CAP_OVER - (2 + Math.floor(rng() * 3)), 1, 2 + Math.floor(rng() * 3));
        }
      } else if (themeIdx === 1) {
        g.fillStyle = "#f4cf94";
        g.fillRect(0, CAP_OVER, 18, 2);
        g.fillStyle = "#d99a5e";
        g.fillRect(0, CAP_OVER + 2, 18, 2);
        g.fillStyle = "#b06a3c";
        g.fillRect(0, CAP_OVER + 4, 18, 2);
        g.fillStyle = "#8f5230";
        g.fillRect(0, CAP_OVER + 6, 18, 2);
        for (let i = 0;i < 3; i++) {
          g.fillStyle = "rgba(122,62,30,0.5)";
          g.fillRect(Math.floor(rng() * 14), CAP_OVER + 1 + Math.floor(rng() * 6), 2 + Math.floor(rng() * 3), 1);
        }
      } else {
        g.fillStyle = "#4c8f4e";
        g.fillRect(0, CAP_OVER, 18, 3);
        g.fillStyle = "#2f6b3e";
        g.fillRect(0, CAP_OVER + 3, 18, 3);
        g.fillStyle = "#20502f";
        g.fillRect(0, CAP_OVER + 6, 18, 2);
        for (let i = 0;i < 5; i++) {
          g.fillStyle = i % 2 ? "#77c46a" : "#8fd47e";
          g.fillRect(Math.floor(rng() * 16), CAP_OVER, 2, 1);
        }
        for (let i = 0;i < 3; i++) {
          g.fillStyle = "#3f7d43";
          g.fillRect(Math.floor(rng() * 17), CAP_OVER - (2 + Math.floor(rng() * 2)), 1, 2 + Math.floor(rng() * 2));
        }
      }
      return c;
    }
    _ensureDecor(level) {
      if (this._decorSource === level)
        return this._decor;
      const decor = [];
      const themeIdx = (Math.max(1, level.levelNumber) - 1) % THEMES.length;
      const rng = makeRng2(Math.imul(level.levelNumber, 1374926497) ^ 3017259506);
      const spikeNear = (tx, ty, r) => {
        for (let y = ty - r;y <= ty + r; y++) {
          if (y < 0 || y >= level.height)
            continue;
          for (let x = tx - r;x <= tx + r; x++) {
            if (x < 0 || x >= level.width)
              continue;
            if (level.tiles[y][x] === 2)
              return true;
          }
        }
        return false;
      };
      const openAbove = (tx, ty, n) => {
        for (let y = ty - n;y < ty; y++) {
          if (y < 0 || level.tiles[y][tx] !== 0)
            return false;
        }
        return true;
      };
      const ceilSpans = typeof level.exposeCeilingSpans === "function" ? level.exposeCeilingSpans() : [];
      const onCeiling = (tx, ty) => {
        for (const s of ceilSpans) {
          if (tx >= s.x0 && tx <= s.x1 && ty >= s.yTop && ty <= s.yBot) {
            return true;
          }
        }
        return false;
      };
      const KINDS = [
        [["tuft", 0.5], ["flower", 0.3], ["pebble", 0.2]],
        [["cactus", 0.4], ["pebbles", 0.35], ["bones", 0.25]],
        [["mushroom", 0.4], ["fern", 0.35], ["pebble", 0.25]]
      ][themeIdx];
      const SIGNATURE = ["tree", "bigcactus", "bamboo"][themeIdx];
      for (let ty = 1;ty < level.height; ty++) {
        for (let tx = 0;tx < level.width; tx++) {
          if (level.tiles[ty][tx] !== 1 || level.tiles[ty - 1][tx] !== 0)
            continue;
          if (spikeNear(tx, ty, 1))
            continue;
          if (onCeiling(tx, ty))
            continue;
          if (rng() <= 0.34) {
            let roll = rng();
            let kind = KINDS[KINDS.length - 1][0];
            for (const [name, weight] of KINDS) {
              if (roll < weight) {
                kind = name;
                break;
              }
              roll -= weight;
            }
            decor.push({
              tx,
              ty,
              kind,
              ox: Math.floor(rng() * 18),
              petal: Math.floor(rng() * FLOWER_COLORS.length),
              ph: rng() * Math.PI * 2
            });
          } else if (rng() <= 0.05 && openAbove(tx, ty, 3) && !spikeNear(tx, ty, 2)) {
            decor.push({
              tx,
              ty,
              kind: SIGNATURE,
              ox: 0,
              petal: 0,
              v: Math.floor(rng() * 2),
              ph: rng() * Math.PI * 2
            });
          }
        }
      }
      if (themeIdx === 2) {
        const vrng = makeRng2((Math.imul(level.levelNumber, 1374926497) ^ 3017259506) + 1);
        for (let ty = 0;ty < level.height - 1; ty++) {
          for (let tx = 0;tx < level.width; tx++) {
            if (level.tiles[ty][tx] !== 1 || level.tiles[ty + 1][tx] !== 0)
              continue;
            if (vrng() > 0.16 || spikeNear(tx, ty + 1, 1))
              continue;
            let len = 1 + Math.floor(vrng() * 3);
            while (len > 0 && ty + 1 + len < level.height && level.tiles[ty + 1 + len][tx] !== 0)
              len--;
            if (len <= 0)
              continue;
            decor.push({
              tx,
              ty: ty + 1,
              kind: "vine",
              ox: 4 + Math.floor(vrng() * 20),
              petal: 0,
              len,
              ph: vrng() * Math.PI * 2
            });
          }
        }
      }
      this._decorSource = level;
      this._decor = decor;
      return decor;
    }
    drawWorld(ctx, level, cameraX, cameraY, viewW, viewH) {
      this._level = level;
      const size = level.tileSize;
      const themeIdx = (Math.max(1, level.levelNumber) - 1) % THEMES.length;
      const art = this._ensureTerrainArt(themeIdx);
      const drawn = size + 1;
      const capScale = drawn / 18;
      const c0 = Math.max(0, Math.floor(cameraX / size));
      const c1 = Math.min(level.width - 1, Math.ceil((cameraX + viewW) / size));
      const r0 = Math.max(0, Math.floor(-cameraY / size));
      const r1 = Math.min(level.height - 1, Math.ceil((-cameraY + viewH) / size));
      for (let ty = r0;ty <= r1; ty++) {
        for (let tx = c0;tx <= c1; tx++) {
          const t = level.tiles[ty][tx];
          if (t === 1) {
            const above = ty > 0 ? level.tiles[ty - 1][tx] : 0;
            const below = ty < level.height - 1 ? level.tiles[ty + 1][tx] : 0;
            const left = tx > 0 ? level.tiles[ty][tx - 1] : 0;
            const right = tx < level.width - 1 ? level.tiles[ty][tx + 1] : 0;
            const h = hash2(tx, ty);
            if (above === 1 && below === 1 && left === 1 && right === 1) {
              ctx.drawImage(art.interior[h & 1], 0, 0, 18, 18, tx * size, ty * size, drawn, drawn);
            } else {
              ctx.drawImage(art.body[h & 3], 0, 0, 18, 18, tx * size, ty * size, drawn, drawn);
            }
            if (above !== 1) {
              ctx.drawImage(art.cap, tx * size, ty * size - CAP_OVER * capScale, drawn, art.cap.height * capScale);
            }
          } else if (t === 2) {
            const spike = sheetRect("tiles", TILES.SPIKE);
            ctx.drawImage(this.images.tiles, spike.sx, spike.sy + SPIKE_BAND_Y, spike.sw, SPIKE_BAND_H, tx * size, ty * size, drawn, drawn);
          }
        }
      }
      ctx.fillStyle = THEMES[themeIdx].rim;
      for (let ty = r0;ty <= r1; ty++) {
        for (let tx = c0;tx <= c1; tx++) {
          if (level.tiles[ty][tx] !== 1)
            continue;
          if (ty > 0 && level.tiles[ty - 1][tx] === 1)
            continue;
          ctx.fillRect(tx * size, ty * size, drawn, 2);
        }
      }
      ctx.fillStyle = "rgba(10,16,32,0.10)";
      for (let ty = r0;ty <= r1; ty++) {
        for (let tx = c0;tx <= c1; tx++) {
          if (level.tiles[ty][tx] !== 1)
            continue;
          if (tx > 0 && level.tiles[ty][tx - 1] === 1)
            continue;
          ctx.fillRect(tx * size, ty * size, 3, drawn);
        }
      }
      ctx.fillStyle = "rgba(10,16,32,0.16)";
      for (let ty = r0;ty <= r1; ty++) {
        for (let tx = c0;tx <= c1; tx++) {
          if (level.tiles[ty][tx] !== 1)
            continue;
          if (tx < level.width - 1 && level.tiles[ty][tx + 1] === 1)
            continue;
          ctx.fillRect((tx + 1) * size - 3, ty * size, 3, drawn);
        }
      }
      this._drawDecor(ctx, this._ensureDecor(level), size, c0, c1, themeIdx);
    }
    _drawDecor(ctx, decor, size, c0, c1, themeIdx) {
      const clock = this.clock;
      const stone = ["#8f9aa3", "#a5765a", "#5d7263"][themeIdx];
      for (const d of decor) {
        if (d.tx < c0 || d.tx > c1)
          continue;
        const x = d.tx * size + d.ox;
        const y = d.ty * size;
        switch (d.kind) {
          case "tuft":
            ctx.fillStyle = "#3f7d31";
            ctx.fillRect(x, y - 6, 2, 6);
            ctx.fillRect(x + 3, y - 9, 2, 9);
            ctx.fillRect(x + 6, y - 5, 2, 5);
            break;
          case "flower": {
            const rot = Math.sin(clock * 2.2 + d.ph) * 0.06;
            ctx.save();
            ctx.translate(x + 2, y);
            ctx.rotate(rot);
            ctx.fillStyle = "#3f7d31";
            ctx.fillRect(-1, -7, 2, 7);
            ctx.fillStyle = FLOWER_COLORS[d.petal];
            ctx.fillRect(-2, -11, 5, 4);
            ctx.restore();
            break;
          }
          case "pebble":
            ctx.fillStyle = stone;
            ctx.fillRect(x, y - 3, 5, 3);
            break;
          case "cactus": {
            const rot = Math.sin(clock * 1.1 + d.ph) * 0.02;
            ctx.save();
            ctx.translate(x + 2, y);
            ctx.rotate(rot);
            ctx.fillStyle = "#5d8a4e";
            ctx.fillRect(-2, -12, 4, 12);
            ctx.fillRect(-5, -8, 3, 3);
            ctx.fillRect(3, -10, 3, 3);
            ctx.fillStyle = "rgba(28,52,24,0.35)";
            ctx.fillRect(-1, -11, 1, 11);
            ctx.restore();
            break;
          }
          case "pebbles":
            ctx.fillStyle = stone;
            ctx.fillRect(x, y - 3, 6, 3);
            ctx.fillRect(x + 7, y - 2, 4, 2);
            ctx.fillRect(x - 4, y - 2, 3, 2);
            break;
          case "bones":
            ctx.fillStyle = "#e8dcc0";
            ctx.fillRect(x, y - 2, 13, 2);
            ctx.fillRect(x + 2, y - 5, 2, 4);
            ctx.fillRect(x + 6, y - 5, 2, 4);
            ctx.fillRect(x + 10, y - 4, 2, 3);
            break;
          case "mushroom":
            ctx.fillStyle = "#d8c9a8";
            ctx.fillRect(x + 1, y - 5, 3, 5);
            ctx.fillRect(x + 7, y - 3, 2, 3);
            ctx.fillStyle = "#b06a4a";
            ctx.fillRect(x - 1, y - 8, 7, 4);
            ctx.fillRect(x + 5, y - 5, 6, 3);
            ctx.fillStyle = "#f2e6cc";
            ctx.fillRect(x + 1, y - 7, 2, 1);
            break;
          case "fern": {
            const rot = Math.sin(clock * 1.6 + d.ph) * 0.07;
            ctx.save();
            ctx.translate(x + 4, y);
            ctx.rotate(rot);
            ctx.fillStyle = "#3f8f52";
            for (const lean of [-6, 0, 6]) {
              ctx.beginPath();
              ctx.moveTo(-1, 0);
              ctx.lineTo(lean, -13);
              ctx.lineTo(2, 0);
              ctx.closePath();
              ctx.fill();
            }
            ctx.restore();
            break;
          }
          case "vine": {
            const rot = Math.sin(clock * 1 + d.ph) * 0.03;
            ctx.save();
            ctx.translate(x + 1, y);
            ctx.rotate(rot);
            const L = d.len * size - 6;
            ctx.fillStyle = "#2f6b3e";
            ctx.fillRect(-1, 0, 2, L);
            ctx.fillStyle = "#4c8f4e";
            for (let s = 8;s < L - 2; s += 12) {
              const side = (s / 12 | 0) % 2 ? 1 : -4;
              ctx.fillRect(side, s, 5, 2);
            }
            ctx.restore();
            break;
          }
          default: {
            const arts = this._propArt[themeIdx] ?? buildPropArt(themeIdx);
            this._propArt[themeIdx] = arts;
            const img = arts[d.v];
            const k = d.kind === "bamboo" ? 1.3 : d.kind === "tree" ? 0.9 : 1.1;
            const amp = d.kind === "bamboo" ? 0.02 : 0.012;
            ctx.save();
            ctx.translate(d.tx * size + size / 2, y);
            ctx.rotate(Math.sin(clock * k + d.ph) * amp);
            ctx.drawImage(img, -img.width / 2, -img.height + 2);
            ctx.restore();
          }
        }
      }
    }
    drawMovingPlatforms(ctx, platforms, levelNumber) {
      const m = PLATFORM_METALS[(Math.max(1, levelNumber) - 1) % THEMES.length];
      const H = 14;
      for (const p of platforms) {
        ctx.fillStyle = "rgba(8,12,24,0.10)";
        ctx.fillRect(p.x + 2, p.y + H + 3, p.width - 4, 6);
        ctx.fillStyle = "rgba(8,12,24,0.18)";
        ctx.fillRect(p.x + 5, p.y + H + 7, p.width - 10, 4);
        ctx.fillStyle = m.plateDark;
        ctx.fillRect(p.x, p.y + 4, p.width, H - 4);
        ctx.fillStyle = m.plate;
        ctx.fillRect(p.x, p.y, p.width, H - 3);
        ctx.fillStyle = m.rim;
        ctx.fillRect(p.x, p.y, p.width, 2);
        ctx.fillStyle = m.band;
        ctx.fillRect(p.x + 8, p.y + 2, 4, H - 4);
        ctx.fillRect(p.x + p.width - 12, p.y + 2, 4, H - 4);
        ctx.fillStyle = m.bolt;
        ctx.fillRect(p.x + 9, p.y + 4, 2, 2);
        ctx.fillRect(p.x + 9, p.y + H - 6, 2, 2);
        ctx.fillRect(p.x + p.width - 11, p.y + 4, 2, 2);
        ctx.fillRect(p.x + p.width - 11, p.y + H - 6, 2, 2);
        const vert = p.axis === "v";
        const v = vert ? p.vy : p.vx;
        const sp = Math.min(1, Math.abs(v) / 30);
        if (sp > 0.05) {
          const dir = v > 0 ? 1 : -1;
          ctx.fillStyle = `rgba(255,255,255,${(0.16 + 0.3 * sp).toFixed(3)})`;
          for (let i = 0;i < 2; i++) {
            ctx.beginPath();
            if (vert) {
              const by0 = dir > 0 ? p.y + H - 10 : p.y + 10;
              const by = by0 + i * 5 * dir;
              const cx0 = p.x + p.width / 2;
              ctx.moveTo(cx0 - 5, by);
              ctx.lineTo(cx0, by + 4 * dir);
              ctx.lineTo(cx0 + 5, by);
            } else {
              const bx0 = dir > 0 ? p.x + p.width - 26 : p.x + 20;
              const bx = bx0 + i * 6 * dir;
              ctx.moveTo(bx, p.y + 4);
              ctx.lineTo(bx + 4 * dir, p.y + H / 2 - 1);
              ctx.lineTo(bx, p.y + H - 4);
            }
            ctx.fill();
          }
        } else if (p.dwelling) {
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.fillRect(p.x, p.y, p.width, 2);
          ctx.fillRect(p.x, p.y + 2, 3, H - 6);
          ctx.fillRect(p.x + p.width - 3, p.y + 2, 3, H - 6);
        }
      }
    }
    _groundBelow(cx, feetY) {
      const level = this._level;
      if (!level)
        return null;
      const size = level.tileSize;
      const tx = Math.floor(cx / size);
      if (tx < 0 || tx >= level.width)
        return null;
      const r0 = Math.max(0, Math.floor(feetY / size));
      const r1 = Math.min(level.height - 1, r0 + 4);
      for (let ty = r0;ty <= r1; ty++) {
        if (level.tiles[ty][tx] === 1)
          return ty * size;
      }
      return null;
    }
    _entityShadow(ctx, cx, feetY, halfW) {
      const gy = this._groundBelow(cx, feetY);
      if (gy === null)
        return;
      const span = 4 * this._level.tileSize;
      const k = Math.min(Math.max(gy - feetY, 0), span) / span;
      ctx.save();
      ctx.globalAlpha = 0.06 + 0.28 * (1 - k);
      ctx.fillStyle = "#0a1020";
      ctx.beginPath();
      ctx.ellipse(cx, gy + 2, halfW * (1 - 0.45 * k), 5 * (1 - 0.4 * k), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    _glowSprite(color) {
      if (!this._glows[color])
        this._glows[color] = buildGlow(color);
      return this._glows[color];
    }
    drawCoins(ctx, coins) {
      const bobPhase = this.clock * 3;
      const glow = this._glowSprite("#ffd76a");
      for (const coin of coins) {
        if (coin.collected)
          continue;
        const phase = coin.x * 0.11 + coin.y * 0.07;
        const cx = coin.x + coin.width / 2;
        const cy = coin.y + coin.height / 2 + Math.sin(bobPhase + phase) * 3;
        const spin = Math.max(0.35, Math.abs(Math.cos(this.clock * 4 + phase)));
        const s = 26;
        ctx.globalAlpha = 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(bobPhase * 0.8 + phase));
        ctx.drawImage(glow, cx - 22, cy - 22, 44, 44);
        ctx.globalAlpha = 1;
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
      const cx = portal.x + portal.width / 2;
      const cy = feetY - h / 2;
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 1.8);
      ctx.globalAlpha = unlocked ? 0.32 + 0.26 * pulse : 0.12;
      const themeIdx = (Math.max(1, this._level?.levelNumber ?? 1) - 1) % THEMES.length;
      const glow = this._glowSprite(unlocked ? THEMES[themeIdx].portalGlow : "#8a7fa8");
      const gs = 96 + 14 * pulse;
      ctx.drawImage(glow, cx - gs / 2, cy - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.save();
      if (!unlocked)
        ctx.globalAlpha = 0.35;
      this._drawSheet(ctx, "tiles", frame, cx - w / 2, feetY - h, w, h);
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
    _ensureHero() {
      if (this._hero === undefined)
        this._hero = buildHeroCanvases();
      return this._hero;
    }
    _heroPose(player) {
      if (!player.grounded)
        return player.vy < 0 ? "jump" : "fall";
      if (Math.abs(player.vx) > 5)
        return "run" + Math.floor(this.clock * 20) % 4;
      return "idle" + Math.floor(this.clock * 2) % 2;
    }
    drawPlayer(ctx, player, squash = 1) {
      const moving = Math.abs(player.vx) > 5;
      const face = this._faceOf(player);
      const w = 44;
      const h = 44 * squash;
      const cx = player.x + player.width / 2;
      this._entityShadow(ctx, cx, player.y + player.height, 16);
      const bob = moving && player.grounded ? Math.abs(Math.sin(this.clock * 10 * Math.PI)) * 2 : 0;
      const feet = player.y + player.height - bob;
      const hero = this._ensureHero();
      if (!hero)
        return;
      ctx.save();
      ctx.translate(cx, feet);
      ctx.scale(face, 1);
      ctx.drawImage(hero[this._heroPose(player)], -w / 2, -h, w, h);
      ctx.restore();
    }
    drawEnemy(ctx, enemy, index) {
      if (enemy.dead)
        return;
      const kind = enemy.kind || "walker";
      if (kind === "spiny") {
        this._drawSpiny(ctx, enemy);
        return;
      }
      if (kind === "charger") {
        this._drawCharger(ctx, enemy);
        return;
      }
      if (kind === "bombardier") {
        this._drawBombardier(ctx, enemy);
        return;
      }
      const frames = index % 2 === 0 ? CHARS.SLIME : CHARS.BAT;
      const frame = frames[Math.floor(this.clock * 6 + index * 1.7) % frames.length];
      const face = this._faceOf(enemy);
      const w = 42;
      const h = 42;
      const cx = enemy.x + enemy.width / 2;
      const feet = enemy.y + enemy.height;
      this._entityShadow(ctx, cx, feet, 15);
      ctx.save();
      ctx.translate(cx, feet);
      ctx.scale(face, 1);
      this._drawSheet(ctx, "characters", frame, -w / 2, -h, w, h);
      ctx.restore();
    }
    _drawSpiny(ctx, enemy) {
      const cx = enemy.x + enemy.width / 2;
      const feet = enemy.y + enemy.height;
      this._entityShadow(ctx, cx, feet, 15);
      const face = this._faceOf(enemy);
      ctx.save();
      ctx.translate(cx, feet);
      ctx.scale(face, 1);
      ctx.fillStyle = "#7d4fa8";
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.quadraticCurveTo(-16, -13, -8, -19);
      ctx.quadraticCurveTo(0, -24, 8, -19);
      ctx.quadraticCurveTo(16, -13, 13, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(18,8,38,0.28)";
      ctx.fillRect(-13, -4, 26, 4);
      ctx.fillStyle = "#16161d";
      const tooth = (bx, by, w, h) => {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + w / 2, by - h);
        ctx.lineTo(bx + w, by);
        ctx.closePath();
        ctx.fill();
      };
      tooth(-11, -13, 6, 7);
      tooth(-4.5, -18, 6, 9);
      tooth(2, -18, 6, 9);
      tooth(8, -12, 6, 7);
      ctx.fillStyle = "#fff";
      ctx.fillRect(5, -14, 4, 4);
      ctx.fillStyle = "#16161d";
      ctx.fillRect(7, -13, 2, 2);
      ctx.restore();
    }
    _drawCharger(ctx, enemy) {
      const CHARGER_WINDUP_TIME = 0.45;
      const cx = enemy.x + enemy.width / 2;
      const feet = enemy.y + enemy.height;
      this._entityShadow(ctx, cx, feet, 17);
      const face = this._faceOf(enemy);
      let sx = 1;
      let sy = 1;
      let flash = false;
      const t = enemy.stateTime || 0;
      if (enemy.state === "windup") {
        const k = Math.min(1, t / CHARGER_WINDUP_TIME);
        sx = 1 + 0.18 * k;
        sy = 1 - 0.25 * k;
        flash = Math.floor(t * 12) % 2 === 0;
      } else if (enemy.state === "dash") {
        sx = 1.12;
        sy = 0.9;
      }
      ctx.save();
      ctx.translate(cx, feet);
      ctx.scale(face * sx, sy);
      ctx.fillStyle = "#b5493a";
      ctx.beginPath();
      ctx.moveTo(-15, 0);
      ctx.quadraticCurveTo(-17, -14, -9, -21);
      ctx.quadraticCurveTo(0, -26, 9, -21);
      ctx.quadraticCurveTo(17, -14, 15, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(20,8,4,0.28)";
      ctx.fillRect(-15, -4, 30, 4);
      ctx.fillStyle = "#e8d8b0";
      ctx.beginPath();
      ctx.moveTo(9, -20);
      ctx.lineTo(21, -15);
      ctx.lineTo(9, -13);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(5, -15, 4, 4);
      ctx.fillStyle = "#16161d";
      ctx.fillRect(7, -14, 2, 2);
      if (flash) {
        ctx.fillStyle = "rgba(255,232,170,0.45)";
        ctx.beginPath();
        ctx.moveTo(-15, 0);
        ctx.quadraticCurveTo(-17, -14, -9, -21);
        ctx.quadraticCurveTo(0, -26, 9, -21);
        ctx.quadraticCurveTo(17, -14, 15, 0);
        ctx.closePath();
        ctx.fill();
      }
      if (enemy.state === "dash") {
        ctx.strokeStyle = "rgba(255,214,170,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-18, -16);
        ctx.lineTo(-26, -16);
        ctx.moveTo(-18, -9);
        ctx.lineTo(-24, -9);
        ctx.stroke();
      }
      ctx.restore();
    }
    _drawBombardier(ctx, enemy) {
      const BOMBARDIER_WINDUP_RANGED_TIME = 0.6;
      const cx = enemy.x + enemy.width / 2;
      const feet = enemy.y + enemy.height;
      this._entityShadow(ctx, cx, feet, 17);
      const face = this._faceOf(enemy);
      let sx = 1;
      let sy = 1;
      const t = enemy.stateTime || 0;
      if (enemy.state === "windup_ranged") {
        const k = Math.min(1, t / BOMBARDIER_WINDUP_RANGED_TIME);
        sx = 1 + 0.1 * k;
        sy = 1 - 0.15 * k;
      } else if (enemy.state === "windup") {
        const k = Math.min(1, t / 0.45);
        sx = 1 + 0.18 * k;
        sy = 1 - 0.25 * k;
      } else if (enemy.state === "dash") {
        sx = 1.12;
        sy = 0.9;
      }
      ctx.save();
      ctx.translate(cx, feet);
      ctx.scale(face * sx, sy);
      ctx.fillStyle = "#4a1f52";
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.quadraticCurveTo(-18, -11, -10, -17);
      ctx.quadraticCurveTo(0, -21, 10, -17);
      ctx.quadraticCurveTo(18, -11, 16, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(14,4,20,0.3)";
      ctx.fillRect(-16, -4, 32, 4);
      ctx.fillStyle = "#b0803a";
      ctx.fillRect(6, -15, 18, 6);
      ctx.fillStyle = "#7d5a26";
      ctx.fillRect(6, -15, 4, 6);
      ctx.fillStyle = "#d8a94e";
      ctx.fillRect(21, -16, 3, 8);
      ctx.strokeStyle = "#c9c2b2";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(7, -15);
      ctx.quadraticCurveTo(4, -21, 8, -22);
      ctx.stroke();
      const spark = 1.5 + (Math.floor(this.clock * 14) % 2 ? 0.6 : 0);
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.arc(8, -22, spark, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(2, -12, 4, 4);
      ctx.fillStyle = "#16161d";
      ctx.fillRect(4, -11, 2, 2);
      if (enemy.state === "windup_ranged") {
        const k = Math.min(1, t / BOMBARDIER_WINDUP_RANGED_TIME);
        ctx.fillStyle = `rgba(255,180,80,${0.25 + 0.5 * k})`;
        ctx.beginPath();
        ctx.arc(25, -12, 2 + 6 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      if (enemy.state === "cooldown_ranged" && t < 0.08) {
        ctx.fillStyle = "rgba(255,232,170,0.9)";
        ctx.beginPath();
        ctx.arc(26, -12, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      if (enemy.state === "dash") {
        ctx.strokeStyle = "rgba(255,214,170,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-19, -13);
        ctx.lineTo(-27, -13);
        ctx.moveTo(-19, -7);
        ctx.lineTo(-25, -7);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // js/movingplatforms.js
  var LAND_TOLERANCE = 0.5;
  var VY_EPSILON = 0.000001;
  var JUMP_BOOST_CAP = 40;
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function applyJumpBoost(player, platform) {
    if (!platform)
      return;
    player.vy += clamp(platform.vy, -JUMP_BOOST_CAP, JUMP_BOOST_CAP);
    player.vx += clamp(platform.vx, -JUMP_BOOST_CAP, JUMP_BOOST_CAP);
  }

  class MovingPlatform {
    constructor(desc) {
      this.y = desc.y;
      this.width = desc.width;
      this.height = desc.height;
      this.axis = desc.axis;
      this.min = desc.min;
      this.max = desc.max;
      this.speed = desc.speed;
      this.phase = desc.phase;
      this.dwell = desc.dwell ?? 0;
      this.vx = 0;
      this.vy = 0;
      this.dx = 0;
      this.dy = 0;
      this.dwelling = false;
      this.elapsed = 0;
      const p0 = this.positionAt(0);
      this.x = this.axis === "v" ? desc.x : p0;
      if (this.axis === "v")
        this.y = p0;
      this.prevY = this.y;
      this.prevX = this.x;
    }
    traverseSeconds() {
      const span = this.max - this.min;
      return span > 0 ? span / this.speed : 0;
    }
    periodSeconds() {
      return 2 * (this.traverseSeconds() + this.dwell);
    }
    positionAt(t) {
      const span = this.max - this.min;
      if (!(span > 0))
        return this.min;
      const leg = this.traverseSeconds();
      const period = this.periodSeconds();
      let u = (t + this.phase * period) % period;
      if (u < 0)
        u += period;
      if (u < this.dwell)
        return this.min;
      u -= this.dwell;
      if (u < leg)
        return this.min + u / leg * span;
      u -= leg;
      if (u < this.dwell)
        return this.max;
      u -= this.dwell;
      return this.max - u / leg * span;
    }
    isDwellingAt(t) {
      if (this.dwell <= 0)
        return false;
      const period = this.periodSeconds();
      let u = (t + this.phase * period) % period;
      if (u < 0)
        u += period;
      const leg = this.traverseSeconds();
      return u < this.dwell || u >= this.dwell + leg && u < 2 * this.dwell + leg;
    }
    update(dt) {
      this.elapsed += dt;
      const pos = this.positionAt(this.elapsed);
      this.prevX = this.x;
      this.prevY = this.y;
      if (this.axis === "v") {
        this.dy = pos - this.y;
        this.dx = 0;
        this.y = pos;
      } else {
        this.dx = pos - this.x;
        this.dy = 0;
        this.x = pos;
      }
      this.vx = dt > 0 ? this.dx / dt : 0;
      this.vy = dt > 0 ? this.dy / dt : 0;
      this.dwelling = this.isDwellingAt(this.elapsed);
    }
    isUnder(player) {
      return Math.abs(player.y + player.height - this.y) < 1.5 && player.x < this.x + this.width && player.x + player.width > this.x;
    }
    carry(player) {
      player.x += this.dx;
      player.y += this.dy;
    }
  }

  class MovingPlatformManager {
    constructor(descriptors = []) {
      this.platforms = descriptors.map((d) => new MovingPlatform(d));
      this.riding = null;
    }
    updateAll(dt) {
      for (const p of this.platforms)
        p.update(dt);
    }
    oneWayRects(player) {
      const out = [];
      for (const p of this.platforms) {
        if (!aabbOverlap(player, p))
          continue;
        const stickyDescent = p === this.riding && p.dy > 0 && player.vy >= 0;
        if (player.vy < p.vy - VY_EPSILON && !stickyDescent)
          continue;
        const topRef = p.dy < 0 ? p.prevY : p.y;
        if (player.prevY !== undefined && player.prevY + player.height > topRef + LAND_TOLERANCE) {
          continue;
        }
        out.push(p);
      }
      return out;
    }
    supportUnder(player) {
      if (!player.grounded)
        return null;
      for (const p of this.platforms) {
        if (p.isUnder(player))
          return p;
      }
      return null;
    }
    attachRider(player) {
      this.riding = this.supportUnder(player);
      return this.riding;
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
  var MAX_MOTES = 20;
  function makeRng3(seed) {
    let s = seed >>> 0;
    return function() {
      s = s + 1831565813 >>> 0;
      let t = s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function createMotes(count, seed, viewW, viewH) {
    const rng = makeRng3(seed);
    const motes = [];
    const n = Math.min(count, MAX_MOTES);
    for (let i = 0;i < n; i++) {
      motes.push({
        x: rng() * viewW,
        y: rng() * viewH,
        vx: 4 + rng() * 10,
        vy: -(2 + rng() * 6),
        size: 1.5 + rng() * 2,
        phase: rng() * Math.PI * 2,
        wobble: 0.4 + rng() * 0.8,
        par: 0.1 + rng() * 0.3
      });
    }
    return motes;
  }
  function stepMotes(list, dt, viewW, viewH) {
    for (const m of list) {
      m.phase += dt * m.wobble;
      m.x += (m.vx + Math.sin(m.phase) * 4) * dt;
      m.y += m.vy * dt;
      m.x = (m.x % viewW + viewW) % viewW;
      m.y = (m.y % viewH + viewH) % viewH;
    }
    return list;
  }
  function drawMotes(ctx, list, cameraX, viewW, color, fireflies = false) {
    for (const m of list) {
      const sx = ((m.x - cameraX * m.par) % viewW + viewW) % viewW;
      const twinkle = 0.55 + 0.45 * Math.sin(m.phase * 2.3);
      ctx.globalAlpha = twinkle * (fireflies ? 0.85 : 0.45);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, m.y, m.size * (fireflies ? 1.4 : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // js/audio.js
  var exports_audio = {};
  __export(exports_audio, {
    MUSIC_PRESETS: () => MUSIC_PRESETS,
    advanceScheduler: () => advanceScheduler,
    buildMelodyLoop: () => buildMelodyLoop,
    duckMusic: () => duckMusic,
    getState: () => getState,
    init: () => init,
    isMuted: () => isMuted,
    loadMutedPreference: () => loadMutedPreference,
    musicVariantFor: () => musicVariantFor,
    playSfx: () => playSfx,
    presetForLevel: () => presetForLevel,
    setMuted: () => setMuted,
    shutdown: () => shutdown,
    startMusic: () => startMusic,
    stopMusic: () => stopMusic,
    toggleMute: () => toggleMute
  });
  var MUSIC_LEVEL = 0.35;
  var SFX_LEVEL = 0.6;
  var MUTE_STORAGE_KEY = "platformerMuted";
  var SCHEDULER_INTERVAL_MS = 25;
  var LOOKAHEAD_SEC = 0.1;
  var CROSSFADE_SEC = 0.8;
  var MUSIC_PRESETS = [
    { name: "day", root: 220, scale: [0, 3, 5, 7, 10], bpm: 72, padCutoff: 900, delayWet: 0, melodyWave: "triangle" },
    { name: "dusk", root: 146.83, scale: [0, 2, 3, 5, 7, 9, 10], bpm: 66, padCutoff: 700, delayWet: 0.14, melodyWave: "sine" },
    { name: "jungle", root: 164.81, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 78, padCutoff: 620, delayWet: 0.28, melodyWave: "sine" }
  ];
  var TIER_CREEP_FIRST_LEVEL = 25;
  var TIER_CREEP_BPM = 6;
  var STEPS_PER_BAR = 8;
  var LOOP_STEPS = STEPS_PER_BAR * 4;
  var PROGRESSION_VARIANTS = [
    [[0, 2, 4, 2], [0, 3, 2, 4], [0, 4, 5, 4], [0, 2, 3, 2]],
    [[0, 2, 4, 2], [0, 5, 4, 2], [0, 2, 5, 4], [0, 3, 4, 2]],
    [[0, 2, 4, 2], [0, 4, 2, 2], [0, 5, 2, 4], [0, 2, 4, 5]]
  ];
  var MELODY_SHIFT_CHOICES = [0, 7, 12];
  var DENSITY_CHOICES = [
    { name: "sparse", prob: 0.45, maxLen: 3 },
    { name: "medium", prob: 0.62, maxLen: 2 },
    { name: "fluid", prob: 0.78, maxLen: 2 }
  ];
  var PAD_MODES = ["sustained", "arp"];
  var BASS_MODES = ["pulse", "downbeat", "drone"];
  var TEMPO_SWING_BPM = 4;
  function makeRng4(seed) {
    let s = seed >>> 0;
    return function() {
      s = s + 1831565813 >>> 0;
      let t = s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function degreeSemitones(scale, degree) {
    const len = scale.length;
    const octave = Math.floor(degree / len);
    const idx = (degree % len + len) % len;
    return scale[idx] + 12 * octave;
  }
  function scaleNoteHz(preset, degree, octave = 0) {
    return preset.root * Math.pow(2, (degreeSemitones(preset.scale, degree) + 12 * octave) / 12);
  }
  function musicSeedForLevel(levelNumber) {
    return (Math.imul(levelNumber, 2654435761) ^ 1369961139) >>> 0;
  }
  function presetForLevel(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
      console.warn("Invalid level number for music preset:", levelNumber, "- defaulting to level 1 preset");
      levelNumber = 1;
    }
    const index = (levelNumber - 1) % MUSIC_PRESETS.length;
    const preset = MUSIC_PRESETS[index];
    const bpm = preset.bpm + (levelNumber >= TIER_CREEP_FIRST_LEVEL ? TIER_CREEP_BPM : 0);
    return { index, preset, bpm, seed: musicSeedForLevel(levelNumber) };
  }
  function musicVariantFor(levelNumber) {
    const { index, preset, bpm: baseBpm, seed } = presetForLevel(levelNumber);
    const rng = makeRng4((seed ^ 2052534697) >>> 0);
    const progressions = PROGRESSION_VARIANTS[index];
    const progIndex = Math.floor(rng() * progressions.length);
    const melodyShift = MELODY_SHIFT_CHOICES[Math.floor(rng() * MELODY_SHIFT_CHOICES.length)];
    const density = DENSITY_CHOICES[Math.floor(rng() * DENSITY_CHOICES.length)];
    const padMode = PAD_MODES[Math.floor(rng() * PAD_MODES.length)];
    const bassMode = BASS_MODES[Math.floor(rng() * BASS_MODES.length)];
    const bpmOffset = Math.floor(rng() * (2 * TEMPO_SWING_BPM + 1)) - TEMPO_SWING_BPM;
    return {
      index,
      preset,
      seed,
      bpm: baseBpm + bpmOffset,
      progression: progressions[progIndex],
      progIndex,
      melodyShift,
      density: density.name,
      densityProb: density.prob,
      densityMaxLen: density.maxLen,
      padMode,
      bassMode,
      bpmOffset,
      signature: `${progIndex}+${melodyShift}+${density.name}+${padMode}+${bassMode}+${bpmOffset}`
    };
  }
  function buildMelodyLoop(presetIndex, levelNumber) {
    const preset = MUSIC_PRESETS[(presetIndex % MUSIC_PRESETS.length + MUSIC_PRESETS.length) % MUSIC_PRESETS.length];
    const variant = musicVariantFor(levelNumber);
    const rng = makeRng4(musicSeedForLevel(levelNumber));
    const loop = new Array(LOOP_STEPS).fill(null);
    let degree = Math.floor(rng() * preset.scale.length);
    let i = 0;
    while (i < LOOP_STEPS) {
      if (rng() < variant.densityProb) {
        degree = Math.max(-2, Math.min(preset.scale.length + 3, degree + Math.floor(rng() * 5) - 2));
        const oct = rng() < 0.25 ? 1 : 0;
        const len = Math.min(1 + Math.floor(rng() * variant.densityMaxLen), LOOP_STEPS - i);
        loop[i] = { deg: degree, oct, len };
        i += len;
      } else {
        i++;
      }
    }
    return loop;
  }
  function advanceScheduler(state, nowSec, lookaheadSec, stepDurSec, emit) {
    if (!(stepDurSec > 0))
      return 0;
    if (state.nextStepTime < nowSec - stepDurSec)
      state.nextStepTime = nowSec;
    let count = 0;
    while (state.nextStepTime < nowSec + lookaheadSec) {
      emit(state.step, state.nextStepTime);
      state.step = (state.step + 1) % LOOP_STEPS;
      state.nextStepTime += stepDurSec;
      count++;
    }
    return count;
  }
  var ctx = null;
  var master = null;
  var sfxBus = null;
  var musicBus = null;
  var playback = null;
  var schedulerId = null;
  var cleanupTimers = new Set;
  var noiseBuffer = null;
  var muted = false;
  var muteLoaded = false;
  var ducked = false;
  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }
  function loadMutedPreference() {
    muted = storageGet(MUTE_STORAGE_KEY) === "true";
    muteLoaded = true;
    return muted;
  }
  function audioConstructor() {
    if (typeof AudioContext !== "undefined")
      return AudioContext;
    if (typeof globalThis.webkitAudioContext !== "undefined")
      return globalThis.webkitAudioContext;
    return null;
  }
  function ensureContext() {
    if (ctx) {
      if (ctx.state === "suspended")
        ctx.resume().catch(() => {});
      return true;
    }
    const Ctor = audioConstructor();
    if (!Ctor)
      return false;
    try {
      ctx = new Ctor;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = SFX_LEVEL;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = ducked || muted ? 0 : MUSIC_LEVEL;
      musicBus.connect(master);
    } catch {
      ctx = null;
      return false;
    }
    return true;
  }
  function cachedNoiseBuffer() {
    if (!noiseBuffer) {
      const len = Math.floor(ctx.sampleRate * 0.3);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0;i < len; i++)
        data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }
  function tone({ wave = "sine", freq, endFreq = 0, dur, peak, attack = 0.005, filterHz = 0, dest, when }) {
    const t = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq > 0)
      osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (filterHz > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = filterHz;
      osc.connect(lp);
      node = lp;
    }
    node.connect(g);
    g.connect(dest || sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  function noiseBurst({ dur, peak, bandHz, when }) {
    const t = when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = cachedNoiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = bandHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }
  var SFX = {
    jump() {
      tone({ wave: "square", freq: 220, endFreq: 600, dur: 0.12, peak: 0.28 });
    },
    land() {
      tone({ wave: "triangle", freq: 150, endFreq: 65, dur: 0.15, peak: 0.32, filterHz: 400 });
    },
    coin() {
      const t = ctx.currentTime;
      tone({ wave: "sine", freq: 987.77, dur: 0.07, peak: 0.26, when: t });
      tone({ wave: "sine", freq: 1318.51, dur: 0.16, peak: 0.26, when: t + 0.07 });
    },
    stomp() {
      tone({ wave: "triangle", freq: 300, endFreq: 60, dur: 0.18, peak: 0.4, filterHz: 900 });
    },
    bombard_fire() {
      tone({ wave: "triangle", freq: 110, endFreq: 45, dur: 0.22, peak: 0.4, filterHz: 320 });
      noiseBurst({ dur: 0.12, peak: 0.18, bandHz: 240 });
    },
    death() {
      tone({ wave: "sawtooth", freq: 380, endFreq: 50, dur: 0.35, peak: 0.32, attack: 0.01 });
      noiseBurst({ dur: 0.15, peak: 0.22, bandHz: 900 });
    },
    portal_unlock() {
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => tone({ wave: "sine", freq: f, dur: 0.12, peak: 0.24, when: t + i * 0.08 }));
    },
    level_complete() {
      const t = ctx.currentTime;
      [220, 261.63, 329.63, 440].forEach((f, i) => tone({
        wave: "triangle",
        freq: f,
        dur: 0.55,
        peak: 0.2,
        attack: 0.02,
        filterHz: 1600,
        when: t + i * 0.12
      }));
    }
  };
  function stopScheduler() {
    if (schedulerId !== null) {
      clearInterval(schedulerId);
      schedulerId = null;
    }
  }
  function schedulerShouldRun() {
    return !!ctx && !!playback && !muted && !ducked;
  }
  function startScheduler() {
    if (schedulerId !== null || !schedulerShouldRun())
      return;
    if (playback.state.nextStepTime < ctx.currentTime) {
      playback.state.nextStepTime = ctx.currentTime;
    }
    schedulerId = setInterval(() => {
      if (!schedulerShouldRun()) {
        stopScheduler();
        return;
      }
      advanceScheduler(playback.state, ctx.currentTime, LOOKAHEAD_SEC, playback.stepDur, (step, when) => playMusicStep(playback, step, when));
    }, SCHEDULER_INTERVAL_MS);
  }
  function playMusicStep(pb, step, when) {
    const preset = pb.preset;
    const v = pb.variant;
    if (step % LOOP_STEPS === 0 && v.padMode === "sustained") {
      const chordRoot = v.progression[0];
      const dur = pb.stepDur * LOOP_STEPS + 2;
      for (const offset of [0, 2, 4]) {
        const freq = scaleNoteHz(preset, chordRoot + offset, 0);
        for (const detune of [-6, 6]) {
          const osc = ctx.createOscillator();
          osc.type = "triangle";
          osc.frequency.value = freq;
          osc.detune.value = detune;
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = preset.padCutoff;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, when);
          g.gain.linearRampToValueAtTime(0.05, when + 1.5);
          g.gain.setValueAtTime(0.05, when + dur - 1.8);
          g.gain.linearRampToValueAtTime(0.0001, when + dur);
          osc.connect(lp);
          lp.connect(g);
          g.connect(pb.gain);
          osc.start(when);
          osc.stop(when + dur + 0.05);
        }
      }
    }
    if (step % LOOP_STEPS === 0 && v.bassMode === "drone") {
      tone({
        wave: "sine",
        freq: scaleNoteHz(preset, v.progression[0], -2),
        dur: pb.stepDur * LOOP_STEPS + 1,
        peak: 0.13,
        attack: 0.5,
        dest: pb.gain,
        when
      });
    }
    if (step % STEPS_PER_BAR === 0) {
      const bar = step / STEPS_PER_BAR % v.progression.length;
      const chordRoot = v.progression[bar];
      if (v.padMode === "arp") {
        tone({
          wave: "triangle",
          freq: scaleNoteHz(preset, chordRoot + [0, 2, 4][bar % 3], 0),
          dur: pb.stepDur * STEPS_PER_BAR + 0.6,
          peak: 0.07,
          attack: 0.3,
          filterHz: preset.padCutoff,
          dest: pb.gain,
          when
        });
      }
      if (v.bassMode !== "drone") {
        tone({
          wave: "sine",
          freq: scaleNoteHz(preset, chordRoot, -1),
          dur: pb.stepDur * 3.2,
          peak: 0.16,
          attack: 0.02,
          dest: pb.gain,
          when
        });
      }
    }
    if (v.bassMode === "pulse" && step % STEPS_PER_BAR === 4) {
      const bar = (step - 4) / STEPS_PER_BAR % v.progression.length;
      tone({
        wave: "sine",
        freq: scaleNoteHz(preset, v.progression[bar], -1),
        dur: pb.stepDur * 2,
        peak: 0.1,
        attack: 0.02,
        dest: pb.gain,
        when
      });
    }
    const note = pb.melody[step];
    if (note) {
      const dur = Math.min(note.len * pb.stepDur * 0.9, 1.6);
      const freq = scaleNoteHz(preset, note.deg, note.oct + 1) * Math.pow(2, v.melodyShift / 12);
      tone({
        wave: preset.melodyWave,
        freq,
        dur,
        peak: 0.12,
        attack: 0.03,
        dest: pb.gain,
        when
      });
      if (pb.delaySend) {
        tone({
          wave: preset.melodyWave,
          freq,
          dur,
          peak: 0.12,
          attack: 0.03,
          dest: pb.delaySend,
          when
        });
      }
    }
  }
  function later(ms, fn) {
    const id = setTimeout(() => {
      cleanupTimers.delete(id);
      fn();
    }, ms);
    cleanupTimers.add(id);
  }
  function retirePlayback(pb) {
    later(CROSSFADE_SEC * 1000 + 150, () => disconnectPlayback(pb));
  }
  function createPlayback(index, variant, levelNumber) {
    const preset = MUSIC_PRESETS[index];
    const stepDur = 60 / variant.bpm / 2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + CROSSFADE_SEC);
    gain.connect(musicBus);
    let delaySend = null;
    let delayNode = null;
    let feedback = null;
    if (preset.delayWet > 0) {
      delayNode = ctx.createDelay(2);
      delayNode.delayTime.value = stepDur * 3;
      feedback = ctx.createGain();
      feedback.gain.value = 0.32;
      delaySend = ctx.createGain();
      delaySend.gain.value = preset.delayWet;
      delaySend.connect(delayNode);
      delayNode.connect(feedback);
      feedback.connect(delayNode);
      delayNode.connect(gain);
    }
    return {
      key: `${index}:${variant.bpm}:${variant.seed}:${variant.signature}`,
      gain,
      preset,
      variant,
      stepDur,
      melody: buildMelodyLoop(index, levelNumber),
      delaySend,
      delayNode,
      feedback,
      state: { step: 0, nextStepTime: ctx.currentTime }
    };
  }
  function disconnectPlayback(pb) {
    try {
      pb.gain.disconnect();
      if (pb.delaySend) {
        pb.delaySend.disconnect();
        pb.feedback.disconnect();
        pb.delayNode.disconnect();
      }
    } catch {}
  }
  function init() {
    if (!muteLoaded)
      loadMutedPreference();
    ensureContext();
  }
  function setMuted(value) {
    muted = !!value;
    muteLoaded = true;
    storageSet(MUTE_STORAGE_KEY, muted ? "true" : "false");
    if (ctx) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(muted ? 0 : 1, t + 0.08);
      if (!muted)
        startScheduler();
    }
  }
  function toggleMute() {
    setMuted(!muted);
    return muted;
  }
  function isMuted() {
    return muted;
  }
  function playSfx(name) {
    if (muted)
      return;
    if (!ensureContext())
      return;
    const fn = SFX[name];
    if (!fn) {
      console.warn("Unknown sound effect requested:", name);
      return;
    }
    fn();
  }
  function startMusic(themeIndex, levelNumber) {
    if (!ensureContext())
      return;
    const variant = musicVariantFor(levelNumber);
    const index = Number.isInteger(themeIndex) && themeIndex >= 0 && themeIndex < MUSIC_PRESETS.length ? themeIndex : variant.index;
    const key = `${index}:${variant.bpm}:${variant.seed}:${variant.signature}`;
    if (playback && playback.key === key)
      return;
    const old = playback;
    playback = createPlayback(index, variant, levelNumber);
    if (old) {
      const t = ctx.currentTime;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0.0001, t + CROSSFADE_SEC);
      retirePlayback(old);
    }
    startScheduler();
  }
  function stopMusic() {
    if (!ctx || !playback)
      return;
    stopScheduler();
    const old = playback;
    playback = null;
    const t = ctx.currentTime;
    old.gain.gain.cancelScheduledValues(t);
    old.gain.gain.setValueAtTime(old.gain.gain.value, t);
    old.gain.gain.linearRampToValueAtTime(0.0001, t + 0.25);
    later(400, () => disconnectPlayback(old));
  }
  function duckMusic(on) {
    ducked = !!on;
    if (ctx) {
      const t = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.setValueAtTime(musicBus.gain.value, t);
      musicBus.gain.linearRampToValueAtTime(ducked || muted ? 0 : MUSIC_LEVEL, t + 0.15);
      if (!ducked)
        startScheduler();
    }
  }
  function shutdown() {
    stopScheduler();
    for (const id of cleanupTimers)
      clearTimeout(id);
    cleanupTimers.clear();
    playback = null;
    if (ctx) {
      const dying = ctx;
      ctx = null;
      master = null;
      sfxBus = null;
      musicBus = null;
      noiseBuffer = null;
      dying.close().catch(() => {});
    }
  }
  function getState() {
    return {
      supported: audioConstructor() !== null,
      hasContext: !!ctx,
      contextState: ctx ? ctx.state : null,
      muted,
      ducked,
      musicKey: playback ? playback.key : null
    };
  }

  // js/main.js
  var TILE_SIZE = 32;
  var MOTE_COUNT = 18;
  function computeZoom(viewportHeight) {
    return Math.max(1, Math.min(3, Math.round(viewportHeight / 540)));
  }
  function avalanche32(x) {
    x ^= x >>> 16;
    x = Math.imul(x, 2146121005);
    x ^= x >>> 15;
    x = Math.imul(x, 2221713035);
    return (x ^ x >>> 16) >>> 0;
  }
  function seedCandidate(runSeed, levelNumber, index) {
    const base = avalanche32(runSeed + Math.imul(levelNumber, 2654435761) >>> 0);
    return index === 0 ? base : avalanche32(base + Math.imul(index, 2246822507) >>> 0);
  }
  function layoutSignature(level) {
    const { width: w, height: h } = level;
    const surface = new Uint8Array(w * h);
    for (let x = 0;x < w; x++) {
      for (let y = 0;y < h; y++) {
        if (level.tiles[y][x] === 1 && (y === 0 || level.tiles[y - 1][x] !== 1)) {
          surface[y * w + x] = 1;
        }
      }
    }
    return { w, h, surface, dir: level.direction };
  }
  function layoutSimilarity(a, b) {
    if (a.w !== b.w || a.h !== b.h)
      return 0;
    let inter = 0, uni = 0;
    for (let i = 0;i < a.surface.length; i++) {
      if (a.surface[i] | b.surface[i]) {
        uni++;
        if (a.surface[i] & b.surface[i])
          inter++;
      }
    }
    let best = uni ? inter / uni : 1;
    if (a.dir !== b.dir && a.dir !== "vertical" && b.dir !== "vertical") {
      let mInter = 0, mUni = 0;
      for (let y = 0;y < a.h; y++) {
        for (let x = 0;x < a.w; x++) {
          const av = a.surface[y * a.w + x];
          const bv = b.surface[y * b.w + (b.w - 1 - x)];
          if (av | bv) {
            mUni++;
            if (av & bv)
              mInter++;
          }
        }
      }
      best = Math.max(best, mUni ? mInter / mUni : 1);
    }
    return best;
  }
  var SEED_CANDIDATES = 6;
  var LAYOUT_SIMILARITY_MAX = 0.5;
  var GRAVITY = 980;
  var PLAYER_SPEED = 200;
  var JUMP_FORCE = 350;
  var MAX_FALL_SPEED = 600;
  var STOMP_BOUNCE = 260;
  var LANDING_SFX_MIN_FALL = 260;
  var FINAL_LEVEL = 100;
  var HIGH_SCORE_KEY = "platformerHighScore";
  var PAUSE_MENU_ARROWS = { ArrowUp: false, ArrowLeft: false, ArrowDown: true, ArrowRight: true };
  var LOOP_ERROR_RECOVERY_FRAMES = 30;
  var LEVEL_TRANSITION_MAX_STALL_FRAMES = 120;
  var DEATH_SCORE_PENALTY_RATE = 0.25;
  function deathScorePenalty(score) {
    if (!Number.isFinite(score) || score <= 0)
      return 0;
    return Math.floor(score * DEATH_SCORE_PENALTY_RATE);
  }
  var CLEAR_BONUS_BASE = 100;
  var CLEAR_BONUS_TIER_STEP = 10;
  var CLEAR_BONUS_REDUCED_RATE = 0.4;
  var STOMP_POINTS = 25;
  var CHARGER_STOMP_POINTS = 40;
  var DODGE_POINTS = 5;
  var DODGE_MAX_CROSS_STEP = 40;
  function clearBonusFor(deathsOnThisLevel, levelNumber) {
    const base = CLEAR_BONUS_BASE + CLEAR_BONUS_TIER_STEP * tierIndexFor(levelNumber);
    const flawless = deathsOnThisLevel === 0;
    return flawless ? base : Math.floor(base * CLEAR_BONUS_REDUCED_RATE);
  }
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
      loadMutedPreference();
      this.ui.setMuteLabel(isMuted());
      this.audio = exports_audio;
      this.difficulty = new Difficulty;
      this.timer = new Timer(60);
      this.timerActive = false;
      this.sprites = new Sprites;
      this.particles = [];
      this.motes = [];
      this._motesSource = null;
      this.shakeTime = 0;
      this.squashTimer = 0;
      this._prevGrounded = true;
      this._dustTx = -1;
      this._portalUnlocked = false;
      this.state = STATE.MENU;
      this.level = null;
      this.runSeed = 1;
      this.levelSeeds = new Map;
      this.recentLayouts = [];
      this.player = null;
      this.enemyManager = null;
      this.collectibles = null;
      this.hazards = null;
      this.projectiles = null;
      this.movingPlatforms = null;
      this._riding = null;
      this.score = 0;
      this.levelStartScore = 0;
      this.deathsOnCurrentLevel = 0;
      this.levelCoinPoints = 0;
      this.levelCombatPoints = 0;
      this.levelEnemiesKilled = 0;
      this.levelEnemiesDodged = 0;
      this.lastClearBreakdown = null;
      this.currentLevel = 1;
      this.lastTime = 0;
      this.levelCompleteTimer = 0;
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
      shutdown();
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
      const muteBtn = document.getElementById("mute-btn");
      const resumeBtn = document.getElementById("resume-btn");
      const restartLevelBtn = document.getElementById("restart-level-btn");
      const quitMenuBtn = document.getElementById("quit-menu-btn");
      if (!startBtn || !retryBtn || !playAgainBtn || !pauseBtn || !muteBtn || !resumeBtn || !restartLevelBtn || !quitMenuBtn) {
        throw new Error("Game requires #start-btn, #retry-btn, #play-again-btn, " + "#pause-btn, #mute-btn, #resume-btn, #restart-level-btn and " + "#quit-menu-btn elements in the page");
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
      onClick(muteBtn, () => {
        this.toggleSound();
        muteBtn.blur();
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
        const vyBefore = this.player.vy;
        this.player.pressJump();
        if (this.player.vy < vyBefore) {
          playSfx("jump");
          applyJumpBoost(this.player, this._riding);
        }
      });
      this.input.onReleaseJump(() => {
        if (this.state !== STATE.PLAYING || !this.player)
          return;
        this.player.releaseJump();
      });
      const moveIfPlaying = (fn) => () => {
        if (this.state === STATE.PLAYING)
          fn();
      };
      this.input.onMoveLeft(moveIfPlaying(() => this.player?.moveLeft(this.input.isWalk())));
      this.input.onMoveRight(moveIfPlaying(() => this.player?.moveRight(this.input.isWalk())));
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
        } else if (!e.repeat && (code === "KeyM" || code === "m" || code === "M")) {
          this.toggleSound();
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
        this.player?.cancelJumpFeel();
        this.ui.showOverlay("pause-screen");
        this.ui.setPauseLabel(true);
        duckMusic(true);
        this.ui.focusPauseMenu();
      } else if (this.state === STATE.PAUSED) {
        this.setState(STATE.PLAYING);
        this.ui.hideOverlay("pause-screen");
        this.ui.setPauseLabel(false);
        duckMusic(false);
        this.ui.blurPauseControls();
      }
    }
    toggleSound() {
      toggleMute();
      this.ui.setMuteLabel(isMuted());
    }
    returnToMenu() {
      this.setState(STATE.MENU);
      stopMusic();
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
    resetLevelEconomyTrackers() {
      this.deathsOnCurrentLevel = 0;
      this.levelCoinPoints = 0;
      this.levelCombatPoints = 0;
      this.levelEnemiesKilled = 0;
      this.levelEnemiesDodged = 0;
    }
    startGame() {
      this.runSeed = Math.random() * 4294967295 >>> 0;
      this.levelSeeds = new Map;
      this.recentLayouts = [];
      const level = this.tryConstructLevel(1);
      if (!level)
        return false;
      this.score = 0;
      this.currentLevel = 1;
      this.resetLevelEconomyTrackers();
      this.timer.timeRemaining = this.timer.baseTime;
      this.publishLevel(level);
      this.ui.showHUD();
      this.ui.hideOverlay("menu-screen");
      return true;
    }
    seedFor(levelNumber) {
      const stored = this.levelSeeds.get(levelNumber);
      if (stored !== undefined)
        return stored;
      let bestSeed = null, bestSig = null, bestScore = Infinity;
      for (let i = 0;i < SEED_CANDIDATES; i++) {
        const seed = seedCandidate(this.runSeed, levelNumber, i);
        let candidate;
        try {
          candidate = new Level(levelNumber, TILE_SIZE, seed);
        } catch {
          continue;
        }
        const sig = layoutSignature(candidate);
        let worst = 0;
        for (const past of this.recentLayouts) {
          worst = Math.max(worst, layoutSimilarity(sig, past));
          if (worst >= LAYOUT_SIMILARITY_MAX)
            break;
        }
        if (worst < LAYOUT_SIMILARITY_MAX) {
          this.levelSeeds.set(levelNumber, seed);
          this.recentLayouts.push(sig);
          return seed;
        }
        if (worst < bestScore) {
          bestScore = worst;
          bestSeed = seed;
          bestSig = sig;
        }
      }
      if (bestSeed !== null) {
        this.levelSeeds.set(levelNumber, bestSeed);
        this.recentLayouts.push(bestSig);
        return bestSeed;
      }
      return seedCandidate(this.runSeed, levelNumber, 0);
    }
    tryConstructLevel(levelNumber) {
      const seed = this.seedFor(levelNumber);
      try {
        return new Level(levelNumber, TILE_SIZE, seed);
      } catch (first) {
        console.error("Level generation failed; re-attempting once:", first);
      }
      try {
        const rescue = (seed ^ 1542469173) >>> 0;
        const level = new Level(levelNumber, TILE_SIZE, rescue);
        this.levelSeeds.set(levelNumber, rescue);
        this.recentLayouts.push(layoutSignature(level));
        return level;
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
      this.projectiles = level.getProjectileManager();
      this.movingPlatforms = new MovingPlatformManager(level.getMovingPlatforms());
      this._riding = null;
      this.ui.updateCoins(this.collectibles.getCoins().length - this.collectibles.getUncollectedCoins().length, this.collectibles.getCoins().length);
      this._portalUnlocked = this.collectibles.meetsPortalRequirement();
      this.levelStartScore = this.score;
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
      init();
      duckMusic(false);
      startMusic((Math.max(1, this.currentLevel) - 1) % THEMES.length, this.currentLevel);
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
      const clearBonus = clearBonusFor(this.deathsOnCurrentLevel, this.currentLevel);
      this.score = Math.min(this.score + clearBonus, Number.MAX_SAFE_INTEGER);
      this.lastClearBreakdown = {
        coins: this.levelCoinPoints,
        combat: this.levelCombatPoints,
        clearBonus,
        enemiesBested: this.levelEnemiesKilled + this.levelEnemiesDodged,
        deaths: this.deathsOnCurrentLevel,
        flawless: this.deathsOnCurrentLevel === 0
      };
      this.setState(STATE.LEVEL_COMPLETE);
      playSfx("level_complete");
      this.ui.setPauseEnabled(false);
      this.levelCompleteTimer = 2;
      this.levelTransitionStalled = false;
      this.levelTransitionStallFrames = 0;
      this.ui.setLevelCompleteBreakdown(this.lastClearBreakdown);
      this.ui.showOverlay("level-complete-screen");
    }
    handleGameOver(cause) {
      this.setState(STATE.GAME_OVER);
      this.deathsOnCurrentLevel++;
      stopMusic();
      playSfx("death");
      this.shakeTime = 0.35;
      if (this.player) {
        spawnBurst(this.particles, this.player.x + this.player.width / 2, this.player.y + this.player.height / 2, "#ff5a5a", 16);
      }
      this.ui.setPauseEnabled(false);
      const penalty = deathScorePenalty(this.score);
      this.score -= penalty;
      this.ui.showGameOver(this.score, cause, penalty);
    }
    handleGameComplete() {
      this.setState(STATE.GAME_COMPLETE);
      stopMusic();
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
      if (this.motes.length) {
        stepMotes(this.motes, dt, window.innerWidth, window.innerHeight);
      }
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
        if (this.movingPlatforms && this.movingPlatforms.platforms.length) {
          this.movingPlatforms.updateAll(dt);
          const ridden = this._riding;
          if (ridden && ridden.isUnder(this.player))
            ridden.carry(this.player);
        }
        this.player.prevX = this.player.x;
        this.player.prevY = this.player.y;
        const bufferWasPending = this.player.jumpBufferTimer > 0;
        this.player.update(dt, this.input.isLeft(), this.input.isRight(), { walk: this.input.isWalk() });
        if (bufferWasPending && this.player.jumpBufferTimer === 0 && this.player.vy < 0) {
          playSfx("jump");
          applyJumpBoost(this.player, this._riding);
        }
        this.physics.applyGravity(this.player, dt);
        const collisions = this.physics.checkCollisions(this.player, this.level.getPlatforms());
        const vyBeforeResolve = this.player.vy;
        this.physics.resolveCollisions(this.player, collisions);
        if (this.movingPlatforms && this.movingPlatforms.platforms.length) {
          const decks = this.movingPlatforms.oneWayRects(this.player);
          if (decks.length)
            this.physics.resolveYCollision(this.player, decks);
          this._riding = this.movingPlatforms.attachRider(this.player);
        }
        if (this.player.grounded && !this._prevGrounded) {
          this.squashTimer = 0.12;
          if (vyBeforeResolve >= LANDING_SFX_MIN_FALL)
            playSfx("land");
          if (!this.input.isLeft() && !this.input.isRight()) {
            this.player.vx = 0;
          }
        }
        this._prevGrounded = this.player.grounded;
        if (this.player.grounded && Math.abs(this.player.vx) > 120) {
          const footTx = Math.floor((this.player.x + this.player.width / 2) / this.level.tileSize);
          if (footTx !== this._dustTx) {
            this._dustTx = footTx;
            const dir = this.player.vx > 0 ? -1 : 1;
            const themeIdx = (Math.max(1, this.currentLevel) - 1) % THEMES.length;
            this.particles.push({
              x: this.player.x + this.player.width / 2 - dir * 10,
              y: this.player.y + this.player.height - 2,
              vx: dir * (30 + (footTx & 3) * 8),
              vy: -(20 + (footTx & 1) * 14),
              life: 0.28,
              maxLife: 0.28,
              size: 2 + (footTx & 1),
              color: THEMES[themeIdx].dust
            });
            if (this.particles.length > MAX_PARTICLES)
              this.particles.shift();
          }
        } else {
          this._dustTx = -1;
        }
        this.enemyManager.updateAll(dt, this.player);
        const contact = this.enemyManager.resolvePlayerContact(this.player);
        if (contact.stomped > 0) {
          playSfx("stomp");
          this.player.vy = -STOMP_BOUNCE;
          this.player.coyoteTimer = 0;
          this.player.jumpCutAvailable = false;
          spawnBurst(this.particles, this.player.x + this.player.width / 2, this.player.y + this.player.height, "#c96bf5", 10);
          let stompPoints = 0;
          for (const killed of contact.stompedEnemies) {
            stompPoints += killed.kind === "charger" || killed.kind === "bombardier" ? CHARGER_STOMP_POINTS : STOMP_POINTS;
          }
          this.levelCombatPoints += stompPoints;
          this.levelEnemiesKilled += contact.stompedEnemies.length;
          this.score = Math.min(this.score + stompPoints, Number.MAX_SAFE_INTEGER);
        }
        if (contact.deadly) {
          this.handleGameOver(contact.deadlyBySpiny ? "spiny" : "enemy");
          return;
        }
        const shots = this.projectiles.updateAll(dt, this.player);
        if (shots.fired > 0)
          playSfx("bombard_fire");
        for (const impact of shots.impacts) {
          spawnBurst(this.particles, impact.x, impact.y, "#b9a58a", 6);
        }
        if (shots.hitPlayer) {
          this.handleGameOver("projectile");
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
        for (const enemy of this.enemyManager.enemies) {
          if (enemy.isDead())
            continue;
          const px = this.player.x + this.player.width / 2;
          const side = Math.sign(px - (enemy.x + enemy.width / 2));
          if (side === 0)
            continue;
          if (enemy._dodgePrevSide !== 0 && side !== enemy._dodgePrevSide && !enemy.dodged && Math.abs(px - enemy._dodgePrevPx) <= DODGE_MAX_CROSS_STEP) {
            enemy.dodged = true;
            this.levelCombatPoints += DODGE_POINTS;
            this.levelEnemiesDodged++;
            this.score = Math.min(this.score + DODGE_POINTS, Number.MAX_SAFE_INTEGER);
          }
          enemy._dodgePrevSide = side;
          enemy._dodgePrevPx = px;
        }
        const collectedCoins = this.collectibles.checkCollection(this.player);
        if (collectedCoins > 0) {
          playSfx("coin");
          spawnBurst(this.particles, this.player.x + this.player.width / 2, this.player.y + this.player.height / 2, "#ffd23f", 12);
          this.score = Math.min(this.score + collectedCoins * COIN_POINTS, Number.MAX_SAFE_INTEGER);
          this.levelCoinPoints += collectedCoins * COIN_POINTS;
          for (let i = 0;i < collectedCoins; i++)
            this.timer.addCoinBonus();
          this.ui.updateCoins(this.collectibles.getCoins().length - this.collectibles.getUncollectedCoins().length, this.collectibles.getCoins().length);
        }
        if (!this._portalUnlocked && this.collectibles.meetsPortalRequirement()) {
          this._portalUnlocked = true;
          playSfx("portal_unlock");
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
              this.resetLevelEconomyTrackers();
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
        if (this.movingPlatforms && this.movingPlatforms.platforms.length) {
          this.sprites.drawMovingPlatforms(this.ctx, this.movingPlatforms.platforms, this.currentLevel);
        }
        if (sprites)
          sprites.drawMoodTint(this.ctx, this.currentLevel, this.camera.x, this.camera.y, effW, effH);
        this.level.draw(this.ctx, sprites);
        if (this.projectiles && this.projectiles.list.length) {
          this.projectiles.drawAll(this.ctx);
        }
        const squash = this.squashTimer > 0 ? 1 - 0.25 * (this.squashTimer / 0.12) : 1;
        this.player.draw(this.ctx, sprites, squash);
        if (this.particles.length)
          drawParticles(this.ctx, this.particles);
        this.ctx.restore();
        if (this._motesSource !== this.level) {
          this._motesSource = this.level;
          this.motes = createMotes(MOTE_COUNT, Math.imul(this.currentLevel, 2654435761) >>> 0, viewW, viewH);
        }
        if (this.motes.length) {
          const amb = THEMES[(Math.max(1, this.currentLevel) - 1) % THEMES.length];
          drawMotes(this.ctx, this.motes, this.camera.x, viewW, amb.mote, amb.fireflies);
        }
        if (sprites) {
          sprites.drawForeground(this.ctx, this.currentLevel, this.camera.x, viewW, viewH);
          sprites.drawVignette(this.ctx, this.currentLevel, viewW, viewH);
        }
        if (this.level && this.level.seed !== null) {
          const label = `L${this.currentLevel} seed ${this.level.seed}`;
          this.ctx.font = "bold 12px monospace";
          this.ctx.textAlign = "right";
          const tw = this.ctx.measureText(label).width;
          const padX = 6, padY = 4;
          const x1 = viewW - 8, baseline = viewH - 8;
          this.ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
          this.ctx.fillRect(x1 - tw - padX, baseline - 10, tw + padX * 2, 10 + padY);
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
          this.ctx.fillText(label, x1, baseline);
          this.ctx.textAlign = "left";
        }
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
  function init2() {
    const game = new Game;
    if (typeof window !== "undefined") {
      window.game = game;
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      init2();
    });
  }
})();
