/**
 * 敌机实体（3 小类 + 2 精英；03 文档 §2.2：精英弹幕表数据驱动）。
 * 手动 AABB 碰撞（不加载物理插件；v4 Arcade 有 API 变更，手动判定对 v4 最稳）。
 * 射击通过 ctx.emit 回调交给 PlayScene（实体不直接持场景引用，逻辑可单测）。
 */
import Phaser from 'phaser'
import { ENEMIES, ELITES, type EnemyDef, type EliteDef } from '../core/constants.ts'

export function aabb(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh
}

export interface UnitCtx {
  tMs: number
  speedScale: number
  bulletSpeedScale: number
  playerX: number
  playerY: number
  /** 发射敌方子弹（实体算好角度/速度，PlayScene 入池） */
  emit: (angle: number, speed: number, x?: number, y?: number) => void
}

/** 精英齐射指令（PlayScene 据此入池） */
export interface EliteShot {
  angle: number
  speed: number
}

export interface Unit {
  kind: string
  x: number
  y: number
  w: number
  h: number
  hp: number
  maxHp: number
  alive: boolean
  /** @returns 精英返回本帧齐射（小类 null） */
  update(dtMs: number, ctx: UnitCtx): EliteShot[] | null
  onHit(dmg: number): boolean
  destroy(): void
}

// ---------- 小类 ----------

class GruntUnit {
  kind = 'grunt'
  x: number
  y: number
  w = ENEMIES.grunt.w
  h = ENEMIES.grunt.h
  hp = ENEMIES.grunt.hp
  maxHp = ENEMIES.grunt.hp
  alive = true
  private vx: number
  private _flash = 0
  private img: Phaser.GameObjects.Image

  constructor(scene: Phaser.Scene, x: number, y: number, speed: number) {
    this.x = x; this.y = y
    this.vx = -speed
    this.img = scene.add.image(x, y, 'grunt')
  }

  update(dtMs: number, ctx: UnitCtx): EliteShot[] | null {
    if (this._flash > 0) { this._flash--; if (this._flash === 0) this.img.setScale(1).setAlpha(1) }
    this.x += this.vx * ctx.speedScale * (dtMs / 1000)
    this.img.setPosition(this.x, this.y)
    return null
  }

  onHit(dmg: number): boolean {
    this.hp -= dmg
    this._flash = 3
    this.img.setScale(1.3).setAlpha(0.65)
    return this.hp <= 0
  }

  destroy(): void {
    this.alive = false
    this.img.destroy()
  }
}

class DiverUnit {
  kind = 'diver'
  x: number
  y: number
  w = ENEMIES.diver.w
  h = ENEMIES.diver.h
  hp = ENEMIES.diver.hp
  maxHp = ENEMIES.diver.hp
  alive = true
  private baseY: number
  private phase: number
  private amp: number
  private cdMs: number
  private vx: number
  private speed: number
  private img: Phaser.GameObjects.Image

  constructor(scene: Phaser.Scene, x: number, y: number, speed: number, bulletSpeed: number, shootInterval: [number, number], rng: () => number) {
    this.x = x; this.y = y; this.baseY = y
    this.vx = -speed
    this.speed = speed
    this.phase = rng() * Math.PI * 2
    this.amp = 46 + rng() * 40
    this.cdMs = shootInterval[0] + rng() * (shootInterval[1] - shootInterval[0])
    this.img = scene.add.image(x, y, 'diver')
    this.bulletSpeed = bulletSpeed
  }
  private bulletSpeed: number

  update(dtMs: number, ctx: UnitCtx): EliteShot[] | null {
    this.img.setAlpha(1).setScale(1)
    this.x += this.vx * ctx.speedScale * (dtMs / 1000)
    this.y = this.baseY + Math.sin(ctx.tMs / 700 + this.phase) * this.amp
    this.img.setPosition(this.x, this.y)
    this.cdMs -= dtMs
    if (this.cdMs <= 0) {
      this.cdMs = ENEMIES.diver.shootIntervalMs[0] + (this.cdMs % 900) + 900
      // 单发直射（角度 = 指向玩家）
      ctx.emit(Math.atan2(ctx.playerY - this.y, ctx.playerX - this.x), this.bulletSpeed * ctx.bulletSpeedScale, this.x - 28, this.y)
    }
    return null
  }

