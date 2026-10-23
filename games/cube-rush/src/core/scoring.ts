/**
 * 计分（04 文档 §1.2）——纯函数，单测覆盖。
 * 规则（倍率按「获得时」累计，非结算推导）：
 * - 距离 1 分/米 × 当前倍率（tick 累加）
 * - 金币 100 × 当前倍率（拾取时累加）
 * - 检查点 5000
 * - 无伤通过 500m 段 2000
 * score.range 0–99,999,999（manifest 与 SCORE.max 一致）。
 */
import { SCORE, CHECKPOINT } from './constants.ts';

export interface ScoreState {
  meters: number;            // 已完成米数（float 累加，读时 floor）
  coins: number;             // 金币个数（int）
  magnetCoins: number;       // 磁力期间吸到的金币（成就 MAGNET_MASTER）
  checkpoints: number;       // 已穿过检查点数（int）
  hits: number;              // 受伤次数（0 = 无伤）
  multiplier: number;        // 当前倍率（1 或 2）
  distanceScore: number;     // 距离分累加器（float）
  coinScore: number;         // 金币分累加器（int）
}

export function newScoreState(): ScoreState {
  return {
    meters: 0, coins: 0, magnetCoins: 0, checkpoints: 0, hits: 0,
    multiplier: 1, distanceScore: 0, coinScore: 0,
  };
}

/** 每 tick 调用：推进 deltaM 米（带当前倍率）。 */
export function addDistance(s: ScoreState, deltaM: number): void {
  s.meters += deltaM;
  s.distanceScore += deltaM * SCORE.perMeter * s.multiplier;
}

/** 拾取 1 枚金币（带当前倍率；magnet=true 时计入磁力成就字段）。 */
export function addCoin(s: ScoreState, magnet: boolean): void {
  s.coins += 1;
  s.coinScore += 100 * s.multiplier;
  if (magnet) s.magnetCoins += 1;
}

/** 穿过检查点。 */
export function addCheckpoint(s: ScoreState): void {
  s.checkpoints += 1;
}

/** 受伤（护盾/无敌期由调用方先判断）。 */
export function addHit(s: ScoreState): void {
  s.hits += 1;
}

/** 无伤 500m 段分（受伤后归零段数）。 */
export function cleanSegmentScore(s: ScoreState): number {
  return s.hits === 0
    ? Math.floor(s.meters / SCORE.noHitSegmentM) * SCORE.noHitSegmentScore
    : 0;
}

/** 总分。 */
export function totalScore(s: ScoreState): number {
  return clampScore(Math.floor(s.distanceScore) + s.coinScore + s.checkpoints * CHECKPOINT.score + cleanSegmentScore(s));
}

/** 结算 meta 形状（与 platform/types.ts 的 ScoreMeta 一致；metaSchema 仅 int|bool 字段）。 */
export interface RunMetaShape {
  meters: number
  coins: number
  magnetCoins: number
  checkpoints: number
  maxSpeed: number
  clean: boolean
}

/** 结算 meta（04 §1.2：meters/coins/checkpoints/maxSpeed + 成就扩展字段）。 */
export function runMeta(s: ScoreState, maxSpeed: number): RunMetaShape {
  return {
    meters: Math.floor(s.meters),
    coins: s.coins,
    magnetCoins: s.magnetCoins,
    checkpoints: s.checkpoints,
    // metaSchema 仅支持 int|string|bool —— maxSpeed 取整（m/s）
    maxSpeed: Math.round(maxSpeed),
    /** 2000m 无伤（成就 NO_HIT_2K 用 game_over meta 子集匹配）。 */
    clean: s.hits === 0 && Math.floor(s.meters) >= 2000,
  };
}

export function clampScore(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(Math.floor(v), SCORE.max);
}
