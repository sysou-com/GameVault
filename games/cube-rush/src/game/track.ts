/**
 * 轨道与实体（04 §2.3：4 块×100m，确定性重排；draw call 预算靠可视裁剪）。
 * 世界模型：玩家恒在 z=0 向 -z「前进」，worldGroup.position.z = meters（传送带式），
 * 实体局部 z = -meter（负 = 前方）。相机在 +z 后方。
 */
import {
  Group, Mesh, BoxGeometry, CylinderGeometry, TorusGeometry, PlaneGeometry, MeshStandardMaterial,
  MeshBasicMaterial, CanvasTexture, AdditiveBlending,
  DoubleSide,
} from 'three/webgpu'
import { LANES, OBSTACLE, OBSTACLE_STYLE, ENERGY, CHECKPOINT, COIN, TRACK } from '../core/constants.ts'
import { planChunk, type ChunkPlan } from '../core/director.ts'

export interface LiveCoin {
  mesh: Mesh
  lane: number
  meter: number
  taken: boolean
  z: number // 世界 z（每 tick 由 Game 计算 = coin.meter - meters）
}

export interface TrackRefs {
  world: Group
  /** 障碍实体（AABB 用；渲染层与碰撞层共享同一批对象）。 */
  obstacles: { mesh: Mesh; meter: number; kind: string; w: number; h: number; d: number; cx: number; cy: number; lanes: number[]; spinning?: boolean }[]
  coins: LiveCoin[]
  gates: { mesh: Group; meter: number; type: 'score' | 'shield' | 'magnet' }[]
  checkpoints: { mesh: Group; meter: number }[]
  /** 当前可视窗口内更新（Game 每 tick 调用）。 */
  update(meters: number): void
  dispose(): void
}

/** 假辉光：运行时径向渐变 sprite（04 §5 批准的降级 Bloom 方案，双后端统一）。 */
let glowTexture: CanvasTexture | null = null
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

// glow 共享平面几何（单例，启动时创建一次，永不 dispose）：
// 所有 glow Mesh 复用同一几何 → 游戏过程零 GPU buffer churn，规避 r186 WebGPURenderer
// 「Buffer used in submit while destroyed」已知 bug（几何销毁/重建触发 stale bind group）。
const glowPlaneGeo = new PlaneGeometry(1, 1)

function glow(color: number, scale = 2.5): Mesh {
  // 用共享 PlaneGeometry 的 Mesh 代替 Sprite：
  // ① 避免逐障碍创建/销毁 SpriteGeometry 造成 GPU buffer churn（触发 r186 WebGPURenderer
  //   「Buffer used in submit while destroyed」已知 bug）；
  // ② 平面默认朝 +z（面向 +z 的相机），无需逐帧 billboard。
  const s = new Mesh(glowPlaneGeo, new MeshBasicMaterial({
    map: makeGlowTexture(), color, blending: AdditiveBlending, depthWrite: false, transparent: true, side: DoubleSide,
  }))
  s.scale.set(scale, scale, 1)
  return s
}

// 共享几何/材质（池化；每类障碍 1 材质 1 几何）
const G = {
  block: new BoxGeometry(OBSTACLE.block.w, OBSTACLE.block.h, OBSTACLE.block.d),
  laserLow: new BoxGeometry(OBSTACLE.laserLow.w, OBSTACLE.laserLow.h, OBSTACLE.laserLow.d),
  laserHigh: new BoxGeometry(OBSTACLE.laserHigh.w, OBSTACLE.laserHigh.h, OBSTACLE.laserHigh.d),
  saw: new CylinderGeometry(1.15, 1.15, OBSTACLE.saw.d, 6), // 六角截面：旋转可见（平面体为革命体，转看不出来）
  coin: new CylinderGeometry(0.24, 0.24, 0.07, 12),
  gatePost: new BoxGeometry(0.35, 2.6, 0.35),
  gateRing: new TorusGeometry(1.35, 0.09, 8, 24),
  cpRing: new TorusGeometry(1.9, 0.12, 8, 32),
}
const M = {
  block: new MeshStandardMaterial({ color: OBSTACLE_STYLE.block.color, emissive: OBSTACLE_STYLE.block.emissive, emissiveIntensity: 0.55, roughness: 0.6 }),
  laserLow: new MeshBasicMaterial({ color: OBSTACLE_STYLE.laserLow.emissive }),
  laserHigh: new MeshBasicMaterial({ color: OBSTACLE_STYLE.laserHigh.emissive }),
  saw: new MeshStandardMaterial({ color: OBSTACLE_STYLE.saw.color, emissive: OBSTACLE_STYLE.saw.emissive, emissiveIntensity: 0.8, roughness: 0.4, metalness: 0.6 }),
  gate: {
    score: new MeshBasicMaterial({ color: ENERGY.score.color }),
    shield: new MeshBasicMaterial({ color: ENERGY.shield.color }),
    magnet: new MeshBasicMaterial({ color: ENERGY.magnet.color }),
  },
  cp: new MeshBasicMaterial({ color: 0xeaffff }),
  coin: new MeshBasicMaterial({ color: 0xffd54a }),
}