  onHit(dmg: number): boolean {
    this.hp -= dmg
    this.img.setScale(1.3).setAlpha(0.65)
    return this.hp <= 0
  }

  destroy(): void {
    this.alive = false
    this.img.destroy()
  }
}

class BomberUnit {
  kind = 'bomber'
  x: number
  y: number
  w = ENEMIES.bomber.w
  h = ENEMIES.bomber.h
  hp = ENEMIES.bomber.hp
  maxHp = ENEMIES.bomber.hp
  alive = true
  private cdMs: number
  private vx: number
  private img: Phaser.GameObjects.Image

  constructor(scene: Phaser.Scene, x: number, y: number, speed: number, bulletSpeed: number) {
    this.x = x; this.y = y
    this.vx = -speed
    this.cdMs = 2200
    this.bulletSpeed = bulletSpeed
    this.img = scene.add.image(x, y, 'bomber')
  }
  private bulletSpeed: number

  update(dtMs: number, ctx: UnitCtx): EliteShot[] | null {
    this.img.setAlpha(1).setScale(1)
    this.x += this.vx * ctx.speedScale * (dtMs / 1000)
    this.y += Math.sin((ctx.tMs / 900 + this.x / 140)) * 0.35
    this.img.setPosition(this.x, this.y)
    this.cdMs -= dtMs
    if (this.cdMs <= 0) {
      this.cdMs = ENEMIES.bomber.shootIntervalMs[0]
      // 3 向扇形朝左
      for (const off of [-0.22, 0, 0.22]) {
        ctx.emit(Math.PI + off, this.bulletSpeed * ctx.bulletSpeedScale, this.x - 32, this.y)
      }
    }
    return null
  }

  onHit(dmg: number): boolean {
    this.hp -= dmg
    this.img.setScale(1.15).setAlpha(0.7)
    return this.hp <= 0
  }

  destroy(): void {
    this.alive = false
    this.img.destroy()
  }
}

// ---------- 精英 ----------

export class EliteUnit {
  kind: string
  x: number
  y: number
  w: number
  h: number
  hp: number
  maxHp: number
  alive = true
  def: EliteDef
  private img: Phaser.GameObjects.Image
  private frame: Phaser.GameObjects.Image
  private bar: Phaser.GameObjects.Graphics
  private patternIdx = -1
  private cdMs = 1000
  private scene: Phaser.Scene

  constructor(scene: Phaser.Scene, key: EliteDef['key'], x: number, y: number) {
    this.def = ELITES[key]
    this.kind = `elite-${key}`
    this.scene = scene
    this.x = Math.min(x, 800)
    this.y = y
    this.w = this.def.w; this.h = this.def.h
    this.hp = this.maxHp = this.def.hp
    this.img = scene.add.image(this.x, this.y, `elite-${key}`)
    this.frame = scene.add.image(this.x, this.y, 'elite-frame').setAlpha(0.8)
    this.bar = scene.add.graphics()
  }

  /** 当前阶段 0..2 */
  get phase(): number {
    return this.hp > this.maxHp * (2 / 3) ? 0 : this.hp > this.maxHp * (1 / 3) ? 1 : 2
  }

