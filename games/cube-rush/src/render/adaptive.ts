/**
 * 自适应三档画质（04 §2.3/§3：0.5s 滑动窗口 FPS 决策；像素比/粒子/判定三开关）。
 * - T0 高档：dpr = min(devicePixelRatio, 2)，粒子 100%
 * - T1 中档：dpr = 1.5，粒子 50%
 * - T2 低档：dpr = 1.0，粒子 0%，**节奏门降级「只通过不判定」（04 §1.5 公平性）**
 * 降级：FPS<40 持续 1s；升级：FPS>55 持续 10s（逐级回爬）。
 * 触控设备（pointer: coarse）默认 T1 起步（04 §3：移动端默认起步中档）。
 */

export type Tier = 0 | 1 | 2

const TIER_DPR = [2, 1.5, 1.0] as const
const TIER_PARTICLES = [1, 0.5, 0] as const

export interface AdaptiveQuality {
  tier(): Tier
  dpr(devicePixelRatio: number): number
  particles(): number
  /** T2 低档：节奏门「只通过不判定」（04 §1.5：低端机不产生不公平）。 */
  rhythmJudged(): boolean
  /** 每渲染帧喂帧（dtMs 实际帧间隔）。档位变化时回调 onTier。 */
  note(dtMs: number): void
}

export function createAdaptiveQuality(isTouch: boolean, onTier?: (t: Tier) => void): AdaptiveQuality {
  let tier: Tier = isTouch ? 1 : 0
  let winFrames = 0
  let winMs = 0
  let badStreakMs = 0
  let goodStreakMs = 0
  let lastApply = 0

  function note(dtMs: number): void {
    // 遮挡/切页产物（dt 被 Game 夹到 250）不计入窗口——避免误降档（04 §2.3）
    if (dtMs >= 250) return
    winFrames += 1
    winMs += dtMs
    if (winMs < 500) return // 0.5s 滑动窗口
    const fps = (winFrames / winMs) * 1000
    winFrames = 0
    winMs = 0
    if (fps < 40) {
      badStreakMs += 500
      goodStreakMs = 0
    } else if (fps > 55) {
      goodStreakMs += 500
      badStreakMs = 0
    } else {
      badStreakMs = 0
      goodStreakMs = 0
    }
    const now = performance.now()
    if (tier < 2 && badStreakMs >= 1000 && now - lastApply > 1000) {
      tier = (tier + 1) as Tier
      lastApply = now
      badStreakMs = 0
      onTier?.(tier)
    } else if (tier > 0 && goodStreakMs >= 10_000 && now - lastApply > 1000) {
      tier = (tier - 1) as Tier
      lastApply = now
      goodStreakMs = 0
      onTier?.(tier)
    }
  }

  return {
    tier: () => tier,
    dpr(d) {
      return Math.min(d, TIER_DPR[tier])
    },
    particles: () => TIER_PARTICLES[tier],
    rhythmJudged: () => tier < 2,
    note,
  }
}
