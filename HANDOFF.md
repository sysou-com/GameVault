# HANDOFF — 会话交接（2026-10-23，M1+M2 生产已上线；游戏 A dev 全链完成，待生产 GO）

> 新会话开场协议：先 `git fetch origin && git status -sb` 同步 → 读 `CLAUDE.md`（红线+入口）→
> 读本文件（当前状态）→ 按任务读 `docs/design/` 对应章节。**冲突优先级：用户裁定 > docs/design > 本文件 > 代码现状。**

## 一、当前状态（M1 ✅ 上线；M2 ✅ 2026-10-23 生产上线，签名 JWT + 中心 RBAC 全链路验收通过）

**生产已跑通**（https://sysou.com/game/ → 308 → www.sysou.com/game/，M1 状态）：
- 后端 `gamevault.service`（systemd，`/opt/java21/current` JVM，127.0.0.1:8094，PG 生产库 `gamevault`，Redis db4）
- 前端 `/var/www/gamevault/static/`（nginx 服务，apex 纯 308 块、真内容在 **www.sysou.com 443 块**）
- 游戏 D「极速反应」v1.0.1 已发布上架，浏览器实机试玩通过（判定/命/结算/连击/本地记录）
- 生产数据：`gamevault` 库 1 游戏（reflex-rush）+ 1 live 版本（V2 迁移 user_id→UUID 随 M2 部署落）

