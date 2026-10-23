# 03 · 游戏 A「霓虹突袭 Neon Raid」详细设计（TypeScript + Phaser 4）

> 品类：2D 横版自动射击（arcade shooter）｜引擎：Phaser 4（锁定 v4.2.x，2026-07 最新稳定版）｜
> 平台接入：按 `02` 文档（manifest / postMessage / 同源提分）｜里程碑：M2

---

## 1. 游戏设计

### 1.1 核心玩法（60 秒可学会，10 分钟有追求）

- 玩家机固定屏幕左 1/4 列，**自动向右射击**（按住不放连发），只操控**上下移动**（横版，类《雷电》简化版）。
- 关卡 = **波次制**：每关 5 波敌机，波次间隔 3s 倒计时；每关结束出现 1 台精英机（多阶段弹幕）。
- 3 大关卡（各 ~3 分钟）：
  1. **夜航（NIGHT FLIGHT）**：直飞机 + 自爆机，教学关卡（无精英弹幕密度）。
  2. **静电风暴（STATIC STORM）**：引入弹幕精英 + 屏幕边缘闪电干扰（纯视觉+轻微输入抖动，可关）。
  3. **核心突袭（CORE RAID）**：全要素 + 双精英同屏，速度密度全面上调。
- 拾取物（精英掉落，概率 100% 单件）：
  - **P 双发**（持续 20s，可叠 2 层 → 四发）
  - **S 护盾**（挡 1 次伤害，2s 无敌闪烁）
  - **B 清屏**（全屏 AOE，对精英 1/3 血）
- 死亡：1 命制；单局结束 → 结算页（本局得分 / 最高连击 / 本关通过率）→ 「再来一局」。

### 1.2 计分（对接平台 score.range 0–9,999,999）

| 事件 | 分值 |
|---|---|
| 小机 | 100 |
| 中型机 | 300 |
| 精英每阶段 | 1,000 |
| 精英全灭 | 5,000 |
| 通关一波 | 2,000 |
| 连击加成 | 连击 n（不中弹累计击杀）：得分 × (1 + min(n,50) × 0.01) |
| 剩余时间奖励（关卡内 3min 时限） | 每秒 50 |

meta 字段（`manifest.score.metaSchema`）：`{ bestCombo: int, wavesCleared: int, elitesKilled: int }`。

### 1.3 操作

| 桌面 | 移动（键盘/鼠标） | WASD/方向键 上下 + 鼠标 Y 跟随（松开吸附） |
|---|---|---|
| 移动 | 触控 | 左半屏虚拟摇杆（上下 1D 即可）+ 右半屏 = 持续射击区（按住） |
| 射击 | 自动 | 按住移动区即射击（自动开火，降低操作负担） |
| 暂停 | P / Esc | 屏幕右上 ⏸ |

### 1.4 视觉与音频

- 风格：**霓虹夜色**——深空蓝黑底 + 高饱和品红/青色描边机影；粒子拖尾（Phaser 粒子）+ 屏幕边缘
  扫描线后处理（CSS `repeating-linear-gradient` 覆盖层即可，不走 shader，省渲染开销）。
- 音频（WebAudio，`audio.requiresGesture=true`）：**零音频资产**——BGM 每关 1 首、SFX 8 条全部运行时 WebAudio 合成
  （`src/audio/synth.ts`，振荡器+噪声+包络，2026-10-23 开发裁定：免资产管线，与 reflex-rush 零资产路线一致）。
  首次 pointerdown/keydown 后初始化 `AudioContext`（自动播放策略）。

---

## 2. 技术选型与工程结构

### 2.1 选型裁定

- **Phaser 4 v4.2.1**（2026-04 GA，渲染器节点式大重写；v4.0 起 API 与 v3 大体兼容，按官方迁移指南
  开发，**只读 v4 文档**，00 文档 §3.2 脚注 5；2026-10-23 核实 v4.2.1「Giedi」2026-07-09 发布，为最新稳定版）。
- TypeScript 5 + Vite 6 构建（单 bundle，代码分割无意义——单页游戏）。
- **零外部资产**（2026-10-23 开发裁定，取代原 PNG 图集+ogg 方案）：机影/子弹/粒子全部运行时
  `Graphics.generateTexture` 生成（`src/assets/textures.ts`）；音频全部 WebAudio 合成（`src/audio/synth.ts`）。
  收益：包体 1.73MB（Phaser 占 ~1.7），无资产打包/版权/加载进度问题。
