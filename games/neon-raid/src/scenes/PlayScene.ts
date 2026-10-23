/**
 * Play：主游戏循环（03 文档 §1/§2）。
 * 波次导演（数据驱动）+ 手动 AABB 碰撞 + 对象池 + 连击计分 + 拾取 + 帧率自适应。
 */
import Phaser from 'phaser'
import { W, H, PLAYER_X, PLAYER, ENEMIES, ELITES, SCORE, GAME, LEVELS } from '../core/constants.ts'
import type { RunState } from '../core/run.ts'
import { addScore, isInvincible } from '../core/run.ts'
import { sweptBulletHits } from '../systems/collide.ts'
import { Rng } from '../core/rng.ts'
import { Combo } from '../systems/combo.ts'
import { WaveDirector } from '../systems/waves.ts'
import { makePlayerBank, makeEnemyBank } from '../entities/bullets.ts'
import { makeUnit, aabb, EliteUnit, type Unit } from '../entities/enemies.ts'
import { PickupPool, PICKUP_KEYS } from '../entities/pickups.ts'
import { audio } from '../audio/synth.ts'
import { loadSettings, saveSettings, type Settings } from '../core/settings.ts'
import { sendTrack, getJwt } from '../platform/bridge.ts'

export class PlayScene extends Phaser.Scene {
  private run!: RunState
  private seed = 1
  private rng!: Rng
  private combo = new Combo()

  private player!: Phaser.GameObjects.Image
  private pBullets!: ReturnType<typeof makePlayerBank>
  private eBullets!: ReturnType<typeof makeEnemyBank>
  private pickups!: PickupPool
  private director!: WaveDirector
  private units: Unit[] = []

  private hud!: { score: Phaser.GameObjects.Text; combo: Phaser.GameObjects.Text; wave: Phaser.GameObjects.Text; timeBar: Phaser.GameObjects.Graphics; hint: Phaser.GameObjects.Text }
  private warnText!: Phaser.GameObjects.Text
  private mouseOn = false
  private pauseLayer!: Phaser.GameObjects.Container

  private fireCdMs = 0
  private paused = false
  private over = false
  private tMs = 0
  private qualityLow = false
  private fpsWindow: { t: number }[] = []
  private fpsAccMs = 0
  private fpsFrames = 0
  private lightningAtMs = 0
  private lightningUntilMs = 0
  private settings!: Settings
  private level!: number

  // 输入
  private kb: Phaser.Input.Keyboard.Key[] = []
  private touchAnchorY = 0
  private touchActive = false

  constructor() {
    super('play')
  }

  init(data: { run: RunState; seed: number }): void {
    this.run = data.run
    this.seed = data.seed
    this.level = this.run.levelIdx + 1
  }

