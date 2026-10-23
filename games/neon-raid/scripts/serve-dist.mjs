import { createServer } from 'node:http'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'
const root = process.argv[2]
const port = Number(process.argv[3] || 8099)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' }
createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = normalize(decodeURIComponent(url.pathname))
  if (p.startsWith('..')) { res.writeHead(403); res.end('forbidden'); return }
  if (p === '/' || p === '\\') p = 'index.html'
  const file = join(root, p)
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  res.end(readFileSync(file))
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' on ' + port))
