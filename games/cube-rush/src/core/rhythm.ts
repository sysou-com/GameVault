/**
 * 节拍生成系统核心（04 文档 §1.5 本游戏「奇」点——纯逻辑层，单测覆盖）。
 * 「关卡即音乐」：BGM 固定 128 BPM 4/4（synth.ts 同源），节拍时间线是纯函数；
 * 导演把障碍/门/金币量化到节拍（SpawnCmd.z = beatTime × speed 的时间反演），
 * 玩家跑起来自然跟拍——节奏从「装饰」变成「关卡结构」。
 *
 * 判定时钟（04 §5 风险对策）：用**固定 60Hz 逻辑步累积的运行时间**（runTimeMs），
 * 不读 rAF 时间戳、不读 AudioContext 时钟——低端机帧率漂移不影响判定公平。
 */
import { SPEED } from './constants.ts'

export const BPM = 128
/** 一拍毫秒（128 BPM：468.75ms）。 */
export const BEAT_DUR_MS = 60_000 / BPM
export const BEATS_PER_BAR = 4

/** 速度曲线（与 Game 主循环同源：每 250m 一档，30m/s 封顶）。 */
export function speedAtMeter(m: number): number {
  const steps = Math.max(0, Math.floor(m / SPEED.stepMeters))
  return Math.min(SPEED.max, SPEED.base + steps * SPEED.perStep)
}

/** 从 0 米跑到 m 米所需时间（秒）。分段线性：每 250m 档速度恒定。 */
export function timeAtMeters(m: number): number {
  if (m <= 0) return 0
  const stepM = SPEED.stepMeters
  const fullSteps = Math.floor(m / stepM)
  let t = 0
  for (let k = 0; k < fullSteps; k++) t += stepM / speedAtMeter(k * stepM)
  const rem = m - fullSteps * stepM
  if (rem > 0) t += rem / speedAtMeter(fullSteps * stepM)
  return t
}

/** timeAtMeters 的逆：运行时间 t（秒）→ 米位（理想速度曲线下）。 */
export function metersAtTime(t: number): number {
  if (t <= 0) return 0
  const stepM = SPEED.stepMeters
  let rem = t
  let m = 0
  for (let k = 0; k < 1024; k++) {
    const v = speedAtMeter(k * stepM)
    if (v >= SPEED.max) return m + rem * v // 封顶段：恒速直解
    const segDur = stepM / v
    if (rem <= segDur) return m + rem * v
    rem -= segDur
    m += stepM
  }
  return m + rem * SPEED.max
}

/** 米位 → 最近节拍序号（四舍五入）。 */
export function beatIndexAtMeter(m: number): number {
  return Math.round((timeAtMeters(m) * 1000) / BEAT_DUR_MS)
}

/** 米位量化到最近节拍对应的米位（导演用：障碍/门/金币「落在拍上」）。 */
export function quantizeToBeat(m: number): number {
  const k = Math.round((timeAtMeters(m) * 1000) / BEAT_DUR_MS)
  return metersAtTime((k * BEAT_DUR_MS) / 1000)
}

/** ≥m 的第一个节拍米位（块首呼吸距离保底用）。 */
export function firstBeatAtOrAfter(m: number): number {
  const k = Math.ceil((timeAtMeters(m) * 1000) / BEAT_DUR_MS)
  return metersAtTime((k * BEAT_DUR_MS) / 1000)
}

/** ≥m 且与 lastM 间隔 ≥minGap 的第一个节拍米位。 */
export function nextBeatAfter(m: number, lastM: number, minGap: number): number {
  let k = Math.ceil((timeAtMeters(m) * 1000) / BEAT_DUR_MS)
  let mm = metersAtTime((k * BEAT_DUR_MS) / 1000)
  while (mm - lastM < minGap) {
    k += 1
    mm = metersAtTime((k * BEAT_DUR_MS) / 1000)
  }
  return mm
}

// ---- 节奏门 / FLOW（04 §1.5）----

