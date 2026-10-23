/**
 * 主状态机（04 §2.2：menu | running | paused | result；rAF 渲染 + 固定 60Hz 逻辑步）。
 * W3「优」视觉包 + W4「奇」节拍系统接线（04 §1.3/§1.4/§1.5）：
 * - 节拍时钟 beatMs（固定 60Hz 逻辑步累积；04 §5：不读 rAF 时间戳）↔ BGM 128BPM 同源
 * - 节奏门 FLOW 判定（按压=跳跃；窗口 ±300ms；PERFECT 90 / GOOD 180；T2 低档只通过不判定）
 * - 连击（×1→×8，4s 衰减，受击清零）+ 近失擦过（<0.35m → +200×倍率 + CLOSE!）
 * - Boost 门（2s 无敌 + 1.6× + 吸金 +1000/s）+ 道具协同（黄金风暴 / 铁壁火箭）
 * - 激光预警示状态机（暗→闪 0.8s→点亮 0.4s 致死；公平性红线）
 * - juice：顿帧 50ms（大金币/近失）/ 屏震 / FOV punch / 闪白（post.ts）
 */
import {
  Scene, PerspectiveCamera, Group, CanvasTexture,
} from 'three/webgpu'
import type { WebGPURenderer } from 'three/webgpu'
import type { MeshBasicMaterial } from 'three/webgpu'
import {
  SPEED, STEP_MS, MAX_CATCHUP_STEPS, PLAYER, ENERGY, CHECKPOINT, LANES,
  BOOST, LASER, NEAR_MISS, HITSTOP,
} from '../core/constants.ts'
import { mulberry32, type Rng } from '../core/rng.ts'
import {
  newScoreState, addDistance, addCoin, addCheckpoint, addHit, addBonus, totalScore, runMeta,
  newCombo, comboBump, comboTick, comboReset, comboRemainingMs,
  type ScoreState, type ComboState,
} from '../core/scoring.ts'
import { aabbOverlap, playerBox, coinPickup, boxSeparation, type Box3 } from '../core/collide.ts'
import { speedAtMeter, BEAT_DUR_MS, RHYTHM, judgeFlow, newGroove, grooveOnPerfect, grooveOnNonPerfect, grooveOnHit, RhythmGateJudge } from '../core/rhythm.ts'
import {
  newPlayerState, stepPlayer, moveLane, jump, slide, isSliding, buildPlayerMesh, type PlayerState, type PlayerVisual,
} from './player.ts'
import { createTrack, buildTrackFloor, type TrackRefs, type TrackCtx, type LiveRhythmGate } from './track.ts'
import { buildEnvironment, type Environment } from './environment.ts'
import type { Command } from '../input/input.ts'
import { BGM_START_DELAY_MS, type AudioEngine } from '../audio/synth.ts'
import type { ScoreMeta } from '../platform/types.ts'

const LANES_X: number[] = [LANES[0], LANES[1], LANES[2]]

export type Phase = 'menu' | 'running' | 'paused' | 'result'

export interface HudPayload {
  score: number
  meters: number
  speed: number
  mult: number
  shield: boolean
  magnet: boolean
  comboMult: number
  comboRemainingMs: number
  groove: boolean
  boost: boolean
  flow: boolean
}

export interface GameDeps {
  webgpu: boolean
  audio: AudioEngine
  onPhase(phase: Phase, payload?: { score: number; meta: ScoreMeta; meters: number }): void
  onHud(h: HudPayload): void
  /** 飘字（04 §1.4/§1.5）。 */
  onFloat(text: string, cls?: 'flow' | 'gold' | 'purple' | 'red' | 'cyan'): void
  /** 每 rAF 帧回调（主循环驱动：自适应 FPS 决策 + 屏幕特效层）。 */
  onFrame(dtMs: number): void
  onDeath(): void
}

interface Timers {
  scoreUntil: number
  shieldUntil: number
  magnetUntil: number
  invincibleUntil: number
  flowUntil: number
  boostUntil: number
}

