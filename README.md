# GameVault —— 游戏展示与试玩平台

**对外入口**：`https://sysou.com/game/`（sysou.com VPS 同一 nginx 443 server 块，路径前缀挂载，与 `/llm/`、`/EasyPCB/`、`/manage/` 并列）

**定位**：一个「即开即玩」的 Web 游戏平台 —— 展示多款自研浏览器游戏，每款游戏代表一种主流游戏开发技术栈（Phaser / Three.js / Godot WASM / 原生 Canvas），玩家零安装、零登录即可试玩，登录后可提交分数与成就。平台本身同时充当「Web 游戏技术矩阵」的展示橱窗：每个游戏卡片标注引擎与架构，既是游戏也是技术 demo。

## 文档地图（唯一真源在 `docs/design/`）

| 文档 | 内容 |
|---|---|
| `docs/design/00-总览-想法与可行性.md` | 平台与游戏全部想法、可行性判定、引擎选型矩阵（2026-10 调研快照）、路线图 |
| `docs/design/01-平台核心设计.md` | 平台后端/前端架构、模块划分、数据模型、API 契约、排行榜、nginx 与部署 |
| `docs/design/02-游戏运行时与发布管线.md` | 游戏包规范（manifest）、iframe 播放器协议、COOP/COEP/SharedArrayBuffer、上传-校验-发布-回滚管线 |
| `docs/design/03-游戏A-霓虹突袭-Phaser.md` | 2D 横版射击（TypeScript + Phaser 4） |
| `docs/design/04-游戏B-方块狂奔-ThreeJS.md` | 3D 低多边形跑酷（Three.js r186 WebGPU） |
| `docs/design/05-游戏C-地牢回声-Godot.md` | 像素地牢爬行（Godot 4.6 GDScript → WebAssembly） |
| `docs/design/06-游戏D-极速反应-Canvas.md` | 零依赖原生 Canvas 2D 即时小游戏（<50KB） |
| `docs/design/07-游戏E-弹珠对轰-多人.md` | 二期：WebSocket 实时对战（服务端权威） |
| `docs/design/08-原生游戏托管与发行-前瞻.md` | 前瞻：非浏览器（原生）游戏的发布/宣传/下载/更新规划（N0 零成本预留 + N1/N2 触发制） |

## 技术栈（与兄弟工程同栈约束）

- 平台后端：**Java 21 + Spring Boot 3.4.5 + Spring Modulith**（groupId `com.sysou`，artifactId `gamevault`），监听 **127.0.0.1:8094**
- 平台前端：**Vue 3 + Vite + TypeScript**，构建 `--base=/game/`
- 数据层：**JPA + Flyway**（`ddl-auto=validate`）+ PostgreSQL 独立 database `gamevault` + Redis 独立 db（db3）
- 异步 Job：**Redis Streams**（消费组 + 死信流 + 幂等）；限流用 Redis 计数（禁 `ConcurrentHashMap`）
- 认证：`sysou-manage` 中心签发 JWT（ES256 + JWKS 本地验签）+ 中心 RBAC；**平台不自建用户体系**
- 游戏侧不受同栈约束：Phaser 4 / Three.js r186 / Godot 4.6 / 原生 Canvas，各游戏独立工程（`games/` 下按游戏分包）

## 快速命令

```bash
# 平台后端（M1 起）
mvn spring-boot:run                       # 127.0.0.1:8094

# 平台前端
cd web && npm install && npm run dev      # Vite dev server，proxy /api → 8094
npm run build                             # vite build --base=/game/
```

> 开工协议与红线见 `CLAUDE.md`；部署事实（nginx 片段、systemd、静态目录）见 `docs/design/01` §部署与 `deploy/`（M1 产出）。
