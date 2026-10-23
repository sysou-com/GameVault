# 06 · 游戏 D「极速反应 Reflex Rush」详细设计（原生 TypeScript + Canvas 2D，零依赖）

> 品类：反应力挑战（reflex challenge）｜技术：无引擎，手写 Canvas 2D + rAF 循环｜
> 平台接入：按 `02` 文档｜里程碑：**M1 首发**（用它验证「开发 → 打包 → 管理台发布 → iframe 试玩 → 提分」
> 全链路，是全平台的第一块石头）｜展示价值：「不靠任何引擎，<50KB 能做出什么」

---

## 1. 游戏设计

### 1.1 核心玩法（单局 20 秒，纯反应力）

- **机制**：屏幕中心一个霓虹圆环以「快慢随机」的节拍收缩；环缩到内圈标记线的**瞬间**按下
  （鼠标点按 / 触屏 / 空格）= 命中。
- 判定（毫秒级，`performance.now()`）：
  - |偏差| ≤ 30ms → **PERFECT**（100 分，连击 +1）
  - ≤ 80ms → **GOOD**（50 分，连击 +1）
  - ≤ 150ms → **OK**（20 分，连击清零）
  - 早按/按空（偏差 >150ms）→ **MISS**（连击清零，命 -1）
- 每局 **3 命**，共 **12 拍**（节拍间隔 0.9s–1.6s 随机，局内逐拍加快 3%）；
  结束 = 3 命耗尽或 12 拍完成 → 结算：总分 / PERFECT 数 / 最长连击 / 平均偏差（ms，保留 1 位）。
- 难度进阶（meta 进度，localStorage 存档）：连续 3 局 PERFECT 率 ≥ 60% → 解锁「专家节奏」
  （间隔下限 0.7s + 加入 1 拍假环（闪烁不收缩，按了 = MISS））——给回访理由，不破坏单局简洁。

### 1.2 计分

`score` = 总分（理论上限 12×100 + 连击加成 max 60 = 1260，`range` 0–9999）；
meta：`{ perfect, streak, avgDeviationMs, expertMode: bool }`。
成就：PERFECT_RUN（单局 12 拍零 MISS）/ DEVIATION_20（平均偏差 ≤ 20ms）/ EXPERT_1000（专家模式 1000 分）。

### 1.3 视觉（全程序化，零图片资产）

- Canvas 2D 每帧绘制：深色径向渐变底 + 收缩圆环（`arc` + `shadowBlur` 霓虹）+ 判定环 +
  命中时刻的粒子爆（20 个，10 帧消散）+ 大字号判定文字（PERFECT/GOOD/OK/MISS，字体用系统
  `monospace`，无字体文件）。
- 无任何图片/字体/音频文件 ⇒ **包体 < 50KB**；音频 = WebAudio 合成音（命中「叮」= 440/880Hz
  正弦 50ms，MISS = 110Hz 方波 100ms），0 音频资产。

---

## 2. 工程结构（刻意保持「一个仓库一个游戏」的最小形态）

```
games/reflex-rush/
├── package.json            # 依赖：仅 typescript + vite（dev）；运行时代码零 import 外部库
├── vite.config.ts          # build.lib 单文件输出 main.js + 保留 index.html/manifest.json
├── index.html              # <canvas id="c"> + 极简加载条（其实秒开，仅为协议完整性）
├── manifest.json           # engine: "canvas-native"（卡片徽章：原生 Canvas · 零依赖）
└── src/
    ├── main.ts             # 装配 + rAF 主循环（~120 行）
    ├── state.ts            # 状态机：idle | countdown(3-2-1) | running | paused | result（联合类型穷举）
    ├── beat.ts             # 节拍调度器（间隔随机表 + 局内加速曲线 + 假环插入，纯逻辑，单测覆盖）
    ├── judge.ts            # 判定（deviationMs → 档位，纯函数，单测覆盖：±1ms 边界表）
    ├── render.ts           # 全部绘制（按 state 分发，~250 行；devicePixelRatio 适配）
    ├── input.ts            # pointerdown / touchstart / keydown(space) 统一 → 时刻戳上报
    ├── audio.ts            # WebAudio 合成音（首交互初始化，02 文档 §4.1 audio.requiresGesture）
    ├── meta.ts             # 专家模式解锁（localStorage 前缀 reflexrush.，02 文档 §4.4）
    └── platform/bridge.ts  # games/shared/bridge.ts 同款（game:ready/score/track/error，02 文档 §4）
```