export class Game {
  private phase: Phase = 'menu'
  private scene: Scene
  private camera: PerspectiveCamera
  private track: TrackRefs
  private env: Environment
  private floor: Group
  private gridTex: CanvasTexture
  private playerVisual: PlayerVisual
  private p: PlayerState
  private s: ScoreState
  private seed: number
  private rng: Rng
  private timers: Timers = { scoreUntil: 0, shieldUntil: 0, magnetUntil: 0, invincibleUntil: 0, flowUntil: 0, boostUntil: 0 }
  private speed = 0
  private maxSpeed = 0
  private camShake = 0
  private lastGates = new Set<number>()
  private lastCps = new Set<number>()
  private raf = 0
  private lastT = 0
  private acc = 0
  private dead = false

  // ---- W4 节拍/连击/近失/boost 状态 ----
  private beatMs = 0                      // 节拍时钟（逻辑步累积；对齐 BGM 首拍）
  private combo: ComboState = newCombo(0)
  private groove = newGroove()
  private flowMult = 1
  private gateJudge = new RhythmGateJudge()     // 节奏门按压→结算状态机（04 §1.5）
  private obMinSep = new Map<number, number>()    // 障碍 meter → 最小分离距离（近失）
  private obTouched = new Set<number>()           // 障碍 meter → 曾重叠（非近失）
  private ironWallArmed = false
  private ironWallUsed = false
  private goldStormActive = false
  private hitStopMs = 0
  private jumpBufferUntil = 0
  private fovPunch = 0
  private flash = 0
  /** 画质档位（自适应；T2 = 节奏门只通过不判定，04 §1.5）。 */
  private rhythmJudged = true
  private particleBudget = 1

  constructor(
    private renderer: WebGPURenderer,
    private canvas: HTMLCanvasElement,
    private deps: GameDeps,
  ) {
    this.scene = new Scene()
    this.seed = (Date.now() & 0xffff) >>> 0
    this.rng = mulberry32(this.seed)
    this.p = newPlayerState()
    this.s = newScoreState()
    this.camera = new PerspectiveCamera(62, 1, 0.1, 900) // 04 §1.3：FOV 62→68 随速度
    this.camera.position.set(0, 3.4, 7)
    this.camera.lookAt(0, 0.8, -6)

    this.env = buildEnvironment(this.seed)
    this.scene.add(this.env.group)
    this.scene.fog = this.env.fog
    const floorRefs = buildTrackFloor()
    this.floor = floorRefs.group
    this.gridTex = floorRefs.gridTex
    this.scene.add(this.floor)
    this.track = createTrack(this.seed)
    this.scene.add(this.track.world)
    this.playerVisual = buildPlayerMesh()
    this.scene.add(this.playerVisual.group)

    this.renderer.setSize(this.canvas.width, this.canvas.height, false)
    this.renderer.render(this.scene, this.camera)
  }

  // ---- 画质档位（adaptive 回调）----
  setRhythmJudged(v: boolean): void { this.rhythmJudged = v }
  setParticleBudget(f: number): void {
    this.particleBudget = f
    this.playerVisual.setParticleBudget(f)
  }