function buildObstacle(kind: 'block' | 'laserLow' | 'laserHigh' | 'saw', meter: number, lanes: number[]): { mesh: Mesh; meter: number; kind: string; cx: number; cy: number; w: number; h: number; d: number; lanes: number[]; spinning?: boolean } {
  const cfg = OBSTACLE[kind]
  let mesh: Mesh
  let cx = 0
  if (kind === 'block') {
    cx = LANES[lanes[0]]
    mesh = new Mesh(G.block, M.block)
  } else if (kind === 'laserLow' || kind === 'laserHigh') {
    mesh = new Mesh(kind === 'laserLow' ? G.laserLow : G.laserHigh, kind === 'laserLow' ? M.laserLow : M.laserHigh)
  } else {
    cx = (LANES[lanes[0]] + LANES[lanes[1]]) / 2
    mesh = new Mesh(G.saw, M.saw)
    mesh.rotation.z = Math.PI / 2 // 轴沿 x（横扫）
  }
  const cy = kind === 'saw' ? cfg.y : cfg.y + cfg.h / 2
  mesh.position.set(cx, cy, -meter)
  if (kind === 'laserLow' || kind === 'laserHigh') {
    mesh.position.y = cfg.y + cfg.h / 2
  }
  const r = { mesh, meter, kind, cx, cy, w: cfg.w, h: cfg.h, d: cfg.d, lanes, spinning: kind === 'saw' || undefined }
  // 辉光（激光/锯/方块边缘光感）
  if (kind !== 'block') {
    const g = glow(OBSTACLE_STYLE[kind].emissive, kind === 'saw' ? 4 : 2.2)
    if (g) mesh.add(g)
  }
  return r
}

function buildGate(type: 'score' | 'shield' | 'magnet', meter: number): Group {
  const g = new Group()
  const mat = M.gate[type]
  const postL = new Mesh(G.gatePost, mat)
  postL.position.set(-1.4, 1.3, 0)
  const postR = new Mesh(G.gatePost, mat)
  postR.position.set(1.4, 1.3, 0)
  const ring = new Mesh(G.gateRing, mat)
  ring.position.set(0, 1.3, 0)
  const halo = glow(ENERGY[type].color, 5)
  if (halo) {
    halo.position.set(0, 1.3, 0)
    g.add(halo)
  }
  g.add(postL, postR, ring)
  g.position.z = -meter
  return g
}

function buildCheckpoint(meter: number): Group {
  const g = new Group()
  const ring = new Mesh(G.cpRing, M.cp)
  ring.position.set(0, 1.5, 0)
  const halo = glow(0xbaffff, 7)
  if (halo) {
    halo.position.set(0, 1.5, 0)
    g.add(halo)
  }
  g.add(ring)
  g.position.z = -meter
  return g
}

