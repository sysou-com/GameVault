import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32, planBeats } from '../src/beat.ts'

test('计划确定性：同 seed 同序列', () => {
  const a = planBeats(mulberry32(42), { expert: false })
  const b = planBeats(mulberry32(42), { expert: false })
  assert.deepEqual(a, b)
})

test('12 拍、时刻严格递增', () => {
  const p = planBeats(mulberry32(7))
  assert.equal(p.length, 12)
  for (let i = 1; i < p.length; i++) {
    assert.ok(p[i].atMs > p[i - 1].atMs, `atMs 非递增 @${i}`)
    assert.ok(p[i].intervalMs >= 500, `间隔低于下限 @${i}: ${p[i].intervalMs}`)
  }
})

test('首拍 ≥1.5s（countdown 结束后留 1.5s 建立节奏）', () => {
  const p = planBeats(mulberry32(1))
  assert.ok(p[0].atMs >= 1500, `首拍太早: ${p[0].atMs}`)
})

test('普通模式间隔下限 900ms（加速前）', () => {
  const p = planBeats(mulberry32(3), { expert: false })
  // 初始间隔在 [900,1600]；逐拍 ×0.97±10% 后仍 ≥500
  assert.ok(p[0].intervalMs >= 900 && p[0].intervalMs <= 1600, `首间隔越界: ${p[0].intervalMs}`)
})

test('专家模式：间隔下限 700ms + 恰好 1 拍假环（不在前两拍/末拍）', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const p = planBeats(mulberry32(seed), { expert: true })
    const decoys = p.filter(b => b.decoy)
    assert.equal(decoys.length, 1, `seed=${seed} 假环数量 ${decoys.length}`)
    assert.ok(decoys[0].index >= 2 && decoys[0].index <= p.length - 2, `seed=${seed} 假环位置 ${decoys[0].index}`)
  }
})

test('非专家模式无假环', () => {
  const p = planBeats(mulberry32(5), { expert: false })
  assert.equal(p.filter(b => b.decoy).length, 0)
})

test('局内加速：后段平均间隔 < 前段', () => {
  // 固定 rng 序列下，accel=0.97 且无随机扰动项影响趋势
  const p = planBeats(() => 0.5, { accel: 0.97 }) // 恒定 0.5
  const first = p[0].intervalMs
  const last = p[p.length - 1].intervalMs
  assert.ok(last < first, `未加速: first=${first} last=${last}`)
})