**M2 本地全绿（2026-10-23，已推 origin/master）**：
- `9392c94` M2 后端：leaderboard（ZSET 总/周榜 + 幂等 + 限流 + flagged P99×5 + settle Job + 周归档）
  + achievement（manifest 同步 + 提交时同步求值）+ 登录门禁（/api/scores、/api/me/** 硬 401）
  + needsReview 发布闸门 + 探针失败自动回滚 + V2__m2_userid_uuid（user_id BIGINT→TEXT/UUID，中心账号是 UUID）
- `85f576d` M2 前端：登录（中心 SSO `sysou.session`）+ 榜单页 + 提分链路（GameFrame 模式二代发）
  + 管理台 M2（needsReview 确认/flagged 复核）+ vue-tsc 入构建
- `733c52f` M2 RBAC：PermCache 回源中心 /manage/internal/perms（pv 缓存，降级旧快照/最小权限）
  + AdminController 按端点硬校 3 个 gamevault:admin:* 点（enforce-auth=true 时）+ /api/me/perm
  （浏览器走应用侧，前端管理台导航门控）
- **游戏 A「霓虹突袭」v1.0.0 dev 全链完成（2026-10-23，待生产 GO，见 §五/§八）**：
  Phaser 4.2.1 + TS + Vite，零外部资产（运行时纹理 + WebAudio 合成，03 文档 §6 已回写）；
  包体 1.73MB（zip 387KB）；单测 9/9 + 浏览器实机泡测 3 关全程零报错 + dev 平台
  （上传 6d7be0942827→校验 ok→发布 v1.0.0→上架→iframe 试玩→桥握手→假 JWT 提分 401 优雅失败）。
  踩坑（v4 renderType/粒子/TextStyle + 精英前缀/扫掠碰撞/场景字段残留）全见 03 文档 §6。
- sysou-manage `a7ea44c`（已推 origin/main）：AppCodes +GAMEVAULT + `V14__gamevault.sql`
  （app_client + gamevault_user/gamevault_admin + 3 api 点 + 1 menu 点）；**dev 中心库已应用并验证**
- 测试：52 单测 + PlatformIT 2（含「本地 JWKS + 本地 /perms 模拟中心」的签名 JWT 全链路：
  验签→提分→榜→settle→成就→RBAC 401/403/200；`-Dgamevault.it.enabled=true -Dtest=PlatformIT`）

**生产启用顺序（待 GO，见 §六）**：中心部署（V14 + MANAGE_INTERNAL_TOKENS 补 gamevault: 项）
→ GameVault env 填 `GAMEVAULT_JWT_ISSUER=https://www.sysou.com/manage/api`（含 /api！）/ `GAMEVAULT_INTERNAL_TOKEN=同值` / `GAMEVAULT_ADMIN_ENFORCE_AUTH=true` → `deploy/deploy.sh` → smoke。

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

## 二、M2 开工清单（按 01 文档 §11 排期；✅ = 2026-10-23 本地完成）

1. ✅ **登录接入**：中心 V14 已注册（dev 库已应用，生产待部署）；后端 JWKS 验签 + /api/me/** 硬 401；
   前端 `session.ts`（`sysou.session` 共享 + `gamevault.session` 防污染）+ 登录弹窗；
   **生产已启用**：中心 V14 已应用（Flyway max=14）、`gamevault:` 内部令牌已配、GameVault env 三行已配（enforce-auth=true）。
2. ✅ **排行榜/成就**：leaderboard + achievement 模块（01 §6 全链）；管理台 needsReview 发布闸门已落。
3. ✅ **游戏 A「霓虹突袭」**（Phaser 4，`docs/design/03`）——**2026-10-23 dev 全链完成**（代码 `games/neon-raid/`，
   提交见 §五）：零资产路线 + v4.2.1 踩坑回写已进 03 文档 §6；**生产部署待用户 GO**（§八）。
4. ✅ **管理台 RBAC**：PermCache 回源 + 端点硬校 + /api/me/perm（§5.3/§7 已回填实装）；
   版本回滚 UI：Admin.vue 已有 rollback 按钮（对 rolled_back 版本再发布）；自动回滚：探针失败自动回 prev live（发布路径内）。
5. ⛔ 遥测表 `play_event_daily` 聚合 Job 是 **M3**，别提前做。

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

## 五、未完成/遗留

- [x] ~~**生产部署 M2**~~ **✅ 2026-10-23 完成**（中心 V14 + 令牌 env → GameVault env → deploy.sh → SMOKE PASS → 签名 JWT 验收全绿，见 §六）
- [ ] **游戏 A 生产部署**（§八，待用户 GO）：上传 zip → 校验 → 发布 → 上架 → 生产 iframe 实机 + 登录提分 smoke
- [ ] 游戏 A 移动端触控真机验收（02 文档 §8 清单，Android Chrome）——M2 内做，可随生产部署后一起验
- [x] ~~01 文档 §10 ArchUnit 模块边界测试、@WebMvcTest 假 JWT 测试~~ —— M2 已用更硬的替代：
  PlatformIT 本地 JWKS + 本地 /perms 模拟中心，签名 JWT 全链路（含 RBAC 401/403）覆盖验签/回源真实路径
- [ ] 首页暂无「搜索/筛选」（06 游戏全量后需要）；`play_event_daily` 埋点（M3）
- [ ] `it-rush`/`it-score` 是 dev 库测试数据（IT 造），生产库没有；dev 里榜单有残留分数（IT 每次重跑会重加）
- [ ] vite dev 只绑 `[::1]`（Windows 行为）：访问用 `http://[::1]:5173/game/`，别用 localhost

**M2 踩坑备忘（防再犯）**：
- **PlatformIT 首次跑失败 = 旧 dev 后端的 JobConsumer 在抢同一个 Redis 消费组**（db6 共享）：跑 IT 前先杀本地 dev 后端（`taskkill //PID <dev后端>`），否则 Job 被旧进程消费/幂等键互踩。
- IT 的 `job:done:*` 幂等键 TTL 7 天：SCORE_SETTLE 的 idem key 必须带时间戳（已改），固定 key 会被上次运行的 done 键永久跳过。
- IT 共享 dev Redis：m2 测试开头会清 `lb:all/pending/p99:it-score` + `lb:week:it-score:*`（rank 断言确定性）。
- `nc` 在 Windows 不存在；Redis 无 CLI 时用 python socket 打 RESP（见会话记录）。
- 中心账号 id 是 **UUID**（sysou-manage V1）——任何 user_id 列都是 TEXT（V2 已改），别写回 BIGINT。
- 生产启用 RBAC 前，中心必须先有 V14（AppCodes 无 gamevault 会 UNKNOWN_APP 400）+ MANAGE_INTERNAL_TOKENS 有 gamevault: 项。
- **issuer 陷阱（2026-10-23 生产实踩）**：GameVault 验签的 `GAMEVAULT_JWT_ISSUER` 必须与中心签 JWT 的 `MANAGE_JWT_ISSUER` **逐字符一致**——中心实际值是 `https://www.sysou.com/manage/api`（**含 /api**，见中心 env），只配 `/manage` 会导致全体用户 401。以中心 env 文件为准抄，别按文档猜。

## 六、生产部署 M2（✅ 2026-10-23 完成；留档备查）

影响面：sysou-manage 中心重启一次（全部 5 应用登录态短暂不可用，<1min；Flyway 只加不删，可回滚=重部署旧 jar）。

**执行记录**：
1. ✅ 中心：`sysou-manage` 构建新 jar → 备份 `/opt/sysou-manage/sysou-manage.jar.bak-20261023-m2` → 部署重启；
   Flyway max=14；`/manage/internal/perms?app=gamevault` 返回 `pv:23, perms:[3 api + 1 menu]`；healthz 200。
   `MANAGE_INTERNAL_TOKENS` 已追加 `gamevault:<32hex>`（token 仅在 VPS env，已备份 `*.bak-20261023-m2`）。
2. ✅ GameVault：env 追加三行——`GAMEVAULT_JWT_ISSUER=https://www.sysou.com/manage/api`（⚠️ 含 /api，与中心 MANAGE_JWT_ISSUER 逐字符一致）、
   `GAMEVAULT_INTERNAL_TOKEN=<与①同值>`、`GAMEVAULT_ADMIN_ENFORCE_AUTH=true`；`deploy/deploy.sh` SMOKE PASS（含兄弟前缀 COOP/COEP 不泄漏检查）。
3. ✅ 验收（生产签名 JWT 实测，用 VPS 本地 JWKS 私钥在 VPS 上签，密钥不出 VPS）：
   - a. 未登录：`POST /api/scores` 401；`GET /api/admin/games` 401
   - c. 无权限点用户：`GET /api/admin/games` **403** `需要权限点 gamevault:admin:game-status`（PermCache 回源中心成功）；`POST /api/scores` **200** rank=1
   - d. 登录态：`/api/me` 200、`/api/games/reflex-rush/leaderboard` 200
   - b-pa. `pa=true` JWT：`GET /api/admin/games` 200（平台管理员旁路生效）
   - （b. `gamevault_admin` 角色账号浏览器管理台 = 用户验收项；API 层 3 点已由 403/200 覆盖，菜单点 `gamevault:menu:admin` 已在中心注册）
4. ✅ 生产测试数据已清：榜单 ZSET/pending 队列/PG 全空，VPS `/tmp/jwtsign` 已删。

回滚预案（未用）：GameVault 侧 = `deploy.sh` 重部署旧 jar（V2 迁移不可回滚但只改列类型，旧代码不读 user_id）；
中心侧 = sysou-manage 重部署上一版 jar（Flyway 不回滚，V14 只增行，无破坏）。

## 七、M2 之后的顺序（01 文档 §11）

M3：游戏 B（方块狂奔 Three.js）+ 运营统计（`play_event_daily` 聚合 Job）+ 云存档（user_save 已有表，存档 API）。
M4：游戏 C（地牢回声 Godot 4.6 WASM）+ COOP/COEP 加固。M5（二期）：游戏 E WebSocket 对战。

## 八、游戏 A 生产部署清单（待用户 GO）

影响面：纯增量（新增 `/var/www/gamevault/games/neon-raid/1.0.0/` + DB game/version 两行），不动既有游戏/配置；可回滚 = 管理台 disable 游戏（无数据删除）。

1. 上传：`scp build/neon-raid-1.0.0.zip` 到 VPS → `curl -F file=@... https://www.sysou.com/game/api/admin/packages`（需 `gamevault:admin:package` 权限 JWT；M2 验收已证 401/403/200 分层生效）
2. 轮询 `GET /game/api/admin/packages/{id}` 至 `jobStatus=done`（探针在 VPS 无头环境跑 v4 渲染器探测——若探针环境无头无 WebGL，注意渲染器 fallback CANVAS 路径已内置）
3. `POST /game/api/admin/versions/{id}/publish`（needsReview=false 直发）→ `POST /game/api/admin/games/neon-raid/enable`（新游戏默认 draft，必须 enable 才上架）
4. 验收：生产 iframe 实机试玩（Phaser banner 出现、菜单可点）+ 登录账号提分（真实中心 JWT，榜单可见 + 成就 FIRST_CLEAR 若 wavesCleared≥5）+ 未登录提分 401
5. 遗留提醒：生产 JWKS 私钥 `/etc/sysou-manage/keys/jwt-priv.pem` 无本地备份（用户已被告知离线加密备份）