  update(dtMs: number, ctx: UnitCtx): EliteShot[] | null {
    this.img.setAlpha(1)
    // 待机位（屏右 1/4 区）缓摆
    const swing = Math.sin(ctx.tMs / 1600) * 40
    this.x = 800 + swing * 0.3
    this.img.setPosition(this.x, this.y)
    this.frame.setPosition(this.x, this.y)
    this.frame.rotation += dtMs / 1000 * 1.2

    // 阶段切换 → 立即来一发
    if (this.phase !== this.patternIdx) {
      this.patternIdx = this.phase
      this.cdMs = Math.min(this.cdMs, 600)
    }

    const out: EliteShot[] = []
    this.cdMs -= dtMs
    if (this.cdMs <= 0 && this.alive) {
      this.cdMs = this.def.patterns[this.patternIdx].intervalMs
      out.push(...this.burst(this.patternIdx, ctx))
    }

    // 血条
    this.bar.clear()
    const bw = this.w
    const by = this.y - this.h / 2 - 18
    this.bar.fillStyle(0x0a1428, 1).fillRect(this.x - bw / 2, by, bw, 6)
    const r = Math.max(0, this.hp / this.maxHp)
    this.bar.fillStyle(r > 0.5 ? 0x3dff8f : r > 0.25 ? 0xffd23d : 0xff2d95, 1)
    this.bar.fillRect(this.x - bw / 2, by, bw * r, 6)
    return out
  }

  /** 一次齐射（图案表数据驱动：kind/弹数/扇形/瞄准，03 文档 §2.3） */
  private burst(patIdx: number, ctx: UnitCtx): EliteShot[] {
    const pat = this.def.patterns[patIdx]
    const speed = pat.bulletSpeed * ctx.bulletSpeedScale
    const px = this.x - this.w / 2 + 8
    const py = this.y
    const out: EliteShot[] = []
    if (pat.kind === 'ring8') {
      for (let i = 0; i < pat.bullets; i++) {
        out.push({ angle: (i / pat.bullets) * Math.PI * 2, speed })
      }
    } else if (pat.aimed) {
      const base = Math.atan2(ctx.playerY - py, ctx.playerX - px)
      for (let i = 0; i < pat.bullets; i++) {
        const off = (i - (pat.bullets - 1) / 2) * pat.spreadRad
        out.push({ angle: base + off, speed })
      }
    } else {
      const total = pat.spreadRad
      for (let i = 0; i < pat.bullets; i++) {
        const f = pat.bullets === 1 ? 0.5 : i / (pat.bullets - 1)
        out.push({ angle: Math.PI + (f - 0.5) * total, speed })
      }
    }
    return out
  }

  onHit(dmg: number): boolean {
    this.hp -= dmg
    this.img.setAlpha(0.7)
    return this.hp <= 0
  }

  destroy(): void {
    this.alive = false
    this.img.destroy()
    this.frame.destroy()
    this.bar.destroy()
  }
}

// ---------- 工厂 ----------

export function makeUnit(scene: Phaser.Scene, kind: string, x: number, y: number, level: number, rng: () => number): Unit {
  const diff = levelDiff(level)
  switch (kind) {
    case 'grunt':
      return new GruntUnit(scene, x, y, ENEMIES.grunt.speed * diff.enemySpeed) as unknown as Unit
    case 'diver':
      return new DiverUnit(scene, x, y, ENEMIES.diver.speed * diff.enemySpeed, ENEMIES.diver.bulletSpeed, ENEMIES.diver.shootIntervalMs, rng) as unknown as Unit
    case 'bomber':
      return new BomberUnit(scene, x, y, ENEMIES.bomber.speed * diff.enemySpeed, ENEMIES.bomber.bulletSpeed) as unknown as Unit
    case 'elite-warden':
    case 'elite-guardian':
      return new EliteUnit(scene, kind === 'elite-warden' ? 'warden' : 'guardian', x, y) as unknown as Unit
    default:
      throw new Error(`unknown unit: ${kind}`)
  }
}

function levelDiff(level: number): { enemySpeed: number; bulletSpeed: number } {
  return { enemySpeed: [1, 1.15, 1.3][level - 1] ?? 1, bulletSpeed: [1, 1.12, 1.22][level - 1] ?? 1 }
}
