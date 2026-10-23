/**
 * 波次导演（03 文档 §2.3：constants 波次表数据驱动，改数值不改逻辑）。
 * 状态机：spawning →（波内单位全灭）gap(3s) → spawning … → elite（精英登场）→ levelCleared。
 * 纯逻辑（无 Phaser 依赖）：注入 rng / spawn / alive 计数，可单测。
 */
import type { Rng } from '../core/rng.ts'
import type { EnemyDef, LevelDef, EliteDef } from '../core/constants.ts'
import { GAME } from '../core/constants.ts'

export type SpawnKind = EnemyDef['key'] | `elite-${EliteDef['key']}`

export interface SpawnCmd {
  kind: SpawnKind
  y: number
}

export type DirectorState = 'spawning' | 'gap' | 'elite' | 'cleared'

export interface DirectorHooks {
  onWaveClear: (waveIdx: number) => void
  onEliteSpawn: (kind: EliteDef['key']) => void
  onLevelCleared: () => void
}

export class WaveDirector {
  state: DirectorState = 'spawning'
  waveIdx = 0
  private spawnQueue: { atMs: number; kind: SpawnKind; y: number }[] = []
  private elapsedMs = 0
  private gapMs = 0
  private spawnedForWave: boolean[] = []
  private eliteSpawned = 0
  private rng: Rng
  private level: LevelDef
  private hooks: DirectorHooks
  private h: number

  constructor(level: LevelDef, rng: Rng, hooks: DirectorHooks, viewHeight: number) {
    this.level = level
    this.rng = rng
    this.hooks = hooks
    this.h = viewHeight
    this.beginWave(0)
  }

  get waveCount(): number {
    return this.level.waves.length
  }

  /** 当前波是否还有未出场的单位 */
  private beginWave(idx: number): void {
    this.state = 'spawning'
    this.waveIdx = idx
    this.elapsedMs = 0
    this.spawnQueue = []
    const wave = this.level.waves[idx]
    this.spawnedForWave = wave.entries.map(() => false)
    for (let e = 0; e < wave.entries.length; e++) {
      const ent = wave.entries[e]
      const density = this.level.difficulty.density
      const count = Math.round(ent.count * (e === 0 ? 1 : density)) // 首条按表，其余按密度微调
      let tMs = ent.t * 1000
      for (let i = 0; i < count; i++) {
        this.spawnQueue.push({ atMs: tMs, kind: ent.spawn, y: this.randY() })
        tMs += (ent.intervalMs ?? 800) / this.level.difficulty.enemySpeed
      }
    }
  }

  private randY(): number {
    const margin = 56 // v1.1.0：实体放大后加大上下边距，防大精英出屏
    return margin + this.rng.next() * (this.h - margin * 2)
  }

  /**
   * 每帧推进。@param aliveEnemies 同屏存活敌机数（含精英）
   * @returns 本帧要 spawn 的单位列表
   */
  update(dtMs: number, aliveEnemies: number): SpawnCmd[] {
    const out: SpawnCmd[] = []
    if (this.state === 'cleared') return out

    if (this.state === 'spawning') {
      this.elapsedMs += dtMs
      const due = this.spawnQueue.filter((s) => s.atMs <= this.elapsedMs)
      if (due.length > 0) {
        const keep = this.spawnQueue.filter((s) => s.atMs > this.elapsedMs)
        for (const s of due) out.push({ kind: s.kind, y: s.y })
        this.spawnQueue = keep
      }
      // 出场完毕且屏内清空 → 波清
      if (this.spawnQueue.length === 0 && aliveEnemies === 0) {
        this.hooks.onWaveClear(this.waveIdx)
        if (this.waveIdx + 1 < this.waveCount) {
          this.state = 'gap'
          this.gapMs = 0
        } else {
          this.state = 'elite'
          this.eliteSpawned = 0
        }
      }
      return out
    }

    if (this.state === 'gap') {
      this.gapMs += dtMs
      if (this.gapMs >= GAME.waveGapMs) this.beginWave(this.waveIdx + 1)
      return out
    }

    // elite：按表逐个登场（关 3 双精英同屏）
    if (this.state === 'elite') {
      const eliteKeys = this.level.elite
      if (this.eliteSpawned < eliteKeys.length) {
        const delay = this.eliteSpawned === 0 ? 2000 : 4000 // 首精英 2s 后，双精英间隔 2s
        this.gapMs += dtMs
        if (this.gapMs >= delay) {
          const kind = eliteKeys[this.eliteSpawned]
          this.eliteSpawned++
          this.gapMs = 0
          this.hooks.onEliteSpawn(kind)
          // SpawnCmd 统一带 elite- 前缀（makeUnit 只认前缀形式；回调仍用裸 key 供 ELITES 查表）
          out.push({ kind: `elite-${kind}`, y: this.h / 2 })
        }
      } else if (aliveEnemies === 0) {
        this.state = 'cleared'
        this.hooks.onLevelCleared()
      }
    }
    return out
  }

  /** 精英阶段是否已开始（UI 用：警告/倒计时） */
  get eliteIncoming(): boolean {
    return this.state === 'elite'
  }
}
