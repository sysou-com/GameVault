/**
 * 连击计时（03 文档 §1.2：连击 n = 不中弹累计击杀；§2.3：1.5s 窗口）。
 * 语义：击杀 +1；超过 comboWindowMs 未再击杀 → 归零；受击 → 归零。
 * 纯逻辑，无 Phaser 依赖（可单测）。
 */
import { SCORE } from '../core/constants.ts'

export class Combo {
  n = 0
  best = 0
  private lastKillAt = -Infinity

  /** 记录一次击杀（nowMs 单调时钟）；返回本次连击值 */
  kill(nowMs: number): number {
    if (nowMs - this.lastKillAt > SCORE.comboWindowMs) this.n = 0
    this.n++
    this.lastKillAt = nowMs
    if (this.n > this.best) this.best = this.n
    return this.n
  }

  hit(): void {
    this.n = 0
    this.lastKillAt = -Infinity
  }

  /** 得分加成（03 §1.2：× (1 + min(n,50)×0.01)） */
  multiplier(): number {
    return SCORE.comboMultiplier(this.n)
  }

  /** 结算时把窗口外的连击视为失效 */
  expire(nowMs: number): void {
    if (nowMs - this.lastKillAt > SCORE.comboWindowMs) this.n = 0
  }
}
