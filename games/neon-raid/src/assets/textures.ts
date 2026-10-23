/**
 * 运行时纹理（Graphics → generateTexture；零 PNG 资产，03 文档 §1.4 霓虹风格的程序化实现）。
 * 全部在 BootScene 里调一次，之后纯 draw call（图集单纹理批次友好，03 §3 ≤30 draw call 预算内）。
 */
import { Rng } from '../core/rng.ts'

const C = {
  cyan: 0x12f0ff, magenta: 0xff2d95, purple: 0xb26bff, yellow: 0xffd23d,
  green: 0x3dff8f, deep: 0x0a1428, white: 0xeafcff,
}

export function buildTextures(scene: Phaser.Scene): void {
  // ---- 玩家机（46×30）：三角机影 + 霓虹描边 ----
  g(scene, 'player', 46, 30, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 2, 46, 26)
    x.lineStyle(2.5, C.cyan, 1); x.beginPath()
    x.moveTo(4, 2); x.lineTo(42, 15); x.lineTo(4, 28); x.lineTo(12, 15); x.closePath()
    x.fillPath()
    x.fillStyle(C.magenta); x.fillRect(6, 11, 10, 8)   // 座舱
    x.fillStyle(C.yellow); x.fillRect(0, 12, 4, 6)      // 尾焰基点
  })

  // ---- 子弹 ----
  g(scene, 'pbullet', 14, 5, (x) => {
    x.fillStyle(C.cyan); x.fillRoundedRect(0, 1, 14, 3, 1.5)
    x.fillStyle(C.white); x.fillRoundedRect(10, 1, 4, 3, 1.5)
  })
  g(scene, 'ebullet', 12, 12, (x) => {
    x.fillStyle(C.magenta); x.fillCircle(6, 6, 5)
    x.fillStyle(C.white); x.fillCircle(6, 6, 2)
  })

  // ---- 敌机 ----
  g(scene, 'grunt', 34, 22, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 1, 34, 20)
    x.lineStyle(2, C.magenta, 1); x.beginPath()
    x.moveTo(30, 11); x.lineTo(8, 2); x.lineTo(2, 8); x.lineTo(2, 14); x.lineTo(8, 20); x.closePath()
    x.fillPath()
    x.fillStyle(C.magenta); x.fillCircle(24, 11, 2.5)
  })
  g(scene, 'diver', 36, 26, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 1, 36, 24)
    x.lineStyle(2, C.purple, 1); x.beginPath()
    x.moveTo(32, 13); x.lineTo(12, 2); x.lineTo(4, 8); x.lineTo(4, 18); x.lineTo(12, 24); x.closePath()
    x.fillPath()
    x.fillStyle(C.purple); x.fillTriangle(20, 13, 30, 8, 30, 18)
  })
  g(scene, 'bomber', 44, 34, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 1, 44, 32)
    x.lineStyle(2.5, C.yellow, 1); x.beginPath()
    x.moveTo(38, 17); x.lineTo(24, 3); x.lineTo(6, 8); x.lineTo(2, 17); x.lineTo(6, 26); x.lineTo(24, 31); x.closePath()
    x.fillPath()
    x.fillStyle(C.yellow); x.fillCircle(16, 17, 5)
    x.lineStyle(2, C.magenta, 0.9); x.strokeCircle(16, 17, 9)
  })

  // ---- 精英核心（96×64 / 112×76 按 def 尺寸各一张）+ 旋转框 ----
  g(scene, 'elite-warden', 96, 64, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 0, 96, 64)
    x.lineStyle(3, C.purple, 1); x.strokeCircle(48, 32, 26)
    x.fillStyle(C.purple); x.fillCircle(48, 32, 18)
    x.fillStyle(C.deep); x.fillCircle(48, 32, 9)
    x.lineStyle(2, C.magenta, 1); x.beginPath()
    x.moveTo(8, 32); x.lineTo(88, 32); x.moveTo(48, 4); x.lineTo(48, 60)
    x.strokePath()
  })
  g(scene, 'elite-guardian', 112, 76, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 0, 112, 76)
    x.lineStyle(3, C.magenta, 1); x.strokeCircle(56, 38, 30)
    x.fillStyle(C.magenta); x.fillCircle(56, 38, 21)
    x.fillStyle(C.deep); x.fillCircle(56, 38, 11)
    x.lineStyle(2.5, C.cyan, 1); x.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      x.moveTo(56 + Math.cos(a) * 30, 38 + Math.sin(a) * 30)
      x.lineTo(56 + Math.cos(a) * 38, 38 + Math.sin(a) * 38)
    }
    x.strokePath()
  })
  g(scene, 'elite-frame', 96, 96, (x) => {
    x.lineStyle(2, C.white, 0.85)
    x.strokeCircle(48, 48, 44)
    x.fillStyle(C.white)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      x.fillCircle(48 + Math.cos(a) * 44, 48 + Math.sin(a) * 44, 2.5)
    }
  })

  // ---- 拾取物（28×28 霓虹菱形 + 符号） ----
  const pickup = (key: string, color: number, symbol: (x: Phaser.GameObjects.Graphics, cx: number, cy: number) => void) => {
    g(scene, `pick-${key}`, 28, 28, (x) => {
      x.fillStyle(C.deep); x.fillRect(0, 0, 28, 28)
      x.lineStyle(2.5, color, 1); x.beginPath()
      x.moveTo(14, 2); x.lineTo(26, 14); x.lineTo(14, 26); x.lineTo(2, 14); x.closePath()
      x.fillPath()
      x.lineStyle(2, color, 1)
      symbol(x, 14, 14)
    })
  }
  pickup('P', C.green, (x, cx, cy) => { // 双发：两道平行槽
    x.beginPath(); x.moveTo(cx - 6, cy - 5); x.lineTo(cx - 6, cy + 5)
    x.moveTo(cx + 6, cy - 5); x.lineTo(cx + 6, cy + 5); x.strokePath()
  })
  pickup('S', C.cyan, (x, cx, cy) => {  // 护盾：圆环
    x.strokeCircle(cx, cy, 6)
  })
  pickup('B', C.yellow, (x, cx, cy) => { // 清屏：爆发星
    x.beginPath()
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI
      x.moveTo(cx - Math.cos(a) * 7, cy - Math.sin(a) * 7)
      x.lineTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7)
    }
    x.strokePath()
  })

  // ---- 粒子/特效纹理 ----
  g(scene, 'spark', 8, 8, (x) => {
    x.fillStyle(C.white); x.fillCircle(4, 4, 3)
    x.fillStyle(C.cyan); x.fillCircle(4, 4, 1.5)
  })
  g(scene, 'explosion', 40, 40, (x) => {
    x.lineStyle(3, C.white, 1); x.strokeCircle(20, 20, 15)
    x.lineStyle(2, C.yellow, 1); x.strokeCircle(20, 20, 8)
  })
  g(scene, 'shock', 128, 128, (x) => {
    x.lineStyle(4, C.yellow, 1); x.strokeCircle(64, 64, 58)
    x.lineStyle(2, C.white, 1); x.strokeCircle(64, 64, 44)
  })
  g(scene, 'shield', 70, 70, (x) => {
    x.lineStyle(3, C.cyan, 0.9); x.strokeCircle(35, 35, 30)
    x.lineStyle(1.5, C.white, 0.5); x.strokeCircle(35, 35, 24)
  })

  // ---- 背景星场（960×540 ×2 层，确定性 Rng） ----
  for (const [key, n, size] of [['bg1', 90, 1.6], ['bg2', 46, 2.6]] as const) {
    const rng = new Rng(777 + n)
    g(scene, key, 960, 540, (x) => {
      for (let i = 0; i < n; i++) {
        const a = rng.range(0.25, 1)
        x.fillStyle(C.white, a)
        x.fillCircle(rng.range(0, 960), rng.range(0, 540), size * rng.range(0.5, 1.5))
      }
    })
  }
}

function g(scene: Phaser.Scene, key: string, w: number, h: number, draw: (x: Phaser.GameObjects.Graphics) => void): void {
  const gfx = scene.make.graphics({ x: 0, y: 0 })
  draw(gfx)
  gfx.generateTexture(key, w, h)
  gfx.destroy()
}
