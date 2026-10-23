// dev 用：游戏包静态服务器（生产由 nginx alias /var/www/gamevault/games/ 提供）
// 用法：node dev-static.mjs [root] [port]（默认 ./data/games 8095）
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'

// normalize 掉 "./" 前缀（与 Windows path 语义一致，否则 startsWith 判根失败 → 403）
const ROOT = normalize(process.argv[2] ?? './data/games')
const PORT = Number(process.argv[3] ?? 8095)
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm', '.css': 'text/css', '.ogg': 'audio/ogg',
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  const p = normalize(join(ROOT, url))
  if (!p.startsWith(ROOT + sep)) { res.writeHead(403); res.end(); return }
  if (existsSync(p) && statSync(p).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[extname(p).toLowerCase()] ?? 'application/octet-stream' })
    createReadStream(p).pipe(res)
  } else {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(PORT, () => console.log(`dev static: http://127.0.0.1:${PORT} root=${ROOT}`))
