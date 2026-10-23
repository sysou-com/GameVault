/**
 * 主状态机（04 §2.2：menu | running | paused | result；rAF 渲染 + 固定 60Hz 逻辑步，
 * 渲染帧内最多补 MAX_CATCHUP_STEPS 步防螺旋死亡）。
 */
import {
  Scene, PerspectiveCamera, Group,
} from 'three/webgpu'
import type { WebGPURenderer } from 'three/webgpu'
import {
  SPEED, STEP_MS, MAX_CATCHUP_STEPS, PLAYER, ENERGY, CHECKPOINT, LANES,
} from '../core/constants.ts'
import { mulberry32, type Rng } from '../core/rng.ts'
import {
  newScoreState, addDistance, addCoin, addCheckpoint, addHit, totalScore, runMeta,
  type ScoreState,
} from '../core/scoring.ts'
import { aabbOverlap, playerBox, coinPickup, type Box3 } from '../core/collide.ts'
import { newPlayerState, stepPlayer, moveLane, jump, slide, isSliding, buildPlayerMesh, type PlayerState } from './player.ts'
import { createTrack, buildTrackFloor, type TrackRefs } from './track.ts'
import { buildEnvironment, type Environment } from './environment.ts'
import type { Command } from '../input/input.ts'
import type { AudioEngine } from '../audio/synth.ts'
import type { ScoreMeta } from '../platform/types.ts'

const LANES_X: number[] = [LANES[0], LANES[1], LANES[2]]

export type Phase = 'menu' | 'running' | 'paused' | 'result'

export interface GameDeps {
  webgpu: boolean
  audio: AudioEngine
  onPhase(phase: Phase, payload?: { score: number; meta: ScoreMeta; meters: number }): void
  onHud(h: { score: number; meters: number; speed: number; mult: number; shield: boolean; magnet: boolean }): void
  onDeath(): void
}

interface Timers {
  scoreUntil: number
  shieldUntil: number
  magnetUntil: number
  invincibleUntil: number
}

export class Game {
  private phase: Phase = 'menu'
  private scene: Scene
  private camera: PerspectiveCamera
  private track: TrackRefs
  private env: Environment
  private playerGroup: Group
  private playerMesh: ReturnType<typeof buildPlayerMesh>
  private floor: Group
  private p: PlayerState
  private s: ScoreState
  private seed: number
  private rng: Rng
  private timers: Timers = { scoreUntil: 0, shieldUntil: 0, magnetUntil: 0, invincibleUntil: 0 }
  private speed = 0
  private maxSpeed = 0
  private camShake = 0
  private lastGates = new Set<number>()
  private lastCps = new Set<number>()
  private raf = 0
  private lastT = 0
  private acc = 0
  private clock = 0
  private dead = false
  private lastPlayMs = 0

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
    this.camera = new PerspectiveCamera(58, 1, 0.1, 900)
    this.camera.position.set(0, 3.4, 7)
    this.camera.lookAt(0, 0.8, -6)

    this.env = buildEnvironment(this.seed)
    this.scene.add(this.env.group)
    this.scene.fog = this.env.fog
    this.floor = buildTrackFloor()
    this.scene.add(this.floor)
    this.track = createTrack(this.seed)
    this.scene.add(this.track.world)
    this.playerMesh = buildPlayerMesh()
    this.playerGroup = this.playerMesh.group
    this.scene.add(this.playerGroup)

