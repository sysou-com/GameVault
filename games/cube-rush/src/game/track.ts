/**
 * 轨道与实体（04 §1.3「优」视觉包 + §1.1/§1.5 W4 门型；04 §2.3：4 块×100m，确定性重排）。
 * 世界模型：玩家恒在 z=0 向 -z「前进」，worldGroup.position.z = meters（传送带式），
 * 实体局部 z = -meter（负 = 前方）。相机在 +z 后方。
 *
 * 渲染纪律（r186 WebGPURenderer「Buffer used in submit while destroyed」根治）：
 * 所有几何/材质 = 启动建一次的共享单例，游戏过程中**绝不 dispose**（chunk 只移出场景，
 * JS 对象交 GC，GPU 资源随页面卸载统一释放）。
 * Draw call 预算（04 §3 ≤64）：金币走 InstancedMesh（1–2 call）、窗灯/光轨/尘土各 1 call、
 * 障碍独立 mesh ≤24（可视窗口裁剪）。
 */
import {
  Group, Mesh, BoxGeometry, CylinderGeometry, TorusGeometry, PlaneGeometry,
  OctahedronGeometry, ExtrudeGeometry, Shape, DynamicDrawUsage,
  MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, AdditiveBlending,
  DoubleSide, RepeatWrapping, InstancedMesh, Matrix4, Vector3, Quaternion,
} from 'three/webgpu'
import {
  LANES, OBSTACLE, OBSTACLE_STYLE, ENERGY, CHECKPOINT, COIN, TRACK, BOOST,
  RHYTHM_GATE_COLOR, BOOST_GATE_COLOR,
} from '../core/constants.ts'
import { planChunk, type ChunkPlan } from '../core/director.ts'

// ---- 类型 ----

export interface LiveCoin {
  lane: number        // 逻辑车道（碰撞用）
  x: number           // 渲染 x（磁力/boost 吸入插值）
  y: number
  meter: number
  taken: boolean
  big: boolean        // 大金币（1,000 分）
}

export interface LiveObstacle {
  root: Group | Mesh
  mesh: Mesh          // 主变换对象（旋转/可见性）
  meter: number
  kind: string
  w: number; h: number; d: number
  cx: number; cy: number
  lanes: number[]
  spinning?: boolean
  beam?: Mesh         // 激光束（预警示状态机）
  emitters?: Mesh[]
  glowPlane?: Mesh
  state?: 'dim' | 'warn' | 'active' // 激光专用（04 §1.3 公平性：先可见可读、再致死）
}

export type GateType = 'score' | 'shield' | 'magnet' | 'boost' | 'rhythm'

export interface LiveGate {
  root: Group
  meter: number
  type: GateType
  ring?: Mesh
  rune?: Mesh
  halo?: Mesh
}

export interface LiveRhythmGate extends LiveGate {
  beatIndex: number   // 理想穿越节拍（FLOW 判定时钟基准）
  targetRing?: Mesh
}

export interface TrackCtx {
  meters: number
  speed: number
  playerX: number
  playerY: number
  magnet: boolean
  boost: boolean
  beatPulse: number   // 0..1（1 = 拍点）
  dtMs: number
  nowMs: number
  /** 激光到岸时间（秒），Game 计算（预警示状态机）。 */
  laserTta(meter: number): number
}

export interface TrackRefs {
  world: Group
  obstacles: LiveObstacle[]
  coins: LiveCoin[]
  gates: LiveGate[]
  rhythmGates: LiveRhythmGate[]
  checkpoints: { root: Group; meter: number; halo?: Mesh }[]
  update(meters: number, ctx: TrackCtx): void
  dispose(): void
}

// ---- 程序纹理（Canvas，零文件）----

let stripeTex: CanvasTexture | null = null
/** 警示条纹（黄/黑 45°；路障块，04 §1.3）。 */
export function makeStripeTexture(): CanvasTexture {
  if (stripeTex) return stripeTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#23232f'
  g.fillRect(0, 0, 64, 64)
  g.strokeStyle = '#ffd54a'
  g.lineWidth = 10
  for (let i = -2; i < 5; i++) {
    g.beginPath()
    g.moveTo(i * 20 - 10, 70)
    g.lineTo(i * 20 + 50, -10)
    g.stroke()
  }
  stripeTex = new CanvasTexture(c)
  stripeTex.wrapS = stripeTex.wrapT = RepeatWrapping
  stripeTex.repeat.set(2, 2)
  return stripeTex
}

