# 04 · 游戏 B「方块狂奔 Cube Rush」详细设计（Three.js r186 · WebGPU）

> 品类：3D 低多边形无尽跑酷（endless runner）｜引擎：Three.js r186（`WebGPURenderer`，自动回退 WebGL2）｜
> 平台接入：按 `02` 文档｜里程碑：M3｜展示价值：WebGPU 浏览器 3D 效果上限（个人项目量级）+ 技术橱窗 P5

---

## 1. 游戏设计

### 1.1 核心玩法

- 视角：第三人称后方斜 45° 跟随相机；玩家 = 发光方块（自转），在**三车道**悬浮轨道上自动向前。
- 操作极简（单手可玩）：**左右换道 + 跳跃**，无射击：
  - 桌面：`A/D` 或 `←/→` 换道，`空格/W/↑` 跳（可二段跳），`Shift` 滑铲（钻低栏）。
  - 移动：左滑/右滑换道，点按跳，下滑滑铲。
- 障碍类型（程序化生成，随距离提速）：
  1. **路障块**（占 1 道，跳/换道躲避）
  2. **激光栏**（低/高两档：低的必须跳，高的必须滑铲）
  3. **旋转锯**（横扫两道，节奏躲避）
  4. **能量门**（×2 得分 10s / 护盾 3s / 磁力吸金币 8s）
  5. **金币**（车道上成线/成弧）
- 失败 = 撞障碍（无护盾时）。单局无尽，距离（米）= 主分数。
- 每 500m 一个「检查点闪门」：穿过 = +5,000 分 + 短暂无敌（节奏喘息点）。
- 模式：`街机`（默认）+ `时间冲刺`（3 分钟内距离排名，M3 后开，复用同一引擎）。

### 1.2 计分

| 事件 | 分值 |
|---|---|
| 距离 | 1 分/米（×能量门倍率） |
| 金币 | 100 × 倍率（磁力模式下自动吸附） |
| 检查点 | 5,000 |
| 无伤通过 500m 段 | 2,000 |

`score.range` 0–99,999,999；meta：`{ meters, coins, checkpoints, maxSpeed: float }`。
成就：FIRST_1K（1000m）、MAGNET_MASTER（磁力吸满 100 币）、NO_HIT_2K（2000m 无伤）。

### 1.3 视觉

- 低多边形 + 霓虹：轨道 = 深灰金属 + 边缘霓虹灯带（emissive）；障碍 = 品红/橙自发光块；
  背景 = 程序化星云（大 sphere + 顶点色渐变）+ 远景城市剪影（InstancedMesh 盒子，伪 3D 视差）。
- 后处理：Bloom（UnrealBloom 等效，TSL 或 EffectComposer——按 r186 当前示例取最简路径）
  + 轻微速度线（shader 平面）；**像素比自适应**：`renderer.setPixelRatio(min(devicePixelRatio, 2))`，
  低端机降 1.0。
- 无音频依赖的沉浸：BGM 1 首（赛博 lo-fi ~1.2MB ogg）+ SFX 5 条（换道/跳/金币/护盾/撞毁）。

---

## 2. 技术选型与工程结构

### 2.1 选型裁定

- **Three.js r186（2026-09 发布）**：`WebGPURenderer` 为官方「WebGLRenderer 的现代替代」，
  **默认尝试 WebGPU，不支持时自动回退 WebGL2 后端**（官方文档，00 文档脚注 1）——一份代码两档画质，
  正是本平台要的「WebGPU 展示 + 全环境可玩」。
- 不用 TSL（节点着色语言）写材质——r186 标准 `MeshStandardMaterial`/`MeshBasicMaterial` + emissive
  足够本游戏视觉量级；Bloom 走 r186 examples 的 webgpu 后处理链路（以当前版本示例为准，红线：官方当版本）。
- **不用物理引擎**：跑酷只需要「车道插值 + 抛物线跳 + AABB 碰撞」，手写 ~200 行，比引入
  rapier/cannon 省 1MB+ 且帧率更稳。
- 资源格式：模型 `.glb`（Blender 低模导出，<100KB 全部模型）+ 音频 ogg；无纹理图集（纯色 + emissive）。
- TypeScript + Vite；three 走 npm（~700KB min，gzip ~170KB）。

### 2.2 工程结构

