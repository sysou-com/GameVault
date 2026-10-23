/** 判定档位与分值（06 文档 §1.1；纯函数，单测锁边界）。 */
export type Grade = 'PERFECT' | 'GOOD' | 'OK' | 'MISS'

export interface JudgeResult {
  grade: Grade
  points: number
  /** 是否延续连击（PERFECT/GOOD 延续；OK/MISS 清零） */
  comboHit: boolean
}

/**
 * deviationMs = 输入时刻 - 拍点时刻（可为负=早按）。
 * |偏差| ≤30ms PERFECT(100) / ≤80ms GOOD(50) / ≤150ms OK(20) / 其余 MISS(0)
 */
export function judge(deviationMs: number): JudgeResult {
  const a = Math.abs(deviationMs)
  if (a <= 30) return { grade: 'PERFECT', points: 100, comboHit: true }
  if (a <= 80) return { grade: 'GOOD', points: 50, comboHit: true }
  if (a <= 150) return { grade: 'OK', points: 20, comboHit: false }
  return { grade: 'MISS', points: 0, comboHit: false }
}

/**
 * 连击加成：每次命中（PERFECT/GOOD）+5，每局上限 60
 *（12 拍全中 = 12×5，与 06 文档 §1.2「12×100 + 连击加成 max 60 = 1260」一致）。
 * budgetLeft = 本局剩余加成额度。
 */
export const COMBO_BONUS_PER_HIT = 5
export function comboBonus(budgetLeft: number): number {
  return Math.min(COMBO_BONUS_PER_HIT, Math.max(0, budgetLeft))
}
