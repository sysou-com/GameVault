# 05 · 游戏 C「地牢回声 Dungeon Echo」详细设计（Godot 4.6 · GDScript → WebAssembly）

> 品类：像素俯视角地牢爬行（roguelite dungeon crawler）｜引擎：Godot 4.6（Web 导出，WASM）｜
> 平台接入：按 `02` 文档（COOP/COEP 由平台统一提供；本游戏默认**单线程构建**，线程版为可选项）｜
> 里程碑：M4｜展示价值：「最接近完整游戏引擎」的开发路径 —— 编辑器 + GDScript + WASM，做一个有
> 存档、程序化生成、战斗、光照的完整游戏

---

## 1. 游戏设计

### 1.1 核心玩法（一局 8–15 分钟，roguelite 循环）

- 俯视角 16-tile 地牢，**每层程序化生成**（房间 + 走廊，房间数 4–7，种子 = 局内随机，局内固定）。
- 玩家：小骑士像素角色（4 向移动 + 攻击动画），**8 向移动**（桌面 WASD，移动触屏左摇杆）。
- 战斗：
  - 近战挥砍（按 0.25s，前方扇形判定）；远程「回声弹」（升级后解锁：点击目标方向发射，弹射 1 次）。
  - 敌人 4 种：蝙蝠（快弱，群刷）、骷髅兵（中速直追）、咒语师（远程弹 + 召唤蝙蝠）、**守卫**（重甲，
    需 3 次重击破甲——破甲瞬间硬直，教学「看招」）。
  - 每层 1 只精英（名字随机：回声骑士/深渊书吏），3 阶段弹幕/连招。
- 房间事件（非战斗，每层 1–2 个）：
  - **回声祭坛**：3 选 1 强化（+15% 伤害 / +1 生命上限 / 拾取范围+50% / 拾取时 5% 概率掉金币 ×2）
  - **宝箱**：金币或药瓶（回复 1，上限 3）
  - **陷阱走廊**：地板刺（踩中扣 1 血 + 短硬直）
- **存档**：局内死亡 = 本局结束（roguelite），**进度 = 金币 + 英雄升级**（元进度）：
  金币每 100 升 1 级永久属性（+1 生命或 +5% 伤害，二选一，玩家选）——存档在 localStorage
  （前缀 `dungeonecho.`，02 文档 §4.4；COEP 下同源 localStorage 正常，浏览器矩阵确认）。
- 通关定义：连续通关 10 层（「回声王座」）。分数 = 累计（层数 × 1000 + 击杀 × 20 + 金币获取量），
  单局结算提交平台。

### 1.2 计分与成就

`score.range` 0–9,999,999；meta：`{ floors, kills, gold, heroLevel }`。
成就（01 文档 §6.2 声明式规则）：FIRST_FLOOR_3 / FLOOR_10（回声王座）/ KILL_100（单局百杀）/
RICH（单局 500 金币）。

### 1.3 视觉与音频（像素）

- 16×16 tile，角色/敌人 16×16（每敌 4 向 × 3 帧），**点精灵渲染**（`canvas_item` 最近邻过滤，
  避免像素糊）；视野 = **2D 光照 + 阴影**（PointLight2D 火把 + 玩家微光，Godot 4 的 2D 光系统
  原生支持阴影——本游戏视觉核心，「地牢回声」的氛围来源）；
- 调色板：深蓝黑夜 + 火把暖橙 + 魔法青（3 主色，像素克制）；
- 音频：8-bit 风 chiptune BGM 2 首（层内/精英战）+ SFX 12 条；**全部 .ogg**（Godot Web 音频要求，
  红线：wav/mp3 在 Web 导出不可靠，统一 ogg vorbis 转码，见 §5 风险）。

---

## 2. 技术选型与工程结构

### 2.1 选型裁定

- **Godot 4.6 + GDScript**（2026-10 快照；红线：开工时核对官方当前 4.x 版本与 Web 导出文档，
  脚注 2：Web 导出要求 WASM + WebGL2；4.3 起单线程导出修复完善 ⇒ **默认单线程，不依赖 SAB**）。
- **单线程构建为主**：
  - 优点：无 SharedArrayBuffer 依赖，任何浏览器（含未隔离环境）可跑；体积略小。
  - 代价：主线程 GC 暂停偶发（像素地牢负载低，实测 4.3+ 单线程在 60fps 目标下足够）。
  - **线程版为可选**：平台已统一提供 COOP/COEP（02 文档 §5），M4 上线时同时上传线程版构建做
    `game:ready` 环境探测对比（线程可用 → 结算页显示「多线程 ✓」徽章）；若单线程帧率达标，
    线程版仅作展示素材，不影响玩家默认体验。
- **不用 C#**：GDScript 迭代最快、与引擎文档一致；C# 的 Web 导出依赖 Mono 运行时，包体大且
  Web 侧支持面窄（个人项目量级不需要）。