**测试（零依赖的好处：单测就是 node --test 跑纯逻辑）**：`beat`（节奏表确定性/加速曲线/假环概率）
+ `judge`（边界用例表：29/30/31ms 等）全过才允许构建；`main/render` 走浏览器矩阵人工验收。

---

## 3. 平台桥接（本游戏是全平台第一个跑通方，细节固化进 02 文档 §4）

- 启动：DOM ready + 首帧绘制完成 → `game:ready {version, engine:"canvas-native", dpr, webgpu:false}`。
- 结算页「提交分数」→ 已登录：同源 `fetch('/game/api/scores')`（token 来自 `localStorage['gamevault.session']`）；
  未登录：显示「登录保存」引导（平台侧登录流，01 文档 §4）。
- 遥测：`game:track start/end`（M3 起平台消费）；错误：canvas 创建失败 → `game:error {code:"webgl-unavailable", message:"浏览器不支持 Canvas 2D"}`（极端兜底）。

---

## 4. 性能预算

| 项 | 目标 |
|---|---|
| 包体积 | **≤ 50KB**（gzip 后 main.js ≤ 15KB + html/manifest） |
| 首玩时间 | 4G P90 ≤ 3s（01 文档 §9 的首玩指标，由本游戏守住底线） |
| 帧率 | 60fps 恒定（每帧绘制 < 2ms，DevTools Performance 验收） |
| 输入延迟感知 | 判定用 `performance.now()` 时间戳（事件时戳，非 rAF 帧时戳），消除一帧抖动 |

---

## 5. 里程碑（M1 内，~1 周）

| 天 | 内容 |
|---|---|
| D1–D2 | 状态机 + 节拍调度 + 判定 + 渲染骨架（能按能判） |
| D3 | 音效合成 + 粒子 + 结算页 + 专家模式解锁 |
| D4 | bridge.ts 桥接 + 单测（beat/judge）+ 打包 |
| D5 | 管理台上传发布 + 浏览器矩阵（含 Android 触屏）+ 02 文档 §8 验收清单 → **M1 平台全链路打通** |

---

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 输入判定公平性争议（玩家觉得「明明按准了算 MISS」） | 结算页展示**逐拍偏差 ms 明细**（数据透明 = 公信力）；判定纯函数单测锁死边界 |
| 触屏设备 pointerdown 延迟差异大 | 用 `event.timeStamp`（事件时戳）而非处理时戳；安卓真机实测记录 p95 输入延迟，写进技术拆解页 |
| 玩法太简单没可玩性（用户试玩反馈，2026-10-23） | **v1.1 多模式**（§7）：颜色门/双环交替/无尽 Rush + **每日挑战**（平台级新奇点，01 文档 §6.3）；M1「链路验证」定位不再等于「永远简单」 |

---

## 7. v1.1 演进（2026-10-23 新增，按用户试玩裁定）

**用户反馈**：现有玩法「太简单，没有可玩性」→ v1.1 加 3 个模式 + 1 个平台能力，
全部复用现有纯逻辑模块（beat/judge 核心不动，只加输入条件与节拍表）：

1. **颜色门模式**：每拍提前 1.5s 显示目标色（青/品红），只有同色环有效，按错色 = MISS——
   在「反应层」上叠加「认知层」（仍单指操作，不破坏极简）。
2. **双环交替**：两环以 50% 相位差交替收缩，必须按顺序按——分心注意力测试（专家向）。
3. **无尽 Rush**：不限拍数，每 4 拍失误率 +4%，得分 = 存活时长 × 连击，3 次失误结束
   （单局 1–3 分钟，主「可玩性」模式；榜单主分 = 存活秒数，meta = perfect 数 / 最长连击）。
4. **每日挑战（「奇」点，平台级，01 文档 §6.3）**：seed = 日期 hash，全体用户当日同 12 拍
   （图案/颜色/时序一致），独立「今日榜」——「今天大家在同一个关卡」是平台级新奇点，
   可扩展到全部 5 个游戏（各游戏在 manifest 声明 dailySeed）。
5. v1.1 验收：模式选择界面 + 每日榜可见 + 各模式判定边界单测（judge 纯函数 +
   新增颜色/双环条件表）+ 版本迭代热发布（平台能力 M1 已具备）。
