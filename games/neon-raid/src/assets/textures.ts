/**
 * 运行时纹理（Graphics → generateTexture；零 PNG 资产，03 文档 §1.4 霓虹风格的程序化实现）。
 * 全部在 BootScene 里调一次，之后纯 draw call（图集单纹理批次友好，03 §3 ≤30 draw call 预算内）。
 *
 * v1.1.0：实体纹理统一 ×1.4 放大（用户反馈「元素太小」）；坐标按新尺寸等比重绘。
 */
import { Rng } from '../core/rng.ts'

const C = {
  cyan: 0x12f0ff, magenta: 0xff2d95, purple: 0xb26bff, yellow: 0xffd23d,
  green: 0x3dff8f, deep: 0x0a1428, white: 0xeafcff,
}

export function buildTextures(scene: Phaser.Scene): void {
  // ---- 玩家机（视觉 64×42；判定框 56×34 略小=宽容度）：三角机影 + 霓虹描边 ----
  g(scene, 'player', 64, 42, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 3, 64, 36)
    x.lineStyle(3.5, C.cyan, 1); x.beginPath()
    x.moveTo(5, 3); x.lineTo(59, 21); x.lineTo(5, 39); x.lineTo(17, 21); x.closePath()
    x.fillPath()
    x.fillStyle(C.magenta); x.fillRect(8, 15, 14, 11)   // 座舱
    x.fillStyle(C.yellow); x.fillRect(0, 17, 5, 9)       // 尾焰基点
  })

  // ---- 子弹 ----
  g(scene, 'pbullet', 20, 7, (x) => {
    x.fillStyle(C.cyan); x.fillRoundedRect(0, 1, 20, 5, 2)
    x.fillStyle(C.white); x.fillRoundedRect(14, 1, 6, 5, 2)
  })
  g(scene, 'ebullet', 17, 17, (x) => {
    x.fillStyle(C.magenta); x.fillCircle(8, 8, 7)
    x.fillStyle(C.white); x.fillCircle(8, 8, 3)
  })

  // ---- 敌机 ----
  g(scene, 'grunt', 48, 31, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 1, 48, 28)
    x.lineStyle(2.8, C.magenta, 1); x.beginPath()
    x.moveTo(42, 15); x.lineTo(11, 2); x.lineTo(3, 11); x.lineTo(3, 19); x.lineTo(11, 28); x.closePath()
    x.fillPath()
    x.fillStyle(C.magenta); x.fillCircle(34, 15, 3.5)
  })
  g(scene, 'diver', 50, 36, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 1, 50, 34)
    x.lineStyle(2.8, C.purple, 1); x.beginPath()
    x.moveTo(45, 18); x.lineTo(17, 2); x.lineTo(5, 11); x.lineTo(5, 25); x.lineTo(17, 34); x.closePath()
    x.fillPath()
    x.fillStyle(C.purple); x.fillTriangle(28, 18, 42, 11, 42, 25)
  })
  g(scene, 'bomber', 62, 48, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 1, 62, 46)
    x.lineStyle(3.5, C.yellow, 1); x.beginPath()
    x.moveTo(53, 24); x.lineTo(34, 3); x.lineTo(8, 11); x.lineTo(2, 24); x.lineTo(8, 37); x.lineTo(34, 44); x.closePath()
    x.fillPath()
    x.fillStyle(C.yellow); x.fillCircle(22, 24, 7)
    x.lineStyle(2.8, C.magenta, 0.9); x.strokeCircle(22, 24, 12)
  })

  // ---- 精英核心（134×90 / 157×106 按 def 尺寸各一张）+ 旋转框 ----
  g(scene, 'elite-warden', 134, 90, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 0, 134, 90)
    x.lineStyle(4, C.purple, 1); x.strokeCircle(67, 45, 36)
    x.fillStyle(C.purple); x.fillCircle(67, 45, 25)
    x.fillStyle(C.deep); x.fillCircle(67, 45, 13)
    x.lineStyle(2.8, C.magenta, 1); x.beginPath()
    x.moveTo(11, 45); x.lineTo(123, 45); x.moveTo(67, 5); x.lineTo(67, 85)
    x.strokePath()
  })
  g(scene, 'elite-guardian', 157, 106, (x) => {
    x.fillStyle(C.deep); x.fillRect(0, 0, 157, 106)
    x.lineStyle(4, C.magenta, 1); x.strokeCircle(78, 53, 42)
    x.fillStyle(C.magenta); x.fillCircle(78, 53, 29)
    x.fillStyle(C.deep); x.fillCircle(78, 53, 15)
    x.lineStyle(3.5, C.cyan, 1); x.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      x.moveTo(78 + Math.cos(a) * 42, 53 + Math.sin(a) * 42)
      x.lineTo(78 + Math.cos(a) * 53, 53 + Math.sin(a) * 53)
    }
    x.strokePath()
  })
  g(scene, 'elite-frame', 134, 134, (x) => {
    x.lineStyle(2.8, C.white, 0.85)
    x.strokeCircle(67, 67, 62)
    x.fillStyle(C.white)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      x.fillCircle(67 + Math.cos(a) * 62, 67 + Math.sin(a) * 62, 3.5)
    }
  })

  // ---- 拾取物（40×40 霓虹菱形 + 符号） ----
  const pickup = (key: string, color: number, symbol: (x: Phaser.GameObjects.Graphics, cx: number, cy: number) => void) => {
    g(scene, `pick-${key}`, 40, 40, (x) => {
      x.fillStyle(C.deep); x.fillRect(0, 0, 40, 40)
      x.lineStyle(3.5, color, 1); x.beginPath()
      x.moveTo(20, 3); x.lineTo(37, 20); x.lineTo(20, 37); x.lineTo(3, 20); x.closePath()
      x.fillPath()
      x.lineStyle(2.8, color, 1)
      symbol(x, 20, 20)
    })
  }
  pickup('P', C.green, (x, cx, cy) => { // 双发：两道平行槽
    x.beginPath(); x.moveTo(cx - 8, cy - 7); x.lineTo(cx - 8, cy + 7)
    x.moveTo(cx + 8, cy - 7); x.lineTo(cx + 8, cy + 7); x.strokePath()
  })
  pickup('S', C.cyan, (x, cx, cy) => {  // 护盾：圆环
    x.strokeCircle(cx, cy, 8)
  })
  pickup('B', C.yellow, (x, cx, cy) => { // 清屏：爆发星
    x.beginPath()
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI
      x.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10)
      x.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10)
    }
    x.strokePath()
  })

  // ---- 粒子/特效纹理 ----
  g(scene, 'spark', 12, 12, (x) => {
    x.fillStyle(C.white); x.fillCircle(6, 6, 4.5)
    x.fillStyle(C.cyan); x.fillCircle(6, 6, 2)
  })
  g(scene, 'explosion', 56, 56, (x) => {
    x.lineStyle(4, C.white, 1); x.strokeCircle(28, 28, 21)
    x.lineStyle(2.8, C.yellow, 1); x.strokeCircle(28, 28, 11)
  })
  g(scene, 'shock', 160, 160, (x) => {
    x.lineStyle(5, C.yellow, 1); x.strokeCircle(80, 80, 75)
    x.lineStyle(2.8, C.white, 1); x.strokeCircle(80, 80, 62)
  })
  g(scene, 'shield', 98, 98, (x) => {
    x.lineStyle(4, C.cyan, 0.9); x.strokeCircle(49, 49, 42)
    x.lineStyle(2, C.white, 0.5); x.strokeCircle(49, 49, 33)
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
