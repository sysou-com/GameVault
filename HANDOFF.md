# HANDOFF — 会话交接（2026-10-23，M1+M2+游戏 A 生产均已上线；移动端适配已部署；游戏 B「方块狂奔」核心完成+生产上线（W3「优」视觉包待做）；用户试玩反馈 →「优/奇」标准文档修订）

> 新会话开场协议：先 `git fetch origin && git status -sb` 同步 → 读 `CLAUDE.md`（红线+入口）→
> 读本文件（当前状态）→ 按任务读 `docs/design/` 对应章节。**冲突优先级：用户裁定 > docs/design > 本文件 > 代码现状。**

## 一、当前状态（M1 ✅ 上线；M2 ✅ 生产上线；游戏 A「霓虹突袭」✅ 2026-10-23 生产上线；移动端适配 ✅ 已部署；游戏 B「方块狂奔」✅ 2026-10-23 核心完成+生产上线，W3 视觉包待做）

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
- **游戏 A「霓虹突袭」v1.0.0 ✅ 生产上线（2026-10-23，见 §八执行记录）**：
  Phaser 4.2.1 + TS + Vite，零外部资产（运行时纹理 + WebAudio 合成，03 文档 §6 已回写）；
  包体 1.73MB（zip 387KB）；生产包 568208843b13 → ready → publish → enable；
  生产验收全绿：详情 API（sha256 与 dev 构建一致 8bfdb3fe…）、真实登录 JWT 提分 rank=1 + 周/总榜 +
  成就 FIRST_CLEAR/COMBO_30 解锁、匿名 401、浏览器桌面+移动模拟（390px）零报错、全屏/横屏按钮在位。
  踩坑（v4 renderType/粒子/TextStyle + 精英前缀/扫掠碰撞/场景字段残留）全见 03 文档 §6。
- **移动端适配 ✅ 生产部署（2026-10-23，`d863e69`）**：App.vue 汉堡菜单（≤760px，blur 卡片下拉 +
  遮罩 + 48px 触控）；GameFrame「全屏」按钮（容器级 requestFullscreen + 触屏竖屏横屏提示 +
  Android orientation.lock 尝试）；全局留白压缩/表格横滚/详情页缩排；
  chrome-devtools 移动模拟验收（汉堡开合、全屏 370×208→390×844、横屏 844×390 满屏、桌面回归）。
- sysou-manage `a7ea44c`（已推 origin/main）：AppCodes +GAMEVAULT + `V14__gamevault.sql`
  （app_client + gamevault_user/gamevault_admin + 3 api 点 + 1 menu 点）；**dev 中心库已应用并验证**
- **2026-10-23 用户试玩反馈 + 「优/奇」质量标准（设计文档已修订，见 §九）**：游戏 D「太简单没可玩性」、
  游戏 B「画面粗糙只有方块/长条/圆，比不过同类 XX 快跑」→ 00 文档 §3.4 新增标准 + 5 份游戏文档修订
  （04 为大改：W3=「优」视觉包、W4=节拍系统（奇点）、v1.1=幽灵竞速/角色三件套；01 文档 §6.3 新增每日挑战榜）；
  `games/cube-rush/` 代码 **已提交 + 生产部署**（本会话：根治 2 个 WebGPU bug，验收全绿，见 §九）；W3「优」视觉包 + W4「奇」节拍系统**由新会话处理**
- 测试：52 单测 + PlatformIT 2（含「本地 JWKS + 本地 /perms 模拟中心」的签名 JWT 全链路：
  验签→提分→榜→settle→成就→RBAC 401/403/200；`-Dgamevault.it.enabled=true -Dtest=PlatformIT`）

**生产启用顺序（待 GO，见 §六）**：中心部署（V14 + MANAGE_INTERNAL_TOKENS 补 gamevault: 项）
→ GameVault env 填 `GAMEVAULT_JWT_ISSUER=https://www.sysou.com/manage/api`（含 /api！）/ `GAMEVAULT_INTERNAL_TOKEN=同值` / `GAMEVAULT_ADMIN_ENFORCE_AUTH=true` → `deploy/deploy.sh` → smoke。