let gridTex: CanvasTexture | null = null
/** 轨道网格（发光格；map.offset 滚动 = 提速即感，04 §1.3）。 */
export function makeGridTexture(): CanvasTexture {
  if (gridTex) return gridTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#0c0c16'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = 'rgba(0,229,255,0.55)'
  g.lineWidth = 2
  g.strokeRect(1, 1, 126, 126)
  g.strokeStyle = 'rgba(0,229,255,0.16)'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(64, 0); g.lineTo(64, 128)
  g.moveTo(0, 64); g.lineTo(128, 64)
  g.stroke()
  gridTex = new CanvasTexture(c)
  gridTex.wrapS = gridTex.wrapT = RepeatWrapping
  return gridTex
}

let runeTex: CanvasTexture | null = null
/** 符文环虚线（门内圈「反向旋转」= 纹理滚动错觉，04 §1.3）。 */
export function makeRuneTexture(): CanvasTexture {
  if (runeTex) return runeTex
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 8
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 128, 8)
  for (let x = 0; x < 128; x += 16) {
    g.fillStyle = (x / 16) % 2 === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.25)'
    g.fillRect(x, 0, 10, 8)
  }
  runeTex = new CanvasTexture(c)
  runeTex.wrapS = RepeatWrapping
  runeTex.repeat.x = 24
  return runeTex
}

let glowTexture: CanvasTexture | null = null
/** 假辉光：运行时径向渐变（04 §5 批准的降级 Bloom 方案，双后端统一）。 */
export function makeGlowTexture(): CanvasTexture {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  glowTexture = new CanvasTexture(c)
  return glowTexture
}

// ---- 共享几何（单例，启动建一次、永不 dispose）----

const sawShape = (() => {
  // 12 齿锯盘（ExtrudeGeometry，弃「方块近似」，04 §1.3）
  const s = new Shape()
  const teeth = 12
  const rOut = 1.0
  const rIn = 0.76
  for (let i = 0; i <= teeth * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn
    const a = (i / (teeth * 2)) * Math.PI * 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  return s
})()

const G = {
  block: new BoxGeometry(OBSTACLE.block.w, OBSTACLE.block.h, OBSTACLE.block.d),
  beam: new CylinderGeometry(0.05, 0.05, 3.6, 8),
  emitter: new OctahedronGeometry(0.16),
  saw: new ExtrudeGeometry(sawShape, { depth: 0.16, bevelEnabled: false, curveSegments: 3 }),
  coin: new CylinderGeometry(0.24, 0.24, 0.07, 12),
  bigCoin: new CylinderGeometry(0.46, 0.46, 0.1, 16),
  gatePost: new BoxGeometry(0.35, 2.6, 0.35),
  gateRing: new TorusGeometry(1.35, 0.09, 8, 24),
  runeRing: new TorusGeometry(1.62, 0.035, 6, 48),
  targetRing: new TorusGeometry(1.05, 0.03, 6, 32),
  cpRing: new TorusGeometry(1.9, 0.12, 8, 32),
  glowPlane: new PlaneGeometry(1, 1),
}
const M = {
  block: new MeshStandardMaterial({
    color: 0x39394d, map: makeStripeTexture(),
    emissive: OBSTACLE_STYLE.block.emissive, emissiveIntensity: 0.25, roughness: 0.6,
  }),
  // 激光三态（预警示状态机；warn 态 opacity 由 update 动画）
  laserLow: {
    dim: new MeshBasicMaterial({ color: OBSTACLE_STYLE.laserLow.emissive, transparent: true, opacity: 0.18 }),
    warn: new MeshBasicMaterial({ color: OBSTACLE_STYLE.laserLow.emissive, transparent: true, opacity: 0.5 }),
    active: new MeshBasicMaterial({ color: OBSTACLE_STYLE.laserLow.emissive }),
  },
  laserHigh: {
    dim: new MeshBasicMaterial({ color: OBSTACLE_STYLE.laserHigh.emissive, transparent: true, opacity: 0.18 }),
    warn: new MeshBasicMaterial({ color: OBSTACLE_STYLE.laserHigh.emissive, transparent: true, opacity: 0.5 }),
    active: new MeshBasicMaterial({ color: OBSTACLE_STYLE.laserHigh.emissive }),
  },
  emitter: new MeshStandardMaterial({ color: 0x1a1a2e, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.4 }),
  saw: new MeshStandardMaterial({ color: 0x2b2b3d, emissive: OBSTACLE_STYLE.saw.emissive, emissiveIntensity: 0.8, roughness: 0.4, metalness: 0.6 }),
  gate: {
    score: new MeshBasicMaterial({ color: ENERGY.score.color }),
    shield: new MeshBasicMaterial({ color: ENERGY.shield.color }),
    magnet: new MeshBasicMaterial({ color: ENERGY.magnet.color }),
    boost: new MeshBasicMaterial({ color: BOOST_GATE_COLOR }),
    rhythm: new MeshBasicMaterial({ color: RHYTHM_GATE_COLOR }),
  },
  rune: {
    score: runeMat(ENERGY.score.color),
    shield: runeMat(ENERGY.shield.color),
    magnet: runeMat(ENERGY.magnet.color),
    boost: runeMat(BOOST_GATE_COLOR),
    rhythm: runeMat(RHYTHM_GATE_COLOR),
  },
  cp: new MeshBasicMaterial({ color: 0xeaffff }),
  coin: new MeshBasicMaterial({ color: 0xffd54a }),
  bigCoin: new MeshBasicMaterial({ color: 0xfff0b0 }),
}
/** 门类型色（04 §1.3：×2=绿 / 护盾=青 / 磁力=金 / boost=红 / 节奏=紫）。 */
const GATE_COLOR: Record<GateType, number> = {
  score: ENERGY.score.color,
  shield: ENERGY.shield.color,
  magnet: ENERGY.magnet.color,
  boost: BOOST_GATE_COLOR,
  rhythm: RHYTHM_GATE_COLOR,
}
function runeMat(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, map: makeRuneTexture(), transparent: true, side: DoubleSide })
}

