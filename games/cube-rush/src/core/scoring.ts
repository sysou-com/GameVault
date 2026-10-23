/**
 * 计分（04 文档 §1.2/§1.4）——纯函数，单测覆盖。
 * 规则（倍率按「获得时」累计，非结算推导）：
 * - 距离 1 分/米 × 生效倍率（tick 累加）
 * - 金币 100 × 生效倍率 / 大金币 1000 × 生效倍率（拾取时累加）
 * - 检查点 5000（固定）；无伤通过 500m 段 2000（固定）
 * - 近失擦过 200 × 生效倍率（§1.4）
 * - FLOW PERFECT +1000 / GOOD +300（固定；§1.5）
 * - Boost 门 2s 期间 +1000/s（固定；§1.1）
 * 生效倍率 = 能量门倍率 × 连击倍率 × FLOW 倍率 × Groove 倍率（由 Game 计算后显式传入）。
 * score.range 0–99,999,999（manifest 与 SCORE.max 一致）。
 */
import { SCORE, CHECKPOINT } from './constants.ts';

export interface ScoreState {
  meters: number;            // 已完成米数（float 累加，读时 floor）
  coins: number;             // 金币个数（int）
  magnetCoins: number;       // 磁力期间吸到的金币（成就 MAGNET_MASTER）
  checkpoints: number;       // 已穿过检查点数（int）
  hits: number;              // 受伤次数（0 = 无伤）
  multiplier: number;        // 能量门倍率（1 或 2）
  distanceScore: number;     // 距离分累加器（float）
  coinScore: number;         // 金币分累加器（int）
  bonusScore: number;        // 近失/FLOW/Boost 固定加分累加器（int）
  nearMisses: number;        // 近失次数（§1.4）
  flowPerfect: number;       // FLOW PERFECT 次数（§1.5）
  flowGood: number;          // FLOW GOOD 次数（§1.5）
}

export function newScoreState(): ScoreState {
  return {
    meters: 0, coins: 0, magnetCoins: 0, checkpoints: 0, hits: 0,
    multiplier: 1, distanceScore: 0, coinScore: 0, bonusScore: 0,
    nearMisses: 0, flowPerfect: 0, flowGood: 0,
  };
}

/** 每 tick 调用：推进 deltaM 米（带生效倍率）。 */
export function addDistance(s: ScoreState, deltaM: number, effMult: number): void {
  s.meters += deltaM;
  s.distanceScore += deltaM * SCORE.perMeter * effMult;
}

/** 拾取金币（带生效倍率；big=大金币 1000；magnet=true 时计入磁力成就字段）。 */
export function addCoin(s: ScoreState, magnet: boolean, effMult: number, big: boolean): void {
  s.coins += 1;
  s.coinScore += (big ? SCORE.bigCoin : 100) * effMult;
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

/** 固定加分（近失×倍率由调用方乘好；FLOW/Boost 原值）。 */
export function addBonus(s: ScoreState, points: number): void {
  s.bonusScore += Math.floor(points);
}

/** 无伤 500m 段分（受伤后归零段数）。 */
export function cleanSegmentScore(s: ScoreState): number {
  return s.hits === 0
    ? Math.floor(s.meters / SCORE.noHitSegmentM) * SCORE.noHitSegmentScore
    : 0;
}

/** 总分。 */
export function totalScore(s: ScoreState): number {
  return clampScore(Math.floor(s.distanceScore) + s.coinScore + s.bonusScore
    + s.checkpoints * CHECKPOINT.score + cleanSegmentScore(s));
}

/** 结算 meta 形状（与 platform/types.ts 的 ScoreMeta 一致；metaSchema 仅 int|string|bool 字段）。 */
export interface RunMetaShape {
  meters: number
  coins: number
  magnetCoins: number
  checkpoints: number
  maxSpeed: number
  nearMisses: number
  flowPerfect: number
  /** 2000m 无伤（成就 NO_HIT_2K 用 game_over meta 子集匹配）。 */
  clean: boolean
  mode: string
}

/** 结算 meta（04 §1.2：meters/coins/checkpoints/maxSpeed/nearMisses/flowPerfect/mode）。 */
export function runMeta(s: ScoreState, maxSpeed: number, mode: string): RunMetaShape {
  return {
    meters: Math.floor(s.meters),
    coins: s.coins,
    magnetCoins: s.magnetCoins,
    checkpoints: s.checkpoints,
    // metaSchema 仅支持 int|string|bool —— maxSpeed 取整（m/s）
    maxSpeed: Math.round(maxSpeed),
    nearMisses: s.nearMisses,
    flowPerfect: s.flowPerfect,
    /** 2000m 无伤（成就 NO_HIT_2K 用 game_over meta 子集匹配）。 */
    clean: s.hits === 0 && Math.floor(s.meters) >= 2000,
    mode,
  };
}

export function clampScore(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(Math.floor(v), SCORE.max);
}

// ---- 连击（04 §1.4：连续「近失/金币/FLOW」累加；×1→×8（每次 +0.25 封顶）；4s 无新累积回落；受击清零）----

export const COMBO = { perStep: 0.25, cap: 8, decayMs: 4000 } as const;

export interface ComboState {
  count: number
  mult: number
  lastMs: number // 上次累积时刻（逻辑时钟 ms）
}

export function newCombo(nowMs: number): ComboState {
  return { count: 0, mult: 1, lastMs: nowMs };
}

export function comboBump(c: ComboState, nowMs: number): void {
  c.count += 1;
  c.mult = Math.min(COMBO.cap, 1 + c.count * COMBO.perStep);
  c.lastMs = nowMs;
}

/** 每 tick：4s 无新累积 → 回落 ×1。 */
export function comboTick(c: ComboState, nowMs: number): void {
  if (c.count > 0 && nowMs - c.lastMs >= COMBO.decayMs) {
    c.count = 0;
    c.mult = 1;
  }
}

export function comboReset(c: ComboState): void {
  c.count = 0;
  c.mult = 1;
}

/** 衰减进度条用：剩余回落毫秒（0..4000）。 */
export function comboRemainingMs(c: ComboState, nowMs: number): number {
  if (c.count === 0) return 0;
  return Math.max(0, COMBO.decayMs - (nowMs - c.lastMs));
}