- 物理：**不用任何物理插件**，手动 AABB 判定（`src/systems/collide.ts`，纯函数可单测）。原方案「Arcade
  `overlap`」已弃：v4 对 Arcade 有 API 变更，手动判定对 v4 最稳且本游戏只有矩形碰撞。
  子弹采用**扫掠 AABB**（同时判本帧与上一帧位置）：dt 被钳 50ms 时子弹一步 45px > 敌机宽 34px，
  不扫掠会高速帧下穿透。
- 存档：本游戏**无存档**（单局制），`saves.localStoragePrefix` 仅存「设置（音量/震屏开关/解锁进度/最高分）」。

### 2.2 工程结构（实现版，2026-10-23）

```
games/neon-raid/
├── package.json            # phaser@4.2.1, typescript, vite, @types/node（test 用）
├── vite.config.ts          # build.outDir=dist；产物即游戏包（zip 交管理台，02 文档 §3.3）
├── index.html              # 包入口（<canvas id="game"> + CSS 扫描线/晕影覆盖层）
├── manifest.json           # 02 文档 §3.1 schema（build 后回填 size.totalBytes）
├── cover.svg               # 封面（零资产：SVG 直出）
├── scripts/                # zip.mjs / update-manifest.mjs（与 reflex-rush 同款）
├── test/logic.test.ts      # node --test 纯逻辑单测（combo/导演/碰撞/计分/防呆）
└── src/
    ├── main.ts             # Phaser.Game 装配（960x540, FIT, 显式渲染器 type，window.__nv 调试钩子）
    ├── scenes/
    │   ├── BootScene.ts    # 纹理生成 + 桥初始化 + 音频手势监听 → Menu
    │   ├── MenuScene.ts    # 标题 / 关卡选择（解锁进度）/ 设置 / 登录态展示
    │   ├── PlayScene.ts    # 主循环（玩家/波次/碰撞/粒子/帧率自适应/关 2 闪电干扰）
    │   └── ResultScene.ts  # 结算 → 同源 fetch 提分（bridge.submitScore）
    ├── core/
    │   ├── constants.ts    # 数值表（3 关×5 波+精英/敌机/难度/积分/拾取，数据驱动）
    │   ├── rng.ts          # 确定性随机 mulberry32（种子存 localStorage，测试可复现）
    │   ├── run.ts          # 单局状态（score/combo/拾取状态；addScore 封顶 9,999,999）
    │   └── settings.ts     # localStorage 设置（音量/震屏/解锁进度/最高分）
    ├── assets/textures.ts  # 运行时纹理（Graphics.generateTexture；零 PNG）
    ├── audio/synth.ts      # WebAudio 合成（3 BGM + 8 SFX；手势后初始化）
    ├── entities/
    │   ├── enemies.ts      # grunt/diver/bomber + 2 精英（弹幕表数据驱动；Unit 接口）
    │   ├── bullets.ts      # 子弹池（玩家 64/敌方 128；px/py 上一帧位置供扫掠）
    │   └── pickups.ts      # 拾取池（P/S/B）
    ├── systems/
    │   ├── waves.ts        # 波次导演状态机（spawning→gap→elite→cleared；纯逻辑）
    │   ├── combo.ts        # 连击计时（1.5s 窗口；纯逻辑）
    │   ├── collide.ts      # AABB/扫掠 AABB（纯函数，node 可单测）
    │   └── pool.ts         # 通用对象池
    └── platform/
        ├── bridge.ts       # postMessage 契约（game:ready/score/error/track）+ 同源 fetch 提分
        └── types.ts        # ScoreMeta 等类型
```

### 2.3 关键实现要点

- **对象池**：子弹（玩家 64 / 敌方 128）、粒子（512）用 `Phaser.GameObjects.Pool`；敌机 ≤ 24 同屏，
  复用 sprite。目标：**0 GC 峰值尖刺**（DevTools 内存面板每波次采样）。
- **波次导演数据驱动**：`constants.ts` 里波次表（JSON 化），策划（=未来的你）改数值不改逻辑：
  `[{ t: 1.2, spawn: "v1line", count: 6 }, { t: 8.0, spawn: "elite-1", pattern: "spread3" }]`。
