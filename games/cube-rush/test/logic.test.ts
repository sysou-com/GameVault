/**
 * 纯逻辑单测（node --test）：确定性随机 / 生成导演 / 碰撞 / 计分。
 * 渲染层（three.js）不在这套测试里——浏览器泡测覆盖（04 §4 W2 验收）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32, range, pickWeighted } from '../src/core/rng.ts'
import { planChunk, passableLanes } from '../src/core/director.ts'
import { aabbOverlap, playerBox, coinPickup } from '../src/core/collide.ts'
import { OBSTACLE, JUMP } from '../src/core/constants.ts'
import {
  newScoreState, addDistance, addCoin, addCheckpoint, addHit,
  totalScore, cleanSegmentScore, runMeta, clampScore,
} from '../src/core/scoring.ts'

test('rng: 同种子同序列（确定性）', () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  for (let i = 0; i < 50; i++) assert.equal(a(), b())
  const c = mulberry32(43)
  assert.notEqual(a(), c())
})

test('rng: range 在区间内', () => {
  const r = mulberry32(1)
  for (let i = 0; i < 200; i++) {
    const v = range(r, 2, 9)
    assert.ok(v >= 2 && v < 9, `v=${v}`)
  }
})

test('rng: pickWeighted 只返回表内键', () => {
  const r = mulberry32(7)
  const w = { block: 38, laserLow: 16, laserHigh: 22, saw: 24 }
  const keys = new Set(Object.keys(w))
  for (let i = 0; i < 500; i++) {
    const k = pickWeighted(r, w)
    assert.ok(keys.has(k), k)
  }
})

test('director: 同 seed+chunk 布局可复现', () => {
  const a = planChunk(1234, 5, 100)
  const b = planChunk(1234, 5, 100)
  assert.deepEqual(a.items, b.items)
  assert.equal(a.energyGate?.meter, b.energyGate?.meter)
  assert.equal(a.checkpoint, b.checkpoint)
})

test('director: 异 seed 布局不同', () => {
  const a = planChunk(1111, 3, 100)
  const b = planChunk(2222, 3, 100)
  assert.notDeepEqual(a.items, b.items)
})

test('director: 块内项单调递增 + 车道合法 + 障碍密度合理', () => {
  for (let c = 0; c < 8; c++) {
    const p = planChunk(99, c, 100)
    for (let i = 1; i < p.items.length; i++) {
      assert.ok(p.items[i].meter > p.items[i - 1].meter, `chunk ${c} 项未递增`)
    }
    for (const it of p.items) {
      for (const lane of it.lanes) assert.ok(lane >= 0 && lane <= 2, `车道越界 ${lane}`)
    }
    const obs = p.items.filter(i => !i.coins)
    assert.ok(obs.length >= 3 && obs.length <= 14, `chunk ${c} 障碍数 ${obs.length} 异常`)
    // 首障碍离块头 ≥10m（呼吸距离）
    if (obs.length) assert.ok(obs[0].meter >= p.fromM + 10, `chunk ${c} 首障碍太贴脸`)
  }
})

test('director: 旋转锯必留可通行车道', () => {
  for (let c = 0; c < 40; c++) {
    const p = planChunk(777, c, 100)
    for (const it of p.items) {
      if (it.coins || it.kind !== 'saw') continue
      const pass = passableLanes(it)
      assert.ok(pass.length === 1, `锯占 ${it.lanes} 无可通行道`)
    }
  }
})

test('collide: AABB 基本相交/分离', () => {
  const a = { cx: 0, cy: 0.4, cz: 0, sx: 0.8, sy: 0.8, sz: 0.8 }
  assert.ok(aabbOverlap(a, { cx: 0, cy: 0.4, cz: 0, sx: 1, sy: 1, sz: 1 }))
  assert.ok(!aabbOverlap(a, { cx: 2, cy: 0.4, cz: 0, sx: 1, sy: 1, sz: 1 }))
  assert.ok(!aabbOverlap(a, { cx: 0, cy: 3, cz: 0, sx: 1, sy: 1, sz: 1 })) // 高度分离
  assert.ok(!aabbOverlap(a, { cx: 0, cy: 0.4, cz: 3, sx: 1, sy: 1, sz: 1 })) // 前后分离
})

test('collide: 玩家盒（站/滑）高度正确', () => {
  const stand = playerBox(0, 0, false)
  assert.equal(stand.sy, 0.8)
  assert.equal(stand.cy, 0.4)
  const slide = playerBox(0, 0, true)
  assert.equal(slide.sy, 0.45)
  assert.equal(slide.cy, 0.225)
})

test('collide: 金币拾取半径（普通 0.6 / 磁力 2.2）', () => {
  const px = 0, py = 0.4
  assert.ok(coinPickup(px, py, { x: 0, y: 0.9, z: 0 }, false))
  assert.ok(!coinPickup(px, py, { x: 1.5, y: 0.9, z: 0 }, false))
  assert.ok(coinPickup(px, py, { x: 1.8, y: 0.9, z: 0 }, true)) // 磁力扩大
  assert.ok(!coinPickup(px, py, { x: 3.5, y: 0.9, z: 0 }, true))
})

// 玩法关键属性（调平防回归）：每类障碍的「可过方式」必须与 04 文档 §1.1 一致
test('collide: 障碍可过方式（低栏跳 / 高栏滑铲 / 路障跳）', () => {
  const at = (y: number, sliding: boolean) => playerBox(0, y, sliding)
  const ob = (k: 'block' | 'laserLow' | 'laserHigh') => {
    const c = OBSTACLE[k]
    return { cx: 0, cy: c.y + c.h / 2, cz: 0, sx: c.w, sy: c.h, sz: c.d }
  }
  const jumpApex = JUMP.vy0 * JUMP.vy0 / (2 * -JUMP.gravity) // ~1.9m

  // 路障块：站着撞，跳（峰值）可过
  assert.ok(aabbOverlap(at(0, false), ob('block')))
  assert.ok(!aabbOverlap(at(jumpApex, false), ob('block')))

  // 低激光栏：站着撞，跳可过
  assert.ok(aabbOverlap(at(0, false), ob('laserLow')))
  assert.ok(!aabbOverlap(at(jumpApex, false), ob('laserLow')))

  // 高激光栏：站着撞、跳也撞（峰值 1.9 < 顶 2.4）→ 只有滑铲能过
  assert.ok(aabbOverlap(at(0, false), ob('laserHigh')))
  assert.ok(aabbOverlap(at(jumpApex, false), ob('laserHigh')))
  assert.ok(!aabbOverlap(at(0, true), ob('laserHigh')))
})

test('scoring: 距离×倍率累加 + 金币 + 检查点 + 无伤段', () => {
  const s = newScoreState()
  addDistance(s, 100) // 100 × 1 = 100
  s.multiplier = 2
  addDistance(s, 100) // 100 × 2 = 200
  addCoin(s, false)   // 100 × 2 = 200（当前倍率）
  s.multiplier = 1
  addCoin(s, false)   // 100 × 1
  addCheckpoint(s)    // 5000
  assert.equal(s.distanceScore, 300)
  assert.equal(s.coinScore, 300)
  // 无伤段：200m → 0 个 500m 段
  assert.equal(cleanSegmentScore(s), 0)
  assert.equal(totalScore(s), 300 + 300 + 5000 + 0)
})

test('scoring: 无伤段分（500m 段 × 2000；受伤归零）', () => {
  const s = newScoreState()
  addDistance(s, 1200)
  assert.equal(cleanSegmentScore(s), 2 * 2000) // 2 个完整 500m 段
  addHit(s)
  assert.equal(cleanSegmentScore(s), 0)
})

test('scoring: 分数上限 clamp', () => {
  assert.equal(clampScore(1e12), 99999999)
  assert.equal(clampScore(-5), 0)
  assert.equal(clampScore(NaN), 0)
  const s = newScoreState()
  s.distanceScore = 1e15
  assert.equal(totalScore(s), 99999999)
})

test('scoring: runMeta 成就字段（clean = 2000m 无伤）', () => {
  const s = newScoreState()
  addDistance(s, 2000)
  const m1 = runMeta(s, 25.3)
  assert.equal(m1.clean, true)
  assert.equal(m1.meters, 2000)
  assert.equal(m1.maxSpeed, 25) // int（metaSchema 仅 int|string|bool）
  addHit(s)
  assert.equal(runMeta(s, 25).clean, false)
  const s2 = newScoreState()
  addDistance(s2, 1999)
  assert.equal(runMeta(s2, 25).clean, false) // 差 1 米
})

test('scoring: 磁力金币计入 magnetCoins（成就字段）', () => {
  const s = newScoreState()
  addCoin(s, true)
  addCoin(s, false)
  addCoin(s, true)
  assert.equal(s.coins, 3)
  assert.equal(s.magnetCoins, 2)
})
