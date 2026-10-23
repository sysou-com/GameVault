import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comboBonus, judge } from '../src/judge.ts'

// 判定边界表（06 文档 §6：判定纯函数单测锁死边界）
const cases: Array<[number, string, number, boolean]> = [
  [0, 'PERFECT', 100, true],
  [29, 'PERFECT', 100, true],
  [30, 'PERFECT', 100, true],
  [31, 'GOOD', 50, true],
  [80, 'GOOD', 50, true],
  [81, 'OK', 20, false],
  [150, 'OK', 20, false],
  [151, 'MISS', 0, false],
  [10000, 'MISS', 0, false],
  // 负偏差（早按）对称
  [-29, 'PERFECT', 100, true],
  [-30, 'PERFECT', 100, true],
  [-31, 'GOOD', 50, true],
  [-81, 'OK', 20, false],
  [-151, 'MISS', 0, false],
]

test('judge 边界表（±ms 对称）', () => {
  for (const [dev, grade, points, combo] of cases) {
    const r = judge(dev)
    assert.equal(r.grade, grade, `dev=${dev} 期望 ${grade}，实际 ${r.grade}`)
    assert.equal(r.points, points)
    assert.equal(r.comboHit, combo)
  }
})

test('连击加成：每次命中 +5，每局上限 60（12 拍全中 = 1260）', () => {
  let budget = 60
  let total = 0
  for (let i = 0; i < 12; i++) {
    const b = comboBonus(budget)
    budget -= b
    total += 100 + b
  }
  assert.equal(budget, 0)
  assert.equal(total, 1260) // 06 文档 §1.2 理论上限
  assert.equal(comboBonus(0), 0)
  assert.equal(comboBonus(3), 3)
  assert.equal(comboBonus(60), 5)
})