/** 创建一条轨道（4 块预建），返回句柄。 */
export function createTrack(seed: number): TrackRefs {
  const world = new Group()
  const obstacles: TrackRefs['obstacles'] = []
  const coins: LiveCoin[] = []
  const gates: TrackRefs['gates'] = []
  const checkpoints: TrackRefs['checkpoints'] = []
  const chunkGroups = new Map<number, Group>()

  function buildChunk(c: number): void {
    const plan: ChunkPlan = planChunk(seed, c, TRACK.chunkM)
    const g = new Group()
    for (const item of plan.items) {
      if (item.coins) {
        // 金币串：指定车道一条直线（间距 1.2m）
        const lane = item.lanes[0] ?? 1
        for (let i = 0; i < item.coins; i++) {
          const mesh = new Mesh(G.coin, M.coin)
          mesh.rotation.x = Math.PI / 2
          const m = item.meter + i * 1.2
          mesh.position.set(LANES[lane], 0.9, -m)
          g.add(mesh)
          coins.push({ mesh, lane, meter: m, taken: false, z: 0 })
        }
      } else {
        const o = buildObstacle(item.kind, item.meter, item.lanes)
        g.add(o.mesh)
        obstacles.push(o)
      }
    }
    if (plan.energyGate) {
      const m = buildGate(plan.energyGate.type, plan.energyGate.meter)
      g.add(m)
      gates.push({ mesh: m, meter: plan.energyGate.meter, type: plan.energyGate.type })
    }
    if (plan.checkpoint != null) {
      const m = buildCheckpoint(plan.checkpoint)
      g.add(m)
      checkpoints.push({ mesh: m, meter: plan.checkpoint })
    }
    chunkGroups.set(c, g)
    world.add(g)
  }

  for (let c = 0; c < TRACK.chunks; c++) buildChunk(c)

  const AHEAD = 220, BEHIND = 20
  function update(meters: number): void {
    world.position.z = meters
    // 块管理：保持 [base .. base+3]
    const base = Math.floor(meters / TRACK.chunkM)
    for (const [c, g] of chunkGroups) {
      if (c < base) {
        g.removeFromParent()
        chunkGroups.delete(c)
        disposeGroup(g)
      }
    }
    const have = (c: number) => chunkGroups.has(c)
    if (!have(base)) buildChunk(base)
    if (!have(base + 1)) buildChunk(base + 1)
    if (!have(base + 2)) buildChunk(base + 2)
    if (!have(base + 3)) buildChunk(base + 3)
    // 可视裁剪（超出窗口的 visible=false，不产生 draw call）
    for (const o of obstacles) {
      const inWindow = o.meter - meters < AHEAD && o.meter - meters > -BEHIND
      o.mesh.visible = inWindow
      if (o.spinning && inWindow) o.mesh.rotation.y += 0.25 // 绕自身长轴（局部 y，z 已 π/2 倾侧）
    }
    for (const c of coins) {
      c.z = c.meter - meters
      c.mesh.visible = !c.taken && c.z < AHEAD && c.z > -BEHIND
      if (c.mesh.visible) c.mesh.rotation.y += 0.1
    }
    for (const g of gates) g.mesh.visible = g.meter - meters < AHEAD && g.meter - meters > -BEHIND
    for (const cp of checkpoints) cp.mesh.visible = cp.meter - meters < AHEAD && cp.meter - meters > -BEHIND
  }

  function disposeGroup(_g: Group): void {
    // 无操作：场景内所有几何均为共享单例（G.* 障碍/金币/门/检查点几何 + glowPlaneGeo），
    // 游戏过程中绝不 dispose（dispose 仍被渲染器缓存引用的几何会触发 r186 WebGPURenderer
    // 「Buffer used in submit while destroyed」）。chunk 只移出场景，JS 对象交由 GC；
    // 共享几何/材质随页面卸载由浏览器统一释放。
  }

  return {
    world,
    obstacles,
    coins,
    gates,
    checkpoints,
    update,
    dispose() {
      for (const [c, g] of chunkGroups) { g.removeFromParent(); disposeGroup(g) }
      chunkGroups.clear()
      obstacles.length = 0; coins.length = 0; gates.length = 0; checkpoints.length = 0
    },
  }
}

/** 地面轨道板（随 world 移动：长板 + 霓虹边缘灯带）。 */
export function buildTrackFloor(): Group {
  const g = new Group()
  const floor = new Mesh(
    new BoxGeometry(4.4, 0.2, 420),
    new MeshStandardMaterial({ color: 0x14141f, roughness: 0.85, metalness: 0.3 }),
  )
  floor.position.set(0, -0.1, -210)
  g.add(floor)
  const stripMatL = new MeshBasicMaterial({ color: 0x00e5ff })
  const stripMatR = new MeshBasicMaterial({ color: 0xff2d78 })
  const stripGeo = new BoxGeometry(0.12, 0.06, 420)
  const l = new Mesh(stripGeo, stripMatL)
  l.position.set(-2.15, 0.03, -210)
  const r = new Mesh(stripGeo, stripMatR)
  r.position.set(2.15, 0.03, -210)
  g.add(l, r)
  // 车道分隔微光
  const laneMat = new MeshBasicMaterial({ color: 0x2a2a4a })
  for (const x of [-0.6, 0.6]) {
    const s = new Mesh(new BoxGeometry(0.04, 0.03, 420), laneMat)
    s.position.set(x, 0.02, -210)
    g.add(s)
  }
  return g
}
