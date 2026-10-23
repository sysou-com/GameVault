/**
 * 环境（04 §1.3「优」修订：3 层视差 + 昼夜 + 窗灯 + 星点。全部程序化，零外部资产）。
 * - 天空：大 sphere 背面 + 顶点色渐变；昼夜 = material.color 乘性染色（免改顶点色）
 * - 星点：InstancedMesh 小平面 ×400（1 draw call，夜间更亮）
 * - 近层：楼宇 InstancedMesh ×28 + **窗户灯点** InstancedMesh ×600（随机亮灭 + 偶发闪烁，1 draw call）
 * - 中层：城市剪影 InstancedMesh ×500（0.3× 伪视差，1 draw call）
 * - 远景：山脊剪影 InstancedMesh ×40（0.12× 视差，1 draw call）
 * - 灯光：hemi + 2 点光（随昼夜色调联动）
 * 注意：所有几何/材质为共享单例，游戏过程中永不 dispose（规避 r186 WebGPURenderer
 * 「Buffer used in submit while destroyed」已知 bug）。
 */
import {
  SphereGeometry, Mesh, MeshBasicMaterial, InstancedMesh, InstancedBufferAttribute,
  BoxGeometry, PlaneGeometry,
  Matrix4, Vector3, Color, Quaternion, HemisphereLight, PointLight,
  FogExp2, BackSide, Group, BufferAttribute,
} from 'three/webgpu'
import { mulberry32 } from '../core/rng.ts'

export interface Environment {
  group: Group
  fog: FogExp2
  /** 城市/远景点位随玩家距离滚动（伪视差）。 */
  updateCity(z: number): void
  /** 昼夜循环：每 1000m 一段（深蓝→紫→深橙，3000m 全循环），窗灯密度联动。 */
  updateDayNight(meters: number, dtMs: number): void
  /** 当前夜色程度 0..1（供 UI/光效读取）。 */
  nightness(): number
}

// 昼夜 3 关键帧（04 §1.3：深蓝 → 紫 → 深橙）
const DAYKEYS = [
  { // 深蓝（深夜）
    fog: new Color(0x07070f), tint: new Color(0.9, 1.0, 1.15), hemiSky: new Color(0x4a3f8a),
    hemiGnd: new Color(0x0a0a14), pointA: new Color(0xff2d78), pointB: new Color(0x00e5ff),
    pointI: 30, night: 1.0,
  },
  { // 紫（夜偏黄昏）
    fog: new Color(0x0d0716), tint: new Color(1.0, 0.85, 1.25), hemiSky: new Color(0x5a3fa0),
    hemiGnd: new Color(0x120a1c), pointA: new Color(0xd04bff), pointB: new Color(0x446bff),
    pointI: 26, night: 0.75,
  },
  { // 深橙（霓虹黄昏）
    fog: new Color(0x120808), tint: new Color(1.35, 0.95, 0.7), hemiSky: new Color(0x8a4f5a),
    hemiGnd: new Color(0x1a0e08), pointA: new Color(0xff7a3d), pointB: new Color(0xffb300),
    pointI: 22, night: 0.4,
  },
]

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