  /** 主循环（rAF；固定步长逻辑；渲染帧内最多补 MAX_CATCHUP_STEPS 步防螺旋死亡）。 */
  startLoop(): void {
    this.lastT = performance.now()
    const frame = (t: number): void => {
      this.raf = requestAnimationFrame(frame)
      let dt = t - this.lastT
      this.lastT = t
      if (dt > 250) dt = 250
      this.deps.onFrame(dt)
      if (this.phase === 'running') {
        this.acc += dt
        let steps = 0
        while (this.acc >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
          this.tick(STEP_MS)
          this.acc -= STEP_MS
          steps++
        }
        if (steps === MAX_CATCHUP_STEPS) this.acc = 0
      }
      // 每帧视觉更新（逻辑冻结时仍渲染：暂停/顿帧画面）
      if (this.phase === 'running' || this.phase === 'menu') {
        this.updateFrameVisuals(dt)
      }
      // 0 尺寸不 render（iframe 布局未定瞬时）——防 WebGPU「swapchain texture of size 0」。
      if (this.canvas.width > 0 && this.canvas.height > 0) this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(frame)
  }

  stopLoop(): void {
    cancelAnimationFrame(this.raf)
  }

  startRun(): void {
    this.seed = (Date.now() & 0xffff) >>> 0
    this.rng = mulberry32(this.seed)
    // 旧轨道移出场景（不 dispose——共享几何永不销毁，规避 r186 WebGPU buffer bug）
    this.scene.remove(this.track.world)
    this.track = createTrack(this.seed)
    this.scene.add(this.track.world)
    this.resetRunState()
  }

  private resetRunState(): void {
    this.p = newPlayerState()
    this.s = newScoreState()
    this.speed = SPEED.base
    this.maxSpeed = SPEED.base
    this.timers = { scoreUntil: 0, shieldUntil: 0, magnetUntil: 0, invincibleUntil: 0, flowUntil: 0, boostUntil: 0 }
    this.lastGates.clear()
    this.lastCps.clear()
    this.camShake = 0
    this.dead = false
    this.combo = newCombo(0)
    this.groove = newGroove()
    this.flowMult = 1
    this.gateJudge.reset()
    this.obMinSep.clear()
    this.obTouched.clear()
    this.ironWallArmed = false
    this.ironWallUsed = false
    this.goldStormActive = false
    this.hitStopMs = 0
    this.jumpBufferUntil = 0
    this.fovPunch = 0
    this.flash = 0
    // 节拍时钟对齐 BGM 首拍（首拍 = 开始 + BGM_START_DELAY_MS；04 §5 固定逻辑步累积）
    this.beatMs = -BGM_START_DELAY_MS
    // BGM 重启会清掉 groove 低音层
    this.deps.audio.setGroove(false)
    this.phase = 'running'
    this.acc = 0
    this.deps.onPhase('running')
    this.deps.audio.startBgm()
  }

  pause(): void {
    if (this.phase !== 'running') return
    this.phase = 'paused'
    this.deps.audio.stopBgm()
    this.deps.onPhase('paused')
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.phase = 'running'
    this.lastT = performance.now()
    this.acc = 0
    // BGM 从 step0 重启（首拍 = 现在 + BGM_START_DELAY_MS）→ 节拍时钟对齐：
    // 令逻辑拍边界恰好落在音频首拍时刻（两钟同速，从此保持同步）
    const nextBeat = Math.ceil(this.beatMs / BEAT_DUR_MS) * BEAT_DUR_MS
    this.beatMs = nextBeat - BGM_START_DELAY_MS
    this.deps.audio.startBgm()
    this.deps.onPhase('running')
  }

  handleCommand(cmd: Command): void {
    if (this.phase !== 'running') return
    const now = performance.now()
    switch (cmd.type) {
      case 'left': moveLane(this.p, -1); this.deps.audio.sfx('lane'); break
      case 'right': moveLane(this.p, 1); this.deps.audio.sfx('lane'); break
      case 'jump': this.onJumpPress(now); break
      case 'slide':
        slide(this.p, now)
        if (isSliding(this.p, now)) {
          this.playerVisual.puffDust(this.p.x, 0, 0, this.particleBudget)
        }
        break
    }
  }

  /** 跳跃按压：① 节奏门按压登记（04 §1.5 判定动作）② 地面即跳 / 空中缓存 150ms（04 W3 输入缓冲）。 */
  private onJumpPress(now: number): void {
    if (this.rhythmJudged) {
      for (const rg of this.track.rhythmGates) {
        this.gateJudge.registerPress(rg.meter, this.beatMs, rg.beatIndex)
      }
    }
    if (this.p.y <= 0 && this.p.vy === 0) {
      if (jump(this.p)) this.deps.audio.sfx('jump')
    } else {
      this.jumpBufferUntil = now + 150 // 落地自动起跳
    }
  }

  /** 生效倍率 = 能量门 × 连击 × FLOW × Groove（04 §1.2/§1.4/§1.5）。 */
  private effMult(): number {
    let m = this.s.multiplier * this.combo.mult * this.flowMult
    if (this.groove.active) m *= RHYTHM.grooveMult
    return m
  }

  private tick(dtMs: number): void {
    const now = performance.now()
    // 节拍时钟：逻辑步累积（顿帧不停——音乐继续，世界冻结；04 §5）
    this.beatMs += dtMs
    comboTick(this.combo, this.beatMs)
    if (this.flowMult !== 1 && now >= this.timers.flowUntil) this.flowMult = 1

    // 顿帧（0.05s 冻结：大金币/近失）——世界与玩家静止，时钟/音乐继续
    if (this.hitStopMs > 0) {
      this.hitStopMs -= dtMs
      return
    }

    // 速度曲线（+boost 1.6× 爆发）
    const boost = now < this.timers.boostUntil
    this.speed = speedAtMeter(this.s.meters) * (boost ? BOOST.speedMult : 1)
    this.maxSpeed = Math.max(this.maxSpeed, this.speed)

    // 推进
    const dM = this.speed * (dtMs / 1000)
    const eff = this.effMult()
    addDistance(this.s, dM, eff)
    if (boost) addBonus(this.s, BOOST.bonusPerSec * (dtMs / 1000)) // +100/0.1s

    // 玩家
    const wasAir = this.p.y > 0
    stepPlayer(this.p, dtMs)
    const landed = wasAir && this.p.y === 0
    if (landed) {
      this.playerVisual.triggerSquash()
      this.playerVisual.puffDust(this.p.x, 0, 0, this.particleBudget)
      // 跳跃输入缓冲：落地瞬间自动起跳（04 W3 操作手感）
      if (now < this.jumpBufferUntil && this.p.jumpsLeft === 2) {
        jump(this.p)
        this.deps.audio.sfx('jump')
        this.jumpBufferUntil = 0
      }
    }

    // 轨道/环境
    const beatPulse = this.beatPulse()
    const ctx: TrackCtx = {
      meters: this.s.meters,
      speed: this.speed,
      playerX: this.p.x,
      playerY: this.p.y,
      magnet: now < this.timers.magnetUntil,
      boost,
      beatPulse,
      dtMs,
      nowMs: now,
      laserTta: (meter: number) => (meter - this.s.meters) / Math.max(1, this.speed),
    }
    this.track.update(this.s.meters, ctx)
    this.env.updateCity(this.s.meters)
    this.env.updateDayNight(this.s.meters, dtMs)
    this.gridTex.offset.y = (this.s.meters / 2) % 1 // 网格随速度滚动（每 repeat ≈ 2m）

    // ---- 碰撞 + 近失（±3m 窗口）----
    if (now >= this.timers.invincibleUntil) {
      const pb: Box3 = playerBox(this.p.x, this.p.y, isSliding(this.p, now))
      for (const o of this.track.obstacles) {
        const rel = o.meter - this.s.meters
        if (rel > 3.5) break
        if (rel < -1.5) continue
        const ob: Box3 = { cx: o.cx, cy: o.cy, cz: rel, sx: o.w, sy: o.h, sz: o.d }
        // 激光：预警示状态机（04 §1.3 公平性——未点亮不致死）
        let lethal = true
        if (o.kind === 'laserLow' || o.kind === 'laserHigh') {
          lethal = o.state === 'active'
        }
        if (lethal && aabbOverlap({ ...pb, cz: 0 }, ob)) {
          this.obTouched.add(o.meter)
          this.onHit(now)
          break
        }
        // 近失跟踪（未碰撞时的最小分离距离；04 §1.4）
        if (lethal) {
          const sep = boxSeparation({ ...pb, cz: 0 }, ob)
          const prev = this.obMinSep.get(o.meter)
          if (prev === undefined || sep < prev) this.obMinSep.set(o.meter, sep)
        }
      }
    }
    // 近失结算（障碍完全通过）
    for (const o of this.track.obstacles) {
      const rel = o.meter - this.s.meters
      if (rel > -1.5) continue
      if (this.obMinSep.has(o.meter)) {
        const minSep = this.obMinSep.get(o.meter)!
        const lethalWas = o.kind !== 'laserLow' && o.kind !== 'laserHigh' || o.state === 'active'
        if (!this.obTouched.has(o.meter) && lethalWas && minSep < NEAR_MISS.threshold) {
          this.onNearMiss()
        }
        this.obMinSep.delete(o.meter)
      }
      this.obTouched.delete(o.meter)
    }

    // ---- 金币 ----
    const magnet = now < this.timers.magnetUntil
    for (const c of this.track.coins) {
      if (c.taken || c.meter - this.s.meters > 60) continue
      if ((magnet || boost) && c.meter - this.s.meters > -1 && c.meter - this.s.meters < 8) {
        c.lane = this.p.lane // 逻辑车道吸附（碰撞判定向心）
      }
      const coinX = LANES_X[c.lane]
      const relZ = c.meter - this.s.meters
      const picked = coinPickup(this.p.x, this.p.y + 0.4, { x: coinX, y: 0.9, z: relZ }, magnet || boost)
      if (picked) {
        c.taken = true
        addCoin(this.s, magnet, eff, c.big)
        this.deps.audio.sfx('coin')
        comboBump(this.combo, this.beatMs)
        if (c.big) {
          // 大金币：0.05s 顿帧 + 闪白（04 §1.3 juice）
          this.hitStopMs = HITSTOP.bigCoinMs
          this.flash = Math.max(this.flash, 0.12)
          this.deps.onFloat('大金币 +1000', 'gold')
        }
      }
    }

    // ---- 能量/Boost 门 ----
    for (const g of this.track.gates) {
      const rel = g.meter - this.s.meters
      if (rel > -0.5 && rel < 1.5 && !this.lastGates.has(g.meter)) {
        this.lastGates.add(g.meter)
        this.applyGate(g.type, now)
      }
    }

    // ---- 检查点 ----
    for (const cp of this.track.checkpoints) {
      const rel = cp.meter - this.s.meters
      if (rel > -0.5 && rel < 1.5 && !this.lastCps.has(cp.meter)) {
        this.lastCps.add(cp.meter)
        addCheckpoint(this.s)
        this.timers.invincibleUntil = now + CHECKPOINT.invincibleMs
        this.deps.audio.sfx('checkpoint')
        this.camShake = Math.max(this.camShake, 0.35)
        this.flash = Math.max(this.flash, 0.12)
        this.fovPunch = Math.max(this.fovPunch, 3)
        this.deps.onFloat('+5000', 'cyan')
      }
    }

    // ---- 节奏门（通过即结算；04 §1.5）----
    for (const rg of this.track.rhythmGates) {
      const rel = rg.meter - this.s.meters
      if (rel <= -0.3 && !this.gateJudge.isSettled(rg.meter)) {
        this.settleRhythmGate(rg.beatIndex, rg.meter, now)
      }
    }

    // ---- 道具协同（04 §1.4 调研吸收：Cube-Field+ 增量协同）----
    const mult2 = this.s.multiplier === 2 && now < this.timers.scoreUntil
    if (mult2 && magnet && !this.goldStormActive) {
      this.goldStormActive = true
      this.deps.onFloat('黄金风暴 ×2', 'gold')
      this.deps.audio.sfx('energy')
    }
    if (!(mult2 && magnet)) this.goldStormActive = false

    // 相机/玩家视觉/HUD（本 tick 已死则跳过，防结算屏后又回显 HUD）
    if (this.phase !== 'running') return
    this.updateCamera(dtMs)
    this.updatePlayerVisual(now, beatPulse)
    // HUD（每 tick 一次足够）
    this.deps.onHud({
      score: totalScore(this.s),
      meters: Math.floor(this.s.meters),
      speed: this.speed,
      mult: this.s.multiplier,
      shield: now < this.timers.shieldUntil,
      magnet,
      comboMult: this.combo.mult,
      comboRemainingMs: comboRemainingMs(this.combo, this.beatMs),
      groove: this.groove.active,
      boost,
      flow: this.flowMult > 1,
    })
  }

  /** 拍点脉动 0..1（1 = 拍点；120ms 内衰减到 0；渲染层用）。 */
  beatPulse(): number {
    const phase = ((this.beatMs % BEAT_DUR_MS) + BEAT_DUR_MS) % BEAT_DUR_MS
    return Math.max(0, 1 - phase / 120)
  }

  /** 渲染帧视觉（每 rAF 帧；逻辑冻结/暂停时也跑——光轨/尘土/屏震衰减）。 */
  private updateFrameVisuals(dtMs: number): void {
    const now = performance.now()
    const speedNorm = Math.min(1, this.speed / SPEED.max)
    this.playerVisual.updateFrame(dtMs, this.p, speedNorm, now)
    // 屏震衰减（撞击 0.1s / 检查点 0.15s / boost 0.2s → camShake 指数衰减）
    if (this.camShake > 0.001) {
      this.camShake *= Math.pow(0.001, dtMs / 200)
      this.camera.position.x += (Math.random() - 0.5) * this.camShake * 0.5
      this.camera.position.y += (Math.random() - 0.5) * this.camShake * 0.5
    }
    // FOV punch 衰减
    if (this.fovPunch > 0.01) this.fovPunch *= Math.pow(0.0005, dtMs / 300)
    else this.fovPunch = 0
  }

  private applyGate(type: 'score' | 'shield' | 'magnet' | 'boost' | 'rhythm', now: number): void {
    if (type === 'score') {
      this.s.multiplier = 2
      this.timers.scoreUntil = now + ENERGY.score.ms
    } else if (type === 'shield') {
      this.timers.shieldUntil = now + ENERGY.shield.ms
    } else if (type === 'magnet') {
      this.timers.magnetUntil = now + ENERGY.magnet.ms
    } else if (type === 'boost') {
      // Boost 门（04 §1.1：2s 无敌 + 1.6× 爆发 + 路径金币自动吸入）
      this.timers.boostUntil = now + BOOST.ms
      this.timers.invincibleUntil = Math.max(this.timers.invincibleUntil, now + BOOST.invincibleMs)
      this.deps.audio.sfx('boost')
      this.camShake = Math.max(this.camShake, 0.5)
      this.flash = Math.max(this.flash, 0.16)
      this.fovPunch = Math.max(this.fovPunch, 4)
      this.deps.onFloat('BOOST ×1.6', 'red')
      // 协同：护盾 + Boost = 铁壁火箭（每局 1 次，04 §1.4）
      if (!this.ironWallUsed && !this.ironWallArmed && now < this.timers.shieldUntil) {
        this.ironWallArmed = true
        this.deps.onFloat('铁壁火箭', 'red')
        this.deps.audio.sfx('energy')
      }
    }
    // 节奏门不走这里（settleRhythmGate 结算）
  }

  /** 节奏门结算（04 §1.5：按压=跳跃；Δt = 按压逻辑时刻 − 节拍时刻；不惩罚）。 */
  private settleRhythmGate(beatIndex: number, meter: number, now: number): void {
    if (!this.rhythmJudged) { this.gateJudge.settle(meter, beatIndex); return } // T2 低档：只通过不判定（04 §1.5 公平性）
    const v = this.gateJudge.settle(meter, beatIndex)
    if (v === 'perfect') {
      addBonus(this.s, RHYTHM.perfectScore)
      this.s.flowPerfect += 1
      this.flowMult = RHYTHM.perfectMult
      this.timers.flowUntil = now + RHYTHM.flowMs
      comboBump(this.combo, this.beatMs)
      const wasActive = this.groove.active
      grooveOnPerfect(this.groove)
      this.deps.audio.sfx('flowPerfect')
      this.deps.onFloat('FLOW PERFECT +1000', 'purple')
      this.camShake = Math.max(this.camShake, 0.4)
      this.flash = Math.max(this.flash, 0.14)
      this.fovPunch = Math.max(this.fovPunch, 4)
      if (this.groove.active && !wasActive) this.enterGroove()
    } else if (v === 'good') {
      addBonus(this.s, RHYTHM.goodScore)
      this.s.flowGood += 1
      this.flowMult = RHYTHM.goodMult
      this.timers.flowUntil = now + RHYTHM.flowMs
      comboBump(this.combo, this.beatMs)
      grooveOnNonPerfect(this.groove)
      this.deps.audio.sfx('flow')
      this.deps.onFloat('FLOW +300', 'purple')
    } else if (v === 'miss' || v === 'none') {
      grooveOnNonPerfect(this.groove) // 无按压/窗口内偏拍 = 普通通过（不惩罚）
    }
  }

  private enterGroove(): void {
    this.deps.audio.setGroove(true) // 低音层 + 速度线增强（post 读 groove 态）
    this.deps.onFloat('GROOVE ×1.5', 'purple')
  }

  private onNearMiss(): void {
    addBonus(this.s, NEAR_MISS.score * this.effMult())
    this.s.nearMisses += 1
    comboBump(this.combo, this.beatMs)
    this.deps.audio.sfx('near')
    this.deps.onFloat('CLOSE! +200', 'cyan')
    this.hitStopMs = Math.max(this.hitStopMs, NEAR_MISS.hitStopMs) // 0.05s 顿帧
    this.fovPunch = Math.max(this.fovPunch, 2)
  }

  private onHit(now: number): void {
    if (now < this.timers.shieldUntil) {
      // 护盾吃掉碰撞：短暂无敌 + 特效
      this.timers.shieldUntil = 0
      this.timers.invincibleUntil = now + 1000
      this.camShake = 0.5
      this.deps.audio.sfx('energy')
      this.deps.onFloat('护盾抵消', 'cyan')
      return
    }
    if (now < this.timers.boostUntil && this.ironWallArmed && !this.ironWallUsed) {
      // 铁壁火箭（04 §1.4 协同：Boost 2s 内受击不中断，每局 1 次）
      this.ironWallUsed = true
      this.timers.invincibleUntil = now + 1000
      this.camShake = 0.6
      this.deps.audio.sfx('energy')
      this.deps.onFloat('铁壁火箭生效!', 'red')
      return
    }
    // 死亡
    this.dead = true
    this.phase = 'result'
    addHit(this.s)
    comboReset(this.combo)
    grooveOnHit(this.groove)
    this.deps.audio.setGroove(false)
    this.camShake = 1.2
    this.flash = Math.max(this.flash, 0.25)
    this.deps.audio.sfx('crash')
    this.deps.audio.stopBgm()
    this.deps.onDeath()
    const meta = runMeta(this.s, this.maxSpeed, 'arcade')
    this.deps.onPhase('result', { score: totalScore(this.s), meta, meters: Math.floor(this.s.meters) })
  }

  private updateCamera(dtMs: number): void {
    const k = 1 - Math.pow(0.0005, dtMs / 1000)
    const targetX = this.p.x * 0.55
    const targetY = 3.4 + this.p.y * 0.35
    const targetZ = 7
    this.camera.position.x += (targetX - this.camera.position.x) * k
    this.camera.position.y += (targetY - this.camera.position.y) * k
    this.camera.position.z += (targetZ - this.camera.position.z) * k
    this.camera.lookAt(this.p.x * 0.7, 0.8, -6)
    // FOV 62→68 随速度 + punch（04 §1.3 速度感）
    const speedNorm = Math.max(0, (this.speed - SPEED.base) / (SPEED.max - SPEED.base))
    const targetFov = 62 + speedNorm * 6 + this.fovPunch
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * 0.15
      this.camera.updateProjectionMatrix()
    }
  }