```
games/cube-rush/
├── package.json            # three@r186, typescript, vite
├── vite.config.ts
├── index.html              # 入口：canvas + 加载条 + WebGPU 检测提示
├── manifest.json           # engine: "threejs"（卡片徽章：Three.js · WebGPU）
└── src/
    ├── main.ts             # 启动：检测 webgpu → new WebGPURenderer()（回退逻辑内建）→ 场景装配
    ├── game/
    │   ├── Game.ts         # 主状态机：menu | running | paused | result（rAF 循环 + 固定步长 60Hz 逻辑）
    │   ├── track.ts        # 轨道分块生成器（前 4 块后 1 块，复用 BufferGeometry；障碍按距离表放置）
    │   ├── player.ts       # 方块 + 换道插值（easeOut 0.15s）+ 跳（二段）+ 滑铲 + AABB 碰撞
    │   ├── camera.ts       # 跟随 + 轻微 lag + 撞击镜头抖
    │   ├── obstacles.ts    # 5 类障碍工厂 + 生成导演（随 meters 的难度曲线，数据表驱动）
    │   ├── collectibles.ts # 金币/能量门（磁力吸附 = 目标点插值）
    │   └── environment.ts  # 星云/远景/灯光（3 点光 + hemi，全部静态烘焙进材质）
    ├── render/
    │   ├── setup.ts        # WebGPURenderer 创建 + 失败时 WebGL2 回退日志（game:track 报 webgpu:false）
    │   ├── post.ts         # Bloom（按帧预算开关：FPS<40 自动关 Bloom）
    │   └── adaptive.ts     # 像素比/粒子/Bloom 三档自适应（0.5s 滑动窗口 FPS 决策）
    ├── input/
    │   └── input.ts        # 键盘 + 触控（swipe 判定 30px 阈值）统一成 Command
    ├── audio/audio.ts      # WebAudio（首交互初始化，02 文档 §4）
    ├── platform/bridge.ts  # games/shared/bridge.ts 同款（02 文档 §4）
    └── assets/models/*.glb
```

### 2.3 关键实现要点

- **轨道生成**：`track.ts` 维护 4 个 100m 块；玩家前进 50m 时最远块重排（障碍/金币重掷，
  用 `seed + blockIndex` 确定性随机，重开同距离布局可复现，利于调平与测试）。
- **碰撞**：玩家 AABB（0.8³）vs 障碍 AABB（每块预计算，随块移动）；金币用距离阈值（0.6m 吸附）。
  逻辑固定 60Hz 步长，渲染 rAF 解耦（渲染帧内最多补 3 个逻辑步，防螺旋死亡）。
- **Draw call 预算 ≤ 50**：远景城市 `InstancedMesh`（1 draw call，500 实例）；金币 `InstancedMesh`
  （同材质合并）；轨道块 4 draw call；障碍 ≤ 24 独立 mesh（材质各 1）。
- **WebGPU 检测与展示**：`navigator.gpu` 存在 → 尝试 `WebGPURenderer`；成功在结算页显示
  「WebGPU ✓」徽章，失败回退 WebGL2 显示「WebGL2 兼容模式」——**把回退本身做成展示内容**
  （技术拆解页 P5 的素材），`game:ready` 里带 `webgpu: boolean` 遥测上报，平台统计「WebGPU 占比」。
- **提分链路**：`Result` 页 → `bridge.submitScore(meters×1+coins×100+..., meta)`，同 03 文档 §2.3。

---

## 3. 性能预算

| 项 | 目标 |
|---|---|
| 包体积 | ≤ 15MB（three ~170KB gz + 代码 ~150KB gz + glb 全集 ≤ 1MB + 音频 ≤ 2MB；余量给后处理 chunk） |
| 首玩时间 | 4G P90 ≤ 8s；WebGPU 编译首次 +2s（引擎 shader 预热，加载条覆盖） |
| 帧率 | 桌面 WebGPU 60fps；WebGL2 回退 50fps 可玩；移动端：关 Bloom + 像素比 1.0 → 45fps |
| Draw call | ≤ 50（§2.3） |
| 内存 | 峰值 ≤ 300MB（WebGPU 资源池，关卡内不增长——块复用的关键验收项） |

---

## 4. 里程碑（M3 内，~4 周）

| 周 | 内容 | 验收 |
|---|---|---|
| W1 | 渲染骨架：WebGPURenderer + 回退 + 轨道滚动 + 玩家三动作 + 相机 | 空轨道可跑，两档后端都跑通 |
| W2 | 障碍 5 类 + 生成导演 + 碰撞 + 金币/能量门 + 计分 | 完整单局流程 |
| W3 | Bloom/环境 + 音频 + 自适应画质 + 触控 + 平台桥接 | 手机可玩；提分链路通 |
| W4 | 性能调优（draw call/内存验收）+ 发布 + 技术拆解页（P5：WebGPU 回退数据图） | 02 文档 §8 清单全过 |

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| WebGPU 环境参差（旧 Android WebView/部分 Safari） | 官方回退路径（WebGL2）+ 画质降档 + 加载期 UI 明示当前后端；遥测统计覆盖率，低于 60% 时技术拆解页改口径 |
| r186 后处理示例 API 变动（three 每版迁移指南） | 锁定 r186；Bloom 若示例链路不稳 → 降级为「emissive + 假辉光（sprite 叠加）」视觉方案，功能不阻塞 |
| 移动端发热（WebGPU 编译 + 满帧） | 自适应三档（§2.3）；默认移动端起步中档 |
| 无尽跑酷内容单调 | 难度曲线数据表 + 检查点节奏 + 500m 段无伤奖励；M3 后加时间冲刺模式复用引擎 |