function glow(color: number, sx: number, sy: number): Mesh {
  // 共享 PlaneGeometry 的 Mesh（规避逐实体几何建毁 → r186 WebGPU buffer bug）
  const s = new Mesh(G.glowPlane, new MeshBasicMaterial({
    map: makeGlowTexture(), color, blending: AdditiveBlending, depthWrite: false, transparent: true, side: DoubleSide,
  }))
  s.scale.set(sx, sy, 1)
  return s
}

// ---- 实体构建 ----

function buildObstacle(kind: 'block' | 'laserLow' | 'laserHigh' | 'saw', meter: number, lanes: number[]): LiveObstacle {
  const cfg = OBSTACLE[kind]
  let cx = 0
  let root: Group | Mesh
  let mesh: Mesh
  const o: LiveObstacle = { root: null as unknown as Group, mesh: null as unknown as Mesh, meter, kind, w: cfg.w, h: cfg.h, d: cfg.d, cx: 0, cy: 0, lanes }

  if (kind === 'block') {
    // 警示条纹铁块 + 品红边缘光脉冲（0.5s 周期）
    cx = LANES[lanes[0]]
    const grp = new Group()
    mesh = new Mesh(G.block, M.block)
    const g = glow(OBSTACLE_STYLE.block.emissive, 2.6, 2.2)
    grp.add(mesh, g)
    o.root = grp
    o.mesh = mesh
    o.glowPlane = g
    o.cy = cfg.y + cfg.h / 2
    grp.position.set(cx, o.cy, -meter)
    o.cx = cx
  } else if (kind === 'laserLow' || kind === 'laserHigh') {
    // 2 发射节点（八面体）+ 之间能量束（细圆柱）；点亮前 0.4s 闪烁预警示（04 §1.3 公平性）
    const grp = new Group()
    const beam = new Mesh(G.beam, kind === 'laserLow' ? M.laserLow.dim : M.laserHigh.dim)
    beam.rotation.z = Math.PI / 2
    const emL = new Mesh(G.emitter, M.emitter)
    emL.position.x = -1.8
    const emR = new Mesh(G.emitter, M.emitter)
    emR.position.x = 1.8
    grp.add(beam, emL, emR)
    const cy = cfg.y + cfg.h / 2
    grp.position.set(0, cy, -meter)
    o.root = grp
    o.mesh = beam
    o.beam = beam
    o.emitters = [emL, emR]
    o.cx = 0
    o.cy = cy
    o.state = 'dim'
    const g = glow(kind === 'laserLow' ? OBSTACLE_STYLE.laserLow.emissive : OBSTACLE_STYLE.laserHigh.emissive, 4.4, 1.0)
    g.position.set(0, 0, 0)
    grp.add(g)
    o.glowPlane = g
  } else {
    // 旋转锯：12 齿锯盘，轴沿 x（横扫），高速自转 + 橙色边缘光
    const grp = new Group()
    const disk = new Mesh(G.saw, M.saw)
    disk.rotation.y = Math.PI / 2 // 挤出轴（局部 z）→ 世界 x
    const g = glow(OBSTACLE_STYLE.saw.emissive, 4.2, 2.6)
    grp.add(disk, g)
    grp.position.set((LANES[lanes[0]] + LANES[lanes[1]]) / 2, cfg.y, -meter)
    o.root = grp
    o.mesh = disk
    o.spinning = true
    o.cx = grp.position.x
    o.cy = cfg.y
    o.glowPlane = g
  }
  return o
}