- **难度曲线**：每关一个 `difficulty` 对象（敌速/弹速/生成密度缩放），测试页直接读表断言平衡。
- **帧率自适应**：`powerPreference: "high-performance"`；检测到 3s 平均 FPS < 45 → 自动降粒子密度
  50%（移动端兜底，记遥测 `quality=low`）。
- **提分链路（ResultScene）**：
  1. 结算页「提交分数」按钮 → `bridge.submitScore(score, meta)`：
     - 已登录（`platform:init.user.id` 存在）→ 同源 `fetch('/game/api/scores')`（带 localStorage 里的中心 JWT，02 文档 §4.3）
     - 未登录 → 提示「登录后保存成绩」+ 展示登录引导（跳平台登录流）
  2. 成就本地触发同步上报：`wavesCleared>=5` → FIRST_CLEAR；`bestCombo>=30` → COMBO_30（规则同 01 文档 §6.2 声明式）。

---

## 3. 性能预算

| 项 | 目标 | 实测（2026-10-23，v1.0.0） |
|---|---|---|
| 包体积 | ≤ 6MB（引擎 ~1.2MB + 图集 ≤ 2.5MB + 音频 ≤ 1.5MB + 代码 ≤ 300KB） | **1.73MB 单 bundle**（Phaser ~1.7MB；零资产后图集/音频预算取消）；zip 387KB |
| 首玩时间 | 4G 模拟 P90 ≤ 8s（01 文档 §9） | 待生产 smoke（包小，预期轻松达标） |
| 帧率 | 桌面 60fps 稳定；移动端 30fps 可玩（降粒子后） | 桌面浏览器 60fps（MCP 实机泡测 3 关全程无异常）；移动端 02 §8 清单 M2 内过 |
| 同屏 draw call | ≤ 30（图集单纹理） | 每纹理独立（零图集）但同屏对象 ≤ ~40，实测无压力；后续如超标再回图集方案 |
| 内存 | 峰值 ≤ 200MB（DevTools，每关结束采样） | 子弹/拾取对象池化；未做正式 DevTools 采样（留生产 smoke） |

---

## 4. 里程碑（M2 内，~3 周）

| 周 | 内容 | 验收 |
|---|---|---|
| W1 | 骨架：场景流（Menu→Play→Result）+ 玩家移动/射击 + 1 种敌机 + 碰撞计分 | 单关可玩 1 分钟 |
| W2 | 波次导演 + 3 敌机 + 2 精英弹幕 + 拾取 + 连击 + 音频 | 3 关完整流程 |
| W3 | 平台桥接（提分/成就/遥测）+ 触控 + 性能调优 + 打包发布 + 02 文档 §8 验收清单 | 公网可玩 + 榜单可见 |

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| Phaser 4 新架构文档/示例少（2026-04 才 GA） | 锁定 v4.2.1；开工先精读官方迁移指南 + 官方 examples（v4 版）；粒子/池 API 有出入时以 4.2.1 源码与 changelog 为准（红线：以官方当版本为准） |
| 移动端触控手感 | 虚拟摇杆 1D 简化；M2 前在真机（Android Chrome）过一遍 02 文档 §8 清单 |
| 弹幕同屏密度超帧率 | 弹速/密度按 `quality` 双档（high/low 两套常量表） |
| 音频自动播放策略 | `requiresGesture` 声明 + 首交互初始化；静音兜底（BGM 默认开，SFX 必响则用户可见提示） |

---

## 6. 开发回写（v1.0.0，2026-10-23）

> 实现中发现与本文早期版本不一致处，均按「以官方/当版本为准」回写；踩坑均配防回归单测。

**资产路线裁定**：PNG 图集 + ogg 音频 → **零资产**（运行时纹理 + WebAudio 合成）。理由：
单页小游戏资产总量 < 100KB，图集管线（TexturePacker）收益为负；与 reflex-rush 路线一致，包体 1.73MB。

**Phaser v4.2.1 踩坑（来源：`node_modules/phaser/dist/phaser.js` + `types/phaser.d.ts` + 官方 v4.0 MIGRATION-GUIDE.md，2026-10-23 核实）**：

