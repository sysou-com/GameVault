/**
 * UI 覆盖层（DOM；菜单/暂停/结算/HUD/设置。CSS 在 index.html <style>）。
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

export interface Ui {
  showMenu(best: number, webgpu: boolean): void
  showHud(h: { score: number; meters: number; speed: number; mult: number; shield: boolean; magnet: boolean }): void
  hideHud(): void
  showPause(): void
  hidePause(): void
  showResult(r: { score: number; meta: ScoreMeta; best: number; isBest: boolean; webgpu: boolean }): void
  setLoginUser(u: PlatformUser | null): void
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
    bestMenu: $('best-menu'),
    bestResult: $('best-result'),
    scoreResult: $('score-result'),
    metersResult: $('meters-result'),
    coinsResult: $('coins-result'),
    cpsResult: $('cps-result'),
    speedResult: $('speed-result'),
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
      el.fx.textContent = fx.join(' ')
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
  }
}