function buildGate(type: GateType, meter: number): LiveGate {
  const g = new Group()
  const mat = M.gate[type]
  const postL = new Mesh(G.gatePost, mat)
  postL.position.set(-1.9, 1.3, 0)
  const postR = new Mesh(G.gatePost, mat)
  postR.position.set(1.9, 1.3, 0)
  const ring = new Mesh(G.gateRing, mat)
  ring.position.set(0, 1.3, 0)
  const rune = new Mesh(G.runeRing, M.rune[type])
  rune.position.set(0, 1.3, 0)
  const halo = glow(GATE_COLOR[type], 5.2, 3.4)
  halo.position.set(0, 1.3, 0)
  g.add(postL, postR, ring, rune, halo)
  g.position.z = -meter
  return { root: g, meter, type, ring, rune, halo }
}

function buildRhythmGate(meter: number, beatIndex: number): LiveRhythmGate {
  const g = buildGate('rhythm', meter)
  // 目标环（判定窗口可视化：拍点时主环收拢到目标环，04 §1.5「同 reflex-rush 圆环思路」）
  const targetRing = new Mesh(G.targetRing, M.gate.rhythm)
  targetRing.position.set(0, 1.3, 0)
  g.root.add(targetRing)
  return { ...g, beatIndex, targetRing }
}

function buildCheckpoint(meter: number): { root: Group; meter: number; halo: Mesh } {
  const g = new Group()
  const ring = new Mesh(G.cpRing, M.cp)
  ring.position.set(0, 1.5, 0)
  const halo = glow(0xbaffff, 7, 4.5)
  halo.position.set(0, 1.5, 0)
  g.add(ring, halo)
  g.position.z = -meter
  return { root: g, meter, halo }
}

// ---- 轨道 ----

