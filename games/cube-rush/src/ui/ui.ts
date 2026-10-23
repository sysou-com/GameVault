/**
 * UI 覆盖层（DOM；菜单/暂停/结算/HUD/combo 条/飘字/GROOVE 标签。CSS 在 index.html <style>）。
 * 平台桥联动：结算页显示登录态（bridge.getPlatformUser）+ 提交按钮。
 */
import { getPlatformUser, type PlatformUser } from '../platform/bridge.ts'
import type { ScoreMeta } from '../platform/types.ts'

export interface UiCallbacks {
  onStart(): void
  onResume(): void
  onRestart(): void
  onResubmit(): void
}

export interface HudPayload {
  score: number
  meters: number
  speed: number
  mult: number
  shield: boolean
  magnet: boolean
  /** 连击（04 §1.4：×1→×8，4s 衰减）。 */
  comboMult: number
  comboRemainingMs: number
  /** Groove 激活（04 §1.5：×1.5 + 低音层）。 */
  groove: boolean
  boost: boolean
  flow: boolean
}

export interface Ui {
  showMenu(best: number, webgpu: boolean): void
  showHud(h: HudPayload): void
  hideHud(): void
  showPause(): void
  hidePause(): void
  showResult(r: { score: number; meta: ScoreMeta; best: number; isBest: boolean; webgpu: boolean }): void
  setLoginUser(u: PlatformUser | null): void
  /** 飘字（CLOSE! / FLOW / FLOW PERFECT / GOLD STORM / IRON WALL ROCKET…；DOM 池化 + CSS 动画）。 */
  float(text: string, cls?: 'flow' | 'gold' | 'purple' | 'red' | 'cyan'): void
}

const $ = (id: string): HTMLElement => document.getElementById(id)!

export function createUi(cb: UiCallbacks): Ui {
  const el = {
    menu: $('ui-menu'),
    hud: $('ui-hud'),
    pause: $('ui-pause'),
    result: $('ui-result'),
    score: $('hud-score'),
    meters: $('hud-meters'),
    speed: $('hud-speed'),
    fx: $('hud-fx'),
    comboWrap: $('hud-combo'),
    comboVal: $('hud-combo-val'),
    comboBar: $('hud-combo-bar'),
    groove: $('hud-groove'),
    floatLayer: $('float-layer'),
    bestMenu: $('best-menu'),
    bestResult: $('best-result'),
    scoreResult: $('score-result'),
    metersResult: $('meters-result'),
    coinsResult: $('coins-result'),
    cpsResult: $('cps-result'),
    speedResult: $('speed-result'),
    nmResult: $('nm-result'),
    flowResult: $('flow-result'),
    isNewBest: $('new-best'),
    submitBtn: $('btn-submit'),
    backendBadge: $('backend-badge'),
    backendBadgeResult: $('backend-badge-result'),
    loginHint: $('login-hint'),
  }
  let user: PlatformUser | null = null

  const show = (e: HTMLElement): void => { e.classList.remove('hidden') }
  const hide = (e: HTMLElement): void => { e.classList.add('hidden') }
  const showOnly = (target: HTMLElement, others: HTMLElement[]): void => {
    for (const o of others) hide(o)
    show(target)
  }

  const startBtn = $('btn-start')
  startBtn.addEventListener('click', () => cb.onStart())
  $('btn-resume').addEventListener('click', () => cb.onResume())
  $('btn-pause-restart').addEventListener('click', () => cb.onRestart())
  $('btn-restart').addEventListener('click', () => cb.onRestart())
  el.submitBtn.addEventListener('click', () => cb.onResubmit())

  const refreshLogin = (): void => {
    if (user && !user.anonymous) {
      el.loginHint.textContent = `已登录：${user.name ?? user.id ?? '玩家'}`
      el.loginHint.classList.remove('hidden')
    } else {
      el.loginHint.textContent = '未登录 —— 登录后可提交分数上榜'
      el.loginHint.classList.remove('hidden')
    }
  }

  return {
    showMenu(best, webgpu) {
      showOnly(el.menu, [el.hud, el.pause, el.result])
      el.bestMenu.textContent = best > 0 ? String(best) : '—'
      el.backendBadge.textContent = webgpu ? 'WebGPU ✓' : 'WebGL2 兼容模式'
      el.backendBadge.classList.toggle('legacy', !webgpu)
      refreshLogin()
    },
    showHud(h) {
      hide(el.menu)
      hide(el.pause)
      hide(el.result)
      show(el.hud)
      el.score.textContent = String(h.score)
      el.meters.textContent = h.meters + ' m'
      el.speed.textContent = h.speed.toFixed(1) + ' m/s'
      const fx: string[] = []
      if (h.mult > 1) fx.push('×2')
      if (h.shield) fx.push('🛡')
      if (h.magnet) fx.push('🧲')
      if (h.boost) fx.push('🚀')
      el.fx.textContent = fx.join(' ')
      // combo 条（×N + 4s 衰减进度；04 §1.4 HUD）
      if (h.comboMult > 1) {
        el.comboWrap.classList.remove('hidden')
        el.comboVal.textContent = '×' + h.comboMult.toFixed(2).replace(/0$/, '')
        el.comboBar.style.width = ((h.comboRemainingMs / 4000) * 100).toFixed(1) + '%'
      } else {
        el.comboWrap.classList.add('hidden')
      }
      el.groove.classList.toggle('hidden', !h.groove)
      el.groove.classList.toggle('active', h.groove)
    },
    hideHud() { hide(el.hud) },
    showPause() { show(el.pause) },
    hidePause() { hide(el.pause) },
    showResult(r) {
      showOnly(el.result, [el.hud, el.menu, el.pause])
      el.scoreResult.textContent = String(r.score)
      el.metersResult.textContent = r.meta.meters + ' m'
      el.coinsResult.textContent = String(r.meta.coins)
      el.cpsResult.textContent = String(r.meta.checkpoints)
      el.speedResult.textContent = r.meta.maxSpeed.toFixed(1) + ' m/s'
      el.nmResult.textContent = String(r.meta.nearMisses)
      el.flowResult.textContent = String(r.meta.flowPerfect)
      el.bestResult.textContent = String(r.best)
      el.isNewBest.classList.toggle('hidden', !r.isBest)
      el.backendBadgeResult.textContent = r.webgpu ? 'WebGPU ✓' : 'WebGL2 兼容模式'
      el.backendBadgeResult.classList.toggle('legacy', !r.webgpu)
      el.submitBtn.classList.toggle('hidden', !user || user.anonymous)
      refreshLogin()
    },
    setLoginUser(u) {
      user = u
      refreshLogin()
      if (!el.result.classList.contains('hidden')) {
        el.submitBtn.classList.toggle('hidden', !user || user.anonymous)
      }
    },
    float(text, cls = 'cyan') {
      const s = document.createElement('span')
      s.className = `float-txt float-${cls}`
      s.textContent = text
      s.style.left = `${46 + Math.random() * 8}%`
      el.floatLayer.appendChild(s)
      window.setTimeout(() => s.remove(), 900)
    },
  }
}
