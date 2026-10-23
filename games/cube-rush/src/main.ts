/**
 * 启动（04 §2.2 main.ts）：canvas → WebGPURenderer（内建回退）→ Game → 输入/音频/UI/桥。
 * 平台桥（02 §4）：game:ready（带 webgpu 标记）/ game:score（结算自动提交一次 + 手动重试）/ game:error。
 */
import type { WebGPURenderer } from 'three/webgpu'
import { createRenderer } from './render/setup.ts'
import { Game } from './game/Game.ts'
import { bindInput } from './input/input.ts'
import { createAudio } from './audio/synth.ts'
import { createUi } from './ui/ui.ts'
import { createPostFx } from './render/post.ts'
import { createAdaptiveQuality } from './render/adaptive.ts'
import {
  initBridge, sendReady, sendError, sendTrack, submitScore,
  type PlatformUser,
} from './platform/bridge.ts'
import type { ScoreMeta, RunResult } from './platform/types.ts'

const canvas = document.getElementById('game') as HTMLCanvasElement
const boot = document.getElementById('boot') as HTMLElement
const bootMsg = document.getElementById('boot-msg') as HTMLElement

const BEST_KEY = 'cube-rush.best'
const SETTINGS_KEY = 'cube-rush.settings'

function readSettings(): { sound: boolean } {
  try {
    const v = localStorage.getItem(SETTINGS_KEY)
    if (v) return { sound: (JSON.parse(v) as { sound?: boolean }).sound !== false }
  } catch { /* 独立运行无 localStorage */ }
  return { sound: true }
}
function writeSettings(s: { sound: boolean }): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}
function readBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0 } catch { return 0 }
}
function writeBest(v: number): void {
  try { localStorage.setItem(BEST_KEY, String(v)) } catch { /* ignore */ }
}

