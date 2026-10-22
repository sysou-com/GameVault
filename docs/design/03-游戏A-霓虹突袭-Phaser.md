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
- 音频（WebAudio，`audio.requiresGesture=true`）：BGM 每关 1 首（~1MB ogg）；SFX：射击/爆炸/拾取/警告 6 条。
  首次 pointerdown/keydown 后初始化 `AudioContext`（自动播放策略）。

---

## 2. 技术选型与工程结构

### 2.1 选型裁定

- **Phaser 4 v4.2.x**（2026-04 GA，渲染器节点式大重写；v4.0 起 API 与 v3 大体兼容，按官方迁移指南
  开发，**只读 v4 文档**，00 文档 §3.2 脚注 5）。
- TypeScript 5 + Vite 7 构建（单 bundle + 图集，代码分割无意义——单页游戏）。
- 物理：**不用 Phaser 物理插件**（自动射击游戏只需矩形碰撞 + 手动速度），用 Arcade 的
  `overlap` 判定（精确需求少，省掉 physics 步进的 CPU 开销）。
- 存档：本游戏**无存档**（单局制），`saves.localStoragePrefix` 仅存「设置（音量/震屏开关）」。

### 2.2 工程结构

```
games/neon-raid/
├── package.json            # phaser@4.2.x, typescript, vite
├── vite.config.ts          # build.outDir=dist；产物即游戏包（zip 交管理台，02 文档 §3.3）
├── index.html              # 包入口（<canvas id="game"> + 加载进度条）
├── manifest.json           # 02 文档 §3.1 schema
└── src/
    ├── main.ts             # Phaser.Game 装配（960x540, scale: FIT, scene 注册）
    ├── scenes/
    │   ├── BootScene.ts    # 资源加载进度 → 转 Menu
    │   ├── MenuScene.ts    # 标题 / 关卡选择（本局进度）/ 设置 / 平台登录引导（platform:init）
    │   ├── PlayScene.ts    # 主游戏循环
    │   └── ResultScene.ts  # 结算 → postMessage game:score
    ├── core/
    │   ├── constants.ts    # 数值表（波次/敌机/难度曲线，数据驱动，便于调平）
    │   ├── rng.ts          # 确定性随机（种子存 localStorage，测试可复现）
    │   └── input.ts        # 键盘+触控统一输入（虚拟摇杆组件）
    ├── entities/
    │   ├── player.ts       # 玩家（状态机：normal/shield/invincible）
    │   ├── enemies/        # 敌机基类 + 3 小类 + 2 精英（每精英一个 class，弹幕表数据驱动）
    │   ├── bullets.ts      # 玩家/敌方子弹池
    │   └── pickups.ts
    ├── systems/
    │   ├── wave.ts         # 波次导演（读 constants 波次表：出场时刻/位置/编队）
    │   ├── combo.ts        # 连击计时（1.5s 窗口）
    │   ├── particles.ts    # 爆炸/拖尾粒子池
    │   └── audio.ts        # AudioContext 生命周期 + 音量设置
    ├── platform/
    │   └── bridge.ts       # postMessage 契约实现（game:ready/score/error/track）+ 同源 fetch 提分
    │                        #   （协议全文 02 文档 §4；~120 行，四款游戏共用同一份，
    │                        #    抽成 games/shared/bridge.ts 各游戏 import）
    └── assets/
        ├── sprites/        # 机影 png（霓虹描边，1x/2x 两套）
        ├── atlas.json      # 图集（TexturePacker 手拼或 free-tex-packer）
        └── audio/          # bgm/sfx ogg
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

| 项 | 目标 |
|---|---|
| 包体积 | ≤ 6MB（引擎 ~1.2MB + 图集 ≤ 2.5MB + 音频 ≤ 1.5MB + 代码 ≤ 300KB） |
| 首玩时间 | 4G 模拟 P90 ≤ 8s（01 文档 §9） |
| 帧率 | 桌面 60fps 稳定；移动端 30fps 可玩（降粒子后） |
| 同屏 draw call | ≤ 30（图集单纹理） |
| 内存 | 峰值 ≤ 200MB（DevTools，每关结束采样） |

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