1. **渲染器选择**：`GameConfig` 无 `render.type`（`RenderConfig` 只有 antialias 等渲染参数）；
   渲染器由**顶层 `type`** 指定（`Phaser.WEBGL` / `Phaser.CANVAS`）。传入 `canvas` 元素（或 customEnvironment）
   时禁止 `AUTO`——`CreateRenderer` 直接抛 `Must set explicit renderType in custom environment`
   （受控/无头浏览器实测必现）。本项目在 `main.ts` 先探测 WebGL 再传 `type`。
2. **粒子 API**：`this.add.particles(x, y, texture, config)`（v3 是 `add.particles(texture)` 返回 emitter 对象）。
3. **TextStyle**：无 `fontWeight` / `lineHeight` → `font: 'bold 24px Arial'` 简写 + `lineSpacing`。
4. **Pointer**：无 `overCanvas` 属性 → 本地 `pointerover/pointerout` 标志。

**本仓自产坑（已修 + 单测防回归）**：

5. **精英 SpawnCmd 前缀**：导演发裸 key（`warden`）但 `makeUnit` 只认 `elite-warden` → 未捕获异常
   冻死整个游戏循环（波 5 后卡死）。修：导演出口统一加前缀；单测断言 SpawnCmd 前缀。
6. **子弹扫掠碰撞**：dt 钳 50ms 时子弹一步 45px > 敌机宽 34px → 高速帧抖动下穿透。修：
   `sweptBulletHits`（本帧+上一帧双判，纯函数单测）。
7. **场景实例复用**：Phaser 场景 `scene.start` 复用同一实例，`create()` 未清的类字段（`units` 数组）
   跨局残留 → 防御性重置（手动重开/测试驱动场景也会踩）。

**工程约定**：ESM 源码 import 一律显式 `.ts` 扩展名（node --test strip-types 需要）；
tsc 配 `allowImportingTsExtensions + noEmit`（仅类型检查，产物走 Vite）。

**验收状态**：node 单测 9/9（combo/导演/碰撞/计分/常量防呆）；浏览器实机泡测 3 关全程
（15 波 + 4 精英 + 拾取 P/S/B + 暂停 + 结算 + 再来一局，控制台零报错）；dev 平台全链路
（上传→校验→发布→上架→ iframe 试玩→桥握手→提分 401 优雅失败）。生产部署待 GO。

---

## 7. v1.1 演进路线图（2026-10-23 新增，按 00 文档 §3.4「优/奇」标准）

本游戏 v1.0.0（2026-10-23 生产上线，零资产运行时纹理）。按用户「优/奇」试玩标准，v1.1 为 M2 后
迭代（不阻塞 M3），主轴是「视觉打磨 + 手感打磨」，**不新增玩法新奇点**（本游戏现展示点 =
「零资产全合成」，保留作技术橱窗；新奇点集中在游戏 B/C/D，见 00 §3.4）：

**优（视觉/手感，对标 = 雷电/1942 系街机射击，2026-10-23 复核）**：
1. **敌机剪影**：现有运行时纹理为基础形状（矩形/圆/三角）→ 按敌机型生成「机影」
   （机身 + 翼三角 + 引擎光晕圆 + 关卡配色：夜航=青 / 静电风暴=紫 / 核心突袭=橙红），
   仍零资产（Graphics 合成），目标「一眼是飞机」。
2. **Juice**：精英击杀 0.05s 顿帧 + 0.3s 慢动作（timeScale 0.4）；受击红边闪；飘分数字；
   每个重要事件 5–8 层微反馈（音/粒子/镜头/闪白，按 GMT 游戏手感原则：短促夸张、按事件量级缩放）。
3. **背景**：加 2 层视差（远星层 + 近云带，canvas 程序绘制，零资产）+ 既有扫描线覆盖层。
4. **道具**：加 **子弹冻结**（敌方子弹冻结 4s，精英掉落 20%）与 **得分宝石**（+500，5% 掉落）
   → 道具 ≥5 种；冻结可与连击连携（冻结期间无弹威胁、连击易保持，满足 00 §3.4「优」自检 #2）。
5. **BGM**：既有 3 首加「精英战」强度层（低音 + 琶音），按波次状态实时切换（WebAudio gain 分层，零资产）。
**里程碑**：M2 后、M3 稳定后 1–2 周（v1.1.0 热发布，平台版本迭代能力 M1 已具备）。
