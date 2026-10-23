/**
 * 输入（04 §1.1：桌面 A/D/←→ 换道、空格/W/↑ 跳（二段）、Shift 滑铲；
 * 移动：左/右滑换道、点按跳、下滑滑铲 + **底屏 25% 区域长按 300ms 滑铲**（04 W3 操作手感））。
 * 统一成 Command 事件，Game 消费（跳跃输入缓冲在 Game 侧，150ms 落地自动起跳）。
 */
export type Command =
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'jump' }
  | { type: 'slide' }

export type CommandSink = (cmd: Command) => void

interface Swipe {
  x: number
  y: number
  t: number
  active: boolean
  fired: boolean
}

export interface InputHandle {
  destroy(): void
}

const SWIPE_PX = 30
const SWIPE_MS = 300
const TAP_MS = 250
/** 底屏长按滑铲（04 W3：屏幕下 25% 区域按住 300ms 不移动 = 滑铲；触控目标 ≥48px 红线——整屏为触控面）。 */
const SLIDE_HOLD_MS = 300
const SLIDE_ZONE_FRAC = 0.75
const SLIDE_HOLD_DRAG_PX = 20

export function bindInput(sink: CommandSink, target: HTMLElement): InputHandle {
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': sink({ type: 'left' }); e.preventDefault(); break
      case 'ArrowRight': case 'KeyD': sink({ type: 'right' }); e.preventDefault(); break
      case 'Space': case 'ArrowUp': case 'KeyW': sink({ type: 'jump' }); e.preventDefault(); break
      case 'ShiftLeft': case 'ShiftRight': sink({ type: 'slide' }); e.preventDefault(); break
    }
  }
  window.addEventListener('keydown', onKey)

  const sw: Swipe = { x: 0, y: 0, t: 0, active: false, fired: false }
  let holdTimer: number | null = null
  const onTouchStart = (e: TouchEvent): void => {
    const t = e.changedTouches[0]
    sw.x = t.clientX; sw.y = t.clientY; sw.t = performance.now()
    sw.active = true; sw.fired = false
    // 底屏长按滑铲：起按点在下 25% → 300ms 未移动触发
    if (t.clientY / window.innerHeight >= SLIDE_ZONE_FRAC) {
      const sx = t.clientX, sy = t.clientY
      holdTimer = window.setTimeout(() => {
        holdTimer = null
        if (sw.active && !sw.fired) {
          const dx = Math.abs(sw.x - sx), dy = Math.abs(sw.y - sy) // 位置未动（sw 字段 = 起按点）
          if (dx < SLIDE_HOLD_DRAG_PX && dy < SLIDE_HOLD_DRAG_PX) {
            sw.fired = true
            sink({ type: 'slide' })
          }
        }
      }, SLIDE_HOLD_MS)
    }
  }
  const onTouchMove = (e: TouchEvent): void => {
    if (holdTimer !== null) {
      // 移动超阈 → 取消长按（回归滑动手势）
      const t = e.changedTouches[0]
      if (Math.abs(t.clientX - sw.x) > SLIDE_HOLD_DRAG_PX || Math.abs(t.clientY - sw.y) > SLIDE_HOLD_DRAG_PX) {
        clearTimeout(holdTimer)
        holdTimer = null
      }
    }
    if (!sw.active || sw.fired) return
    const t = e.changedTouches[0]
    const dx = t.clientX - sw.x
    const dy = t.clientY - sw.y
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      sink({ type: dx > 0 ? 'right' : 'left' })
      sw.fired = true
    } else if (dy >= SWIPE_PX && Math.abs(dy) > Math.abs(dx)) {
      sink({ type: 'slide' })
      sw.fired = true
    }
  }
  const onTouchEnd = (e: TouchEvent): void => {
    if (holdTimer !== null) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
    if (!sw.active) return
    sw.active = false
    if (!sw.fired && performance.now() - sw.t < TAP_MS) {
      const dy = e.changedTouches[0].clientY - sw.y
      if (Math.abs(dy) < SWIPE_PX) sink({ type: 'jump' }) // 点按 = 跳
    }
  }
  target.addEventListener('touchstart', onTouchStart, { passive: true })
  target.addEventListener('touchmove', onTouchMove, { passive: true })
  target.addEventListener('touchend', onTouchEnd, { passive: true })

  return {
    destroy() {
      if (holdTimer !== null) clearTimeout(holdTimer)
      window.removeEventListener('keydown', onKey)
      target.removeEventListener('touchstart', onTouchStart, { passive: true } as EventListenerOptions)
      target.removeEventListener('touchmove', onTouchMove, { passive: true } as EventListenerOptions)
      target.removeEventListener('touchend', onTouchEnd, { passive: true } as EventListenerOptions)
    },
  }
}
