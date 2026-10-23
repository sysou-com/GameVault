#!/usr/bin/env bash
# GameVault 上线冒烟（01 文档 §8 部署事实清单 + 02 文档 §5 作用域隔离）
# 用法：在 VPS 上执行 ./deploy/smoke.sh [base_url]（默认 https://sysou.com）
set -euo pipefail

BASE="${1:-https://sysou.com}"
FAIL=0

check() { # name, condition(0/1 via $?)
  if [ "$2" -eq 0 ]; then echo "  ✓ $1"; else echo "  ✗ $1"; FAIL=1; fi
}

headers() { curl -sI "$1" 2>/dev/null || true; }

echo "GameVault smoke @ $BASE"

# 1) 首页：200 + no-store + COOP/COEP
h=$(headers "$BASE/game/")
echo "$h" | grep -qi 'HTTP/.*200'                      && check "GET /game/ → 200" 0 || check "GET /game/ → 200" 1
echo "$h" | grep -qi 'cache-control: no-store'         && check "/game/ HTML no-store" 0 || check "/game/ HTML no-store" 1
echo "$h" | grep -qi 'cross-origin-opener-policy'      && check "/game/ COOP 头在位" 0 || check "/game/ COOP 头在位" 1
echo "$h" | grep -qi 'cross-origin-embedder-policy'    && check "/game/ COEP 头在位" 0 || check "/game/ COEP 头在位" 1

# 2) API 存活
body=$(curl -s "$BASE/game/api/health" || true)
echo "$body" | grep -q '"ok":true'                     && check "GET /game/api/health ok" 0 || check "GET /game/api/health ok" 1

# 3) 目录 API
body=$(curl -s "$BASE/game/api/games" || true)
echo "$body" | grep -q '^\['                           && check "GET /game/api/games → JSON 数组" 0 || check "GET /game/api/games → JSON 数组" 1

# 4) 游戏包目录：COOP/COEP（有 live 游戏时抽 1 个 entry 核对；无游戏则跳过）
slug=$(echo "$body" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p' | head -1)
if [ -n "${slug:-}" ]; then
  g=$(headers "$BASE/game/g/$slug/cover.png")
  echo "$g" | grep -qi 'HTTP/.*200'                    && check "GET /game/g/$slug/cover.png → 200" 0 || check "GET /game/g/$slug/cover.png → 200" 1
  echo "$g" | grep -qi 'cross-origin-embedder-policy'  && check "/game/g/ COEP 头在位" 0 || check "/game/g/ COEP 头在位" 1
else
  echo "  - 跳过 /game/g/ 抽样（目录为空）"
fi

# 5) 作用域隔离：兄弟前缀**不得**带 COOP/COEP（02 文档 §5 红线）
for prefix in llm EasyPCB manage; do
  bh=$(headers "https://sysou.com/$prefix/")
  if echo "$bh" | grep -qiE 'cross-origin-(opener|embedder)-policy'; then
    check "兄弟前缀 /$prefix/ 未带 COOP/COEP" 1
  else
    check "兄弟前缀 /$prefix/ 未带 COOP/COEP" 0
  fi
done

if [ "$FAIL" -eq 0 ]; then
  echo "SMOKE PASS"
else
  echo "SMOKE FAIL"
  exit 1
fi
