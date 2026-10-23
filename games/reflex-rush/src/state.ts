/** 状态机（06 文档 §2：联合类型穷举）。 */
import type { Grade } from './judge'

export type Phase = 'idle' | 'countdown' | 'running' | 'result'

export interface BeatOutcome {
  index: number
  decoy: boolean
  /** 偏差 ms（未按 = null） */
  deviationMs: number | null
  grade: Grade
  points: number
}

export interface RunResult {
  score: number
  perfect: number
  good: number
  ok: number
  miss: number
  maxStreak: number
  /** 平均偏差（ms，1 位小数；只统计有输入的拍） */
  avgDeviationMs: number | null
  outcomes: BeatOutcome[]
  livesLeft: number
}