async function main(): Promise<void> {
  const settings = readSettings()
  const audio = createAudio()

  // 渲染器（WebGPU→WebGL2 内建回退）
  let renderer: WebGPURenderer
  let webgpu: boolean
  try {
    ;({ renderer, webgpu } = await createRenderer(canvas))
  } catch (e) {
    sendError('webgl-unavailable', String(e))
    bootMsg.textContent = '渲染器初始化失败：' + String(e)
    return
  }

  let lastResult: RunResult | null = null
  let trackStartMs = 0

  // 自适应三档画质（04 §2.3/§3：FPS 窗口决策；触控默认中档起步）+ 屏幕特效层（速度线/节拍脉冲/闪白）
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
  const fxCanvas = document.getElementById('fx') as HTMLCanvasElement
  let quality = createAdaptiveQuality(isTouch, (t) => {
    game.setRhythmJudged(quality.rhythmJudged())
    game.setParticleBudget(quality.particles())
    resize()
  })
  // ?debug=1&forceTier=0|1|2：强制档位（泡测用——窗口被遮挡时 rAF 被节流，自适应会误降 T2）
  const forceTier = new URLSearchParams(location.search).get('forceTier')
  if (forceTier !== null && ['0', '1', '2'].includes(forceTier)) {
    const t = Number(forceTier) as 0 | 1 | 2
    quality = { ...quality, note: () => undefined, tier: () => t }
  }
  const postFx = createPostFx(fxCanvas)
  let fpsSmooth = 60

  const game = new Game(renderer, canvas, {
    webgpu,
    audio,
    onPhase(phase, payload) {
      switch (phase) {
        case 'running':
          ui.hidePause()
          break
        case 'paused':
          ui.showPause()
          break
        case 'result':
          if (payload) finish(payload)
          break
        case 'menu':
          break
      }
    },
    onHud(h) {
      ui.showHud(h)
    },
    onFloat(text, cls) {
      ui.float(text, cls)
    },
    onDeath() { /* 相机抖动/闪白在 Game 内 + postFx 闪白 */ },
    onFrame(dtMs) {
      quality.note(dtMs)
      fpsSmooth += ((dtMs > 0 ? 1000 / dtMs : 60) - fpsSmooth) * 0.05
      postFx.update(dtMs, {
        speed: game.speedNow(),
        maxSpeed: 30,
        boost: game.boostNow(),
        groove: game.grooveNow().active,
        beatPulse: game.beatPulse(),
        running: game.phaseNow === 'running',
      }, game.consumeFlash())
    },
  })

  const ui = createUi({
    onStart: () => {
      ensureAudio()
      trackStartMs = Date.now()
      sendTrack('start')
      game.startRun()
    },
    onResume: () => game.resume(),
    onRestart: () => {
      ensureAudio()
      trackStartMs = Date.now()
      sendTrack('start')
      game.startRun()
    },
    onResubmit: () => {
      if (lastResult) void trySubmit(lastResult)
    },
  })

  async function trySubmit(r: RunResult): Promise<void> {
    const res = await submitScore(r.score, r.meta)
    const btn = document.getElementById('btn-submit') as HTMLButtonElement
    if (res === 'ok') {
      btn.textContent = '✓ 已提交上榜'
      btn.disabled = true
    } else if (res === 'no-auth') {
      btn.textContent = '未登录（登录后可提交）'
    } else {
      btn.textContent = '提交失败，点击重试'
      btn.disabled = false
    }
  }

  function finish(payload: { score: number; meta: ScoreMeta; meters: number }): void {
    const best = readBest()
    const isBest = payload.score > best
    if (isBest) writeBest(payload.score)
    lastResult = { score: payload.score, meta: payload.meta, meters: payload.meters }
    ui.showResult({ score: payload.score, meta: payload.meta, best: Math.max(best, payload.score), isBest, webgpu })
    void trySubmit(lastResult)
    sendTrack('end', Date.now() - trackStartMs)
  }

  // ---- 平台桥 ----
  initBridge({
    onInit: (u: PlatformUser) => ui.setLoginUser(u),
    onRestart: () => {
      ensureAudio()
      trackStartMs = Date.now()
      sendTrack('start')
      game.startRun()
    },
  })
  sendTrack('pv')

  // 首次交互解锁音频（自动播放策略）
  let audioReady = false
  function ensureAudio(): void {
    if (audioReady) return
    audioReady = true
    audio.init(settings.sound ? 0.7 : 0)
    const muteBtn = document.getElementById('btn-mute') as HTMLButtonElement
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const m = !audio.muted()
        audio.setMuted(m)
        settings.sound = !m
        writeSettings(settings)
        muteBtn.textContent = m ? '🔇 声音关' : '🔊 声音开'
      })
    }
  }
  window.addEventListener('pointerdown', ensureAudio, { once: true })
  window.addEventListener('keydown', ensureAudio, { once: true })

  // 输入（运行中才消费；触控目标 = body，键盘监听 window 在 bindInput 内部）
  bindInput(cmd => {
    if (game.phaseNow === 'running') game.handleCommand(cmd)
  }, document.body)

  // 菜单/结算：回车或空格 = 开始/再来；P/Esc = 暂停
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'Space') {
      const menuVisible = !document.getElementById('ui-menu')!.classList.contains('hidden')
      const resultVisible = !document.getElementById('ui-result')!.classList.contains('hidden')
      const pauseVisible = !document.getElementById('ui-pause')!.classList.contains('hidden')
      if (menuVisible || resultVisible || pauseVisible) {
        e.preventDefault()
        ensureAudio()
        trackStartMs = Date.now()
        sendTrack('start')
        game.startRun()
      }
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (game.phaseNow === 'running') { game.pause(); return }
      if (game.phaseNow === 'paused') game.resume()
    }
  })

  // 页面隐藏自动暂停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.phaseNow === 'running') game.pause()
  })

  // 尺寸（像素比上限随自适应档位：min(dpr, 2/1.5/1.0)，04 §2.3 三档；触控默认中档起步）
  function resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    // iframe 布局未定（瞬时 0 尺寸）时不写入 0——WebGPURenderer 对 0 尺寸 swapchain 会抛
    // 「Could not create a swapchain texture of size 0」GPUValidationError（r186 实机复现）。
    if (w <= 0 || h <= 0) return
    const dpr = quality.dpr(window.devicePixelRatio || 1)
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    game.resize(canvas.width, canvas.height)
    postFx.resize(w, h)
  }
  window.addEventListener('resize', resize)
  // ResizeObserver：可靠捕获 iframe 0→确定尺寸的布局过渡（resize 事件在 iframe 里可能不触发）。
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(document.body)
  resize()

  // 启动
  boot.classList.add('hidden')
  ui.showMenu(readBest(), webgpu)
  // 强制档位生效（泡测）：应用判定/粒子开关
  if (forceTier !== null && ['0', '1', '2'].includes(forceTier)) {
    game.setRhythmJudged(quality.rhythmJudged())
    game.setParticleBudget(quality.particles())
  }
  game.startLoop()
  sendReady({
    version: '1.1.0',
    engine: 'threejs',
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    webgpu,
  })

  // 泡测驾驶钩子（仅 ?debug=1；生产 iframe 不带参数，不暴露）
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__cr = {
      game,
      quality: () => quality.tier(),
      fps: () => Math.round(fpsSmooth),
      view: () => ({
        phase: game.phaseNow,
        lane: game.playerLane(),
        meters: game.meters(),
        beatMs: game.beatMsNow(),
        groove: game.grooveNow(),
        combo: game.comboNow(),
        drawCalls: game.drawCalls(),
        census: game.census(),
        nextRhythmGate: game.nextRhythmGate(),
        nextObstacles: game.nextObstacles(45),
      }),
      // 跳米数到节奏门前（泡测 FLOW 判定用）
      warpToM: (m: number) => {
        const g = game as unknown as { jumpTo(m: number): void }
        g.jumpTo(m)
      },
      warpBeat: (ms: number) => {
        const g = game as unknown as { warpBeatMs(ms: number): void }
        g.warpBeatMs(ms)
      },
      // 手动驱动逻辑步（窗口被遮挡 rAF 暂停时手动推进模拟）
      step: (ms: number) => {
        const g = game as unknown as { debugStep(ms: number): void }
        g.debugStep(ms)
      },
    }
  }
}

main().catch(e => {
  sendError('runtime', String(e))
  console.error(e)
})
