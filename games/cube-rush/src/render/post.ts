/**
 * 屏幕特效层（04 §1.3「速度感与 juice」，2D canvas 叠加，零 GPU 后处理成本）。
 * r186 官方后处理链路核实（2026-10-23，源码）：examples EffectComposer 仅支持 WebGLRenderer，
 * WebGPURenderer 无标准 composer（自建 TSL pass 超出游戏范围）→ 按 04 §5 预批降级方案
 * 「emissive + 假辉光 sprite」双后端统一（Bloom 效果由 glow sprite 承担），本模块负责
 * 屏幕空间 juice：速度线（密度 ∝ 速度）/ 节拍脉冲 / 事件闪白（04 §1.3「重要事件 5–8 层微反馈」）。
 */

export interface FxState {
  speed: number
  maxSpeed: number
  boost: boolean
  groove: boolean
  beatPulse: number // 0..1（1 = 拍点，Game 由逻辑时钟计算）
  running: boolean
}

interface Line {
  a: number // 角度
  r: number // 半径（屏幕半径比例 0..1）
  len: number
  w: number
  hue: number // 0 青 / 1 品红
}

const LINE_N = 48

export interface PostFx {
  canvas: HTMLCanvasElement
  /** 每渲染帧调用。flash ∈ [0,1] 全屏闪白（事件驱动，内部衰减）。 */
  update(dtMs: number, s: FxState, flash: number): void
  resize(w: number, h: number): void
}

export function createPostFx(canvas: HTMLCanvasElement): PostFx {
  const g = canvas.getContext('2d')!
  const lines: Line[] = Array.from({ length: LINE_N }, () => ({
    a: Math.random() * Math.PI * 2,
    r: 0.3 + Math.random() * 0.9,
    len: 0.06 + Math.random() * 0.1,
    w: 1 + Math.random() * 1.6,
    hue: Math.random() < 0.5 ? 0 : 1,
  }))
  let flash = 0

  function resize(w: number, h: number): void {
    canvas.width = Math.max(1, w)
    canvas.height = Math.max(1, h)
  }

  function update(dtMs: number, s: FxState, f: number): void {
    const W = canvas.width
    const H = canvas.height
    if (W < 2 || H < 2) return
    g.clearRect(0, 0, W, H)
    if (!s.running) return
    const cx = W / 2
    const cy = H / 2
    const R = Math.hypot(cx, cy)
    const dt = dtMs / 1000

    // 全屏闪白（事件：检查点/boost/FLOW/撞击）
    if (f > 0) flash = Math.max(flash, f)
    if (flash > 0.004) {
      g.globalCompositeOperation = 'lighter'
      g.fillStyle = `rgba(255,255,255,${flash.toFixed(3)})`
      g.fillRect(0, 0, W, H)
      flash *= Math.pow(0.0005, dt / 0.25) // 0.25s 衰减
      g.globalCompositeOperation = 'source-over'
    }

    // 节拍脉冲：屏幕边缘光环（音乐感；GROOVE 时增强）
    if (s.beatPulse > 0.01) {
      const p = s.beatPulse * (s.groove ? 1 : 0.55)
      g.globalCompositeOperation = 'lighter'
      g.strokeStyle = `rgba(180,75,255,${(0.22 * p).toFixed(3)})`
      g.lineWidth = 10 + 26 * p
      g.beginPath()
      g.ellipse(cx, cy, R * 0.98, R * 0.86, 0, 0, Math.PI * 2)
      g.stroke()
      g.globalCompositeOperation = 'source-over'
    }

    // 速度线：屏幕边缘径向拉线，密度 ∝ 速度（+boost/GROOVE 增强）
    const speedNorm = s.maxSpeed > 0 ? s.speed / s.maxSpeed : 0
    const active = Math.min(LINE_N, Math.round(6 + speedNorm * 30 + (s.boost ? 12 : 0) + (s.groove ? 6 : 0)))
    const pull = (1.2 + speedNorm * 2.2 + (s.boost ? 1.5 : 0)) // 内缩速度（半径/s）
    g.globalCompositeOperation = 'lighter'
    for (let i = 0; i < active; i++) {
      const l = lines[i]
      l.r -= pull * l.len * dt * 3
      if (l.r < 0.05) {
        l.r = 0.75 + Math.random() * 0.45
        l.a = Math.random() * Math.PI * 2
        l.len = 0.05 + Math.random() * 0.1
      }
      const a1 = l.a + Math.atan2(cy / H - 0.5, cx / W - 0.5) // 向屏幕中心偏
      const x1 = cx + Math.cos(l.a) * l.r * R
      const y1 = cy + Math.sin(l.a) * l.r * R * 0.86
      const x2 = cx + Math.cos(l.a) * (l.r + l.len) * R
      const y2 = cy + Math.sin(l.a) * (l.r + l.len) * R * 0.86
      const alpha = Math.min(0.5, (l.r * 1.2) * (0.25 + speedNorm * 0.5) * (s.boost ? 1.4 : 1))
      g.strokeStyle = l.hue === 0 ? `rgba(0,229,255,${alpha.toFixed(3)})` : `rgba(255,45,120,${alpha.toFixed(3)})`
      g.lineWidth = l.w
      g.beginPath()
      g.moveTo(x1, y1)
      g.lineTo(x2, y2)
      g.stroke()
      void a1
    }
    g.globalCompositeOperation = 'source-over'
  }

  return { canvas, update, resize }
}
