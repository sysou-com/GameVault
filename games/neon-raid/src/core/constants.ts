/**
 * 数值表（03 文档 §1/§2.3：数据驱动，策划改数值不改逻辑）。
 * 设计基准 960×540（16:9，manifest.viewport.base）。
 *
 * v1.1.0（2026-10-23 用户反馈「游戏元素太小」）：实体尺寸统一 ×1.4（AS）。
 * 玩家判定框比视觉小一圈（宽容度）；敌人/子弹/拾取物视觉=判定。
 */

export const W = 960
export const H = 540

/** 玩家机固定左 1/4 列（03 §1.1） */
export const PLAYER_X = W * 0.25

export interface PlayerDef {
  w: number; h: number
  speed: number            // px/s 上下移动
  fireIntervalMs: number   // 自动开火间隔（双发×层数减半间隔不变，改并行多弹）
  bulletSpeed: number      // px/s
  shieldTimeMs: number     // 护盾持续时间
}
export const PLAYER: PlayerDef = {
  w: 56, h: 34, speed: 430, fireIntervalMs: 130, bulletSpeed: 900, shieldTimeMs: 8000,
}

export interface EnemyDef {
  key: 'grunt' | 'diver' | 'bomber'
  w: number; h: number
  hp: number
  score: number
  speed: number            // px/s（向左），按关卡难度缩放
  spawnX: number
  canShoot: boolean
  shootIntervalMs: [number, number]
  bulletSpeed: number
  contactDamage: number
}
export const ENEMIES: Record<EnemyDef['key'], EnemyDef> = {
  grunt:  { key: 'grunt',  w: 48, h: 31, hp: 1, score: 100, speed: 200, spawnX: W + 40, canShoot: false, shootIntervalMs: [0, 0], bulletSpeed: 0,   contactDamage: 1 },
  diver:  { key: 'diver',  w: 50, h: 36, hp: 2, score: 300, speed: 165, spawnX: W + 40, canShoot: true,  shootIntervalMs: [1400, 2600], bulletSpeed: 260, contactDamage: 1 },
  bomber: { key: 'bomber', w: 62, h: 48, hp: 4, score: 300, speed: 105, spawnX: W + 40, canShoot: true,  shootIntervalMs: [2600, 2600], bulletSpeed: 230, contactDamage: 1 },
}

export interface EliteDef {
  key: 'warden' | 'guardian'
  w: number; h: number
  hp: number
  phaseScore: number       // 每阶段 1000（03 §1.2）
  killScore: number        // 全灭 5000
  speed: number
  patterns: ElitePattern[] // 阶段弹幕表（数据驱动）
}
export interface ElitePattern {
  name: string
  kind: 'spread3' | 'aimed3' | 'ring8' | 'fan5' | 'doubleSpread5'
  intervalMs: number
  bulletSpeed: number
  bullets: number          // 每次齐射子弹数
  spreadRad: number        // 扇形总弧度（spread/fan 用）
  aimed: boolean
}
export const ELITES: Record<EliteDef['key'], EliteDef> = {
  warden: {
    key: 'warden', w: 134, h: 90, hp: 30, phaseScore: 1000, killScore: 5000, speed: 55,
    patterns: [
      { name: 'P1', kind: 'spread3', intervalMs: 1100, bulletSpeed: 240, bullets: 3, spreadRad: 0.9, aimed: false },
      { name: 'P2', kind: 'aimed3',  intervalMs: 1300, bulletSpeed: 300, bullets: 3, spreadRad: 0.22, aimed: true },
      { name: 'P3', kind: 'ring8',   intervalMs: 1600, bulletSpeed: 210, bullets: 8, spreadRad: 0, aimed: false },
    ],
  },
  guardian: {
    key: 'guardian', w: 157, h: 106, hp: 40, phaseScore: 1000, killScore: 5000, speed: 48,
    patterns: [
      { name: 'P1', kind: 'fan5', intervalMs: 950, bulletSpeed: 260, bullets: 5, spreadRad: 1.1, aimed: false },
      { name: 'P2', kind: 'doubleSpread5', intervalMs: 1500, bulletSpeed: 235, bullets: 5, spreadRad: 0.7, aimed: false },
      { name: 'P3', kind: 'aimed3', intervalMs: 1100, bulletSpeed: 330, bullets: 3, spreadRad: 0.18, aimed: true },
    ],
  },
}

/** 波次表（03 §2.3 JSON 化）：t=波次内延迟秒，spawn 编队，count 数量 */
export interface WaveEntry { t: number; spawn: EnemyDef['key']; count: number; intervalMs?: number }
export interface WaveDef { name: string; entries: WaveEntry[] }
export interface LevelDef {
  id: number
  name: string
  sub: string
  timeLimitMs: number
  waves: WaveDef[]         // 5 波
  elite: EliteDef['key'][] // 关底精英（关 3 = 双精英同屏）
  difficulty: { enemySpeed: number; bulletSpeed: number; density: number } // 缩放系数
  accent: number           // 主题色（霓虹）
}

const wave = (name: string, entries: WaveEntry[]): WaveDef => ({ name, entries })

