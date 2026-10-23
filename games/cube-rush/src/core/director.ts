/**
 * 障碍生成导演（04 §2.3：seed + blockIndex 确定性，重开同距离布局可复现）。
 * 纯逻辑层：只产出「计划」（距离/种类/车道），渲染层负责实例化。
 */
import { SPAWN_BANDS, ENERGY_GATE_EVERY_M, CHECKPOINT, COIN, type ObstacleKind } from './constants.ts';
import { mulberry32, range, pickWeighted, type Rng } from './rng.ts';

export interface SpawnPlan {
  /** 距本局起点的米数（单调递增）。 */
  meter: number;
  kind: ObstacleKind;
  /** 障碍占用的车道索引（0/1/2；laserLow/High 可跨多道，saw 占相邻两道）。 */
  lanes: number[];
  /** 金币串（仅 coin 计划项）。 */
  coins?: number; // 金币数量
}

export interface ChunkPlan {
  chunkIndex: number;
  fromM: number;
  toM: number;
  items: SpawnPlan[];
  /** 本块能量门（可空）。 */
  energyGate?: { meter: number; type: 'score' | 'shield' | 'magnet' };
  /** 本块检查点（可空）。 */
  checkpoint?: number; // 米数
}

function bandFor(m: number) {
  let b = SPAWN_BANDS[0];
  for (const cand of SPAWN_BANDS) if (m >= cand.from) b = cand;
  return b;
}

/** 检查点落在 500 的倍数（块内）。 */
export function planChunk(seed: number, chunkIndex: number, chunkM: number): ChunkPlan {
  const fromM = chunkIndex * chunkM;
  const toM = fromM + chunkM;
  const rng: Rng = mulberry32((seed ^ Math.imul(chunkIndex + 1, 0x9e3779b9)) >>> 0);
  const items: SpawnPlan[] = [];

  let m = fromM + range(rng, 12, 20); // 块内开头留呼吸距离
  let lastObsM = -Infinity;
  while (m < toM - 8) {
    const band = bandFor(m);
    const kind = pickWeighted(rng, band.weights);
    const lanes = lanesFor(kind, rng);
    // 公平性：同一条道不能与上一个障碍重叠（间距 ≥ 玩家 1.5s 反应距离的一半）
    const gap = range(rng, band.gap[0], band.gap[1]);
    m = Math.max(m, lastObsM + 5.5); // 最小间隔：避免贴脸双障碍
    lastObsM = m;
    items.push({ meter: Math.round(m * 10) / 10, kind, lanes });
    // 金币串：50% 概率在障碍后跟一串（引导线）
    if (rng() < 0.5) {
      const n = COIN.perRun[0] + Math.floor(rng() * (COIN.perRun[1] - COIN.perRun[0] + 1));
      items.push({ meter: Math.round((m + 2.5) * 10) / 10, kind: 'block' as ObstacleKind, lanes, coins: n });
      // coin 计划项借用 kind='block' 标记 + coins 字段（渲染层按 coins 分支）
      items[items.length - 1].kind = 'block';
    }
    m += gap;
  }
  items.sort((a, b) => a.meter - b.meter);

  const plan: ChunkPlan = { chunkIndex, fromM, toM, items };

  // 能量门：750m 间隔（3 型轮转），落在块内
  const gates: number[] = [];
  for (let g = 1; ; g++) {
    const gm = g * ENERGY_GATE_EVERY_M;
    if (gm >= toM) break;
    if (gm > fromM) gates.push(gm);
  }
  if (gates.length) {
    const types: ('score' | 'shield' | 'magnet')[] = ['score', 'shield', 'magnet'];
    const g = gates[0];
    plan.energyGate = { meter: g, type: types[Math.floor(g / ENERGY_GATE_EVERY_M) % 3] };
  }
  // 检查点：500m 间隔
  for (let c = 1; ; c++) {
    const cm = c * CHECKPOINT.everyM;
    if (cm >= toM) break;
    if (cm > fromM) plan.checkpoint = cm;
  }
  return plan;
}

/** 障碍占道规则：block 单道；laser 全宽；saw 相邻两道（留一道可过）。 */
function lanesFor(kind: ObstacleKind, rng: Rng): number[] {
  switch (kind) {
    case 'block':
      return [Math.floor(rng() * 3)];
    case 'laserLow':
    case 'laserHigh':
      return [0, 1, 2];
    case 'saw': {
      // 两道：[0,1] / [1,2] 随机，留另一道
      return rng() < 0.5 ? [0, 1] : [1, 2];
    }
  }
}

/** 某障碍的可通行车道（供导演自检/单测）。 */
export function passableLanes(p: SpawnPlan): number[] {
  if (p.coins) return [0, 1, 2];
  if (p.kind === 'laserLow' || p.kind === 'laserHigh') return [0, 1, 2]; // 全宽但可用跳/滑铲通过
  return [0, 1, 2].filter(i => !p.lanes.includes(i));
}
