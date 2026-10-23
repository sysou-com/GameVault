/** 单局运行状态（跨关卡累计；03 文档 §1.2 计分） */
import { SCORE } from './constants.ts'

export interface RunState {
  score: number
  bestCombo: number
  wavesCleared: number
  elitesKilled: number
  levelsCleared: number
  levelIdx: number        // 0..2
  playMs: number
  doubleShotUntilMs: number
  doubleShotStacks: number
  shield: boolean
  invincibleUntilMs: number
  died: boolean
}

export function newRun(levelIdx = 0): RunState {
  return {
    score: 0, bestCombo: 0, wavesCleared: 0, elitesKilled: 0,
    levelsCleared: 0, levelIdx, playMs: 0,
    doubleShotUntilMs: 0, doubleShotStacks: 0,
    shield: false, invincibleUntilMs: 0, died: false,
  }
}

export function addScore(run: RunState, base: number, mult: number): void {
  run.score = Math.min(SCORE.max, run.score + Math.round(base * mult))
}

export function isInvincible(run: RunState, nowMs: number): boolean {
  return nowMs < run.invincibleUntilMs
}