  private updatePlayerVisual(now: number, _beatPulse: number): void {
    this.playerVisual.group.position.set(this.p.x, this.p.y, 0)
    // 换道倾斜 15°（bank；04 §1.3）
    const bank = Math.max(-0.26, Math.min(0.26, (LANES_X[this.p.lane] - this.p.x) * 0.55))
    this.playerVisual.group.rotation.z += (bank - this.playerVisual.group.rotation.z) * 0.25
    // 护盾光环变色 / 无敌闪烁
    const shielded = now < this.timers.shieldUntil
    ;(this.playerVisual.glowSprite.material as MeshBasicMaterial).color.set(shielded ? 0x00ff88 : 0x00e5ff)
    this.playerVisual.group.visible = now >= this.timers.invincibleUntil || Math.floor(now / 90) % 2 === 0
  }

  resize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return // 防 0 尺寸（iframe 布局未定瞬时）
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  get phaseNow(): Phase {
    return this.phase
  }

  /** 渲染器 draw call 数（本帧；仅 WebGL 后端是每帧值——r186 WebGPU 后端该计数器非每帧重置，勿用于验收）。 */
  drawCalls(): number {
    return (this.renderer.info as unknown as { render: { calls: number } }).render.calls
  }

  /** 场景可渲染对象普查（draw call 上限估算：每个 mesh/IM 至少 1 次；WebGPU 下用这个验收 04 §3 ≤64）。 */
  census(): { renderables: number; instanced: number } {
    let renderables = 0
    let instanced = 0
    const walk = (o: { children?: object[]; isMesh?: boolean; isPoints?: boolean; isInstancedMesh?: boolean }): void => {
      if ((o as { isInstancedMesh?: boolean }).isInstancedMesh) { renderables++; instanced++ }
      else if ((o as { isMesh?: boolean }).isMesh || (o as { isPoints?: boolean }).isPoints) renderables++
      for (const c of (o as { children?: object[] }).children || []) walk(c)
    }
    walk(this.scene as unknown as { children: object[] })
    return { renderables, instanced }
  }

