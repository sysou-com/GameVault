/** 全程序化绘制（06 文档 §1.3：零图片/字体资产；Canvas 2D，DPR 适配在 main）。 */
import type { BeatPlan } from './beat'
import type { Grade } from './judge'
import type { Phase, RunResult } from './state'

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number // 0..1
}

export interface RenderState {
  phase: Phase
  now: number
  runStart: number
  beats: BeatPlan[]
  beatCursor: number
  lives: number
  score: number
  streak: number
  lastGrade: { grade: Grade; at: number } | null
  particles: Particle[]
  countdownEnds: number
  result: RunResult | null
  expert: boolean
  bestScore: number
  newlyUnlocked: boolean
}

const NEON = '#22d3ee'
const NEON2 = '#a78bfa'
const MISS = '#f87171'

export function render(ctx: CanvasRenderingContext2D, w: number, h: number, s: RenderState): void {
  // 深色径向渐变底
  const bg = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75)
  bg.addColorStop(0, '#0d1526')
  bg.addColorStop(1, '#05070d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2
  const cy = h * 0.44
  const unit = Math.min(w, h)
  const rInner = unit * 0.13
  const rOuter = unit * 0.32

  // 判定环（固定）
  ctx.save()
  ctx.strokeStyle = NEON
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  if (s.phase === 'running') {
    const beat = s.beats[s.beatCursor]
    if (beat) {
      const remain = beat.atMs - (s.now - s.runStart)
      if (beat.decoy) {
        // 假环：闪烁、不收缩
        const blink = 0.35 + 0.3 * Math.sin(s.now / 90)
        ctx.save()
        ctx.globalAlpha = Math.max(0, blink)
        ctx.strokeStyle = MISS
        ctx.lineWidth = 5
        ctx.setLineDash([14, 10])
        ctx.beginPath()
        ctx.arc(cx, cy, rInner + (rOuter - rInner) * 0.55, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      } else if (remain > -160) {
        // 收缩环：approach 窗口 = 该拍间隔
        const p = Math.max(0, Math.min(1, remain / Math.max(300, beat.intervalMs)))
        const r = rInner + (rOuter - rInner) * p
        ctx.save()
        ctx.strokeStyle = NEON
        ctx.shadowColor = NEON
        ctx.shadowBlur = 24
        ctx.lineWidth = 6
        ctx.globalAlpha = 0.4 + 0.6 * (1 - p)
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }
    drawHud(ctx, w, h, s)
  } else if (s.phase === 'countdown') {
    const remain = Math.max(0, s.countdownEnds - s.now)
    const n = remain > 2000 ? '3' : remain > 1000 ? '2' : '1'
    ctx.save()
    ctx.fillStyle = '#e6ebf5'
    ctx.font = `700 ${unit * 0.16}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = NEON
    ctx.shadowBlur = 30
    ctx.fillText(n, cx, cy)
    ctx.restore()
  } else if (s.phase === 'idle') {
    drawIdle(ctx, w, h, s)
  } else if (s.phase === 'result' && s.result) {
    drawResult(ctx, w, h, s)
  }

  // 粒子
  for (const p of s.particles) {
    ctx.save()
    ctx.globalAlpha = Math.max(0, p.life)
    ctx.fillStyle = NEON2
    ctx.beginPath()
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // 判定文字（600ms 淡出 + 上飘）
  if (s.lastGrade) {
    const dt = s.now - s.lastGrade.at
    if (dt < 600) {
      const a = 1 - dt / 600
      const color = s.lastGrade.grade === 'MISS' ? MISS : s.lastGrade.grade === 'PERFECT' ? NEON : NEON2
      ctx.save()
      ctx.globalAlpha = a
      ctx.fillStyle = color
      ctx.font = `700 ${unit * 0.07}px monospace`
      ctx.textAlign = 'center'
      ctx.shadowColor = color
      ctx.shadowBlur = 18
      ctx.fillText(s.lastGrade.grade, cx, cy - unit * 0.02 - dt * 0.03)
      ctx.restore()
    }
  }
}

function drawHud(ctx: CanvasRenderingContext2D, w: number, _h: number, s: RenderState): void {
  const pad = Math.min(w, _h) * 0.03
  ctx.save()
  ctx.font = `600 ${_h * 0.035}px monospace`
  ctx.fillStyle = '#e6ebf5'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'right'
  ctx.fillText(`${s.score}`, w - pad, pad)
  ctx.textAlign = 'left'
  ctx.fillStyle = s.streak >= 3 ? '#22d3ee' : '#8b95ad'
  ctx.fillText(s.streak > 0 ? `x${s.streak}` : '', pad, pad)
  // 命（3 点）
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < s.lives ? '#f87171' : '#232c42'
    ctx.beginPath()
    ctx.arc(w / 2 - 16 + i * 16, pad + 6, 4.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawIdle(ctx: CanvasRenderingContext2D, w: number, h: number, s: RenderState): void {
  const cx = w / 2
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#e6ebf5'
  ctx.font = `700 ${h * 0.08}px monospace`
  ctx.shadowColor = '#22d3ee'
  ctx.shadowBlur = 26
  ctx.fillText('极速反应', cx, h * 0.3)
  ctx.shadowBlur = 0
  ctx.fillStyle = '#8b95ad'
  ctx.font = `${h * 0.035}px monospace`
  ctx.fillText('REFLEX RUSH', cx, h * 0.37)
  ctx.font = `${h * 0.03}px monospace`
  ctx.fillText('环缩到内圈的瞬间 · 点按 / 触屏 / 空格', cx, h * 0.52)
  ctx.fillText('PERFECT ≤30ms · GOOD ≤80ms · OK ≤150ms · 3 命 / 12 拍', cx, h * 0.57)
  ctx.fillStyle = '#22d3ee'
  const blink = 0.5 + 0.5 * Math.sin(performance.now() / 400)
  ctx.globalAlpha = blink
  ctx.font = `600 ${h * 0.04}px monospace`
  ctx.fillText('点按开始', cx, h * 0.68)
  ctx.globalAlpha = 1
  ctx.fillStyle = s.expert ? '#a78bfa' : '#8b95ad'
  ctx.font = `${h * 0.028}px monospace`
  ctx.fillText(
    s.expert ? `专家节奏已解锁（间隔下限 0.7s + 假环） · 最佳 ${s.bestScore}` : `最佳 ${s.bestScore} · 连续 3 局 PERFECT≥60% 解锁专家节奏`,
    cx, h * 0.76,
  )
  ctx.restore()
}

function drawResult(ctx: CanvasRenderingContext2D, w: number, h: number, s: RenderState): void {
  const r = s.result!
  const cx = w / 2
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#e6ebf5'
  ctx.font = `700 ${h * 0.07}px monospace`
  ctx.shadowColor = '#22d3ee'
  ctx.shadowBlur = 22
  ctx.fillText(`${r.score} 分`, cx, h * 0.16)
  ctx.shadowBlur = 0
  ctx.fillStyle = '#8b95ad'
  ctx.font = `${h * 0.032}px monospace`
  ctx.fillText(
    `P×${r.perfect}  G×${r.good}  OK×${r.ok}  M×${r.miss}   最长连击 ${r.maxStreak}   平均偏差 ${r.avgDeviationMs === null ? '—' : r.avgDeviationMs.toFixed(1) + 'ms'}`,
    cx, h * 0.24,
  )
  if (s.newlyUnlocked) {
    ctx.fillStyle = '#a78bfa'
    ctx.fillText('★ 已解锁「专家节奏」', cx, h * 0.30)
  }
  // 逐拍偏差明细（数据透明 = 公信力，06 文档 §6 风险对策）
  const top = h * 0.36
  const rowH = h * 0.03
  ctx.font = `${h * 0.026}px monospace`
  ctx.textAlign = 'left'
  const x0 = w * 0.28
  r.outcomes.forEach((o, i) => {
    const y = top + i * rowH
    const label = o.decoy ? 'FAKE' : o.grade
    ctx.fillStyle =
      o.decoy ? '#f87171'
      : o.grade === 'MISS' ? '#f87171'
      : o.grade === 'PERFECT' ? '#22d3ee'
      : '#8b95ad'
    ctx.fillText(`${String(i + 1).padStart(2, ' ')} ${label.padEnd(7)}${o.deviationMs === null ? '      —' : (o.deviationMs >= 0 ? '+' : '') + o.deviationMs.toFixed(0) + 'ms'}`, x0, y)
  })
  ctx.textAlign = 'center'
  ctx.fillStyle = '#8b95ad'
  ctx.font = `${h * 0.03}px monospace`
  const loginHint = localStorage.getItem('gamevault.session') ? '分数已提交' : '登录后可提交排行榜（M2 开放）'
  ctx.fillText(`${loginHint} · 点按再来一局`, cx, h * 0.92)
  ctx.restore()
}
