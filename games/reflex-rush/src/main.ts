/** 装配 + rAF 主循环（06 文档 §2；判定用事件时戳 performance.now()）。 */
import { mulberry32, planBeats, type BeatPlan } from './beat'
import { comboBonus, judge } from './judge'
import { Sfx } from './audio'
import { clearSaves, loadMeta, recordGame, type Meta } from './meta'
import { attachInput } from './input'
import { render, type Particle, type RenderState } from './render'
import type { BeatOutcome, Phase, RunResult } from './state'
import {
  onPlatform, sendError, sendReady, sendScore, sendTrack,
} from './platform/bridge'

const VERSION = '1.0.0'
const ENGINE = 'canvas-native'
const LIVES = 3
const HIT_WINDOW_MS = 150

const canvas = document.getElementById('c')
if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
  sendError('webgl-unavailable', '浏览器不支持 Canvas 2D')
  throw new Error('canvas unavailable')
}
const ctx = canvas.getContext('2d')
if (!ctx) {
  sendError('webgl-unavailable', '浏览器不支持 Canvas 2D')
  throw new Error('2d context unavailable')
}

// 尺寸与 DPR
let W = 0
let H = 0
function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  W = window.innerWidth
  H = window.innerHeight
  canvas.width = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
}
window.addEventListener('resize', resize)
resize()

const sfx = new Sfx()
let meta: Meta = loadMeta()
let phase: Phase = 'idle'
let beats: BeatPlan[] = []
let beatCursor = 0
let lives = LIVES
let score = 0
let streak = 0
let maxStreak = 0
let runStart = 0
let countdownEnds = 0
let lastGrade: { grade: BeatOutcome['grade']; at: number } | null = null
let comboBudget = 60
let particles: Particle[] = []
let outcomes: BeatOutcome[] = []
let result: RunResult | null = null
let newlyUnlocked = false
let readySent = false
let token: string | null = null

function renderState(): RenderState {
  return {
    phase,
    now: performance.now(),
    runStart,
    beats,
    beatCursor,
    lives,
    score,
    streak,
    lastGrade,
    particles,
    countdownEnds,
    result,
    expert: meta.expertUnlocked,
    bestScore: meta.bestScore,
    newlyUnlocked,
  }
}

// ---------- 流程 ----------

function startRun(): void {
  phase = 'countdown'
  countdownEnds = performance.now() + 3000
  sfx.ensure()
}

function beginRunning(): void {
  beats = planBeats(mulberry32((Date.now() & 0xffffff) + 1), {
    expert: meta.expertUnlocked,
  })
  beatCursor = 0
  lives = LIVES
  score = 0
  streak = 0
  maxStreak = 0
  comboBudget = 60
  outcomes = beats.map(b => ({ index: b.index, decoy: b.decoy, deviationMs: null, grade: 'MISS' as const, points: 0 }))
  result = null
  newlyUnlocked = false
  lastGrade = null
  runStart = performance.now()
  phase = 'running'
  sendTrack('start')
}

function spawnBurst(n: number, colorHue: 'cyan' | 'red'): void {
  const cx = W / 2
  const cy = H * 0.44
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const v = 2 + Math.random() * 4
    particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 })
    void colorHue
  }
  if (particles.length > 120) particles = particles.slice(-120)
}

function applyGrade(o: BeatOutcome, ts: number): void {
  o.deviationMs = o.deviationMs // keep
  if (o.grade === 'MISS' && o.decoy) {
    sfx.miss()
  } else {
    const j = judge(o.deviationMs!)
    o.grade = j.grade
    o.points = j.points
    if (j.comboHit) {
      streak++
      maxStreak = Math.max(maxStreak, streak)
      const bonus = comboBonus(comboBudget)
      comboBudget -= bonus
      score += o.points + bonus
      sfx.hit(j.grade === 'PERFECT')
      spawnBurst(j.grade === 'PERFECT' ? 20 : 10, 'cyan')
    } else {
      streak = 0
      score += o.points
      if (j.grade === 'OK') sfx.hit(false)
      else sfx.miss()
    }
  }
  lastGrade = { grade: o.grade, at: ts }
  if (!o.decoy) {
    lives--
  }
}

