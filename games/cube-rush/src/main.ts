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
    onDeath() { /* 相机抖动在 Game 内 */ },
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

  // 尺寸（像素比上限 2，04 §2.3 自适应；低端机后续可降 1.0）
  function resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    game.resize(canvas.width, canvas.height)
  }
  window.addEventListener('resize', resize)
  resize()

  // 启动
  boot.classList.add('hidden')
  ui.showMenu(readBest(), webgpu)
  game.startLoop()
  sendReady({
    version: '1.0.0',
    engine: 'threejs',
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    webgpu,
  })

  // 泡测驾驶钩子（仅 ?debug=1；生产 iframe 不带参数，不暴露）
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__cr = {
      game,
      view: () => ({
        phase: game.phaseNow,
        lane: game.playerLane(),
        meters: game.meters(),
        nextObstacles: game.nextObstacles(45),
      }),
    }
  }
}

main().catch(e => {
  sendError('runtime', String(e))
  console.error(e)
})
