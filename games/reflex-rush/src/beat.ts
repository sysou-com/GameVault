/** 节拍调度（06 文档 §1.1；纯逻辑 + 确定性 RNG，单测覆盖）。 */

export interface BeatPlan {
  index: number
  /** 距 run 开始的绝对时刻（ms） */
  atMs: number
  /** 距上一拍间隔（ms） */
  intervalMs: number
  /** 假环：闪烁不收缩，按了 = MISS（专家模式） */
  decoy: boolean
}

export interface BeatOpts {
  totalBeats?: number
  /** 普通模式间隔下限 900ms；专家模式 700ms */
  minMs?: number
  maxMs?: number
  /** 局内逐拍加速系数（0.97 = 每拍快 3%） */
  accel?: number
  /** 专家模式：间隔下限 700ms + 1 拍假环（06 文档 §1.1） */
  expert?: boolean
}

/** 确定性 32 位 LCG 风格 RNG（mulberry32） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST_BEAT_DELAY_MS = 1500
const HARD_MIN_INTERVAL_MS = 500

export function planBeats(rng: () => number, opts: BeatOpts = {}): BeatPlan[] {
  const total = opts.totalBeats ?? 12
  const min = opts.expert ? (opts.minMs ?? 700) : (opts.minMs ?? 900)
  const max = opts.maxMs ?? 1600
  const accel = opts.accel ?? 0.97

  let decoyIndex = -1
  if (opts.expert && total > 3) {
    // 专家模式插入 1 拍假环；不放在前两拍/末拍（给玩家建立节奏的时间）
    decoyIndex = 2 + Math.floor(rng() * (total - 3))
  }

  const plans: BeatPlan[] = []
  let t = FIRST_BEAT_DELAY_MS
  let interval = min + (max - min) * rng()
  for (let i = 0; i < total; i++) {
    t += interval
    plans.push({
      index: i,
      atMs: Math.round(t),
      intervalMs: Math.round(interval),
      decoy: i === decoyIndex,
    })
    // 逐拍加速 + 快慢随机（±10%），下限 500ms 防不可玩
    interval = Math.max(HARD_MIN_INTERVAL_MS, interval * accel * (0.9 + rng() * 0.2))
  }
  return plans
}
