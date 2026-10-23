/**
 * 纯逻辑单测（node --test）：确定性随机 / 节拍系统 / 生成导演 / 碰撞 / 连击 / 计分。
 * 渲染层（three.js）不在这套测试里——浏览器泡测覆盖（04 §4 W3/W4 验收）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32, range, pickWeighted } from '../src/core/rng.ts'
import {
  planChunk, passableLanes,
} from '../src/core/director.ts'
import { aabbOverlap, playerBox, coinPickup, boxSeparation } from '../src/core/collide.ts'
import { OBSTACLE, JUMP, NEAR_MISS, BOOST } from '../src/core/constants.ts'
import {
  newScoreState, addDistance, addCoin, addCheckpoint, addHit, addBonus,
  totalScore, cleanSegmentScore, runMeta, clampScore,
  newCombo, comboBump, comboTick, comboReset, comboRemainingMs, COMBO,
} from '../src/core/scoring.ts'
import {
  BEAT_DUR_MS, speedAtMeter, timeAtMeters, metersAtTime, beatIndexAtMeter,
  quantizeToBeat, judgeFlow, RHYTHM, newGroove, grooveOnPerfect, grooveOnNonPerfect,
  grooveOnHit, RhythmGateJudge,
} from '../src/core/rhythm.ts'

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

// ---- 节拍系统（W4「奇」点：纯函数边界表）----

test('rhythm: 128BPM 一拍 = 468.75ms', () => {
  assert.ok(Math.abs(BEAT_DUR_MS - 468.75) < 1e-9)
})

test('rhythm: timeAtMeters 分段线性（14m/s 起步，250m 一档 +0.8，5000m 封顶 30）', () => {
  assert.ok(Math.abs(timeAtMeters(0) - 0) < 1e-12)
  assert.ok(Math.abs(timeAtMeters(14) - 1) < 1e-9)          // 14m/s × 1s
  assert.ok(Math.abs(timeAtMeters(250) - 250 / 14) < 1e-9)   // 第一档全程 14
  assert.ok(Math.abs(timeAtMeters(500) - (250 / 14 + 250 / 14.8)) < 1e-9)
  assert.equal(speedAtMeter(0), 14)
  assert.equal(speedAtMeter(250), 14.8)
  assert.equal(speedAtMeter(5000), 30)
  assert.equal(speedAtMeter(99999), 30)
})

test('rhythm: timeAtMeters ↔ metersAtTime 互逆（采样往返误差 < 0.5m）', () => {
  for (const m of [1, 50, 250, 251, 600, 1234, 2500, 3000, 4500, 5000, 8000]) {
    const t = timeAtMeters(m)
    const back = metersAtTime(t)
    assert.ok(Math.abs(back - m) < 0.5, `m=${m} t=${t} back=${back}`)
  }
})

test('rhythm: metersAtTime 在封顶段恒速（≥5000m 按 30m/s）', () => {
  const t5000 = timeAtMeters(5000)
  assert.ok(Math.abs(metersAtTime(t5000 + 1) - 5030) < 1e-6)   // +1s × 30m/s
  assert.ok(Math.abs(metersAtTime(t5000 + 60) - 6800) < 1e-6)  // +60s × 30m/s
})

test('rhythm: quantizeToBeat 落在节拍格（往返 = 节拍序号 × 一拍）', () => {
  for (const m of [12, 87.3, 250, 612.4, 1433, 2999, 5000.5]) {
    const q = quantizeToBeat(m)
    const k = beatIndexAtMeter(q)
    const ideal = metersAtTime((k * BEAT_DUR_MS) / 1000)
    assert.ok(Math.abs(q - ideal) < 1e-6, `m=${m} q=${q}`)
    // 量化不偏移超过半拍
    assert.ok(Math.abs(quantizeToBeat(m) - m) < (BEAT_DUR_MS / 1000) * speedAtMeter(m) / 2 + 0.01)
  }
})

test('rhythm: judgeFlow 边界（90ms PERFECT / 180ms GOOD / 其余 miss）', () => {
  assert.equal(judgeFlow(0), 'perfect')
  assert.equal(judgeFlow(90), 'perfect')
  assert.equal(judgeFlow(-90), 'perfect')
  assert.equal(judgeFlow(91), 'good')
  assert.equal(judgeFlow(180), 'good')
  assert.equal(judgeFlow(-180), 'good')
  assert.equal(judgeFlow(181), 'miss')
  assert.equal(judgeFlow(-500), 'miss')
})

test('rhythm: Groove 连续 3 次 PERFECT 激活；非 PERFECT 断连但激活态保持；受击全清', () => {
  const g = newGroove()
  grooveOnPerfect(g); assert.equal(g.active, false)
  grooveOnPerfect(g); assert.equal(g.active, false)
  grooveOnNonPerfect(g) // 中途断连
  assert.equal(g.streak, 0)
  assert.equal(g.active, false)
  grooveOnPerfect(g)
  grooveOnPerfect(g); assert.equal(g.active, false)
  grooveOnPerfect(g); assert.equal(g.active, true) // 第 3 次连续
  grooveOnNonPerfect(g) // 断连不关闭已激活的 Groove（04 §1.5：直到受击）
  assert.equal(g.streak, 0)
  assert.equal(g.active, true)
  grooveOnHit(g)
  assert.equal(g.active, false)
  assert.equal(g.streak, 0)
})

// ---- 节奏门判定状态机（回归：旧实现 settle 先 delete 后 get → 永远读不到按压 → FLOW 永不触发）----

test('gateJudge: 按压→结算顺序回归（先读后删；PERFECT 10ms 偏拍）', () => {
  const j = new RhythmGateJudge()
  const meter = 1001.29
  const B = 141
  const beat = B * BEAT_DUR_MS
  // 拍前 10ms 按压登记（±300ms 窗口内）
  assert.equal(j.registerPress(meter, beat - 10, B), true)
  // 结算：必须先读到按压再删——回归断言：若顺序错，这里会是 'none'（FLOW 永不触发的根因）
  assert.equal(j.settle(meter, B), 'perfect')
  // 已结算门：再按压/再结算均无效
  assert.equal(j.registerPress(meter, beat + 5, B), false)
  assert.equal(j.settle(meter, B), 'none')
  assert.equal(j.isSettled(meter), true)
})

test('gateJudge: 无按压 = none（普通通过不惩罚）', () => {
  const j = new RhythmGateJudge()
  assert.equal(j.settle(600.0, 82), 'none')
})

test('gateJudge: 窗口内偏拍（250ms）= miss（不奖励）', () => {
  const j = new RhythmGateJudge()
  const B = 100
  const beat = B * BEAT_DUR_MS
  assert.equal(j.registerPress(700.0, beat + 250, B), true)
  assert.equal(j.settle(700.0, B), 'miss')
})

test('gateJudge: 窗口外按压不登记（±300ms）', () => {
  const j = new RhythmGateJudge()
  const B = 100
  const beat = B * BEAT_DUR_MS
  assert.equal(j.registerPress(800.0, beat + 301, B), false)
  assert.equal(j.registerPress(800.0, beat - 301, B), false)
  assert.equal(j.settle(800.0, B), 'none')
})

test('gateJudge: 重复按压只记第一次（04 §1.5：以首次有效按压为准）', () => {
  const j = new RhythmGateJudge()
  const B = 100
  const beat = B * BEAT_DUR_MS
  assert.equal(j.registerPress(900.0, beat - 150, B), true)
  assert.equal(j.registerPress(900.0, beat - 5, B), false) // 第二次忽略
  assert.equal(j.settle(900.0, B), 'good') // -150ms → good
})

test('gateJudge: reset 清空按压与结算态', () => {
  const j = new RhythmGateJudge()
  const B = 100
  j.registerPress(950.0, B * BEAT_DUR_MS, B)
  j.reset()
  assert.equal(j.registerPress(950.0, B * BEAT_DUR_MS, B), true)
  assert.equal(j.settle(950.0, B), 'perfect')
})

// ---- 导演（节拍量化版）----

test('director: 同 seed+chunk 布局可复现', () => {
  const a = planChunk(1234, 5, 100)
  const b = planChunk(1234, 5, 100)
  assert.deepEqual(a.items, b.items)
  assert.equal(a.energyGate?.meter, b.energyGate?.meter)
  assert.equal(a.checkpoint, b.checkpoint)
  assert.equal(a.boostGate, b.boostGate)
  assert.deepEqual(a.rhythmGate, b.rhythmGate)
})

test('director: 异 seed 布局不同', () => {
  const a = planChunk(1111, 3, 100)
  const b = planChunk(2222, 3, 100)
  assert.notDeepEqual(a.items, b.items)
})

test('director: 块内项单调递增 + 车道合法 + 障碍密度合理 + 量化不叠格', () => {
  for (let c = 0; c < 8; c++) {
    const p = planChunk(99, c, 100)
    for (let i = 1; i < p.items.length; i++) {
      assert.ok(p.items[i].meter > p.items[i - 1].meter, `chunk ${c} 项未递增`)
    }
    for (const it of p.items) {
      for (const lane of it.lanes) assert.ok(lane >= 0 && lane <= 2, `车道越界 ${lane}`)
    }
    // 相邻项（障碍-障碍）不落在同一节拍格：间距 ≥ 2m（低档节拍格间距 6.56m，这里防量化塌缩）
    const obs = p.items.filter(i => !i.coins)
    for (let i = 1; i < obs.length; i++) {
      assert.ok(obs[i].meter - obs[i - 1].meter >= 2, `chunk ${c} 量化塌缩: ${obs[i - 1].meter}→${obs[i].meter}`)
    }
    assert.ok(obs.length >= 2 && obs.length <= 14, `chunk ${c} 障碍数 ${obs.length} 异常`)
    // 首障碍离块头 ≥8m（呼吸距离；量化可能比 10m 略早，保底 8m）
    if (obs.length) assert.ok(obs[0].meter >= p.fromM + 8, `chunk ${c} 首障碍太贴脸 ${obs[0].meter - p.fromM}`)
  }
})

test('director: 障碍米位全部落在节拍格（04 §1.5 量化生成）', () => {
  for (let c = 0; c < 6; c++) {
    const p = planChunk(7, c, 100)
    for (const it of p.items) {
      const k = beatIndexAtMeter(it.meter)
      const ideal = metersAtTime((k * BEAT_DUR_MS) / 1000)
      assert.ok(Math.abs(it.meter - ideal) < 0.05, `item ${it.meter} 未对齐节拍（ideal=${ideal}）`)
    }
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

test('director: 节奏门 600m 后每 400m + 节拍锚点 + ±18m 呼吸段', () => {
  const p = planChunk(42, 6, 100) // 600–700m 块
  assert.ok(p.rhythmGate, '600m 块应有节奏门')
  assert.ok(Math.abs(p.rhythmGate!.meter - 600) < 6, `节奏门米位 ${p.rhythmGate!.meter}`)
  // 节拍锚点一致
  const k = beatIndexAtMeter(p.rhythmGate!.meter)
  assert.equal(k, p.rhythmGate!.beatIndex)
  // 呼吸段：门 ±18m 内无实体
  for (const it of p.items) {
    assert.ok(Math.abs(it.meter - p.rhythmGate!.meter) >= RHYTHM.clearM, `呼吸段内不应有实体 ${it.meter}`)
  }
  // 后续块门位递增 400m（边界门归属起始块：1000m 门在第 10 块）
  const p2 = planChunk(42, 7, 100) // 700–800
  const p3 = planChunk(42, 8, 100) // 800–900
  const p9 = planChunk(42, 9, 100) // 900–1000
  const p10 = planChunk(42, 10, 100) // 1000–1100
  assert.ok(!p2.rhythmGate && !p3.rhythmGate && !p9.rhythmGate, '700/800/900 块内不应有门（600 后 400m 一扇）')
  assert.ok(p10.rhythmGate, '1000m 块应有第二扇节奏门')
  assert.ok(Math.abs(p10.rhythmGate!.meter - 1000) < 6, `第二扇门 ${p10.rhythmGate!.meter}`)
})

test('director: Boost 门 800m 后每 800m（边界归属起始块）', () => {
  const p6 = planChunk(5, 6, 100)  // 600–700：无
  const p8 = planChunk(5, 8, 100)  // 800–900：有（800m）
  const p10 = planChunk(5, 10, 100) // 1000–1100：无
  const p15 = planChunk(5, 15, 100) // 1500–1600：无（1600 归属下块）
  const p16 = planChunk(5, 16, 100) // 1600–1700：有（1600m）
  assert.ok(!p6.boostGate)
  assert.ok(p8.boostGate && Math.abs(p8.boostGate - 800) < 6, `boost ${p8.boostGate}`)
  assert.ok(!p10.boostGate)
  assert.ok(!p15.boostGate)
  assert.ok(p16.boostGate && Math.abs(p16.boostGate - 1600) < 6, `boost ${p16.boostGate}`)
})

test('director: 能量门/检查点保留（量化后位置不变 ±3m）', () => {
  const p3 = planChunk(9, 3, 100) // 300–400：检查点 500 不在内
  assert.ok(!p3.checkpoint)
  const p5 = planChunk(9, 5, 100) // 500–600：检查点 500
  assert.ok(p5.checkpoint, '500m 块应有检查点')
  assert.ok(Math.abs(p5.checkpoint! - 500) < 3, `检查点 ${p5.checkpoint}`)
})

// ---- 碰撞 ----

test('collide: AABB 基本相交/分离', () => {
  const a = { cx: 0, cy: 0.4, cz: 0, sx: 0.8, sy: 0.8, sz: 0.8 }
  assert.ok(aabbOverlap(a, { cx: 0, cy: 0.4, cz: 0, sx: 1, sy: 1, sz: 1 }))
  assert.ok(!aabbOverlap(a, { cx: 2, cy: 0.4, cz: 0, sx: 1, sy: 1, sz: 1 }))
  assert.ok(!aabbOverlap(a, { cx: 0, cy: 3, cz: 0, sx: 1, sy: 1, sz: 1 })) // 高度分离
  assert.ok(!aabbOverlap(a, { cx: 0, cy: 0.4, cz: 3, sz: 1, sx: 1, sy: 1 })) // 前后分离
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

test('collide: boxSeparation 最近点距离（重叠/包含=0 / 轴向间隙 / 对角）', () => {
  const a = { cx: 0, cy: 0.4, cz: 0, sx: 0.8, sy: 0.8, sz: 0.8 }
  assert.equal(boxSeparation(a, { cx: 0, cy: 0.4, cz: 0, sx: 1, sy: 1, sz: 1 }), 0) // 包含=0
  assert.ok(Math.abs(boxSeparation(a, { cx: 1.5, cy: 0.4, cz: 0, sx: 1, sy: 1, sz: 1 }) - 0.6) < 1e-9) // x 间隙 1.5−0.4−0.5
  const diag = boxSeparation(a, { cx: 2, cy: 2, cz: 2, sx: 0.8, sy: 0.8, sz: 0.8 })
  assert.ok(Math.abs(diag - Math.sqrt(1.2 * 1.2 + 0.8 * 0.8 + 1.2 * 1.2)) < 1e-9, `对角分离 ${diag}`)
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

// ---- 连击（04 §1.4）----

test('combo: 每次 +0.25 封顶 ×8；4s 衰减；受击清零', () => {
  const c = newCombo(0)
  assert.equal(c.mult, 1)
  for (let i = 0; i < 5; i++) comboBump(c, 100 * i)
  assert.equal(c.mult, 1 + 5 * COMBO.perStep)
  const last = 5000 + 99
  for (let i = 0; i < 100; i++) comboBump(c, 5000 + i) // 远超封顶
  assert.equal(c.mult, COMBO.cap)
  comboTick(c, last + COMBO.decayMs - 1)
  assert.equal(c.mult, COMBO.cap) // 未到 4s
  comboTick(c, last + COMBO.decayMs)
  assert.equal(c.mult, 1)        // 满 4s 回落
  comboBump(c, 20000)
  assert.equal(comboRemainingMs(c, 20000), COMBO.decayMs)
  comboReset(c)
  assert.equal(c.mult, 1)
  assert.equal(c.count, 0)
})

// ---- 计分 ----

test('scoring: 距离×生效倍率累加 + 金币 + 检查点 + 无伤段 + 固定加分', () => {
  const s = newScoreState()
  addDistance(s, 100, 1)                    // 100
  addDistance(s, 100, 2)                    // 200
  addCoin(s, false, 2, false)               // 100×2=200
  addCoin(s, false, 1, false)               // 100
  addCoin(s, false, 2, true)                // 大金币 1000×2=2000
  addBonus(s, NEAR_MISS.score * 2)          // 近失 200×2=400
  addBonus(s, RHYTHM.perfectScore)          // FLOW 1000（固定）
  addCheckpoint(s)                          // 5000
  assert.equal(s.distanceScore, 300)
  assert.equal(s.coinScore, 2300)   // 200 + 100 + 大金币 2000
  assert.equal(s.bonusScore, 1400)  // 近失 400 + FLOW 1000
  // 无伤段：200m → 0 个 500m 段
  assert.equal(cleanSegmentScore(s), 0)
  assert.equal(totalScore(s), 300 + 2300 + 1400 + 5000 + 0)
})

test('scoring: 无伤段分（500m 段 × 2000；受伤归零）', () => {
  const s = newScoreState()
  addDistance(s, 1200, 1)
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

test('scoring: runMeta 成就字段 + 新字段（nearMisses/flowPerfect/mode）', () => {
  const s = newScoreState()
  addDistance(s, 2000, 1)
  addBonus(s, RHYTHM.perfectScore)
  s.flowPerfect = 2
  s.nearMisses = 3
  const m1 = runMeta(s, 25.3, 'arcade')
  assert.equal(m1.clean, true)
  assert.equal(m1.meters, 2000)
  assert.equal(m1.maxSpeed, 25) // int（metaSchema 仅 int|string|bool）
  assert.equal(m1.nearMisses, 3)
  assert.equal(m1.flowPerfect, 2)
  assert.equal(m1.mode, 'arcade')
  addHit(s)
  assert.equal(runMeta(s, 25, 'arcade').clean, false)
  const s2 = newScoreState()
  addDistance(s2, 1999, 1)
  assert.equal(runMeta(s2, 25, 'arcade').clean, false) // 差 1 米
})

test('scoring: 磁力金币计入 magnetCoins（成就字段）', () => {
  const s = newScoreState()
  addCoin(s, true, 1, false)
  addCoin(s, false, 1, false)
  addCoin(s, true, 2, false)
  assert.equal(s.coins, 3)
  assert.equal(s.magnetCoins, 2)
})

test('constants: Boost 参数与 04 §1.1 一致', () => {
  assert.equal(BOOST.ms, 2000)
  assert.equal(BOOST.speedMult, 1.6)
  assert.equal(BOOST.firstM, 800)
  assert.equal(BOOST.bonusPerSec, 1000) // +100/0.1s
})