function finishRun(): void {
  const judged = outcomes.filter(o => !o.decoy)
  const perfect = judged.filter(o => o.grade === 'PERFECT').length
  const good = judged.filter(o => o.grade === 'GOOD').length
  const ok = judged.filter(o => o.grade === 'OK').length
  const miss = judged.filter(o => o.grade === 'MISS').length
  const withInput = judged.filter(o => o.deviationMs !== null)
  const avg = withInput.length
    ? withInput.reduce((s, o) => s + Math.abs(o.deviationMs!), 0) / withInput.length
    : null
  result = {
    score,
    perfect,
    good,
    ok,
    miss,
    maxStreak,
    avgDeviationMs: avg,
    outcomes,
    livesLeft: lives,
  }
  phase = 'result'
  const perfectRate = judged.length ? perfect / judged.length : 0
  const rec = recordGame(meta, perfectRate, score, maxStreak)
  meta = rec.meta
  newlyUnlocked = rec.newlyUnlocked
  sendTrack('end', performance.now() - runStart)
  void sendScore(score, {
    perfect,
    streak: maxStreak,
    avgDeviationMs: Number((avg ?? 0).toFixed(1)),
    expertMode: meta.expertUnlocked,
  }, token)
}

function onHit(ts: number): void {
  sfx.ensure()
  if (phase === 'idle') {
    startRun()
    return
  }
  if (phase === 'result') {
    startRun()
    return
  }
  if (phase !== 'running') return

  // 找窗口内未判定的拍（取偏差最小者；空按 = 窗口外 → MISS）
  let best: BeatOutcome | null = null
  let bestDev = Infinity
  for (const o of outcomes) {
    if (o.deviationMs !== null) continue // 已判
    const b = beats[o.index]
    const dev = ts - (runStart + b.atMs)
    if (Math.abs(dev) <= HIT_WINDOW_MS && Math.abs(dev) < Math.abs(bestDev)) {
      best = o
      bestDev = dev
    }
  }
  if (best) {
    best.deviationMs = bestDev
    applyGrade(best, ts)
  } else {
    // 空按（偏差 >150ms）：MISS 一命
    streak = 0
    lives--
    lastGrade = { grade: 'MISS', at: ts }
    sfx.miss()
  }
  if (lives <= 0) finishRun()
}

// ---------- 主循环 ----------

function tick(): void {
  const now = performance.now()

  if (phase === 'countdown' && now >= countdownEnds) beginRunning()

  if (phase === 'running') {
    // 拍点过期未按 → 自动 MISS（假环跳过：不按假环不罚）
    for (;;) {
      const o = outcomes[beatCursor]
      if (!o || o.decoy) break
      const elapsed = now - (runStart + beats[o.index].atMs)
      if (elapsed > HIT_WINDOW_MS && o.deviationMs === null) {
        o.deviationMs = elapsed
        applyGrade(o, now)
      } else {
        break
      }
      beatCursor++
    }
    if (beatCursor >= beats.length || lives <= 0) {
      // 补判剩余（lives 归零时）
      if (lives <= 0) {
        // 补判：未到达的拍留 deviationMs=null（明细显示「—」），避免 Infinity 污染平均偏差
        for (let i = beatCursor; i < beats.length; i++) {
          const o = outcomes[i]
          if (o.deviationMs === null && !o.decoy) o.grade = 'MISS'
        }
      }
      finishRun()
    }
  }

  // 粒子
  for (const p of particles) {
    p.x += p.vx
    p.y += p.vy
    p.life -= 0.08
  }
  particles = particles.filter(p => p.life > 0)

  render(ctx, W, H, renderState())

  if (!readySent) {
    readySent = true
    sendReady({ version: VERSION, engine: ENGINE, dpr: window.devicePixelRatio || 1, webgpu: false })
    sendTrack('pv')
  }
  requestAnimationFrame(tick)
}

// ---------- 平台消息 ----------

const detachInput = attachInput(onHit)

onPlatform('platform:init', (data) => {
  // M1 游客态：平台 token 经 localStorage['gamevault.session'] 共享（02 文档 §4.3）
  token = localStorage.getItem('gamevault.session')
  void data
})
onPlatform('platform:restart', () => {
  // 重新开始：直接开新 run（跳过 idle）
  startRun()
})
onPlatform('platform:clearSave', () => {
  clearSaves()
  meta = loadMeta()
})

void detachInput
requestAnimationFrame(tick)
