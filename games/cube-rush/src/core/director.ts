/**
 * 障碍生成导演（04 §2.3：seed + blockIndex 确定性，重开同距离布局可复现）。
 * 纯逻辑层：只产出「计划」（距离/种类/车道），渲染层负责实例化。
 *
 * 节拍量化（04 §1.5 W4）：所有实体米位量化到 128BPM 节拍格
 * （`SpawnCmd.z = beatTime × speed` 的时间反演，rhythm.ts 提供时间↔米位换算），
 * 玩家跑起来自然跟拍；量化后碰撞格上的项被丢弃（保留先落者，节拍格不叠障碍）。
 * 节奏门（600m 后每 400m，±18m 呼吸段）与 Boost 门（800m 后每 800m）同为节拍锚点。
 */
import {
  SPAWN_BANDS, ENERGY_GATE_EVERY_M, CHECKPOINT, COIN, BOOST,
  type ObstacleKind,
} from './constants.ts';
import { mulberry32, range, pickWeighted, type Rng } from './rng.ts';
import { quantizeToBeat, firstBeatAtOrAfter, nextBeatAfter, beatIndexAtMeter, RHYTHM } from './rhythm.ts';

export interface SpawnPlan {
  /** 距本局起点的米数（单调递增；已量化到节拍）。 */
  meter: number;
  kind: ObstacleKind;
  /** 障碍占用的车道索引（0/1/2；laserLow/High 可跨多道，saw 占相邻两道）。 */
  lanes: number[];
  /** 金币串（仅 coin 计划项）。 */
  coins?: number; // 金币数量
  /** 金币串首枚为大金币（1,000 分；1% 概率，04 §1.1）。 */
  bigCoin?: boolean;
}

export interface RhythmGatePlan {
  meter: number;
  /** 节拍序号（理想运行下穿越该门时刻 = beatIndex × 一拍，FLOW 判定时钟基准）。 */
  beatIndex: number;
}

export interface ChunkPlan {
  chunkIndex: number;
  fromM: number;
  toM: number;
  items: SpawnPlan[];
  /** 本块能量门（可空；已量化到节拍）。 */
  energyGate?: { meter: number; type: 'score' | 'shield' | 'magnet' };
  /** 本块检查点（可空；已量化到节拍）。 */
  checkpoint?: number; // 米数
  /** 本块 Boost 门（可空；已量化到节拍）。 */
  boostGate?: number; // 米数
  /** 本块节奏门（可空；节拍锚点）。 */
  rhythmGate?: RhythmGatePlan;
}

function bandFor(m: number) {
  let b = SPAWN_BANDS[0];
  for (const cand of SPAWN_BANDS) if (m >= cand.from) b = cand;
  return b;
}

const MIN_GAP = 5.5; // 量化后最小障碍间距（节拍格不叠障碍）

/** 检查点/能量门/Boost 门落在块内（量化到节拍）；障碍铺满节拍格（呼吸距离保底）。 */
export function planChunk(seed: number, chunkIndex: number, chunkM: number): ChunkPlan {
  const fromM = chunkIndex * chunkM;
  const toM = fromM + chunkM;
  const rng: Rng = mulberry32((seed ^ Math.imul(chunkIndex + 1, 0x9e3779b9)) >>> 0);
  const items: SpawnPlan[] = [];

  // 块首呼吸距离：≥10m 后的第一个节拍
  let m = firstBeatAtOrAfter(fromM + 10);
  let lastObsM = -Infinity;
  while (m < toM - 8) {
    const band = bandFor(m);
    const kind = pickWeighted(rng, band.weights);
    const lanes = lanesFor(kind, rng);
    // 量化后的节拍格若与前一个障碍太近 → 顺延到下一格（不移动已落项，保持节拍对齐）
    m = nextBeatAfter(m, lastObsM, MIN_GAP);
    lastObsM = m;
    items.push({ meter: m, kind, lanes });
    // 金币串：50% 概率在障碍后跟一串（引导线；串首 1% 大金币）
    if (rng() < 0.5) {
      const n = COIN.perRun[0] + Math.floor(rng() * (COIN.perRun[1] - COIN.perRun[0] + 1));
      const cm = nextBeatAfter(m + 2.5, lastObsM, 2.0);
      items.push({
        meter: cm,
        kind: 'block',
        lanes,
        coins: n,
        bigCoin: rng() < 0.01,
      });
    }
    // 下一步候选：当前障碍 + 本档间距，再取最近节拍
    m = m + range(rng, band.gap[0], band.gap[1]);
  }
  items.sort((a, b) => a.meter - b.meter);

  const plan: ChunkPlan = { chunkIndex, fromM, toM, items };

  // 能量门：750m 间隔（3 型轮转），量化到节拍
  const gates: number[] = [];
  for (let g = 1; ; g++) {
    const gm = g * ENERGY_GATE_EVERY_M;
    if (gm >= toM) break;
    if (gm >= fromM) gates.push(gm);
  }
  if (gates.length) {
    const types: ('score' | 'shield' | 'magnet')[] = ['score', 'shield', 'magnet'];
    const g = gates[0];
    plan.energyGate = { meter: quantizeToBeat(g), type: types[Math.floor(g / ENERGY_GATE_EVERY_M) % 3] };
  }
  // 检查点：500m 间隔（量化到节拍）
  for (let c = 1; ; c++) {
    const cm = c * CHECKPOINT.everyM;
    if (cm >= toM) break;
    if (cm >= fromM) plan.checkpoint = quantizeToBeat(cm);
  }
  // Boost 门：800m 后每 800m（量化到节拍）
  for (let g = 1; ; g++) {
    const bm = BOOST.firstM + (g - 1) * BOOST.everyM;
    if (bm >= toM) break;
    if (bm >= fromM) plan.boostGate = quantizeToBeat(bm);
  }
  // 节奏门：600m 后每 400m（节拍锚点；±18m 呼吸段清空障碍）
  for (let g = 1; ; g++) {
    const rm = RHYTHM.firstGateM + (g - 1) * RHYTHM.everyM;
    if (rm >= toM) break;
    if (rm >= fromM) {
      const meter = quantizeToBeat(rm);
      plan.rhythmGate = { meter, beatIndex: beatIndexAtMeter(rm) };
      const lo = meter - RHYTHM.clearM;
      const hi = meter + RHYTHM.clearM;
      plan.items = items.filter(it => it.meter < lo || it.meter > hi);
    }
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
