#!/usr/bin/env bash
# GameVault 部署脚本（本地执行，SSH 免密 root@sysou.com）
#
# 前置（VPS 一次性）：见 deploy/gamevault.service 头部注释 + nginx 片段已插入 server 块。
# 纪律（红线）：
#   - 只传 jar 不够——nginx 从磁盘服务前端，web/dist 必须同步 /var/www/gamevault/static/
#   - 凭据只走 VPS /etc/gamevault.env（0600），本脚本不碰密钥
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=root@sysou.com

echo "==> 构建 jar（含 web/dist → BOOT-INF/static 回退）"
mvn -B -DskipTests clean package
[ -f web/dist/index.html ] || { echo "web/dist 缺失：先 npm install && npm run build"; exit 1; }

echo "==> 同步 jar → /opt/gamevault/"
ssh "$HOST" "mkdir -p /opt/gamevault && chown -R gamevault:gamevault /opt/gamevault"
scp -q target/gamevault.jar "$HOST:/opt/gamevault/gamevault.jar"

echo "==> 同步前端 → /var/www/gamevault/static/（nginx 真实服务源）"
ssh "$HOST" "mkdir -p /var/www/gamevault/static /var/www/gamevault/games && chown -R gamevault:gamevault /var/www/gamevault"
# tar 流式同步（VPS 无 rsync 依赖）
tar -C web/dist -cf - . | ssh "$HOST" "tar -xf - -C /var/www/gamevault/static/"

echo "==> 重启服务"
ssh "$HOST" "systemctl daemon-reload; systemctl restart gamevault; sleep 5; systemctl is-active gamevault"

echo "==> 冒烟"
ssh "$HOST" "bash -s" < deploy/smoke.sh
echo "DEPLOY OK"
