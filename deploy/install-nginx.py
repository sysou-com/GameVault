#!/usr/bin/env python3
"""把 GameVault nginx 片段插入 /etc/nginx/nginx.conf 的 sysou.com 443 server 块（幂等）。

用法（VPS 上）：python3 install-nginx.py /tmp/gamevault-nginx.conf
片段已由 scp 传到 /tmp（来自 deploy/nginx-gamevault.conf，location 行即幂等锚点）。
"""
import re
import shutil
import sys
import time

CONF = "/etc/nginx/nginx.conf"
FRAG = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gamevault-nginx.conf"

s = open(CONF).read()
if "/game/api/" in s:
    print("  - nginx 片段已安装，跳过")
    sys.exit(0)

lines = s.split("\n")
idx = next((i for i, l in enumerate(lines) if "server_name" in l and "sysou.com" in l), None)
assert idx is not None, "找不到 sysou.com 的 server_name 行"

start = next((i for i in range(idx, -1, -1) if re.match(r"\s*server\s*\{", lines[i])), None)
assert start is not None, "找不到 server 块起点"

depth, end = 0, None
for i in range(start, len(lines)):
    depth += lines[i].count("{") - lines[i].count("}")
    if depth == 0:
        end = i
        break
assert end is not None, "找不到 server 块结束"

frag = open(FRAG).read().rstrip()
bak = CONF + ".bak-" + time.strftime("%Y%m%d%H%M%S")
shutil.copy(CONF, bak)
lines.insert(end, "\n" + frag + "\n")
open(CONF, "w").write("\n".join(lines))
print(f"  - 片段插入 server 块（第 {start + 1} 行）→ 闭合括号前；备份 {bak}")