**dev 环境（本地 Windows）**：
- 隧道：PG 54329→VPS:5432、Redis 6380→VPS:6379（`plink`/`ssh` 自建，断了要重拉）
- dev 库 `gamevault_dev`（角色 `gamevault_dev`；2026-10-23 从 `gamevault` 改名拆分，`.env.dev` 已同步）
- 启动（唯一权威脚本 `deploy/dev-start.sh`，2026-10-23 事故后重写；/tmp/gv-dev-start*.sh 弃用）：
  ```bash
  bash deploy/dev-start.sh   # PG 隧道 54329 + Redis 隧道 6380 + GAMEVAULT_REDIS_DB=6 + 本地 JWKS + enforce-auth=false
  ```
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
3. ✅ **游戏 A「霓虹突袭」**（Phaser 4，`docs/design/03`）——**2026-10-23 生产上线**（§八 执行记录）；
   移动端触控真机（Android Chrome）验收待用户实际手机跑一遍（02 文档 §8 清单），模拟验收已过。
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
- [x] ~~**游戏 A 生产部署**~~ **✅ 2026-10-23 完成**（见 §八 执行记录）
- [x] ~~**游戏 B「方块狂奔」核心实现 + 生产部署**~~ **✅ 2026-10-23 完成**（Three.js r186 WebGPU/WebGL2 双后端、零资产；根治 2 个 WebGPU bug；生产验收全绿，见 §九）
- [ ] 游戏 B W3「优」视觉包 + W4「奇」节拍系统（**新会话处理**，04 文档 §1.3/§4）
- [ ] 游戏 A 移动端触控真机验收（Android Chrome，02 文档 §8 清单）——浏览器模拟已过，待用户实际手机跑一遍（横屏/全屏/触屏操控/震动感）
- [ ] 游戏 A 生产分数/成就数据清理（smoke 提交过 2 条：rbac-it@sysou.com 99999 + 12345，成就 FIRST_CLEAR/COMBO_30；留作展示或等用户示下再清）
- [ ] 游戏 B 生产分数数据清理（测试提交 1 条：rbac-it@sysou.com 15000，成就 FIRST_1K；另有 1 条被拒审计行 clientTs 过早；等用户示下再清）
- [x] ~~01 文档 §10 ArchUnit 模块边界测试、@WebMvcTest 假 JWT 测试~~ —— M2 已用更硬的替代：
  PlatformIT 本地 JWKS + 本地 /perms 模拟中心，签名 JWT 全链路（含 RBAC 401/403）覆盖验签/回源真实路径
- [ ] 首页暂无「搜索/筛选」（06 游戏全量后需要）；`play_event_daily` 埋点（M3）
- [ ] M3 新增平台项：**每日挑战榜**（01 文档 §6.3；每日 ZSET + 48h TTL，无新表）——与运营统计 Job 排期
- [ ] M3 新增平台项：**云存档 API**（01 文档 §5.2 既有设计）支撑幽灵竞速上传（04 文档 §6）——与 M3 云存档排期
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
- **Redis db 交叉污染事故（2026-10-23 生产实踩，严重）**：旧 dev 启动参数 `--gamevault.redis.database=6` 是**不存在的属性**
  （Redis db 实际绑定 `spring.data.redis.database` ← env **`GAMEVAULT_REDIS_DB`**，默认 4）→ dev 后端连进**生产 db4**，
  其 JobConsumer（同名消费组 `gamevault`）抢消费生产 Job：生产上传的包被 dev 侧「staging 文件缺失」标失败并静默 ACK
  （job:done 被 dev 时钟写入、生产侧永远看不到 handler 日志）。**防再犯**：dev 只用 `deploy/dev-start.sh`
  （`GAMEVAULT_REDIS_DB=6`）；判断隔离是否生效看 `redis-cli -n 6 XINFO GROUPS gamevault:jobs`（db6）而非 db4。
- **GameFrame iframe `allow` 属性（2026-10-23）**：`pointer-lock` 是 sandbox 特性（`allow-pointer-lock`），
  不是 Permissions-Policy 特性——写进 `allow=` 会触发 Chrome 警告「Unrecognized feature: pointer-lock」；本类游戏（触屏/键盘）也不需要指针锁定，`ALLOW='autoplay'` 即可。

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

