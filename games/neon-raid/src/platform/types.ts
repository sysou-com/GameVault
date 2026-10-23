/** 分数 meta（manifest.score.metaSchema 声明，平台服务端校验 + 成就规则读取） */
export interface ScoreMeta {
  bestCombo: number
  wavesCleared: number
  elitesKilled: number
}

export interface RunResult {
  score: number
  meta: ScoreMeta
  levelsCleared: number
  died: boolean
  playMs: number
}
