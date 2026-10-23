/**
 * 输入（04 §1.1：桌面 A/D/←→ 换道、空格/W/↑ 跳（二段）、Shift 滑铲；
 * 移动：左/右滑换道、点按跳、下滑滑铲）。统一成 Command 事件，Game 消费。
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
  const onTouchStart = (e: TouchEvent): void => {
    const t = e.changedTouches[0]
    sw.x = t.clientX; sw.y = t.clientY; sw.t = performance.now()
    sw.active = true; sw.fired = false
  }
  const onTouchMove = (e: TouchEvent): void => {
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
      window.removeEventListener('keydown', onKey)
      target.removeEventListener('touchstart', onTouchStart)
      target.removeEventListener('touchmove', onTouchMove)
      target.removeEventListener('touchend', onTouchEnd)
    },
  }
}