M3：游戏 B（方块狂奔 Three.js —— ✅ 核心完成+生产上线，W3「优」视觉包 + W4「奇」节拍系统待做）+ 运营统计（`play_event_daily` 聚合 Job）+ 云存档（user_save 已有表，存档 API）。
M4：游戏 C（地牢回声 Godot 4.6 WASM）+ COOP/COEP 加固。M5（二期）：游戏 E WebSocket 对战。

## 八、游戏 A 生产部署（✅ 2026-10-23 完成；留档备查）

**执行记录**：
1. ✅ 上传：zip scp 上 VPS → VPS 上用生产 JWKS 私钥签 `pa=true` 管理员 JWT（Signer.class 在 VPS `/tmp/jwtsign`，用完即删）→
   `POST /api/admin/packages` → 轮询至 `jobStatus=done, versionStatus=ready, needsReview=false`（生产包 **568208843b13**，versionId=2）
2. ✅ `POST /api/admin/versions/2/publish` + `POST /api/admin/games/neon-raid/enable`（新游戏默认 draft）；
   落盘 `/var/www/gamevault/games/neon-raid/1.0.0/`（4 文件）
3. ✅ 验收：`GET /api/games/neon-raid`（liveVersion sha256=`8bfdb3fe…` 与 dev 构建一致）；
   真实登录 JWT 提分 12345 → rank=1，99999 → rank=1 + **成就解锁 [FIRST_CLEAR, COMBO_30]**；
   周/总榜均见分；匿名 `POST /api/scores` 401；浏览器桌面+移动模拟（390×844）零 console error；
   全屏/横屏提示在位；`deploy.sh` SMOKE PASS（含 /game/g/neon-raid/1.0.0/cover.svg 200）
4. ✅ 清理：VPS `/tmp/jwtsign`、`/tmp/neon-raid-1.0.0.zip` 已删；本地临时 json 已删

**遗留提醒**：生产 JWKS 私钥 `/etc/sysou-manage/keys/jwt-priv.pem` 已有用户授权本地备份
（`D:\workspace\sysou-manage\keys\production-backup\jwt-priv.pem`，gitignored，勿提交/勿打印）；
建议后续再加一层加密离线备份。

## 九、「优/奇」标准与设计修订（2026-10-23，用户裁定）

**背景**：用户当日试玩反馈——游戏 D（极速反应）「太简单没有可玩性」；游戏 B（方块狂奔）「画面粗糙，
只有方块、长条、圆，同类『XX 快跑』游戏元素与玩法好很多」。裁定：**后续开发的所有游戏都要满足「优 + 奇」**
（标准全文见 00 文档 §3.4；CLAUDE.md §二红线已同步）。

**本次修订**（纯文档，无代码改动）：
- `00` 文档：§3.4 新增（优/奇标准 + 优自检清单 + 各游戏奇点表 A–E + 对标作品）
- `04` 文档（cube-rush，在研）**大改**：§1.1 +boost 门/大金币/节奏门；§1.2 +近失/连击/FLOW 计分；
  §1.3 视觉全升级（玩家光轨/squash、障碍动效材质 + 预警示、3 层环境视差 + 昼夜、速度线/屏震）；
  §1.4 连击与近失；§1.5 **节拍生成系统（核心奇点：BGM 节拍时间线生成关卡 + 节奏门 FLOW 判定）**；
  §3.5 标杆调研来源；§4 W3=「优」视觉包 / W4=「奇」系统；§6 v1.1（幽灵竞速/角色三件套/时间冲刺/波形图案/皮肤）
- `06` 文档（reflex-rush）：§7 v1.1 新增（颜色门/双环交替/无尽 Rush/每日挑战）；§5「太简单」风险行更新
- `03` 文档（neon-raid）：§7 v1.1 新增（敌机剪影/juice/视差背景/冻结道具/精英战音乐层）
- `05` 文档（地牢回声）：§6 新增（优自检 + **sonar 黑暗核心系统**奇点）
- `07` 文档（弹珠对轰）：§8 新增（优自检 + **球桌突变 + 能量球**奇点）
- `01` 文档：§6.3 新增每日挑战榜（M3；每日 ZSET + 48h TTL，无新表）