- 资源管线：tileset（Aseprite/Tiled 制作，导出 png + 碰撞层）；音效统一 ogg；模型全 2D，无 3D 资产。
- 存档：`UserFile` 抽象 → Web 下自动映射 localStorage（Godot 4 的 `user://` 在 Web 即 localStorage/
  IndexedDB，以当前版本文档为准；`saves.localStoragePrefix` 在 manifest 声明供平台「清空存档」用）。

### 2.2 工程结构（Godot 项目）

```
games/dungeon-echo/godot/            # Godot 编辑器项目（.godot 不入库，构建产物才入平台）
├── project.godot                    # 主场景 Main.tscn；导出预设 web（单线程 + 线程双预设）
├── scripts/
│   ├── main.gd                      # 游戏状态机：menu | playing | level_clear | game_over | result
│   ├── dungeon/
│   │   ├── generator.gd             # 程序化生成：种子 → 房间布局（A* 连通 + 房间事件放置 + 敌人波表）
│   │   ├── level_data.gd            # 层难度曲线数据（敌人配置/精英表/事件概率，数据驱动）
│   │   └── tilemap.gd               # TileMap 层装配（地板/墙/陷阱/机关）
│   ├── player/
│   │   ├── player.gd                # 移动（8 向）/挥砍（扇形 Area2D 判定）/回声弹/受击无敌帧
│   │   └── upgrades.gd              # 3 选 1 强化（声明式表）
│   ├── enemies/
│   │   ├── enemy_base.gd            # 追击 AI（视线 + 简单 A*，NavMesh 2D 或网格寻路）
│   │   ├── bat.gd / skeleton.gd / caster.gd / guard.gd / elite_*.gd
│   │   └── ai_patrol.gd             # 巡逻/警觉状态机
│   ├── combat/
│   │   ├── hitbox.gd / hurtbox.gd   # 伤害结算（中央 CombatBus 信号总线，解耦实体）
│   │   └── echo_bolt.gd             # 回声弹（弹射 1 次，RayCast2D）
│   ├── meta/
│   │   └── hero_save.gd             # 元进度存档（金币/等级/解锁，user:// 落盘 + 损坏自愈回默认）
│   ├── ui/
│   │   ├── hud.gd                   # 生命/金币/层数 + 触屏控件（左摇杆 + 攻击/闪避按钮）
│   │   └── menus.gd                 # 主菜单/结算/强化选择
│   └── platform/
│       └── bridge.gd                # postMessage 桥（Godot JS 互操作）：
│                                    #   JSBridge.call("postMessage", {type:"game:ready",...})
│                                    #   提分：直接 HTTPRequest 同源 /game/api/scores（带 token）
└── assets/                          # tilesets/角色/音频(ogg)/chiptune
```

### 2.3 关键实现要点

- **生成器确定性**：种子随 `rand_seed()` 每局生成并写入局内日志；`generator.gd` 纯函数
  （种子 + 层数 → 布局数据），单元测试在 Godot 自带 `GUT`（或手写 `SceneTree` 测试场景）里
  断言「同种子同布局 + 连通性 100% + 敌人波表合法」。
- **2D 光照性能**：阴影光源 ≤ 4 个同屏（火把池化，房间远端火把熄灭）；`shadow` 分辨率 512；
  移动端自动关阴影（检测 DPR<2 且 FPS<45 → 关，记遥测）。
- **AI 预算**：同屏敌人 ≤ 16（波次导演控制生成节奏）；寻路每 0.5s 重算一次（不逐帧）。
- **平台桥（bridge.gd，~150 行，JS 互操作）**：
  - `game:ready`：`get_tree().root` 首帧后发（带 `version/engine: godot-4.6/threaded: bool`）；
  - `game:error`：导出壳 `statusbar` 回调转 postMessage（加载失败/资源 404，02 文档 §7 进度条来源）；
  - 提分：`HTTPRequest` → `https://sysou.com/game/api/scores`？❌ **不写死域名**（红线）——
    用 `get_window().get_url()` 推导同源 origin，相对路径 `/game/api/scores`；
    token 从 `localStorage.getItem('gamevault.session')` 读（02 文档 §4.3，Godot 侧
    `JSBridge.eval("localStorage.getItem('gamevault.session')")`）。
- **导出流程（CI 化，脚本 `games/dungeon-echo/export.sh`）**：
  ```
  godot --headless --export-pack Web debug   # 单线程预设
  godot --headless --export-pack Web-Threaded release   # 线程预设（可选产物）
  组装包目录：index.html(导出壳) + .wasm + .pck + manifest.json + cover.png → zip 交管理台
  ```
  Godot 4.6 的 Web 导出模板（export template）需预先下载（`~/.local/share/godot/export_templates/`），
  部署文档注明 VPS 不需要 Godot（**构建在本地/CI 做，VPS 只收静态包**——与平台红线一致）。

---

## 3. 性能预算

