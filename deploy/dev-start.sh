#!/bin/bash
# GameVault 本地 dev 后端启动（2026-10-23 起为唯一权威启动方式，取代 /tmp/gv-dev-start*.sh）
#
# ⚠️ 事故记录（2026-10-23）：旧脚本用 `--gamevault.redis.database=6` 启动，该属性不存在
#    （Redis db 绑定的是 spring.data.redis.database ← env GAMEVAULT_REDIS_DB，默认 4），
#    导致 dev 后端连进生产 Redis db4，其 JobConsumer 抢消费生产 Job（生产包处理失败、
#    dev 版本行被误标 failed）。现以 env GAMEVAULT_REDIS_DB=6 正确隔离。
set -e
DBU=$(grep -E '^GAMEVAULT_DEV_DB_USER=' /d/workspace/GameVault/.env.dev | cut -d= -f2)
DBP=$(grep -E '^GAMEVAULT_DEV_DB_PASSWORD=' /d/workspace/GameVault/.env.dev | cut -d= -f2)
REDIS_PWD=$(grep -E '^GAMEVAULT_DEV_REDIS_PASSWORD=' /d/workspace/GameVault/.env.dev | cut -d= -f2)
export GAMEVAULT_DB_URL="jdbc:postgresql://127.0.0.1:54329/gamevault_dev"
export GAMEVAULT_DB_USER="$DBU"
export GAMEVAULT_DB_PASSWORD="$DBP"
export GAMEVAULT_REDIS_HOST=127.0.0.1
export GAMEVAULT_REDIS_PORT=6380
export GAMEVAULT_REDIS_PASSWORD="$REDIS_PWD"
export GAMEVAULT_REDIS_DB=6        # ← 关键：dev 专用 db6（与生产 db4 隔离；PlatformIT 亦用 db6，跑 IT 前先停本服务）
export GAMEVAULT_JWT_ISSUER=""     # dev 用本地 JWKS 验签（中心 dev 库）
cd /d/workspace/GameVault
nohup /d/Java/jdk21.0.12.1/bin/java -jar target/gamevault.jar --gamevault.admin.enforce-auth=false > /tmp/gv-dev6.log 2>&1 &
echo "java pid $!"
