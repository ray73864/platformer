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
    DEATH_SCORE_PENALTY_RATE: () => DEATH_SCORE_PENALTY_RATE,
    FINAL_LEVEL: () => FINAL_LEVEL,
    Game: () => Game,
    STATE: () => STATE,
    TILE_SIZE: () => TILE_SIZE,
    computeZoom: () => computeZoom,
    deathScorePenalty: () => deathScorePenalty,
    destroyAllGames: () => destroyAllGames,
    init: () => init2
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
  function configFor(levelNumber) {
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
      console.warn("Invalid level number for difficulty scaling:", levelNumber, "- defaulting to basic tier");
      return LEVEL_CONFIGS.basic;
    }
    if (levelNumber >= 75)
      return LEVEL_CONFIGS.legend;
    if (levelNumber >= 50)
      return LEVEL_CONFIGS.master;
    if (levelNumber >= 25)
      return LEVEL_CONFIGS.expert;
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
  var CHARGER_WINDUP_TIME = 0.45;
  var CHARGER_DASH_TIME = 1.2;
  var CHARGER_COOLDOWN_TIME = 1;
  var CHARGER_DASH_SPEED_MULT = 2.2;
  var CHARGER_TRIGGER_COLS = 6;
  var CHARGER_TRIGGER_ROW_TOLERANCE = 32;
  class Enemy {
    constructor(x, y, minX, maxX, kind = "walker") {
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
    }
    update(dt, player = null) {
      if (this.dead)
        return;
      if (this.kind === "charger") {
        this._updateCharger(dt, player);
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
            this.state = "windup";
            this.stateTime = 0;
            this._preWindupVx = this.vx;
            this.vx = 0;
          }
          break;
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
      ctx.fillStyle = body;
      ctx.fillRect(this.x, this.y, this.width, this.height);
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
      }
      ctx.fillStyle = "#fff";
      const eyeFace = this.state === "windup" ? Math.sign(this._preWindupVx || 1) : this.vx >= 0 ? 1 : -1;
      const eyeOffset = eyeFace >= 0 ? 18 : 6;
      ctx.fillRect(this.x + eyeOffset, this.y + 8, 4, 4);
    }
  }

  class EnemyManager {
    constructor() {
      this.enemies = [];
    }
    addEnemy(x, y, minX, maxX, kind = "walker") {
      this.enemies.push(new Enemy(x, y, minX, maxX, kind));
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
        } else {
          deadly = true;
        }
      }
      return { stomped, deadly, deadlyBySpiny };
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
  var SPINY_CAP_DIVISOR = 3;
  var HOSTILE_MIN_RUN = 4;
  var MOVING_PLATFORM_FIRST_LEVEL = 8;
  var MAX_MOVING_PLATFORMS = 2;
  var MP_ACCEPT_CHANCE = 0.9;
  var MP_GAP_MIN_WIDTH = 3;
  var MP_GAP_MAX_WIDTH = 6;
  var MP_DECK_TILES = 2;
  var MP_CLEARANCE_ROWS = 3;
  var MP_SPEED_MIN = 26;
  var MP_SPEED_RANGE = 18;
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
    }
    return reachable;
  }
  class Level {
    constructor(levelNumber, tileSize, seed) {
      this.levelNumber = levelNumber;
      this.tileSize = tileSize;
      this.rng = makeRng(seed === undefined ? Math.random() * 4294967295 >>> 0 : seed >>> 0);
      this.seed = seed === undefined ? null : seed >>> 0;
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
          valid = this.deriveEnemySpawns().length > 0 && (this.direction === "vertical" || this.countTilesOfType(2) > 0);
        }
        attempt++;
      }
      this.generationAttempts = attempt;
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
        let step = this.rng() < 0.15 ? 2 : 1;
        let c = x + dir * step;
        if (c < 1 || c > w - 2) {
          dir = -dir;
          step = 1;
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
      const gapChance = isPhase2 ? Math.min(0.22 + 0.02 * (this.levelNumber - 4), GAP_CHANCE_CAP) : 0.18 + 0.04 * this.levelNumber;
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
          if (tiles[y][nx] === 1 || tiles[y - 1][nx] === 1)
            return true;
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
    isMarkerSite(tiles, x, y, reachable, opts = {}) {
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
      const minSpan = opts.allowRouteAdjacent ? 1 : 2;
      return Math.min(span.right, bandMax) - Math.max(span.left, bandMin) + 1 >= minSpan;
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
      let placed = 0;
      for (const c of candidates) {
        if (placed >= target)
          break;
        tiles[c.y][c.x] = 4;
        placed++;
      }
      if (placed === 0 && this.pathCells) {
        candidates = collectSites(true);
        shuffle(candidates, this.rng);
        for (const c of candidates) {
          if (placed >= Math.min(target, 1))
            break;
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
      const spawns = this.deriveEnemySpawns();
      const spinyChance = kindChance(this.levelNumber, SPINY_FIRST_LEVEL, SPINY_RAMP_LEVELS, SPINY_CHANCE_MAX);
      const chargerChance = kindChance(this.levelNumber, CHARGER_FIRST_LEVEL, CHARGER_RAMP_LEVELS, CHARGER_CHANCE_MAX);
      const spinyCap = Math.ceil(spawns.length / SPINY_CAP_DIVISOR);
      let spinies = 0;
      for (const s of spawns) {
        let kind = "walker";
        const roll = this.rng();
        if (roll < spinyChance && spinies < spinyCap) {
          kind = "spiny";
        } else if (roll >= spinyChance && roll < spinyChance + chargerChance) {
          kind = "charger";
        }
        if (kind !== "walker" && solidRunWidth(this.tiles, this.width, s.x, s.y + 1) < HOSTILE_MIN_RUN) {
          kind = "walker";
        }
        if (kind === "spiny")
          spinies++;
        this.enemyManager.addEnemy(s.x * this.tileSize, s.y * this.tileSize, s.left * this.tileSize, (s.right + 1) * this.tileSize, kind);
      }
    }
    columnTopRow(x) {
      for (let y = 0;y < this.height; y++) {
        if (this.tiles[y][x] === 1)
          return y;
      }
      return null;
    }
    deriveMovingPlatforms() {
      const out = [];
      if (this.levelNumber < MOVING_PLATFORM_FIRST_LEVEL)
        return out;
      if (this.direction === "vertical")
        return out;
      const T = this.tileSize;
      const candidates = [];
      let x = 1;
      while (x < this.width - 1) {
        if (this.columnTopRow(x) !== null) {
          x++;
          continue;
        }
        const a = x;
        while (x < this.width - 1 && this.columnTopRow(x) === null)
          x++;
        const b = x - 1;
        const w = b - a + 1;
        if (w < MP_GAP_MIN_WIDTH || w > MP_GAP_MAX_WIDTH)
          continue;
        const leftTop = this.columnTopRow(a - 1);
        const rightTop = this.columnTopRow(b + 1);
        if (leftTop === null || rightTop === null)
          continue;
        if (Math.abs(leftTop - rightTop) > 1)
          continue;
        const S = Math.max(leftTop, rightTop);
        if (this.movingDeckLegal(a, b, S))
          candidates.push({ a, b, S });
      }
      shuffle(candidates, this.rng);
      for (const c of candidates) {
        const roll = this.rng();
        if (out.length >= MAX_MOVING_PLATFORMS)
          continue;
        if (roll >= MP_ACCEPT_CHANCE)
          continue;
        const speed = MP_SPEED_MIN + this.rng() * MP_SPEED_RANGE;
        const phase = this.rng();
        out.push({
          x: c.a * T,
          y: c.S * T,
          width: MP_DECK_TILES * T,
          height: T,
          axis: "h",
          min: c.a * T,
          max: (c.b + 1) * T - MP_DECK_TILES * T,
          speed,
          phase,
          vx: 0,
          vy: 0
        });
      }
      return out;
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
      pit: "Fell into the void"
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
    PLAYER_IDLE: 9,
    PLAYER_RUN: 10,
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
        const sp = Math.min(1, Math.abs(p.vx) / 30);
        if (sp > 0.05) {
          const dir = p.vx > 0 ? 1 : -1;
          const bx0 = dir > 0 ? p.x + p.width - 26 : p.x + 20;
          ctx.fillStyle = `rgba(255,255,255,${(0.16 + 0.3 * sp).toFixed(3)})`;
          for (let i = 0;i < 2; i++) {
            const bx = bx0 + i * 6 * dir;
            ctx.beginPath();
            ctx.moveTo(bx, p.y + 4);
            ctx.lineTo(bx + 4 * dir, p.y + H / 2 - 1);
            ctx.lineTo(bx, p.y + H - 4);
            ctx.fill();
          }
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
      this._entityShadow(ctx, cx, player.y + player.height, 16);
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
      const kind = enemy.kind || "walker";
      if (kind === "spiny") {
        this._drawSpiny(ctx, enemy);
        return;
      }
      if (kind === "charger") {
        this._drawCharger(ctx, enemy);
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
      this.vx = 0;
      this.vy = 0;
      this.dx = 0;
      this.dy = 0;
      this.elapsed = 0;
      const p0 = this.positionAt(0);
      this.x = this.axis === "v" ? desc.x : p0;
      if (this.axis === "v")
        this.y = p0;
    }
    positionAt(t) {
      const span = this.max - this.min;
      if (!(span > 0))
        return this.min;
      const u = (t * this.speed / span + this.phase * 2) % 2;
      const f = u <= 1 ? u : 2 - u;
      return this.min + f * span;
    }
    update(dt) {
      this.elapsed += dt;
      const pos = this.positionAt(this.elapsed);
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
        if (player.vy < p.vy - VY_EPSILON)
          continue;
        if (player.prevY !== undefined && player.prevY + player.height > p.y + LAND_TOLERANCE) {
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
      this.player = null;
      this.enemyManager = null;
      this.collectibles = null;
      this.hazards = null;
      this.movingPlatforms = null;
      this._riding = null;
      this.score = 0;
      this.levelStartScore = 0;
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
        return new Level(levelNumber, TILE_SIZE, (this.seedFor(levelNumber) ^ 1542469173) >>> 0);
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
      this.setState(STATE.LEVEL_COMPLETE);
      playSfx("level_complete");
      this.ui.setPauseEnabled(false);
      this.levelCompleteTimer = 2;
      this.levelTransitionStalled = false;
      this.levelTransitionStallFrames = 0;
      this.ui.showOverlay("level-complete-screen");
    }
    handleGameOver(cause) {
      this.setState(STATE.GAME_OVER);
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
          this._riding = this.movingPlatforms.supportUnder(this.player);
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
        }
        if (contact.deadly) {
          this.handleGameOver(contact.deadlyBySpiny ? "spiny" : "enemy");
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
          playSfx("coin");
          spawnBurst(this.particles, this.player.x + this.player.width / 2, this.player.y + this.player.height / 2, "#ffd23f", 12);
          this.score = Math.min(this.score + collectedCoins * COIN_POINTS, Number.MAX_SAFE_INTEGER);
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
          this.ctx.font = "10px monospace";
          this.ctx.textAlign = "right";
          this.ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
          this.ctx.fillText(`L${this.currentLevel} seed ${this.level.seed}`, viewW - 8, viewH - 8);
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
