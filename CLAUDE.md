# CLAUDE.md — GameVault：游戏展示与试玩平台（会话入口）

> **本文件是薄索引，不是规范正文。** 唯一真源 = `docs/design/` 下各设计文档。
> 本文件只回答「开工先读什么、按什么顺序读、红线在哪、命令怎么跑」——**不要在这里发明架构**，
> 冲突时以 `docs/design/` 为准。
>
> **一句话**：`https://sysou.com/game/` 的 Web 游戏平台 —— 展示并即时试玩自研浏览器游戏
> （Phaser / Three.js / Godot WASM / 原生 Canvas 四种技术栈矩阵），零安装零登录可玩，
> 登录可提交分数。平台层与兄弟工程（llm / Weaveora / EasyPCB / sysou-manage）**同栈**；
> 游戏层**刻意不同栈**（用户裁定：游戏部分按主流游戏开发语言与效果选型）。

---

## 一、开工协议（每个会话必做）

0. **开工先同步远端（先于一切）**：`git fetch origin && git status -sb`。
   - `behind` ⇒ 先 `git pull --ff-only`；`ahead`+`behind` ⇒ 先 `git pull --rebase` 解冲突；
     **禁止 `git push --force`**。
   - 顺带核对远端默认分支指向工作分支（本仓 `master`，GitHub 仓建好后保持）。

1. **先读文档，再写代码。**
2. **按任务分层读：**

| 任务类型 | 必读 |
|---|---|
| 任何新会话开场 | 本文件 §二（红线）+ `docs/design/00` §架构总览 |
| 平台后端（API/模块/表） | `docs/design/01`（模块规格 §五、数据模型 §六、API 契约 §七） |
| 平台前端（Vue 页面） | `docs/design/01` §四（前端架构）+ 兄弟工程 `../sysou-manage` 前端接入章节 |
| 游戏接入 / 发布 / 运行时 | `docs/design/02`（manifest / postMessage 协议 / COOP·COEP / 发布管线） |
| 做某款具体游戏 | `docs/design/03..07` 中对应游戏文档（先读该游戏 §技术选型再写代码） |
| 原生/非浏览器游戏、下载发行、代码签名（前瞻） | `docs/design/08`（**不在 M1–M5 排期**，触发制；N0 零成本预留项随 M1 顺手落，见其 §8） |
| 部署 / nginx / 端口 / 缓存头 | `docs/design/01` §部署 + `deploy/`（M1 落盘）；兄弟工程 `../EasyPCB/deploy` 可参照 |
| 排障 | 先看报错原文与最近一次运行日志，再对照对应模块章节 |

3. **冲突优先级**：用户裁定 > `docs/design/` > `README.md` > 现有代码。与用户裁定冲突时**停下问用户**。
4. 阶段完成即提交（`git log` 即过程记录）；**禁止在一个会话里跨天堆多个不相关任务**。

---

## 二、红线（防呆摘要；冲突时以文档与用户裁定为准）

- **⛔ 独立工程，不寄生兄弟仓。** 与 `llm` / `Weaveora` / `EasyPCB` / `sysou-manage` 是兄弟工程：
  不共享代码 / 业务库 / 业务表。耦合面只有三处：① 同一 VPS 的 nginx 路径前缀 `/game/`；
  ② 共享 VPS 中间件（PostgreSQL 独立 db `gamevault`、Redis 独立 db3）；
  ③ `sysou-manage` 统一身份/权限中心（登录态、角色、权限点以中心为准，**本平台不自建用户体系**）。
- **⛔ 平台层同栈，不得擅改。** 后端 Java 21 + Spring Boot 3.4.5 + Spring Modulith（groupId `com.sysou`）、
  前端 Vue 3 + Vite + TS、JPA + Flyway（`ddl-auto` 恒 `validate`）、Redis Streams Job（消费组 + 死信流 + 幂等）、
  Redis 限流（**禁 `ConcurrentHashMap` 计数**）。游戏层（`games/` 下）不受此限，选型以 `docs/design/00` §引擎矩阵为准。
- **⛔ 端口与前缀是部署事实。** 后端 **8094**（llm=8090、EasyPCB=8091、EasyPCB 沙箱=8092、sysou-manage=8093，勿冲突）；
  前缀 `/game/`；静态根 `/var/www/gamevault/static/`；游戏包根 `/var/www/gamevault/games/`。
  改端口/前缀必须同步 nginx 片段 + `application.yml` + 文档三处一致。
- **⛔ 前端不写死域名与绝对路径。** 请求一律相对路径（同源 `/api/...`、`/game/...`），与兄弟工程同款纪律。
- **⛔ 密钥不进仓库、不进前端。** 凭据只走环境变量或 600 权限 env 文件；`.gitignore` 挡 `*.env`。
  游戏运行在玩家浏览器里，**游戏包内不得包含任何密钥/内网地址**（发布校验会扫描，见 `docs/design/02` §安全）。
- **⛔ 未经逐项确认，禁止删除 / 移动 / 覆盖任何文件、数据、配置。** 判定「没人用」不构成授权；
  先列清单（路径 + 影响面 + 不可逆程度）→ 停下逐项确认 → 才执行；执行前留恢复路径。
- **⛔ 长动作后台化。** 游戏包上传/解压/校验可能超 60s：一律异步 Job（Redis Streams）+ 状态轮询，
  前端与 agent 侧都不许长连接堵死。
- **⛔ 上下文纪律**：不把原始日志/大文件内容倒进上下文；大输出先落盘，再给「路径 + 关键数字」。
- **⛔ 事实以官方 / 当版本为准，不靠记忆。** 引擎版本（Phaser 4.x / Three.js r1xx / Godot 4.x）与 API
  一律查官方文档与当前版本 release notes，并标注来源 + 日期；`docs/design/00` §引擎矩阵是 2026-10 快照，**引用时复核**。
- **⛔ 排行榜提交必须服务端裁决。** 分数只认平台 API（登录态 + 校验规则 + 限流 + 幂等键），
  前端自报不可信；防作弊规则见 `docs/design/01` §排行榜。
- **⛔ 文案中文 / 提示词英文 / API 字段与服务名英文**（与兄弟工程一致）。

---

## 三、命令速查

```bash
# 平台后端（M1 起可用；当前仓库为空壳，docs 先行）
mvn spring-boot:run
mvn test

# 平台前端（M1 起）
cd web && npm install && npm run dev
npm run build        # vite build --base=/game/

# 游戏工程（各游戏独立，M1 起 games/ 下）
cd games/reflex-rush && npm run build   # 产物按 docs/design/02 包规范打成 zip 交管理台发布
```

## 四、阶段状态（随里程碑更新）

- [ ] M1 平台核心（目录 + 播放器 + 部署）+ 游戏 D（极速反应）
- [ ] M2 排行榜/成就 + 游戏 A（霓虹突袭，Phaser 4）
- [ ] M3 游戏 B（方块狂奔，Three.js）+ 运营统计 + 云存档（user_save + 存档 API，01 文档 §5.2）
- [ ] M4 游戏 C（地牢回声，Godot 4.6 WASM）+ COOP/COEP 加固
- [ ] M5（二期）游戏 E（弹珠对轰，WebSocket 对战）