  /** 当前速度（渲染层/特效用）。 */
  speedNow(): number { return this.speed }
  /** boost 爆发中（速度线增强）。 */
  boostNow(): boolean { return performance.now() < this.timers.boostUntil }
  /** 事件闪白峰值（post 每帧取走并清零）。 */
  consumeFlash(): number {
    const f = this.flash
    this.flash = 0
    return f
  }

  /** 泡测：跳米数（?debug=1；清近失/节奏门残留态）。 */
  jumpTo(m: number): void {
    this.s.meters = Math.max(0, m)
    this.gateJudge.reset()
    this.obMinSep.clear()
    this.obTouched.clear()
    for (const rg of this.track.rhythmGates) if (rg.meter < m) this.gateJudge.markSettled(rg.meter)
    for (const g of this.track.gates) if (g.meter < m) this.lastGates.add(g.meter)
    for (const cp of this.track.checkpoints) if (cp.meter < m) this.lastCps.add(cp.meter)
  }

  /** 泡测：节拍时钟 warp（?debug=1；FLOW 判定确定性验收用）。 */
  warpBeatMs(ms: number): void {
    this.beatMs = ms
  }

  /** 泡测：节奏门 settle 追踪（?debug=1）。 */
  gateTrace(): { meter: number; result: string; pressDelta: number | null }[] {
    return this.gateJudge.settleTrace
  }