    this.renderer.setSize(this.canvas.width, this.canvas.height, false)
    this.renderer.render(this.scene, this.camera)
  }

  /** 主循环（rAF；固定步长逻辑）。 */
  startLoop(): void {
    this.lastT = performance.now()
    const frame = (t: number): void => {
      this.raf = requestAnimationFrame(frame)
      let dt = t - this.lastT
      this.lastT = t
      if (dt > 250) dt = 250 // 后台切回防大跳
      if (this.phase === 'running') {
        this.acc += dt
        let steps = 0
        while (this.acc >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
          this.tick(STEP_MS)
          this.acc -= STEP_MS
          steps++
        }
        if (steps === MAX_CATCHUP_STEPS) this.acc = 0 // 丢弃余量（防螺旋死亡）
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
    // 重置
    this.seed = (Date.now() & 0xffff) >>> 0
    this.rng = mulberry32(this.seed)
    // 旧轨道：移出场景（不 dispose——所有几何为共享单例，绝不销毁，规避 r186 WebGPURenderer
    // 「Buffer used in submit while destroyed」已知 bug）。重建轨道（共享几何，零 GPU churn）。
    this.scene.remove(this.track.world)
    this.track = createTrack(this.seed)
    this.scene.add(this.track.world)
    this.resetRunState()
  }

  /** 重置一局的游戏逻辑态（玩家/计分/计时/轨道拾取态）。 */
  private resetRunState(): void {
    this.p = newPlayerState()
    this.s = newScoreState()
    this.speed = SPEED.base
    this.maxSpeed = SPEED.base
    this.timers = { scoreUntil: 0, shieldUntil: 0, magnetUntil: 0, invincibleUntil: 0 }
    this.lastGates.clear()
    this.lastCps.clear()
    this.camShake = 0
    this.dead = false
    this.lastPlayMs = 0
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
    this.deps.audio.startBgm()
    this.deps.onPhase('running')
  }

  handleCommand(cmd: Command): void {
    if (this.phase !== 'running') return
    const now = performance.now()
    switch (cmd.type) {
      case 'left': moveLane(this.p, -1); this.deps.audio.sfx('lane'); break
      case 'right': moveLane(this.p, 1); this.deps.audio.sfx('lane'); break
      case 'jump': if (jump(this.p)) this.deps.audio.sfx('jump'); break
      case 'slide': slide(this.p, now); break
    }
  }

  private tick(dtMs: number): void {
    const now = performance.now()
    this.lastPlayMs += dtMs
    this.tickMultiplier(now)

    // 速度曲线
    const steps = Math.floor(this.s.meters / SPEED.stepMeters)
    this.speed = Math.min(SPEED.max, SPEED.base + steps * SPEED.perStep)
    this.maxSpeed = Math.max(this.maxSpeed, this.speed)

    // 推进
    const dM = this.speed * (dtMs / 1000)
    addDistance(this.s, dM)

    // 玩家
    stepPlayer(this.p, dtMs)

    // 轨道/世界更新
    this.track.update(this.s.meters)
    this.env.updateCity(this.s.meters)

    // ---- 碰撞（只看玩家附近 ±3m 的障碍） ----
    if (now >= this.timers.invincibleUntil) {
      const pb: Box3 = playerBox(this.p.x, this.p.y, isSliding(this.p, now))
      for (const o of this.track.obstacles) {
        if (Math.abs(o.meter - this.s.meters) > 3) continue
        const ob: Box3 = { cx: o.cx, cy: o.cy, cz: o.meter - this.s.meters, sx: o.w, sy: o.h, sz: o.d }
        // 注意：障碍 cz 是「相对玩家的 z」（前方为正），玩家 cz=0
        if (aabbOverlap({ ...pb, cz: 0 }, { ...ob, cz: o.meter - this.s.meters })) {
          this.onHit(now)
          break
        }
      }
    }

    // ---- 金币 ----
    const magnet = now < this.timers.magnetUntil
    for (const c of this.track.coins) {
      if (c.taken || c.z > 60) continue
      // 磁力：向玩家聚拢
      if (magnet && c.z > -1 && c.z < 8) {
        c.lane = this.p.lane
      }
      const coinX = LANES_X[c.lane]
      const picked = coinPickup(this.p.x, this.p.y + 0.4, { x: coinX, y: 0.9, z: c.z }, magnet)
      if (picked) {
        c.taken = true
        c.mesh.visible = false
        addCoin(this.s, magnet)
        this.deps.audio.sfx('coin')
      }
    }

    // ---- 能量门 ----
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
      }
    }

    // 相机/玩家视觉/HUD（本 tick 已死则跳过，防结算屏后又回显 HUD）
    if (this.phase !== 'running') return
    this.updateCamera(dtMs)
    // 玩家视觉
    this.updatePlayerVisual(now)
    // HUD（每 tick 一次足够）
    this.deps.onHud({
      score: totalScore(this.s),
      meters: Math.floor(this.s.meters),
      speed: this.speed,
      mult: this.s.multiplier,
      shield: now < this.timers.shieldUntil,
      magnet: magnet,
    })
  }

  private applyGate(type: 'score' | 'shield' | 'magnet', now: number): void {
    if (type === 'score') {
      this.s.multiplier = 2
      this.timers.scoreUntil = now + ENERGY.score.ms
    } else if (type === 'shield') {
      this.timers.shieldUntil = now + ENERGY.shield.ms
    } else {
      this.timers.magnetUntil = now + ENERGY.magnet.ms
    }
    this.deps.audio.sfx('energy')
  }

  private onHit(now: number): void {
    if (now < this.timers.shieldUntil) {
      // 护盾吃掉碰撞：短暂无敌 + 特效
      this.timers.shieldUntil = 0
      this.timers.invincibleUntil = now + 1000
      this.camShake = 0.5
      this.deps.audio.sfx('energy')
      return
    }
    // 死亡
    this.dead = true
    this.phase = 'result'
    addHit(this.s)
    this.camShake = 1.2
    this.deps.audio.sfx('crash')
    this.deps.audio.stopBgm()
    this.deps.onDeath()
    const meta = runMeta(this.s, this.maxSpeed)
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
    if (this.camShake > 0.001) {
      this.camShake *= Math.pow(0.001, dtMs / 400)
      this.camera.position.x += (Math.random() - 0.5) * this.camShake * 0.5
      this.camera.position.y += (Math.random() - 0.5) * this.camShake * 0.5
    }
    this.camera.lookAt(this.p.x * 0.7, 0.8, -6)
  }

  private updatePlayerVisual(now: number): void {
    const sliding = isSliding(this.p, now)
    const h = sliding ? PLAYER.slideHeight : PLAYER.height
    this.playerGroup.position.set(this.p.x, this.p.y, 0)
    this.playerMesh.core.position.y = h / 2
    this.playerMesh.core.scale.y = h / PLAYER.height
    // 自转（发光方块）
    this.playerMesh.core.rotation.y += 0.03
    // 护盾光环变色
    const shielded = now < this.timers.shieldUntil
    this.playerMesh.glowSprite.material.color.set(shielded ? 0x00ff88 : 0x00e5ff)
    // 无敌闪烁
    this.playerGroup.visible = now >= this.timers.invincibleUntil || Math.floor(now / 90) % 2 === 0
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

  // ---- 泡测/调试访问器（?debug=1 钩子用） ----
  playerLane(): number {
    return this.p.lane
  }

  meters(): number {
    return this.s.meters
  }

  /** 前方 aheadM 米内的障碍（按米数升序）。 */
  nextObstacles(aheadM: number): { meter: number; kind: string; lanes: number[]; rel: number }[] {
    const m = this.s.meters
    return this.track.obstacles
      .filter(o => o.meter - m > -1 && o.meter - m < aheadM)
      .sort((a, b) => a.meter - b.meter)
      .slice(0, 6)
      .map(o => ({ meter: o.meter, kind: o.kind, rel: o.meter - m, lanes: o.lanes }))
  }

  /** 倍率到期检查（tick 内调用）。 */
  tickMultiplier(now: number): void {
    if (this.s.multiplier > 1 && now >= this.timers.scoreUntil) {
      this.s.multiplier = 1
    }
  }
}