**奇点确认状态（2026-10-23）**：以下 5 项奇点**全部用户暂准**（按建议方案推进，实际效果演示后再最终确认）：
1. cube-rush 核心奇点 = 节拍生成 + 节奏门 FLOW（M3 W4）
2. cube-rush 第二奇点 = 幽灵竞速（与榜一/自己的最好纪录同赛道跑，M3 后 v1.1；平台加小只读端点）
3. dungeon-echo 奇点 = sonar 黑暗核心系统（M4 W3 并入）
4. marble-duel 奇点 = 球桌突变 + 能量球（M5 W3 并入）
5. reflex-rush v1.1 模式组 + 每日挑战榜（M3 平台项）

> **2026-10-23 补充（首轮奇点发现方法实践）**：cube-rush 奇点交叉验证完成（04 §3.6）——
> 「音乐生成关卡」已有小众案例（ByteBeat/RobotzZz/Music Racer，均未火：无生态/操作过简/要自带音乐），
> 奇点定位修正为「主流 runner 深度 × 音乐-关卡同源 × 平台生态」；吸收 3 项「优」升级（道具协同/角色人格/落地手感）。
> 后续新游戏（C/D/E 深化时）开工前均按 00 §3.4 方法先做一轮同类调研。

**奇点发现方法（用户裁定 2026-10-23，00 文档 §3.4）**：后续规划新游戏时，先搜索网上
「口碑高 + 玩法新奇 + 没火起来」的游戏（Steam Next Fest / itch.io / 独立游戏站），分析其新奇点
（凭什么新/怎么玩/为何没火）→ 优化升级，或与本平台技术路线（零资产合成/WebGPU/排行榜+云存档）
结合形成设计；调研结果随来源+日期回写对应游戏文档。

**cube-rush 代码状态（2026-10-23 更新）**：游戏 B「方块狂奔」**核心实现完成 + 生产部署**（本会话）：
- 核心逻辑/渲染/输入/音频/UI + 平台 bridge 全完成；单测 16/16；包体 808KB（gzip 224KB）。
- **根治 2 个 WebGPU bug**（均找到根因并消除，非压制）：
  ① `Buffer used in submit while destroyed`（chunk 生命周期建/毁几何 → GPU buffer churn，stale bind group 指向已销毁 buffer）
  → 全部几何改共享单例（启动建一次、永不 dispose），glow 由 Sprite 换共享平面 Mesh；
  ② `swapchain texture of size 0`（平台 iframe 布局未定瞬时 0 尺寸）→ resize 遇 0 忽略 + `ResizeObserver` 可靠捕获 0→确定尺寸 + frame loop 0 尺寸跳过 render。
- 生产验收全绿：浏览器实玩零 console 报错、WebGPU ✓、提分 rank1 + 成就 FIRST_1K 解锁、排行榜（全服/周）、
  匿名 401、COOP/COEP；sha256 `f523216a…` 与本地构建一致。提交 `d9b7ed7`（核心实现+buffer bug）+ `011a0b8`（size-0 bug）。
- 代码保护机制（定时检查 `cube-rush-stability-check` + `dev-cube-rush-watch.mjs` + 状态文件）**已删除**（用户 2026-10-23 确认：本会话工作完成，保护暂不需要）。
- 下一步 **W3（「优」视觉包）+ W4（「奇」节拍系统）由新会话处理**，按 04 文档 §1.3/§4：光轨/squash/障碍动效+预警示/3 层视差+昼夜/速度线/屏震 + 节拍生成系统。

**新规则（用户裁定 2026-10-23）**：**手机端操作兼容是每款游戏的硬性要求**——触控操作（滑动/虚拟摇杆/屏幕按钮，
触控目标 ≥48px）+ 横屏提示/全屏按钮 + 移动端降档画质；CLAUDE.md §二红线与 00 §3.4「优」自检已同步。