export const LEVELS: LevelDef[] = [
  {
    id: 1, name: 'NIGHT FLIGHT', sub: '夜航', timeLimitMs: 180_000,
    waves: [
      wave('W1', [{ t: 0, spawn: 'grunt', count: 5, intervalMs: 900 }]),
      wave('W2', [{ t: 0, spawn: 'grunt', count: 4, intervalMs: 700 }, { t: 3, spawn: 'grunt', count: 3, intervalMs: 700 }]),
      wave('W3', [{ t: 0, spawn: 'diver', count: 3, intervalMs: 1200 }, { t: 2, spawn: 'grunt', count: 4, intervalMs: 600 }]),
      wave('W4', [{ t: 0, spawn: 'grunt', count: 5, intervalMs: 550 }, { t: 2, spawn: 'diver', count: 3, intervalMs: 1100 }]),
      wave('W5', [{ t: 0, spawn: 'diver', count: 4, intervalMs: 1000 }, { t: 2, spawn: 'bomber', count: 1 }]),
    ],
    elite: ['warden'],
    difficulty: { enemySpeed: 1, bulletSpeed: 1, density: 1 },
    accent: 0x12f0ff,
  },
  {
    id: 2, name: 'STATIC STORM', sub: '静电风暴', timeLimitMs: 180_000,
    waves: [
      wave('W1', [{ t: 0, spawn: 'grunt', count: 6, intervalMs: 700 }, { t: 2.5, spawn: 'diver', count: 2, intervalMs: 900 }]),
      wave('W2', [{ t: 0, spawn: 'diver', count: 4, intervalMs: 900 }, { t: 3, spawn: 'grunt', count: 5, intervalMs: 500 }]),
      wave('W3', [{ t: 0, spawn: 'bomber', count: 1 }, { t: 1, spawn: 'diver', count: 3, intervalMs: 1000 }, { t: 3, spawn: 'grunt', count: 4, intervalMs: 600 }]),
      wave('W4', [{ t: 0, spawn: 'grunt', count: 6, intervalMs: 450 }, { t: 2, spawn: 'diver', count: 4, intervalMs: 800 }]),
      wave('W5', [{ t: 0, spawn: 'diver', count: 4, intervalMs: 850 }, { t: 1.5, spawn: 'bomber', count: 2, intervalMs: 1600 }]),
    ],
    elite: ['warden'],
    difficulty: { enemySpeed: 1.15, bulletSpeed: 1.12, density: 1.15 },
    accent: 0xb26bff,
  },
  {
    id: 3, name: 'CORE RAID', sub: '核心突袭', timeLimitMs: 180_000,
    waves: [
      wave('W1', [{ t: 0, spawn: 'diver', count: 4, intervalMs: 700 }, { t: 2, spawn: 'bomber', count: 1 }]),
      wave('W2', [{ t: 0, spawn: 'grunt', count: 7, intervalMs: 420 }, { t: 3, spawn: 'diver', count: 3, intervalMs: 800 }]),
      wave('W3', [{ t: 0, spawn: 'bomber', count: 2, intervalMs: 1800 }, { t: 1, spawn: 'diver', count: 4, intervalMs: 750 }]),
      wave('W4', [{ t: 0, spawn: 'diver', count: 5, intervalMs: 650 }, { t: 2.5, spawn: 'grunt', count: 6, intervalMs: 420 }]),
      wave('W5', [{ t: 0, spawn: 'grunt', count: 6, intervalMs: 400 }, { t: 1.5, spawn: 'diver', count: 4, intervalMs: 700 }, { t: 3, spawn: 'bomber', count: 1 }]),
    ],
    elite: ['warden', 'guardian'],
    difficulty: { enemySpeed: 1.3, bulletSpeed: 1.22, density: 1.3 },
    accent: 0xff2d95,
  },
]

/** 拾取物（03 §1.1：精英掉落 100% 单件） */
export interface PickupDef { key: 'P' | 'S' | 'B'; name: string; color: number; lifeMs: number }
export const PICKUPS: Record<PickupDef['key'], PickupDef> = {
  P: { key: 'P', name: '双发', color: 0x3dff8f, lifeMs: 120_000 },
  S: { key: 'S', name: '护盾', color: 0x12f0ff, lifeMs: 120_000 },
  B: { key: 'B', name: '清屏', color: 0xffd23d, lifeMs: 120_000 },
}

export const SCORE = {
  small: 100,          // 小机（grunt/diver 按表 100/300）
  elitePhase: 1000,
  eliteKill: 5000,
  waveClear: 2000,     // 通关一波
  timeBonusPerSec: 50, // 剩余时间奖励
  max: 9_999_999,      // 对接平台 score.range（03 §1.2）
  /** 连击加成（03 §1.2）：得分 × (1 + min(n,50)×0.01) */
  comboMultiplier: (n: number) => 1 + Math.min(n, 50) * 0.01,
  comboWindowMs: 1500, // 连击计时窗口（03 §2.3）
  maxComboStack: 50,
}

export const GAME = {
  doubleShotDurationMs: 20_000,  // P 双发持续 20s
  maxDoubleShotStacks: 2,        // 可叠 2 层 → 四发
  aoeRadius: 520,                // B 清屏半径（覆盖全画面）
  aoeEliteRatio: 1 / 3,          // 对精英 1/3 血
  waveGapMs: 3000,               // 波次间隔 3s 倒计时
  maxOnScreenEnemies: 24,        // 同屏敌机上限（03 §2.3）
  playerBulletPool: 64,
  enemyBulletPool: 128,
  particleBudget: 512,
  fpsLowThreshold: 45,           // 3s 平均 FPS < 45 → 降粒子密度 50%
  fpsSampleMs: 3000,
}
