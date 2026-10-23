// 构建后把真实体积回填 manifest.json（02 文档 §3.1 size 字段；M1 校验器要求字段存在且非负）
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.cwd()
const dist = join(root, 'dist')

function sumDir(dir) {
  let total = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) total += sumDir(p)
    else total += statSync(p).size
  }
  return total
}

const totalBytes = sumDir(dist) + readFileSync(join(root, 'manifest.json')).length
const initialLoadBytes = statSync(join(dist, 'index.html')).size +
  sumDir(join(dist, 'assets'))
  + readFileSync(join(root, 'manifest.json')).length

const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
m.size = {
  totalBytes,
  initialLoadBytes,
  maxAssetBytes: 200_000_000,
}
writeFileSync(join(root, 'manifest.json'), JSON.stringify(m, null, 2) + '\n')
console.log(`manifest size 回填: total=${totalBytes}B initial=${initialLoadBytes}B`)
