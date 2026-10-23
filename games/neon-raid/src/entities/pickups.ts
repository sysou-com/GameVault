/**
 * 拾取物（03 文档 §1.1：精英掉落 100% 单件 P 双发 / S 护盾 / B 清屏）。
 * 池化复用，缓慢左漂 + 呼吸浮动。
 */
import Phaser from 'phaser'
import { PICKUPS, type PickupDef } from '../core/constants.ts'

export class Pickup {
  img: Phaser.GameObjects.Image
  x = 0
  y = 0
  w = 28
  h = 28
  key!: PickupDef['key']
  alive = false
  private baseY = 0
  private t = Math.random() * 10

  constructor(private scene: Phaser.Scene) {
    this.img = scene.add.image(0, 0, 'pick-P')
    this.img.setVisible(false)
  }

  spawn(key: PickupDef['key'], x: number, y: number): void {
    this.key = key
    this.x = x
    this.baseY = y
    this.alive = true
    this.img.setTexture(`pick-${key}`).setPosition(x, y).setVisible(true)
  }

  update(dtMs: number, tMs: number): void {
    if (!this.alive) return
    this.x -= 60 * (dtMs / 1000)
    this.y = this.baseY + Math.sin(tMs / 500 + this.t) * 6
    this.img.setPosition(this.x, this.y)
    if (this.x < -30) this.alive = false
  }

  kill(): void {
    this.alive = false
    this.img.setVisible(false)
  }
}

export class PickupPool {
  private items: Pickup[] = []
  live: Pickup[] = []

  constructor(scene: Phaser.Scene, cap: number) {
    for (let i = 0; i < cap; i++) {
      const p = new Pickup(scene)
      this.items.push(p)
    }
  }

  spawn(key: PickupDef['key'], x: number, y: number): void {
    const p = this.items.pop()
    if (!p) return
    p.spawn(key, x, y)
    this.live.push(p)
  }

  update(dtMs: number, tMs: number): void {
    for (const p of this.live) {
      p.update(dtMs, tMs)
      if (!p.alive) {
        this.live.splice(this.live.indexOf(p), 1)
        this.items.push(p)
      }
    }
  }

  clear(): void {
    for (const p of this.live) p.kill()
    this.live.length = 0
  }
}

export const PICKUP_KEYS = Object.keys(PICKUPS) as PickupDef['key'][]