export function createTrack(seed: number): TrackRefs {
  const world = new Group()
  const obstacles: LiveObstacle[] = []
  const coins: LiveCoin[] = []
  const gates: LiveGate[] = []
  const rhythmGates: LiveRhythmGate[] = []
  const checkpoints: TrackRefs['checkpoints'] = []
  const chunkGroups = new Map<number, Group>()

  // 金币 InstancedMesh（全部金币合并 1–2 draw call）
  const COIN_N = 128
  const coinIM = new InstancedMesh(G.coin, M.coin, COIN_N)
  coinIM.instanceMatrix.setUsage(DynamicDrawUsage)
  world.add(coinIM)
  const bigIM = new InstancedMesh(G.bigCoin, M.bigCoin, 16)
  world.add(bigIM)
  const bigGlowIM = new InstancedMesh(G.glowPlane, new MeshBasicMaterial({
    map: makeGlowTexture(), color: 0xffd54a, blending: AdditiveBlending, depthWrite: false, transparent: true, side: DoubleSide,
  }), 16)
  world.add(bigGlowIM)
  const m4 = new Matrix4()
  const q0 = new Quaternion()
  const v0 = new Vector3()
  const s0 = new Vector3()
  let bigCoinCount = 0
  let coinSpin = 0

  function buildChunk(c: number): void {
    const plan: ChunkPlan = planChunk(seed, c, TRACK.chunkM)
    const g = new Group()
    for (const item of plan.items) {
      if (item.coins) {
        // 金币串：指定车道一条直线（间距 1.2m；串首可大金币）
        const lane = item.lanes[0] ?? 1
        for (let i = 0; i < item.coins; i++) {
          const m = item.meter + i * 1.2
          coins.push({ lane, x: LANES[lane], y: 0.9, meter: m, taken: false, big: item.bigCoin === true && i === 0 })
        }
      } else {
        const o = buildObstacle(item.kind, item.meter, item.lanes)
        g.add(o.root)
        obstacles.push(o)
      }
    }
    if (plan.energyGate) {
      const gt = buildGate(plan.energyGate.type, plan.energyGate.meter)
      g.add(gt.root)
      gates.push(gt)
    }
    if (plan.boostGate != null) {
      const gt = buildGate('boost', plan.boostGate)
      g.add(gt.root)
      gates.push(gt)
    }
    if (plan.rhythmGate) {
      const rg = buildRhythmGate(plan.rhythmGate.meter, plan.rhythmGate.beatIndex)
      g.add(rg.root)
      rhythmGates.push(rg)
    }
    if (plan.checkpoint != null) {
      const cp = buildCheckpoint(plan.checkpoint)
      g.add(cp.root)
      checkpoints.push(cp)
    }
    chunkGroups.set(c, g)
    world.add(g)
  }

  for (let c = 0; c < TRACK.chunks; c++) buildChunk(c)

  const AHEAD = 220, BEHIND = 20

  function update(meters: number, ctx: TrackCtx): void {
    world.position.z = meters
    // 块管理：保持 [base .. base+3]
    const base = Math.floor(meters / TRACK.chunkM)
    for (const [c, g] of chunkGroups) {
      if (c < base) {
        g.removeFromParent()
        chunkGroups.delete(c)
      }
    }
    const have = (c: number) => chunkGroups.has(c)
    for (let i = 0; i < TRACK.chunks; i++) {
      if (!have(base + i)) buildChunk(base + i)
    }

    // 激光预警示状态机（04 §1.3 公平性：暗态 → 0.8s 闪烁 → 0.4s 点亮致死）
    const blink = 0.35 + 0.65 * Math.abs(Math.sin(ctx.nowMs * 0.024))
    for (const st of [M.laserLow.warn, M.laserHigh.warn]) st.opacity = blink

    // 障碍动画 + 可视裁剪
    for (const o of obstacles) {
      const rel = o.meter - meters
      const inWindow = rel < AHEAD && rel > -BEHIND
      ;(o.root as Object3DLike).visible = inWindow
      if (!inWindow) continue
      if (o.kind === 'laserLow' || o.kind === 'laserHigh') {
        const tta = ctx.laserTta(o.meter)
        const st = tta > 0.8 ? 'dim' : tta > 0.4 ? 'warn' : 'active'
        if (o.state !== st) {
          o.state = st
          const set = o.kind === 'laserLow' ? M.laserLow : M.laserHigh
          o.beam!.material = set[st]
        }
        if (o.glowPlane) o.glowPlane.visible = st !== 'dim'
      } else if (o.spinning) {
        o.mesh.rotation.z += 0.35 // 绕自身长轴高速自转
      }
      if (o.glowPlane && o.kind === 'block') {
        // 品红边缘光脉冲（0.5s 周期）
        const p = 0.8 + 0.2 * Math.sin(ctx.nowMs * 0.0125 + o.meter)
        o.glowPlane.scale.set(2.6 * p, 2.2 * p, 1)
      }
    }

    // 金币（IM 批量：普通 128 + 大金币 16 + 大金币辉光）
    coinSpin += ctx.dtMs * 0.004
    let ci = 0
    bigCoinCount = 0
    for (const c of coins) {
      const z = c.meter - meters
      if (c.taken || z > AHEAD || z < -BEHIND) {
        // 磁力/boost 吸入：渲染 x/y 向玩家聚拢（抛物线吸入观感）
        if (c.taken) continue
        continue
      }
      if ((ctx.magnet || ctx.boost) && z > -1 && z < 8) {
        const k = 1 - Math.pow(0.0005, ctx.dtMs / 1000)
        c.x += (ctx.playerX - c.x) * k
        c.y += (ctx.playerY + 0.4 - c.y) * k * 0.6
      }
      if (c.big) {
        const sc = 1 + 0.08 * Math.sin(ctx.nowMs * 0.006)
        v0.set(c.x, c.y, -z)
        q0.setFromAxisAngle(V3Y, coinSpin * 2)
        s0.set(sc, sc, sc)
        m4.compose(v0, q0, s0)
        bigIM.setMatrixAt(bigCoinCount, m4)
        const gs = 2.2 * (1 + 0.15 * Math.sin(ctx.nowMs * 0.006))
        m4.compose(v0, q0, s0.set(gs, gs, 1))
        bigGlowIM.setMatrixAt(bigCoinCount, m4)
        bigCoinCount++
      } else {
        v0.set(c.x, c.y + 0.05 * Math.sin(coinSpin + c.meter), -z)
        q0.setFromAxisAngle(V3Y, coinSpin + c.meter)
        s0.set(1, 1, 1)
        m4.compose(v0, q0, s0)
        coinIM.setMatrixAt(ci, m4)
        ci++
      }
    }
    // 未用槽位缩 0（避免显示残留）
    s0.set(0, 0, 0)
    m4.compose(v0.set(0, -50, 0), q0, s0)
    for (; ci < COIN_N; ci++) coinIM.setMatrixAt(ci, m4)
    for (let i = bigCoinCount; i < 16; i++) bigIM.setMatrixAt(i, m4), bigGlowIM.setMatrixAt(i, m4)
    coinIM.instanceMatrix.needsUpdate = true
    bigIM.instanceMatrix.needsUpdate = true
    bigGlowIM.instanceMatrix.needsUpdate = true

    // 门（符文环纹理滚动 = 反向旋转错觉；节拍脉动；halo 缩放）
    for (const g of gates) {
      const rel = g.meter - meters
      g.root.visible = rel < AHEAD && rel > -BEHIND
      if (!g.root.visible) continue
      if (g.type === 'boost' || g.type === 'rhythm') {
        if (g.rune) M.rune[g.type].map!.offset.x += ctx.dtMs * 0.00025
        if (g.ring && g.type === 'rhythm') {
          // 拍点时主环收拢（判定窗口可视化，04 §1.5）
          const s = 1 + 0.16 * (1 - ctx.beatPulse)
          g.ring.scale.set(s, s, 1)
        }
        if (g.halo) {
          const hs = 1 + 0.1 * ctx.beatPulse
          g.halo.scale.set(5.2 * hs, 3.4 * hs, 1)
        }
      }
    }
    for (const cp of checkpoints) {
      const rel = cp.meter - meters
      cp.root.visible = rel < AHEAD && rel > -BEHIND
      if (cp.halo && cp.root.visible) {
        const p = 0.9 + 0.15 * Math.sin(ctx.nowMs * 0.004)
        cp.halo.scale.set(7 * p, 4.5 * p, 1)
      }
    }
  }

  return {
    world,
    obstacles,
    coins,
    gates,
    rhythmGates,
    checkpoints,
    update,
    dispose() {
      for (const [, g] of chunkGroups) g.removeFromParent()
      chunkGroups.clear()
      obstacles.length = 0; coins.length = 0; gates.length = 0
      rhythmGates.length = 0; checkpoints.length = 0
    },
  }
}

