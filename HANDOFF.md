# HANDOFF — 会话交接（2026-10-23，M1 已部署上线）

> 新会话开场协议：先 `git fetch origin && git status -sb` 同步 → 读 `CLAUDE.md`（红线+入口）→
> 读本文件（当前状态）→ 按任务读 `docs/design/` 对应章节。**冲突优先级：用户裁定 > docs/design > 本文件 > 代码现状。**

## 一、当前状态（M1 ✅ 上线）

**生产已跑通**（https://sysou.com/game/ → 308 → www.sysou.com/game/）：
- 后端 `gamevault.service`（systemd，`/opt/java21/current` JVM，127.0.0.1:8094，PG 生产库 `gamevault`，Redis db4）
- 前端 `/var/www/gamevault/static/`（nginx 服务，apex 纯 308 块、真内容在 **www.sysou.com 443 块**）
- 游戏 D「极速反应」v1.0.1 已发布上架，浏览器实机试玩通过（判定/命/结算/连击/本地记录）
- `deploy/smoke.sh` 全绿（COOP/COEP 作用域隔离已验证，兄弟前缀未带头）
- 生产数据：`gamevault` 库 1 游戏（reflex-rush）+ 1 live 版本；`/var/www/gamevault/games/reflex-rush/1.0.1/`

**dev 环境（本地 Windows）**：
- 隧道：PG 54329→VPS:5432、Redis 6380→VPS:6379（`plink`/`ssh` 自建，断了要重拉）
- dev 库 `gamevault_dev`（角色 `gamevault_dev`；2026-10-23 从 `gamevault` 改名拆分，`.env.dev` 已同步）
- 启动（均已验证）：
  ```bash
  # 后端（需先 source .env.dev 并映射 GAMEVAULT_* 环境变量，REDIS_DB=6，GAMES_DIR=./data/games）
  java -jar target/gamevault.jar
  # 前端（5173；vite 只绑 [::1]，用 http://[::1]:5173/game/ 访问）
  cd web && npm run dev
  # 游戏包静态（vite /game/g 代理的 8095 源）
  node dev-static.mjs ./data/games 8095
  ```
- dev 里已有数据：`it-rush`（IT 假数据）+ `reflex-rush`（1.0.0/1.0.1）

## 二、M2 开工清单（按 01 文档 §11 排期）

1. **登录接入**：sysou-manage 中心注册 `gamevault` 应用（拿 issuer/apps/权限点）→
   `GAMEVAULT_JWT_ISSUER` 填入生产 env + `GAMEVAULT_ADMIN_ENFORCE_AUTH=true`；
   前端 GameFrame 登录态（`gamevault.session` 已有位）→ 提分 API。
2. **排行榜/成就**：`leaderboard` 模块（01 §5.3/§6：ZSET 榜 + `score_submission` 幂等 + 限流 + flagged 规则纯函数）；
   管理台 `needsReview` 发布门禁。
3. **游戏 A「霓虹突袭」**（Phaser 4，`docs/design/03`）——先查 Phaser 4 当前版本文档（红线：以当版本为准）。
4. **管理台 RBAC**（权限点以中心为准）+ 版本回滚 UI 完善 + 自动回滚（发布后 nginx-probe 失败）。
5. 遥测表 `play_event_daily` 聚合 Job 是 **M3**，别提前做。

## 三、部署与排障速查

```bash
bash deploy/deploy.sh        # 日常部署（构建→同步→unit/nginx 幂等→重启→冒烟）
ssh root@sysou.com 'bash -s' < deploy/smoke.sh   # 冒烟（默认 www.sysou.com）
ssh root@sysou.com 'journalctl -u gamevault -f'  # 后端日志
ssh root@sysou.com 'tail /var/log/nginx/error.log'
```
- **凭据**：生产 `/etc/gamevault.env`（0600，只在 VPS）；本地 `.env.dev`（0600，gitignored）。**任何密钥不进仓库/前端/上下文。**
- 生产改配置后：`nginx -t && systemctl reload nginx`；后端 `systemctl restart gamevault`。
- 常见坑（2026-10-23 全部踩过，详见 01 文档 §8 踩坑记录）：
  - VPS `/usr/bin/java` 是 17 —— 必须 `/opt/java21/current/bin/java`
  - nginx：片段只进 **www 块**（apex 是纯 308）；`^~` 屏蔽正则；alias 不跨 location；`types{}` 整体覆盖 mime；
    `proxy_pass` 尾 `/` 会多剥一层前缀；若梦块全局资源正则已加 `^(?!/game/)` 排除（改的是兄弟块，动它之前先读那行注释）
  - Job 消费组从 `0-0` 建（不是 `$`），否则首发 job 永久 UNKNOWN；卡死时 `XGROUP DESTROY gamevault:jobs gamevault`（**db4**）+ restart
  - zip-slip 判定用 `isSafeExtraction`（Windows `Path.of("./x")` 陷阱）

## 四、红线提醒（防再犯）

- 平台层 Java 21 + Spring Boot 3.4.5 + Vue3，**不得擅自换栈**；游戏层自由（06 文档按引擎选型）。
- 端口 8094 / 前缀 `/game/` / 静态根 `/var/www/gamevault/{static,games}/` —— 三处（nginx+yml+文档）必须一致。
- 密钥不进仓库/前端/游戏包（发布校验会扫描）；游戏包内不得含内网地址。
- 未经逐项确认，不删/移/覆盖任何文件与数据；长动作（上传/解压）必须走 Redis Streams Job。
- 事实以官方/当版本为准：引擎 API 查官方文档并标来源+日期，`docs/design/00` 引擎矩阵是快照引用需复核。
- `git push --force` 禁止；master 单分支；阶段完成即提交。

## 五、未完成/遗留（M2 顺路清）

- [ ] 生产 `GAMEVAULT_JWT_ISSUER` 仍空（M1 设计如此：enforce-auth=false，管理端仅日志；M2 填）
- [ ] 01 文档 §10 测试策略里的 ArchUnit 模块边界测试、@WebMvcTest 假 JWT 测试未落（当前 35 单测 + PlatformIT 覆盖核心链路）
- [ ] 首页暂无「搜索/筛选」（06 游戏全量后需要）；`play_event_daily` 埋点（M3）
- [ ] `it-rush` 是 dev 库测试数据，生产库没有；生产发布流程已验证用 reflex-rush
- [ ] vite dev 只绑 `[::1]`（Windows 行为）：访问用 `http://[::1]:5173/game/`，别用 localhost
