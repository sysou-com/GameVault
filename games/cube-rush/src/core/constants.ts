/**
 * 方块狂奔 · 全局常量与数据表（设计 04 文档 §1；数据驱动，调平只改这里）。
 * 坐标约定：玩家 z=0 向 -z 前进；车道 x = -1.2 / 0 / +1.2。
 */

export const LANES = [-1.2, 0, 1.2] as const;

/** 玩家 AABB（0.8³ 基准；滑铲时高 0.45）。 */
export const PLAYER = {
  width: 0.8,
  height: 0.8,
  slideHeight: 0.45,
  laneLerpMs: 150,      // 换道插值时长（easeOut）
} as const;

/** 速度曲线（m/s）：起点 14，3000m 封顶 30；每 250m 一档。 */
export const SPEED = {
  base: 14,
  max: 30,
  perStep: 0.8,
  stepMeters: 250,
} as const;

/** 跳跃物理（抛物线；vy0/g 决定滞空 ~0.79s、峰值 ~1.9m）。 */
export const JUMP = {
  vy0: 9.5,
  gravity: -24,
  doubleJumpVy: 7.5,
} as const;

/** 滑铲时长（ms）。 */
export const SLIDE_MS = 600;

/** 障碍尺寸（AABB 宽/高/长，米；z 向长度）。 */
export const OBSTACLE = {
  block:   { w: 1.0, h: 1.6, d: 0.8, y: 0 },    // 路障块（地面，跳/换道）
  laserLow:{ w: 3.6, h: 0.9, d: 0.25, y: 0 },   // 低激光栏（必须跳；跨全宽或单道由导演指定）
  laserHigh:{ w: 3.6, h: 1.85, d: 0.25, y: 0.55 }, // 高激光栏（0.55–2.4：站立撞/跳跃峰值 1.9 也撞 → 必须滑铲）
  saw:     { w: 2.4, h: 0.9, d: 0.7, y: 0.45 }, // 旋转锯（占两道，y0.45 中心）
} as const;

export type ObstacleKind = 'block' | 'laserLow' | 'laserHigh' | 'saw';

/** 障碍配色（emissive 霓虹）。 */
export const OBSTACLE_STYLE: Record<ObstacleKind, { color: number; emissive: number }> = {
  block:     { color: 0x39394d, emissive: 0xff2d78 },
  laserLow:  { color: 0x1a1a2e, emissive: 0x00e5ff },
  laserHigh: { color: 0x1a1a2e, emissive: 0xffb300 },
  saw:       { color: 0x2b2b3d, emissive: 0xff5722 },
};

/** 生成导演：按 meters 的难度表（每 200m 一档，权重和=100）。 */
export interface SpawnBand {
  from: number;
  gap: [number, number];        // 障碍间隔（米）范围
  weights: Record<ObstacleKind, number>;
}
export const SPAWN_BANDS: SpawnBand[] = [
  { from: 0,    gap: [9, 12],  weights: { block: 60, laserLow: 20, laserHigh: 10, saw: 0  } },
  { from: 400,  gap: [8, 11],  weights: { block: 45, laserLow: 20, laserHigh: 15, saw: 20 } },
  { from: 1200, gap: [7, 9],   weights: { block: 38, laserLow: 18, laserHigh: 20, saw: 24 } },
  { from: 2500, gap: [6, 8],   weights: { block: 32, laserLow: 16, laserHigh: 22, saw: 30 } },
];

/** 能量门：×2 得分 10s / 护盾 3s / 磁力 8s。 */
export const ENERGY = {
  score:  { ms: 10000, color: 0x00ff88 },
  shield: { ms: 3000,  color: 0x00e5ff },
  magnet: { ms: 8000,  color: 0xffb300 },
} as const;
export const ENERGY_GATE_EVERY_M = 750;   // 每 750m 一个能量门（类型轮转 score→shield→magnet）

/** 检查点闪门：每 500m，+5000 分 + 1.5s 无敌。 */
export const CHECKPOINT = { everyM: 500, score: 5000, invincibleMs: 1500 } as const;

/** 金币（100×倍率；磁力 8s 内自动吸附）。 */
export const COIN = { value: 100, pickupRadius: 0.6, magnetRadius: 2.2, perRun: [2, 5] as const } as const;

/** 计分（04 §1.2）。 */
export const SCORE = {
  perMeter: 1,
  noHitSegmentM: 500,
  noHitSegmentScore: 2000,
  max: 99999999,
} as const;

/** 逻辑固定步长（60Hz）。 */
export const STEP_MS = 1000 / 60;
/** 渲染帧内最多补的逻辑步（防螺旋死亡）。 */
export const MAX_CATCHUP_STEPS = 3;

/** 轨道块：4 块 × 100m；玩家推进 50m 触发最远块重排。 */
export const TRACK = { chunkM: 100, chunks: 4, refillAtM: 50 } as const;