| 项 | 目标 |
|---|---|
| 包体积 | ≤ 35MB：引擎 wasm（单线程 ~16–20MB，Brotli 后 ~8MB）+ pck（资产 ≤ 6MB）+ 壳 |
| 首玩时间 | 首次 30MB（4G 约 15–30s，**加载条 + 分阶段提示**：引擎 → 资产 → 就绪）；二次访问 0（30d 长缓存） |
| 帧率 | 桌面 60fps（阴影开）；移动端 60fps 阴影关 / 30fps 可玩 |
| 内存 | ≤ 400MB（wasm 线性内存增长上限 2GB 理论，实际监控 p95 < 400MB，超线报警遥测） |

---

## 4. 里程碑（M4 内，~4 周）

| 周 | 内容 | 验收 |
|---|---|---|
| W1 | 玩家移动 + 1 房间固定地牢 + 挥砍/受击 + 火把光照 | 单房间可打怪 |
| W2 | 生成器（种子/连通/事件）+ 敌人 4 种 + 精英 1 + 层推进 | 连续 3 层完整流程 |
| W3 | 元进度存档 + 强化选择 + 音频 + 触控 + bridge.gd 桥接 | 死亡重开保留金币；提分链路通 |
| W4 | 双构建导出（单线程/线程）+ 加载体验打磨 + 发布 + 技术拆解页（GDScript+WASM 路线 + COOP/COEP 实测数据） | 02 文档 §8 清单 + `window.crossOriginIsolated===true` 打印验证 |

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 首包 25–35MB 加载慢，移动端劝退 | Brotli（压缩率 ~60%）+ 30d 长缓存 + 分阶段进度 UI + 「建议 Wi-Fi」提示；遥测统计放弃率，>40% 时考虑资产再瘦身（音频降码率/图集压缩） |
| Godot Web 音频（wav/mp3 不可靠） | 红线：全 ogg vorbis（导入时 Godot 自动用 ogg 重压缩）；上线矩阵 Safari/Android 重点听测 |
| 引擎版本迭代快（4.x 小版本破坏性变更） | 锁定 4.6；升级走独立 PR + 重新过 §8 清单；导出模板版本与引擎小版本严格对应 |
| 2D 阴影在低端手机掉帧 | 移动端自动关阴影（§2.3）；桌面保持完整氛围 |
| 单线程 GC 暂停（偶发卡顿） | 负载控制（同屏 ≤16 敌、对象池化）；线程版构建对比数据兜底；若单线程实测 p99 卡顿 >100ms，切换默认构建为线程版（平台 COOP/COEP 已备） |
| `user://` Web 映射行为随版本变化 | 存档损坏自愈（解析失败回默认 + 备份原文件）；localStorage 写入失败（隐私模式）降级为「本局内有效」并提示 |

---

## 6. 优/奇自检（2026-10-23 新增，按 00 文档 §3.4 用户裁定）

**优（视觉/战斗手感，对标 = Enter the Gungeon 系像素 roguelite，2026-10-23 复核）**：
- 美术：tileset Aseprite 手绘（16×16、8 色板、每实体 2–3 帧动画）——**不许「灰方块」**；
  光效（火把/阴影灯）是氛围核心；低端机降级「无阴影 + 光色」（§2.3 已备）。
- 战斗手感：攻击顿帧（0.05s）+ 受击闪白（实体 0.1s）+ 屏震 + 伤害数字；
  chiptune 两层（探索层/战斗层）实时切换。
- 道具：3 选 1 强化（既有）→ 道具种类 ≥8（攻击/冲刺/回声充能/生命/吸血/金币磁吸/脉冲半径/脉冲冷却，声明式表）。

**奇（新奇点，本游戏核心，用户 2026-10-23 暂准，实际效果演示后再最终确认）**：**回声定位（sonar）核心系统**——
现设计只有名字「回声」+ 1 个武器（echo_bolt），地牢本体仍是常规明暗爬行（正是「奇」的缺口）；
v2.0 把「回声」从武器升为核心资源：
1. **默认黑暗**：地牢全黑，玩家只看见自身 2 格半径（火把大幅弱化）；
2. **回声脉冲（核心资源）**：按 F/按钮 → 径向脉冲 0.8s 扩散（可见扩散环 + sonar 音），
   1.5s 内揭示 8 格内所有物（黑暗中敌人显示「回声形」= 淡轮廓，不主动索敌）；
   脉冲能量 3 充能，20s 回 1 格（或道具补给）；
3. **核心循环**：「脉冲 → 看见 → 移动/攻击 → 重入黑暗」，紧张感来自「黑暗里有什么」；
   回声弹（既有武器）保留为脉冲的副产品（脉冲同时向 8 向各发 1 发）；
4. **强化联动（3 选 1 内）**：脉冲半径 +2 / 充能 +1 / 回声记忆（揭示过的 60s 内留在小地图）。

**为什么是「奇」**：sonar 式可见性控制在地牢爬行品类罕见（现有案例集中在恐怖小品，roguelite 主流没有），
且天然承接本游戏命名与既有技术（RayCast2D 脉冲、阴影光管线），实现成本 ≈ 1 个新系统（~300 行）。
**里程碑影响**：W2（生成器+房间）不变；W3（meta/强化）并入回声脉冲系统；W4 验收加「黑暗可玩性」项。