type Object3DLike = { visible: boolean }
const V3Y = new Vector3(0, 1, 0)

/** 地面轨道板（04 §1.3：发光网格纹理随速度滚动 = map.offset 平移）。 */
export function buildTrackFloor(): { group: Group; gridTex: CanvasTexture } {
  const g = new Group()
  const gridTex = makeGridTexture()
  gridTex.repeat.set(2, 210) // 每格 ≈ 2.2m × 2m
  const floor = new Mesh(
    new BoxGeometry(4.4, 0.2, 420),
    new MeshStandardMaterial({
      color: 0x304050, map: gridTex, roughness: 0.85, metalness: 0.3,
      emissive: 0x00e5ff, emissiveMap: gridTex, emissiveIntensity: 0.32,
    }),
  )
  floor.position.set(0, -0.1, -210)
  g.add(floor)
  const stripGeo = new BoxGeometry(0.12, 0.06, 420)
  const l = new Mesh(stripGeo, new MeshBasicMaterial({ color: 0x00e5ff }))
  l.position.set(-2.15, 0.03, -210)
  const r = new Mesh(stripGeo, new MeshBasicMaterial({ color: 0xff2d78 }))
  r.position.set(2.15, 0.03, -210)
  g.add(l, r)
  const laneMat = new MeshBasicMaterial({ color: 0x2a2a4a })
  for (const x of [-0.6, 0.6]) {
    const s = new Mesh(new BoxGeometry(0.04, 0.03, 420), laneMat)
    s.position.set(x, 0.02, -210)
    g.add(s)
  }
  return { group: g, gridTex }
}
