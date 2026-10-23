/** 分数 meta（manifest.score.metaSchema 声明，平台服务端校验 + 成就规则读取）。
 * 注意：combo_gte 规则要求 meta 字段为整数（metaIntegral），meters/coins/magnetCoins 必须 int。 */
export interface ScoreMeta {
  meters: number
  coins: number
  magnetCoins: number
  checkpoints: number
  maxSpeed: number
  /** 2000m 无伤（成就 NO_HIT_2K：game_over meta 子集 {clean:true}）。 */
  clean: boolean
}

export interface RunResult {
  score: number
  meta: ScoreMeta
  meters: number
}
