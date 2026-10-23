// 零依赖 zip 打包（ZIP/DEFLATE，node:zlib）：dist/* + manifest.json + cover.svg → build/<slug>-<version>.zip
// 平台管理台上传此包（02 文档 §3 包规范；manifest.json 在包根）
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const root = process.cwd()
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))

// ---- ZIP 最小实现（本地文件头 + 中央目录 + EOCD，DEFLATE） ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const now = new Date()
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)

function fileEntries() {
  const out = []
  const push = (relPath, buf) => out.push({ name: relPath, buf })
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, prefix + name + '/')
      else push(prefix + name, readFileSync(p))
    }
  }
  walk(join(root, 'dist'), '')
  push('manifest.json', readFileSync(join(root, 'manifest.json')))
  push('cover.svg', readFileSync(join(root, 'cover.svg')))
  return out
}

const entries = fileEntries()
const locals = []
const central = []
let offset = 0
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, 'utf8')
  const crc = crc32(e.buf)
  const comp = deflateRawSync(e.buf, { level: 9 })
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)          // version needed
  local.writeUInt16LE(0, 6)           // flags
  local.writeUInt16LE(8, 8)           // method: deflate
  local.writeUInt16LE(dosTime, 10)
  local.writeUInt16LE(dosDate, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(comp.length, 18)
  local.writeUInt32LE(e.buf.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)
  locals.push(Buffer.concat([local, nameBuf, comp]))

  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt16LE(20, 4)
  cd.writeUInt16LE(20, 6)
  cd.writeUInt16LE(0, 8)
  cd.writeUInt16LE(8, 10)
  cd.writeUInt16LE(dosTime, 12)
  cd.writeUInt16LE(dosDate, 14)
  cd.writeUInt32LE(crc, 16)
  cd.writeUInt32LE(comp.length, 20)
  cd.writeUInt32LE(e.buf.length, 24)
  cd.writeUInt16LE(nameBuf.length, 28)
  cd.writeUInt16LE(0, 30)
  cd.writeUInt16LE(0, 32)
  cd.writeUInt16LE(0, 34)
  cd.writeUInt16LE(0, 36)
  cd.writeUInt32LE(0, 38)
  cd.writeUInt32LE(offset, 42)
  central.push(Buffer.concat([cd, nameBuf]))
  offset += local.length + nameBuf.length + comp.length
}

const cdBuf = Buffer.concat(central)
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(entries.length, 8)
eocd.writeUInt16LE(entries.length, 10)
eocd.writeUInt32LE(cdBuf.length, 12)
eocd.writeUInt32LE(offset, 16)
eocd.writeUInt16LE(0, 20)

const zip = Buffer.concat([...locals, cdBuf, eocd])
const outDir = join(root, 'build')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, `${manifest.game}-${manifest.version}.zip`)
writeFileSync(outFile, zip)
console.log(`zip 写出 ${outFile}（${zip.length} bytes，${entries.length} 文件）`)
// manifest.size.totalBytes 若未回填则提示
if (!manifest.size || typeof manifest.size.totalBytes !== 'number') {
  console.warn('⚠ manifest.size 未回填：先跑 npm run build')
}
