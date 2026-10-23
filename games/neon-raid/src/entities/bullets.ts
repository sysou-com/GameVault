/**
 * 子弹池（03 文档 §2.3：玩家 64 / 敌方 128，对象池复用，0 GC 尖刺目标）。
 */
import Phaser from 'phaser'
import { Pool } from '../systems/pool.ts'
import { GAME } from '../core/constants.ts'

export interface Bullet {
  img: Phaser.GameObjects.Image
  x: number
  y: number
  vx: number
  vy: number
  px: number
  py: number
  alive: boolean
  r: number
}

function makeBullet(): Bullet {
  return {
    img: null as unknown as Phaser.GameObjects.Image,
    x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, alive: false,
    r: 5,
  }
}

export class BulletBank {
  private items: Bullet[] = []
  private live: Bullet[] = []

  constructor(private scene: Phaser.Scene, private texture: string, private cap: number, private radius: number) {
    for (let i = 0; i < cap; i++) {
      const img = scene.add.image(0, 0, texture)
      img.setVisible(false)
      const b = makeBullet()
      b.img = img
      b.r = radius
      this.items.push(b)
    }
  }

  get inUse(): number {
    return this.live.length
  }

  get activeBullets(): Bullet[] {
    return this.live
  }

  spawn(x: number, y: number, vx: number, vy: number): void {
    const b = this.items.pop()
    if (!b) return // 池满：静默丢弃（弹幕上限保护）
    b.x = x; b.y = y; b.px = x; b.py = y; b.vx = vx; b.vy = vy; b.alive = true
    b.img.setPosition(x, y).setVisible(true)
    b.img.setScale(1)
    this.live.push(b)
  }

  update(dtMs: number, w: number, h: number): void {
    const step = dtMs / 1000
    for (const b of this.live) {
      b.px = b.x; b.py = b.y
      b.x += b.vx * step
      b.y += b.vy * step
      if (b.x < -20 || b.x > w + 40 || b.y < -20 || b.y > h + 20) {
        this.kill(b)
      } else {
        b.img.setPosition(b.x, b.y)
      }
    }
  }

  kill(b: Bullet): void {
    b.alive = false
    b.img.setVisible(false)
    const i = this.live.indexOf(b)
    if (i >= 0) this.live.splice(i, 1)
    if (this.items.length < this.cap) this.items.push(b)
  }

  clear(): void {
    for (const b of this.live) this.kill(b)
  }
}

export function makePlayerBank(scene: Phaser.Scene): BulletBank {
  return new BulletBank(scene, 'pbullet', GAME.playerBulletPool, 5)
}

export function makeEnemyBank(scene: Phaser.Scene): BulletBank {
  return new BulletBank(scene, 'ebullet', GAME.enemyBulletPool, 8)
}
