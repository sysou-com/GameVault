/**
 * 玩家（04 §1.3「优」修订：从「自转方块」到「跑者」——独立剪影 + squash/stretch + 光轨 + 尘土）。
 * 玩家 mesh 固定 z=0（传送带世界），x 向车道插值，y 向跳跃物理。
 * 渲染层全部共享单例几何（启动建一次、永不 dispose，规避 r186 WebGPURenderer buffer bug）。
 */
import {
  Group, Mesh, BoxGeometry, CylinderGeometry, PlaneGeometry, OctahedronGeometry,
  MeshStandardMaterial, MeshBasicMaterial, AdditiveBlending, DoubleSide,
  InstancedMesh, InstancedBufferAttribute, Matrix4, Vector3, Quaternion, Color,
} from 'three/webgpu'
import { LANES, PLAYER, JUMP, SLIDE_MS } from '../core/constants.ts'
import { makeGlowTexture } from './track.ts'

export interface PlayerState {
  lane: number          // 目标车道 0/1/2
  x: number             // 当前 x（插值中）
  y: number             // 离地高度
  vy: number
  jumpsLeft: number     // 0/1/2
  slidingUntil: number  // ms 时间戳
  lastHitAt: number
}

export function newPlayerState(): PlayerState {
  return { lane: 1, x: LANES[1], y: 0, vy: 0, jumpsLeft: 2, slidingUntil: 0, lastHitAt: 0 }
}

export function isSliding(p: PlayerState, now: number): boolean {
  return now < p.slidingUntil
}

/** 逻辑步（固定 60Hz）：换道插值 + 跳跃物理。 */
export function stepPlayer(p: PlayerState, dtMs: number): void {
  // 换道插值（指数逼近，150ms 后剩 0.1% 距离）
  const target = LANES[p.lane]
  const k = 1 - Math.pow(0.001, dtMs / PLAYER.laneLerpMs)
  p.x += (target - p.x) * k
  if (Math.abs(target - p.x) < 0.002) p.x = target

  // 跳跃物理
  if (p.y > 0 || p.vy !== 0) {
    p.y += p.vy * (dtMs / 1000)
    p.vy += JUMP.gravity * (dtMs / 1000)
    if (p.y <= 0) {
      p.y = 0
      p.vy = 0
      p.jumpsLeft = 2
    }
  }
}

/** 换道（到边再按不越界）。 */
export function moveLane(p: PlayerState, dir: -1 | 1): void {
  p.lane = Math.max(0, Math.min(2, p.lane + dir))
}

/** 跳（二段）。@returns 是否起跳。 */
export function jump(p: PlayerState): boolean {
  if (p.jumpsLeft <= 0) return false
  p.vy = p.jumpsLeft === 2 ? JUMP.vy0 : JUMP.doubleJumpVy
  p.jumpsLeft -= 1
  p.slidingUntil = 0 // 空中取消滑铲
  return true
}

/** 滑铲（仅地面）。 */
export function slide(p: PlayerState, now: number): void {
  if (p.y > 0) return
  p.slidingUntil = now + SLIDE_MS
}

// ---- 渲染件（共享单例几何，永不 dispose）----

const TRAIL_N = 24
const DUST_N = 40

/** 玩家 mesh 组件（04 §1.3：方块身体 + 正面 2 眼 + 顶部天线灯 → 背后 10m 可认的剪影）。 */
export interface PlayerVisual {
  group: Group
  core: Mesh
  glowSprite: Mesh
  /** 落地 squash 触发（Game 调用；0.15s 回弹）。 */
  triggerSquash(): void
  /** 落地/换道尘土（Game 调用；6–10 粒，0.3s 消散；budget 0 时不喷）。 */
  puffDust(x: number, y: number, side: number, budget: number): void
  /** 每帧更新：squash 回弹 + 自转 + 光轨 + 尘土 + 天线灯脉动。speedNorm 0..1（光轨长度 ∝ 速度）。 */
  updateFrame(dtMs: number, p: PlayerState, speedNorm: number, now: number): void
  /** 光轨/尘土的粒子预算缩放（自适应档位：1 / 0.5 / 0）。 */
  setParticleBudget(f: number): void
}

