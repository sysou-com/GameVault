#!/usr/bin/env bash
# GameVault VPS 一次性 bootstrap（幂等守护：已装一半会停下要求人工确认，不盲目重跑）
#
# 用法（本地执行）：ssh root@sysou.com 'bash -s' < deploy/bootstrap.sh
#
# 做的事：
#   - PostgreSQL：dev 库 gamevault → gamevault_dev（改名）；生产库 gamevault + 角色 gamevault（01 文档 §部署：生产 db = gamevault）
#     为什么拆库：dev（本地经隧道）与 prod（VPS 本机）曾共用一个库 → 双后端同写 catalog 表会互踩
#   - 系统：gamevault 用户（/opt/gamevault）+ /var/www/gamevault/{static,games}
#   - /etc/gamevault.env（0600）：凭据只落 VPS，不进仓库、不进本地上下文
set -euo pipefail

if [ -e /etc/gamevault.env ] || [ -d /opt/gamevault ] || id gamevault >/dev/null 2>&1; then
  echo "⚠️ 已 bootstrap 过（检测到部分产物）。确认状态后人工重跑，本脚本不自动合并。"
  exit 1
fi

echo "==> PostgreSQL：dev/prod 拆库"
if su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='gamevault_dev'\"" | grep -q 1; then
  echo "  - gamevault_dev 已存在，跳过改名"
else
  echo "  - 改名 gamevault → gamevault_dev（dev 库，本地经隧道使用）"
  su postgres -c "psql -c 'ALTER DATABASE gamevault RENAME TO gamevault_dev'"
fi

PW=""
if su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='gamevault'\"" | grep -q 1; then
  echo "  - 生产库 gamevault 已存在（复用；env 丢失需人工补密码）"
else
  PW=$(openssl rand -hex 16)
  su postgres -c "psql -c \"CREATE ROLE gamevault LOGIN PASSWORD '$PW'\""
  su postgres -c "psql -c 'CREATE DATABASE gamevault OWNER gamevault'"
  echo "  - 创建生产库 gamevault + 角色 gamevault"
fi

echo "==> 系统用户 + 目录"
useradd -r -m -d /opt/gamevault -s /usr/sbin/nologin gamevault
mkdir -p /opt/gamevault /var/www/gamevault/static /var/www/gamevault/games
chown -R gamevault:gamevault /opt/gamevault /var/www/gamevault

echo "==> /etc/gamevault.env (0600)"
RPW=$(grep -oE '^MANAGE_REDIS_PASSWORD=.*' /etc/sysou-manage/sysou-manage.env | head -1 | cut -d= -f2-)
# 角色已存在但 env 丢失 → 拿不到密码，停下人工处理（密码只在创建瞬间可得）
if [ -z "$PW" ]; then
  echo "⚠️ 生产角色已存在但 /etc/gamevault.env 不存在 → 密码不可恢复，请人工创建 env 后重跑"
  exit 1
fi
if [ -z "$RPW" ]; then
  echo "⚠️ 找不到 /etc/sysou-manage/sysou-manage.env 的 MANAGE_REDIS_PASSWORD"
  exit 1
fi
cat > /etc/gamevault.env <<EOF
GAMEVAULT_DB_URL=jdbc:postgresql://127.0.0.1:5432/gamevault
GAMEVAULT_DB_USER=gamevault
GAMEVAULT_DB_PASSWORD=$PW
GAMEVAULT_REDIS_HOST=127.0.0.1
GAMEVAULT_REDIS_PORT=6379
GAMEVAULT_REDIS_PASSWORD=$RPW
GAMEVAULT_REDIS_DB=4
GAMEVAULT_GAMES_DIR=/var/www/gamevault/games
GAMEVAULT_STAGING_DIR=/opt/gamevault/staging
GAMEVAULT_ARCHIVE_DIR=/opt/gamevault/archive
GAMEVAULT_NGINX_PROBE_ENABLED=true
GAMEVAULT_NGINX_PROBE_BASE=http://127.0.0.1
EOF
chmod 600 /etc/gamevault.env
echo "==> bootstrap 完成（systemd 安装与部署由 deploy.sh 负责）"