export function buildEnvironment(seed: number): Environment {
  const group = new Group()
  const rngW = mulberry32(seed ^ 0xc17)

  // 天空球（半径 800，背面渲染，顶点色三段渐变；material.color 作昼夜乘性染色）
  const skyGeo = new SphereGeometry(800, 24, 16)
  const pos = skyGeo.getAttribute('position') as BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const cTop = new Color(0x050514)
  const cMid = new Color(0x1b0b2e)
  const cBot = new Color(0x0a0a18)
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const y = (pos.getY(i) / 800 + 1) / 2
    if (y > 0.55) tmp.copy(cMid).lerp(cTop, (y - 0.55) / 0.45)
    else tmp.copy(cBot).lerp(cMid, y / 0.55)
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b
  }
  skyGeo.setAttribute('color', new BufferAttribute(colors, 3))
  const skyMat = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false })
  group.add(new Mesh(skyGeo, skyMat))

  // 星点（上半球，r=770；1 draw call）
  const starGeo = new PlaneGeometry(1.6, 1.6)
  const starMat = new MeshBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0.8, fog: false })
  const stars = new InstancedMesh(starGeo, starMat, 400)
  const m4 = new Matrix4()
  const q0 = new Quaternion()
  const eul = new Quaternion()
  for (let i = 0; i < 400; i++) {
    const az = rngW() * Math.PI * 2
    const el = Math.asin(rngW() * 0.95) // 偏上半球
    const r = 770
    const x = r * Math.cos(el) * Math.cos(az)
    const y = r * Math.sin(el) + 40
    const z = -Math.abs(r * Math.cos(el) * Math.sin(az)) - 60 // 集中在前方
    q0.setFromAxisAngle(new Vector3(0, 1, 0), rngW() * Math.PI)
    m4.compose(new Vector3(x, y, z), q0, new Vector3(1, 1, 1))
    stars.setMatrixAt(i, m4)
  }
  stars.instanceMatrix.needsUpdate = true
  group.add(stars)

  // 近层楼宇（两侧 ±8..20m；1 draw call）
  const bldGeo = new BoxGeometry(1, 1, 1)
  const bldMat = new MeshBasicMaterial({ color: 0x10101f })
  const BLD = 28
  const buildings = new InstancedMesh(bldGeo, bldMat, BLD)
  for (let i = 0; i < BLD; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const x = side * (8 + rngW() * 12)
    const h = 4 + rngW() * 14
    const z = -(rngW() * 400) + 30
    m4.compose(new Vector3(x, h / 2 - 0.5, z), q0, new Vector3(2.5 + rngW() * 3, h, 3 + rngW() * 5))
    buildings.setMatrixAt(i, m4)
  }
  buildings.instanceMatrix.needsUpdate = true
  group.add(buildings)

  // 窗户灯点（近层楼面上；1 draw call，instanceColor 随机亮灭 + 偶发闪烁）
  const WIN = 600
  const winGeo = new PlaneGeometry(0.35, 0.28)
  const winMat = new MeshBasicMaterial({ transparent: true, opacity: 0.95 })
  const windows = new InstancedMesh(winGeo, winMat, WIN)
  windows.instanceColor = new InstancedBufferAttribute(new Float32Array(WIN * 3), 3)
  const winState = new Array(WIN).fill(0).map(() => ({
    on: rngW() < 0.55,
    hue: 0.6 + rngW() * 0.4, // 0.6 暖黄 → 1.0 白
    flick: rngW() * 1000,
  }))
  const winPos = new Vector3()
  const winQ = new Quaternion()
  for (let i = 0; i < WIN; i++) {
    // 挂到随机近层楼宇的某一面（近似：取楼宇网格内随机点 + 侧向朝向）
    const b = i % BLD
    const side = b % 2 === 0 ? -1 : 1
    const bx = side * (8 + mulberry32(seed ^ 0xc17 ^ (b * 7))() * 12) // 近似重放（视觉用，无需精确）
    winPos.set(bx * (0.92 + rngW() * 0.16), 1 + rngW() * 10, -(rngW() * 400) + 30)
    winQ.setFromAxisAngle(new Vector3(0, 1, 0), side > 0 ? -Math.PI / 2 : Math.PI / 2)
    m4.compose(winPos, winQ, new Vector3(1, 1, 1))
    windows.setMatrixAt(i, m4)
  }
  windows.instanceMatrix.needsUpdate = true
  group.add(windows)

  // 中层城市剪影（InstancedMesh ×500，0.3× 伪视差）
  const cityGeo = new BoxGeometry(1, 1, 1)
  const cityMat = new MeshBasicMaterial({ color: 0x141033 })
  const city = new InstancedMesh(cityGeo, cityMat, 500)
  for (let i = 0; i < 500; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const x = side * (14 + rngW() * 40)
    const h = 2 + rngW() * 22
    const z = -(rngW() * 900) + 50
    m4.compose(new Vector3(x, h / 2 - 0.5, z), q0, new Vector3(2 + rngW() * 5, h, 2 + rngW() * 6))
    city.setMatrixAt(i, m4)
  }
  city.instanceMatrix.needsUpdate = true
  group.add(city)

  // 远景山脊（0.12× 视差；极暗 + 雾吃掉细节）
  const ridgeGeo = new BoxGeometry(1, 1, 1)
  const ridgeMat = new MeshBasicMaterial({ color: 0x0a0a18 })
  const ridge = new InstancedMesh(ridgeGeo, ridgeMat, 40)
  for (let i = 0; i < 40; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const x = side * (30 + rngW() * 60)
    const h = 4 + rngW() * 10
    const z = -(rngW() * 1200) + 100
    m4.compose(new Vector3(x, h / 2 - 1, z), q0, new Vector3(30 + rngW() * 40, h, 40 + rngW() * 60))
    ridge.setMatrixAt(i, m4)
  }
  ridge.instanceMatrix.needsUpdate = true
  group.add(ridge)

  // 雾 + 灯光
  const fog = new FogExp2(0x07070f, 0.011)
  group.add(new HemisphereLight(0x4a3f8a, 0x0a0a14, 0.9))
  const hemi = group.children[group.children.length - 1] as HemisphereLight
  const pink = new PointLight(0xff2d78, 30, 60, 2)
  pink.position.set(-6, 4, -10)
  group.add(pink)
  const cyan = new PointLight(0x00e5ff, 30, 60, 2)
  cyan.position.set(6, 3, -20)
  group.add(cyan)

  const cFog = new Color()
  const cTint = new Color()
  const cSky = new Color()
  const cGnd = new Color()
  const cPA = new Color()
  const cPB = new Color()
  const winC = new Color()
  let nightness = 1
  let winClock = 0

  function updateDayNight(meters: number, dtMs: number): void {
    // 昼夜相位：每 1000m 一关键帧，3000m 全循环（+1 偏移：开局从亮相，避免起步太暗）
    const phase = ((((meters % 3000) + 3000) % 3000) / 1000 + 1) % 3
    const k = Math.floor(phase)
    const f = smoothstep(phase - k)
    const A = DAYKEYS[k % 3]
    const B = DAYKEYS[(k + 1) % 3]
    cFog.copy(A.fog).lerp(B.fog, f)
    cTint.copy(A.tint).lerp(B.tint, f)
    cSky.copy(A.hemiSky).lerp(B.hemiSky, f)
    cGnd.copy(A.hemiGnd).lerp(B.hemiGnd, f)
    cPA.copy(A.pointA).lerp(B.pointA, f)
    cPB.copy(A.pointB).lerp(B.pointB, f)
    fog.color.copy(cFog)
    skyMat.color.copy(cTint)
    hemi.color.copy(cSky)
    hemi.groundColor.copy(cGnd)
    pink.color.copy(cPA)
    cyan.color.copy(cPB)
    const pI = A.pointI + (B.pointI - A.pointI) * f
    pink.intensity = pI
    cyan.intensity = pI
    nightness = A.night + (B.night - A.night) * f
    starMat.opacity = 0.25 + 0.6 * nightness
    // 窗灯：密度与亮度随夜色；偶发闪烁（每 300ms 抽 4 扇翻转）
    winClock += dtMs
    if (winClock > 300) {
      winClock = 0
      for (let i = 0; i < 4; i++) {
        const w = winState[(Math.random() * WIN) | 0]
        w.on = !w.on
      }
    }
    const wI = 0.25 + 0.75 * nightness
    for (let i = 0; i < WIN; i++) {
      const w = winState[i]
      const flick = w.flick > 0 ? 0.5 + 0.5 * Math.sin(i * 12.9898 + Math.floor(winClock / 300) * 7.1) : 1
      if (w.on) {
        winC.setRGB(1, w.hue * 0.8, w.hue * 0.55).multiplyScalar(wI * (w.flick > 0 ? flick : 1))
      } else {
        winC.setRGB(0.04, 0.04, 0.07)
      }
      windows.instanceColor!.setXYZ(i, winC.r, winC.g, winC.b)
    }
    windows.instanceColor!.needsUpdate = true
  }

  return {
    group,
    fog,
    updateCity(z) {
      // 伪视差：近层 0.55× / 中层 0.3× / 远景 0.12×（各自循环长度取模；星点在天空球上不做视差）
      buildings.position.z = ((z * 0.55) % 400 + 400) % 400
      city.position.z = ((z * 0.3) % 900 + 900) % 900
      ridge.position.z = ((z * 0.12) % 1200 + 1200) % 1200
    },
    updateDayNight,
    nightness: () => nightness,
  }
}

/** 窗灯闪烁相位（保留占位：winState.flick 用）。 */