  create(): void {
    this.settings = loadSettings()
    this.rng = new Rng(this.seed + this.level * 97)
    this.combo = new Combo()
    this.paused = false
    this.over = false
    this.tMs = 0
    this.units.length = 0 // 防御：场景复用（手动重开）时清掉上一局的单位
    this.qualityLow = false
    this.fpsWindow = []
    this.fpsAccMs = 0
    this.fpsFrames = 0
    this.lightningAtMs = 4000
    this.lightningUntilMs = 0

    // 背景（双层视差）
    const bg1 = this.add.image(W / 2, H / 2, 'bg1').setAlpha(0.6)
    const bg2 = this.add.image(W / 2, H / 2, 'bg2').setAlpha(0.8)

    // 玩家
    this.player = this.add.image(PLAYER_X, H / 2, 'player')
    this.pBullets = makePlayerBank(this)
    this.eBullets = makeEnemyBank(this)
    this.pickups = new PickupPool(this, 4)

    // 波次导演（数据驱动）
    const lvl = LEVELS[this.level - 1]
    this.director = new WaveDirector(lvl, this.rng, {
      onWaveClear: (idx) => {
        addScore(this.run, SCORE.waveClear, this.combo.multiplier())
        this.run.wavesCleared++
        audio.sfx('pickup')
        this.flashHud('WAVE CLEAR +' + Math.round(SCORE.waveClear * this.combo.multiplier()))
      },
      onEliteSpawn: () => {
        this.warnText.setVisible(true)
        audio.sfx('warn')
      },
      onLevelCleared: () => this.levelCleared(),
    }, H)
    this.warnText = this.add.text(W / 2, H / 2 - 60, '!! WARNING !!', {
      font: 'bold 34px Arial', color: '#ff2d95',
    }).setOrigin(0.5).setVisible(false)
    this.tweens.add({ targets: this.warnText, alpha: 0.4, duration: 400, yoyo: true, repeat: -1 })

    // HUD
    const scoreT = this.add.text(16, 12, 'SCORE 0', { fontFamily: 'Arial', font: 'bold 20px Arial', color: '#eafcff' })
    const comboT = this.add.text(16, 40, '', { fontFamily: 'Arial', fontSize: '16px', color: '#ffd23d' })
    const waveT = this.add.text(W - 16, 12, '', { fontFamily: 'Arial', fontSize: '16px', color: '#7fd7ff' }).setOrigin(1, 0)
    const timeBar = this.add.graphics()
    const hint = this.add.text(W - 16, 36, this.level === 2 && this.settings.shake ? '⚡ 静电干扰中' : '', {
      fontFamily: 'Arial', fontSize: '14px', color: '#b26bff',
    }).setOrigin(1, 0)
    this.hud = { score: scoreT, combo: comboT, wave: waveT, timeBar, hint }

    this.add.text(16, H - 30, '[P/Esc] 暂停    [W/S 或 鼠标] 移动    自动开火', {
      fontFamily: 'Arial', fontSize: '12px', color: '#3a5a86',
    })

    // 暂停层
    this.pauseLayer = this.add.container(0, 0)
    const pbg = this.add.rectangle(W / 2, H / 2, W, H, 0x02040c, 0.72)
    const ptext = this.add.text(W / 2, H / 2, 'PAUSED\n[P/Esc] 继续', {
      fontFamily: 'Arial', fontSize: '30px', color: '#eafcff', align: 'center', lineSpacing: 14,
    }).setOrigin(0.5)
    this.pauseLayer.add([pbg, ptext]).setVisible(false)

    // 输入
    const kb = this.input.keyboard!
    this.kb = [
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
    ]
    kb.on('keydown-P', () => this.togglePause())
    kb.on('keydown-ESC', () => this.togglePause())

    // 触控/鼠标
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.x < W / 2) {
        this.touchActive = true
        this.touchAnchorY = p.y
      }
    })
    this.input.on('pointerup', () => {
      this.touchActive = false
    })
    this.input.on('pointerover', () => { this.mouseOn = true })
    this.input.on('pointerout', () => { this.mouseOn = false })

    // 背景视差（闭包引用）
    this.tweens.add({ targets: bg1, x: bg1.x - W, duration: 40_000, repeat: -1, ease: 'Linear' })
    this.tweens.add({ targets: bg2, x: bg2.x - W, duration: 14_000, repeat: -1, ease: 'Linear' })
    // 双宽度拼贴：第二份背景补右半
    const bg1b = this.add.image(W / 2 + W, H / 2, 'bg1').setAlpha(0.6)
    const bg2b = this.add.image(W / 2 + W, H / 2, 'bg2').setAlpha(0.8)
    this.tweens.add({ targets: bg1b, x: bg1b.x - W, duration: 40_000, repeat: -1, ease: 'Linear' })
    this.tweens.add({ targets: bg2b, x: bg2b.x - W, duration: 14_000, repeat: -1, ease: 'Linear' })
    bg1b.setScrollFactor(0); bg2b.setScrollFactor(0); bg1.setScrollFactor(0); bg2.setScrollFactor(0)
  }

  // ---------- 主循环 ----------

  update(time: number, dtMs: number): void {
    if (this.paused || this.over) return
    const dt = Math.min(dtMs, 50) // 防跳帧爆炸
    this.tMs += dt
    this.run.playMs += dt
    this.fpsFrames++
    this.fpsAccMs += dt
    if (this.fpsAccMs >= GAME.fpsSampleMs) {
      const avg = (this.fpsFrames * 1000) / this.fpsAccMs
      this.qualityLow = this.qualityLow || avg < GAME.fpsLowThreshold
      this.fpsAccMs = 0
      this.fpsFrames = 0
      if (this.qualityLow) {
        this.hud.hint.setText(this.hud.hint.text + '  [画质:LOW]')
      }
    }

    this.updatePlayer(dt)
    this.updateAutoFire(dt)

    // 波次导演 → 出场
    const spawnCmds = this.director.update(dt, this.units.length)
    for (const c of spawnCmds) {
      const u = makeUnit(this, c.kind, W + 30, c.y, this.level, () => this.rng.next())
      this.units.push(u)
    }

    // 实体更新（精英阶段切换 → 每阶段 1000 分；齐射入池）
    const ctx = {
      tMs: this.tMs,
      speedScale: LEVELS[this.level - 1].difficulty.enemySpeed,
      bulletSpeedScale: LEVELS[this.level - 1].difficulty.bulletSpeed,
      playerX: PLAYER_X,
      playerY: this.player.y,
      emit: (angle: number, speed: number, x?: number, y?: number) => {
        this.eBullets.spawn(x ?? W - 20, y ?? this.player.y, Math.cos(angle) * speed, Math.sin(angle) * speed)
      },
    }
    for (const u of this.units) {
      const shots = u.update(dt, ctx)
      if (u.kind === 'elite-warden' || u.kind === 'elite-guardian') {
        const elite = u as unknown as EliteUnit
        const ph = elite.phase
        const st = u as unknown as { _seenPhase?: number }
        if (st._seenPhase === undefined) {
          st._seenPhase = ph
        } else if (ph > st._seenPhase) {
          st._seenPhase = ph
          addScore(this.run, ELITES[elite.def.key].phaseScore, this.combo.multiplier())
          audio.sfx('warn')
          this.flashHud(`PHASE ${ph + 1}`)
        }
        if (shots) {
          for (const shot of shots) {
            this.eBullets.spawn(u.x, u.y, Math.cos(shot.angle) * shot.speed, Math.sin(shot.angle) * shot.speed)
          }
        }
      }
    }
    // 出屏清理
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].x < -60 || !this.units[i].alive) this.units.splice(i, 1)
    }

    this.pBullets.update(dt, W, H)
    this.eBullets.update(dt, W, H)
    this.pickups.update(dt, this.tMs)

    this.collide()
    this.combo.expire(this.tMs)

    // 闪电干扰（关 2；视觉 + 轻微输入抖动，可关）
    if (this.level === 2) {
      if (this.tMs > this.lightningAtMs && this.tMs > this.lightningUntilMs) {
        this.lightningAtMs = this.tMs + this.rng.range(4000, 9000)
        this.lightningUntilMs = this.tMs + 320
        audio.sfx('warn')
        this.cameras.main.flash(80, 180, 130, 255)
      }
    }

    // HUD
    this.hud.score.setText(`SCORE ${this.run.score}`)
    this.hud.combo.setText(this.combo.n > 1 ? `COMBO ×${this.combo.n}  (+${Math.round((this.combo.multiplier() - 1) * 100)}%)` : '')
    const lvl = LEVELS[this.level - 1]
    const waveNo = Math.min(this.director.waveIdx + 1, lvl.waves.length)
    const phase = this.director.state === 'elite' ? 'ELITE' : `${waveNo}/${lvl.waves.length}`
    this.hud.wave.setText(`${lvl.name}  ${phase}`)
    const remainMs = Math.max(0, lvl.timeLimitMs - this.tMs)
    this.hud.timeBar.clear()
    const ratio = remainMs / lvl.timeLimitMs
    this.hud.timeBar.fillStyle(remainMs < 30_000 ? 0xff2d95 : 0x12f0ff, 1)
    this.hud.timeBar.fillRect(0, H - 6, W * ratio, 6)
    if (remainMs <= 0 && !this.director.eliteIncoming && this.director.state !== 'cleared') {
      this.endRun(false) // 时限到 → 结束
    }
  }

  // ---------- 玩家 ----------

  private updatePlayer(dt: number): void {
    const speed = PLAYER.speed
    let dy = 0
    if (Phaser.Input.Keyboard.JustDown(this.kb[0]) || this.kb[0].isDown || this.kb[1].isDown) dy -= 1
    if (this.kb[2].isDown || this.kb[3].isDown) dy += 1
    if (this.touchActive) {
      const p = this.input.activePointer
      const delta = (p.y - this.touchAnchorY) / 40
      dy += Phaser.Math.Clamp(delta, -1, 1)
    } else if (this.mouseOn && !this.isTouch()) {
      // 鼠标 Y 跟随（松开吸附）
      const targetY = this.input.activePointer.y
      this.player.y = Phaser.Math.Linear(this.player.y, targetY, 0.25)
    }
    this.player.y = Phaser.Math.Clamp(this.player.y + dy * speed * (dt / 1000), 20, H - 20)
    // 静电风暴：轻微输入抖动（可关）
    if (this.level === 2 && this.settings.shake && this.tMs < this.lightningUntilMs) {
      this.player.y += (this.rng.next() - 0.5) * 6
    }
  }

  private isTouch(): boolean {
    return 'ontouchstart' in window && window.matchMedia('(pointer: coarse)').matches
  }

  private updateAutoFire(dt: number): void {
    this.fireCdMs -= dt
    if (this.fireCdMs > 0) return
    const now = this.tMs
    const stacks = now < this.run.doubleShotUntilMs ? this.run.doubleShotStacks : 0
    const n = 1 + Math.min(stacks, GAME.maxDoubleShotStacks)
    this.fireCdMs = PLAYER.fireIntervalMs
    const offsets = n === 1 ? [0] : n === 2 ? [-6, 6] : n === 3 ? [-12, 0, 12] : [-15, -5, 5, 15]
    for (const off of offsets) {
      this.pBullets.spawn(this.player.x + 22, this.player.y + off, PLAYER.bulletSpeed, 0)
    }
    audio.sfx('shoot')
  }

  // ---------- 碰撞 ----------

  /** 扫掠 AABB：同时检查子弹上一帧位置（见 systems/collide.ts） */
  private bulletHitsUnit(b: { x: number; y: number; px: number; py: number }, w: number, h: number, u: { x: number; y: number; w: number; h: number }): boolean {
    return sweptBulletHits(b, w, h, u)
  }

  private collide(): void {
    const px = this.player.x
    const py = this.player.y
    const invincible = isInvincible(this.run, this.tMs)

    // 玩家子弹 vs 敌机
    for (const b of [...this.pBullets.activeBullets]) {
      for (const u of this.units) {
        if (!u.alive) continue
        if (this.bulletHitsUnit(b, 14, 5, u)) {
          this.pBullets.kill(b)
          const dead = u.onHit(1)
          this.spawnHitSpark(b.x, b.y)
          if (dead) this.killUnit(u)
          break
        }
      }
      if (!b.alive) continue
    }

    if (!invincible) {
      // 敌方子弹 vs 玩家
      for (const b of [...this.eBullets.activeBullets]) {
        if (this.bulletHitsUnit(b, 12, 12, { x: px, y: py, w: PLAYER.w, h: PLAYER.h })) {
          this.eBullets.kill(b)
          this.damagePlayer()
          break
        }
      }
      // 敌机接触 vs 玩家
      if (!this.over) {
        for (const u of this.units) {
          if (u.alive && aabb(u.x, u.y, u.w, u.h, px, py, PLAYER.w, PLAYER.h)) {
            this.damagePlayer()
            break
          }
        }
      }
    }

    // 玩家 vs 拾取
    for (const p of [...this.pickups.live]) {
      if (p.alive && aabb(p.x, p.y, p.w, p.h, px, py, PLAYER.w + 12, PLAYER.h + 12)) {
        p.kill()
        this.applyPickup(p.key)
      }
    }
  }

  private applyPickup(key: 'P' | 'S' | 'B'): void {
    audio.sfx('pickup')
    if (key === 'P') {
      this.run.doubleShotStacks = Math.min(GAME.maxDoubleShotStacks, this.run.doubleShotStacks + 1)
      this.run.doubleShotUntilMs = this.tMs + GAME.doubleShotDurationMs
      this.flashHud('DOUBLE SHOT ×' + this.run.doubleShotStacks)
    } else if (key === 'S') {
      this.run.shield = true
      this.run.invincibleUntilMs = this.tMs + 2000 // 2s 无敌闪烁
      audio.sfx('shield')
      this.flashHud('SHIELD')
    } else {
      // B 清屏：全屏 AOE（对精英 1/3 血）
      audio.sfx('boom')
      this.cameras.main.shake(300, 0.012)
      this.spawnAoRing()
      for (const u of [...this.units]) {
        if (u.kind.startsWith('elite-')) {
          if (u.onHit(Math.ceil(u.maxHp * GAME.aoeEliteRatio))) this.killUnit(u)
        } else {
          this.killUnit(u)
        }
      }
    }
  }

  private damagePlayer(): void {
    if (this.run.shield) {
      this.run.shield = false
      this.run.invincibleUntilMs = this.tMs + 2000
      audio.sfx('shield')
      this.cameras.main.shake(200, 0.008)
      return
    }
    this.combo.hit()
    this.run.died = true
    audio.sfx('hit')
    audio.sfx('explodeBig')
    this.spawnExplosion(this.player.x, this.player.y, true)
    this.cameras.main.shake(500, 0.02)
    this.over = true
    this.time.delayedCall(900, () => this.endRun(true))
  }

  private killUnit(u: Unit): void {
    if (!u.alive) return
    const isElite = u.kind.startsWith('elite-')
    // 精英阶段分
    if (isElite) {
      const def = u.kind === 'elite-warden' ? ELITES.warden : ELITES.guardian
      addScore(this.run, def.killScore, this.combo.multiplier()) // 全灭 5000（阶段分在 update 里按切换给）
      this.run.elitesKilled++
      audio.sfx('explodeBig')
      this.spawnExplosion(u.x, u.y, true)
      if (this.settings.shake) this.cameras.main.shake(300, 0.01)
      // 100% 掉落单件拾取（03 §1.1）
      this.pickups.spawn(this.rng.pick(PICKUP_KEYS), u.x, u.y)
    } else {
      const def = ENEMIES[u.kind as 'grunt' | 'diver' | 'bomber']
      addScore(this.run, def.score, this.combo.multiplier())
      audio.sfx('explode')
      this.spawnExplosion(u.x, u.y, false)
    }
    const n = this.combo.kill(this.tMs)
    if (n > this.run.bestCombo) this.run.bestCombo = n
    u.destroy()
    u.alive = false
  }

  // ---------- 关卡/局 ----------

  private levelCleared(): void {
    // 剩余时间奖励（03 §1.2：每秒 50）
    const lvl = LEVELS[this.level - 1]
    const remainSec = Math.max(0, Math.floor((lvl.timeLimitMs - this.tMs) / 1000))
    addScore(this.run, remainSec * SCORE.timeBonusPerSec, 1)
    this.run.levelsCleared++
    // 解锁进度
    const s = loadSettings()
    s.unlockedLevel = Math.max(s.unlockedLevel, Math.min(3, this.level + 1))
    saveSettings(s)
    this.flashHud(`LEVEL CLEAR  时间奖励 +${remainSec * SCORE.timeBonusPerSec}`)
    this.warnText.setVisible(false)
    if (this.level < 3) {
      this.run.levelIdx++
      this.time.delayedCall(1400, () => {
        this.scene.start('play', { run: this.run, seed: this.seed })
        audio.startBgm(this.run.levelIdx)
      })
    } else {
      this.time.delayedCall(1200, () => this.endRun(false))
    }
    // 清空残余
    for (const u of this.units) u.destroy()
    this.units.length = 0
    this.pBullets.clear()
    this.eBullets.clear()
    this.pickups.clear()
  }

  private endRun(died: boolean): void {
    if (this.over && !died) return
    this.over = true
    audio.stopBgm()
    sendTrack('end', this.run.playMs)
    const s = loadSettings()
    s.bestScore = Math.max(s.bestScore, this.run.score)
    saveSettings(s)
    this.scene.start('result', { run: this.run, seed: this.seed, died })
  }

  private togglePause(): void {
    if (this.over) return
    this.paused = !this.paused
    this.pauseLayer.setVisible(this.paused)
    if (this.paused) audio.stopBgm()
    else audio.startBgm(this.run.levelIdx)
  }

  // ---------- 视觉 ----------

  private flashMsg?: Phaser.GameObjects.Text
  private flashHud(msg: string): void {
    this.flashMsg?.destroy()
    this.flashMsg = this.add.text(W / 2, 90, msg, {
      font: 'bold 24px Arial', color: '#3dff8f',
    }).setOrigin(0.5)
    this.tweens.add({ targets: this.flashMsg, alpha: 0, y: '+=-18', duration: 1400, delay: 500, onComplete: () => this.flashMsg?.destroy() })
  }

  private spawnHitSpark(x: number, y: number): void {
    if (this.qualityLow && this.rng.chance(0.5)) return
    const e = this.add.particles(x, y, 'spark', {
      speed: { min: 60, max: 260 }, angle: { min: 0, max: 360 }, lifespan: { min: 150, max: 320 },
      scale: { start: 1, end: 0 }, blendMode: 'ADD', quantity: 4,
    })
    e.setDepth(5)
    this.time.delayedCall(400, () => e.destroy())
  }

  private spawnExplosion(x: number, y: number, big: boolean): void {
    if (this.qualityLow && this.rng.chance(0.5)) return
    const e = this.add.particles(x, y, 'explosion', {
      speed: { min: big ? 120 : 60, max: big ? 320 : 180 }, angle: { min: 0, max: 360 },
      lifespan: { min: 200, max: 450 }, scale: { start: big ? 1.4 : 0.9, end: 0 },
      blendMode: 'ADD', quantity: big ? 10 : 6,
    })
    e.setDepth(6)
    this.time.delayedCall(600, () => e.destroy())
  }

  private spawnAoRing(): void {
    const e = this.add.particles(W / 2, H / 2, 'shock', {
      speed: 500, lifespan: 500, scale: { start: 2.4, end: 0 }, blendMode: 'ADD', quantity: 6,
    })
    e.setDepth(6)
    this.time.delayedCall(700, () => e.destroy())
  }
}