export const RHYTHM = {
  firstGateM: 600,    // 600m 后出现
  everyM: 400,        // 约每 400m 一扇
  perfectMs: 90,      // |Δt| ≤ 90ms → FLOW PERFECT
  goodMs: 180,        // |Δt| ≤ 180ms → FLOW GOOD
  pressWindowMs: 300, // 门判定窗口（窗口外的按键不构成判定）
  flowMs: 5000,       // FLOW 倍率持续
  perfectScore: 1000,
  goodScore: 300,
  perfectMult: 2,
  goodMult: 1.2,
  grooveStreak: 3,    // 连续 3 次 PERFECT → Groove
  grooveMult: 1.5,
  clearM: 18,         // 节奏门 ±18m 内清空障碍（呼吸段）
} as const

export type FlowVerdict = 'perfect' | 'good' | 'miss'

/** FLOW 判定纯函数（04 §1.5；边界表形状同 reflex-rush judge.ts）。 */
export function judgeFlow(deltaMs: number): FlowVerdict {
  const d = Math.abs(deltaMs)
  if (d <= RHYTHM.perfectMs) return 'perfect'
  if (d <= RHYTHM.goodMs) return 'good'
  return 'miss'
}

/** Groove 状态（连续 PERFECT 计数；连续 3 次激活；受击中断）。 */
export interface GrooveState {
  streak: number
  active: boolean
}

export function newGroove(): GrooveState {
  return { streak: 0, active: false }
}

export function grooveOnPerfect(g: GrooveState): void {
  g.streak += 1
  if (g.streak >= RHYTHM.grooveStreak) g.active = true
}

/** 非 PERFECT 通过（GOOD/miss/无按压）：连续计数归零（Groove 一旦激活保持，直到受击）。 */
export function grooveOnNonPerfect(g: GrooveState): void {
  g.streak = 0
}

export function grooveOnHit(g: GrooveState): void {
  g.streak = 0
  g.active = false
}

/**
 * 节奏门按压→结算状态机（04 §1.5；纯函数级，单测回归「先删后读」bug：
 * 旧实现 settle 里 gatePress.delete(meter) 在 get(meter) 之前 → 永远读不到按压 → FLOW 永不触发）。
 */
export class RhythmGateJudge {
  private pressed = new Map<number, number>() // meter → 按压逻辑时刻(beatMs)
  private settled = new Set<number>()
  /** 泡测追踪：每次 settle 的结果（?debug=1 用）。 */
  settleTrace: { meter: number; result: string; pressDelta: number | null }[] = []

  /** 按压登记（04 §1.5：按压=跳跃；±300ms 窗口内且未登记过才有效）。返回是否登记成功。 */
  registerPress(meter: number, beatMs: number, beatIndex: number): boolean {
    if (this.settled.has(meter)) return false
    const d = beatMs - beatIndex * BEAT_DUR_MS
    if (Math.abs(d) <= RHYTHM.pressWindowMs && !this.pressed.has(meter)) {
      this.pressed.set(meter, beatMs)
      return true
    }
    return false
  }

  /** 门通过结算：'perfect' | 'good' | 'miss'（窗口内但偏拍，不奖励不惩罚）| 'none'（无按压=普通通过）。 */
  settle(meter: number, beatIndex: number): 'perfect' | 'good' | 'miss' | 'none' {
    this.settled.add(meter)
    const pressT = this.pressed.get(meter) // 先读……
    this.pressed.delete(meter)             // ……后删（顺序错误 = FLOW 永不触发）
    const result: 'perfect' | 'good' | 'miss' | 'none' = pressT === undefined ? 'none' : judgeFlow(pressT - beatIndex * BEAT_DUR_MS)
    this.settleTrace.push({ meter, result, pressDelta: pressT === undefined ? null : pressT - beatIndex * BEAT_DUR_MS })
    return result
  }

  isSettled(meter: number): boolean {
    return this.settled.has(meter)
  }

  /** 泡测：当前已登记未结算的按压 meter 列表。 */
  pressedMeters(): number[] {
    return [...this.pressed.keys()]
  }

  /** 泡测 warp 用：已过的门直接标记结算（不触发判定副作用）。 */
  markSettled(meter: number): void {
    this.settled.add(meter)
  }

  reset(): void {
    this.pressed.clear()
    this.settled.clear()
    this.settleTrace.length = 0
  }
}