  /** 泡测：手动驱动逻辑步（?debug=1；窗口被遮挡 rAF 暂停时手动推进模拟，与 warp 同一测试通道）。 */
  debugStep(ms: number): void {
    if (this.phase !== 'running') return
    this.acc += ms
    let steps = 0
    while (this.acc >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
      this.tick(STEP_MS)
      this.acc -= STEP_MS
      steps++
    }
    if (steps === MAX_CATCHUP_STEPS) this.acc = 0
    this.updateFrameVisuals(ms)
  }

  /** 泡测/调试访问器（?debug=1 钩子用）。 */
  playerLane(): number { return this.p.lane }
  meters(): number { return this.s.meters }
  beatMsNow(): number { return this.beatMs }
  grooveNow(): { streak: number; active: boolean } { return { ...this.groove } }
  comboNow(): { mult: number; count: number } { return { mult: this.combo.mult, count: this.combo.count } }
  /** 前方 aheadM 米内的障碍（按米数升序）。 */
  nextObstacles(aheadM: number): { meter: number; kind: string; lanes: number[]; rel: number }[] {
    const m = this.s.meters
    return this.track.obstacles
      .filter(o => o.meter - m > -1 && o.meter - m < aheadM)
      .sort((a, b) => a.meter - b.meter)
      .slice(0, 6)
      .map(o => ({ meter: o.meter, kind: o.kind, rel: o.meter - m, lanes: o.lanes }))
  }
  nextRhythmGate(): { meter: number; beatIndex: number; rel: number } | null {
    const m = this.s.meters
    let best: LiveRhythmGate | null = null
    for (const rg of this.track.rhythmGates) {
      if (rg.meter - m > -1 && rg.meter - m < 300 && (best === null || rg.meter < best.meter)) best = rg
    }
    if (!best) return null
    return { meter: best.meter, beatIndex: best.beatIndex, rel: best.meter - m }
  }
}
