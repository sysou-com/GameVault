/**
 * 环境（04 §1.3：星云 + 远景城市剪影 + 灯光）。全部程序化，零外部资产。
 * - 天空：大 sphere 背面 + 顶点色渐变（深空→霓虹紫）
 * - 城市：InstancedMesh 盒子 ×500（伪 3D 视差，1 draw call）
 * - 灯光：hemi + 2 点光（霓虹氛围；障碍自发光为主视觉）
 * 注意：所有几何/材质为共享单例，游戏过程中永不 dispose（规避 r186 WebGPURenderer
 * 「Buffer used in submit while destroyed」已知 bug）。
 */
import {
  SphereGeometry, Mesh, MeshBasicMaterial, InstancedMesh, BoxGeometry,
  Matrix4, Vector3, Color, Quaternion, HemisphereLight, PointLight,
  FogExp2, BackSide, Group, BufferAttribute,
} from 'three/webgpu'
import { mulberry32 } from '../core/rng.ts'

export interface Environment {
  group: Group
  fog: FogExp2
  /** 城市剪影随玩家距离轻微滚动（伪视差）。 */
  updateCity(z: number): void
}

export function buildEnvironment(seed: number): Environment {
  const group = new Group()

  // 天空球（半径 800，背面渲染，顶点色三段渐变）
  const skyGeo = new SphereGeometry(800, 24, 16)
  const pos = skyGeo.getAttribute('position') as BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const cTop = new Color(0x050514)      // 顶部深空
  const cMid = new Color(0x1b0b2e)      // 中紫
  const cBot = new Color(0x0a0a18)      // 底部近黑
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const y = (pos.getY(i) / 800 + 1) / 2 // 0(底)–1(顶)
    if (y > 0.55) tmp.copy(cMid).lerp(cTop, (y - 0.55) / 0.45)
    else tmp.copy(cBot).lerp(cMid, y / 0.55)
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b
  }
  skyGeo.setAttribute('color', new BufferAttribute(colors, 3))
  const sky = new Mesh(
    skyGeo,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false }),
  )
  group.add(sky)

  // 远景城市：InstancedMesh 盒子 500（两侧 + 远端，伪 3D）
  // 用 MeshBasicMaterial（远景剪影不受轨道点光影响，更快更贴主题）。
  const cityGeo = new BoxGeometry(1, 1, 1)
  const cityMat = new MeshBasicMaterial({ color: 0x141033 })
  const city = new InstancedMesh(cityGeo, cityMat, 500)
  const rng = mulberry32(seed ^ 0xc17)
  const m4 = new Matrix4()
  const q0 = new Quaternion()
  for (let i = 0; i < 500; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const x = side * (14 + rng() * 40)
    const h = 2 + rng() * 22
    const z = -(rng() * 900) + 50
    const w = 2 + rng() * 5
    m4.compose(new Vector3(x, h / 2 - 0.5, z), q0, new Vector3(w, h, 2 + rng() * 6))
    city.setMatrixAt(i, m4)
  }
  city.instanceMatrix.needsUpdate = true
  group.add(city)

  // 雾（指数雾，霓虹夜空感）—— 归 Scene，Game.ts 装配
  const fog = new FogExp2(0x07070f, 0.011)

  // 灯光
  group.add(new HemisphereLight(0x4a3f8a, 0x0a0a14, 0.9))
  const pink = new PointLight(0xff2d78, 30, 60, 2)
  pink.position.set(-6, 4, -10)
  group.add(pink)
  const cyan = new PointLight(0x00e5ff, 30, 60, 2)
  cyan.position.set(6, 3, -20)
  group.add(cyan)

  return {
    group,
    fog,
    updateCity(z) {
      // 伪视差：城市整体以 0.3× 速度向相机滚动，超出 900m 后循环
      const shift = ((z * 0.3) % 900 + 900) % 900
      city.position.z = shift
    },
  }
}