export function buildPlayerMesh(): PlayerVisual {
  const group = new Group()

  const core = new Mesh(
    new BoxGeometry(PLAYER.width, PLAYER.height, PLAYER.width),
    new MeshStandardMaterial({ color: 0x101020, emissive: 0x00e5ff, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 }),
  )
  core.position.y = PLAYER.height / 2
  group.add(core)

  // 正面 2 眼（小亮色 quad，-z 面 = 行进方向；相机在 +z 后方看不到，给侧面/结算视角与光轨层认剪影）
  const eyeGeo = new PlaneGeometry(0.16, 0.1)
  const eyeMat = new MeshBasicMaterial({ color: 0xeaffff, side: DoubleSide })
  const eyeL = new Mesh(eyeGeo, eyeMat)
  eyeL.position.set(-0.16, PLAYER.height * 0.66, -PLAYER.width / 2 - 0.02)
  eyeL.rotation.y = Math.PI
  const eyeR = new Mesh(eyeGeo, eyeMat)
  eyeR.position.set(0.16, PLAYER.height * 0.66, -PLAYER.width / 2 - 0.02)
  eyeR.rotation.y = Math.PI
  group.add(eyeL, eyeR)

  // 顶部天线 + 灯（独立剪影标志；橙色脉动）
  const antenna = new Mesh(
    new CylinderGeometry(0.03, 0.05, 0.4, 6),
    new MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.7 }),
  )
  antenna.position.y = PLAYER.height + 0.2
  group.add(antenna)
  const lamp = new Mesh(
    new OctahedronGeometry(0.1),
    new MeshStandardMaterial({ color: 0x221100, emissive: 0xffb300, emissiveIntensity: 2 }),
  )
  lamp.position.y = PLAYER.height + 0.45
  group.add(lamp)

  // 假辉光（共享平面 + 径向渐变；04 §5 批准的降级 Bloom 方案）
  const glowSprite = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: makeGlowTexture(), color: 0x00e5ff, blending: AdditiveBlending,
      depthWrite: false, transparent: true, side: DoubleSide,
    }),
  )
  glowSprite.scale.set(2.2, 2.2, 1)
  glowSprite.position.y = PLAYER.height / 2
  group.add(glowSprite)

  // 光轨（24 段渐隐 quad 链，InstancedMesh 1 draw call；长度 ∝ 速度；颜色=角色色）
  const trailGeo = new PlaneGeometry(1, 1)
  const trailMat = new MeshBasicMaterial({
    map: makeGlowTexture(), color: 0xffffff, blending: AdditiveBlending,
    depthWrite: false, transparent: true, side: DoubleSide,
  })
  const trail = new InstancedMesh(trailGeo, trailMat, TRAIL_N)
  trail.instanceColor = new InstancedBufferAttribute(new Float32Array(TRAIL_N * 3), 3)
  group.add(trail)
  // 历史环（x, y, 有效）
  const hist: { x: number; y: number }[] = Array.from({ length: TRAIL_N }, () => ({ x: LANES[1], y: 0 }))
  let histIdx = 0
  let histAcc = 0

  // 尘土粒子池（落地/换道 6–10 粒，0.3s 消散；1 draw call）
  const dustGeo = new PlaneGeometry(0.28, 0.28)
  const dustMat = new MeshBasicMaterial({
    map: makeGlowTexture(), color: 0xffffff, blending: AdditiveBlending,
    depthWrite: false, transparent: true, side: DoubleSide,
  })
  const dust = new InstancedMesh(dustGeo, dustMat, DUST_N)
  dust.instanceColor = new InstancedBufferAttribute(new Float32Array(DUST_N * 3), 3)
  group.add(dust)
  const dustP = Array.from({ length: DUST_N }, () => ({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 0.3,
  }))
  let dustIdx = 0

  let squash = 0
  let curSX = 1
  let curSY = 1
  let budget = 1
  const m4 = new Matrix4()
  const q0 = new Quaternion()
  const v0 = new Vector3()
  const s0 = new Vector3()
  const cTrail = new Color(0x00e5ff)

  return {
    group, core, glowSprite,
    triggerSquash() { squash = 1 },
    setParticleBudget(f: number) { budget = f },
    puffDust(x, y, side, b: number) {
      const n = Math.round((6 + Math.random() * 4) * b)
      for (let i = 0; i < n; i++) {
        const d = dustP[dustIdx]
        dustIdx = (dustIdx + 1) % DUST_N
        d.x = x + side * (0.1 + Math.random() * 0.25) + (Math.random() - 0.5) * 0.2
        d.y = Math.max(0.05, y + 0.1 * Math.random())
        d.z = 0.1 + Math.random() * 0.3
        d.vx = side * (0.6 + Math.random() * 1.2) + (Math.random() - 0.5)
        d.vy = 0.4 + Math.random() * 0.8
        d.vz = 0.5 + Math.random() * 1.5 // 向后（+z 远离行进方向）
        d.life = d.max
      }
    },
    updateFrame(dtMs, p, speedNorm, now) {
      // squash & stretch（0.15s 回弹；落地压扁 1.3×0.7 / 空中拉长 0.9×1.1）
      squash *= Math.pow(0.001, dtMs / 150)
      let tSX: number, tSY: number
      if (squash > 0.02) { tSX = 1 + 0.3 * squash; tSY = 1 - 0.3 * squash }
      else if (p.y > 0.15) { tSX = 0.9; tSY = 1.1 }
      else { tSX = 1; tSY = 1 }
      const sk = 1 - Math.pow(0.0001, dtMs / 150)
      curSX += (tSX - curSX) * sk
      curSY += (tSY - curSY) * sk
      const h = isSliding(p, now) ? PLAYER.slideHeight : PLAYER.height
      core.scale.set(curSX, (h / PLAYER.height) * curSY, curSX)
      core.position.y = (PLAYER.height * core.scale.y) / 2
      glowSprite.position.y = core.position.y
      lamp.position.y = PLAYER.height + 0.45 + (p.y > 0 ? 0 : (PLAYER.height * core.scale.y - PLAYER.height) / 2)

      // 自转（发光方块）
      core.rotation.y += 0.03
      eyeL.position.y = eyeR.position.y = core.position.y + (PLAYER.height * core.scale.y) / 2 * 0.35

      // 天线灯脉动（1Hz 呼吸 + 高频闪烁）
      lamp.scale.setScalar(1 + 0.15 * Math.sin(now * 0.006) * Math.sin(now * 0.023))

      // 光轨（位置历史 → 渐隐链；长度 ∝ 速度）
      histAcc += dtMs
      if (histAcc > 33) {
        histAcc = 0
        hist[histIdx] = { x: p.x, y: core.position.y }
        histIdx = (histIdx + 1) % TRAIL_N
      }
      const trailLen = Math.min(1, 0.25 + speedNorm * 0.9) * budget
      for (let i = 0; i < TRAIL_N; i++) {
        const idx = (histIdx - 1 - i + TRAIL_N * 2) % TRAIL_N // i=0 最新 → i=23 最旧
        const hpt = hist[idx]
        const age = i / (TRAIL_N - 1) // 0 新 → 1 旧
        const f = Math.max(0, 1 - age / Math.max(0.001, trailLen))
        const sc = (0.18 + 0.5 * f) * (0.4 + 0.6 * budget)
        v0.set(hpt.x, hpt.y, i * 0.42)
        s0.set(sc, sc, 1)
        m4.compose(v0, q0, s0)
        trail.setMatrixAt(i, m4)
        cTrail.setRGB(0, 0.9, 1).multiplyScalar(f * f * 0.85)
        trail.instanceColor!.setXYZ(i, cTrail.r, cTrail.g, cTrail.b)
      }
      trail.instanceMatrix.needsUpdate = true
      trail.instanceColor!.needsUpdate = true

      // 尘土
      for (let i = 0; i < DUST_N; i++) {
        const d = dustP[i]
        if (d.life <= 0) {
          s0.set(0, 0, 0)
          m4.compose(v0.set(0, -10, 0), q0, s0)
          dust.setMatrixAt(i, m4)
          continue
        }
        d.life -= dtMs / 1000
        d.x += d.vx * dtMs / 1000
        d.y = Math.max(0.03, d.y + d.vy * dtMs / 1000)
        d.z += d.vz * dtMs / 1000
        d.vy -= 3.5 * dtMs / 1000
        const lf = Math.max(0, d.life / d.max)
        const sc = 0.5 * lf + 0.05
        m4.compose(v0.set(d.x, d.y, d.z), q0, s0.set(sc, sc, 1))
        dust.setMatrixAt(i, m4)
        cTrail.setRGB(0.55, 0.75, 1).multiplyScalar(lf * 0.5)
        dust.instanceColor!.setXYZ(i, cTrail.r, cTrail.g, cTrail.b)
      }
      dust.instanceMatrix.needsUpdate = true
      dust.instanceColor!.needsUpdate = true
    },
  }
}
