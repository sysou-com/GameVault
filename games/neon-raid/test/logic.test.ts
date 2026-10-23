// 纯逻辑单测（node --test）：combo / wave director / rng / score 规则
import { test } from 'node:test'
import assert from 'node:assert'
import { Combo } from '../src/systems/combo.ts'
import { aabb, sweptBulletHits } from '../src/systems/collide.ts'
import { Rng } from '../src/core/rng.ts'
import { addScore, newRun } from '../src/core/run.ts'
import { SCORE } from '../src/core/constants.ts'
import { LEVELS } from '../src/core/constants.ts'
import { WaveDirector } from '../src/systems/waves.ts'

test('combo: 窗口内累计、超时归零、受击归零', () => {
  const c = new Combo()
  assert.equal(c.kill(0), 1)
  assert.equal(c.kill(1000), 2)
  assert.equal(c.best, 2)
  c.kill(2600) // 距上次 >1.5s → 重新计
  assert.equal(c.n, 1)
  c.kill(2700)
  assert.equal(c.n, 2)
  c.hit()
  assert.equal(c.n, 0)
  c.kill(3000)
  assert.equal(c.n, 1)
})

test('combo: 加成公式 1 + min(n,50)*0.01', () => {
  assert.equal(SCORE.comboMultiplier(0), 1)
  assert.equal(SCORE.comboMultiplier(10), 1.1)
  assert.equal(SCORE.comboMultiplier(50), 1.5)
  assert.equal(SCORE.comboMultiplier(80), 1.5) // 封顶 50
})

test('rng: 同种子可复现、值域正确', () => {
  const a = new Rng(42)
  const b = new Rng(42)
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next())
  const c = new Rng(7)
  for (let i = 0; i < 500; i++) {
    const v = c.next()
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`)
  }
  const n = c.int(3, 5)
  assert.ok(n >= 3 && n <= 5)
})

test('collide: 基础 AABB 与边界', () => {
  assert.ok(aabb(100, 100, 34, 22, 110, 105, 14, 5), '重叠')
  assert.ok(!aabb(100, 100, 34, 22, 125, 100, 14, 5), 'x 分离（dx=25 ≥ (34+14)/2=24）')
  assert.ok(!aabb(100, 100, 34, 22, 100, 114, 14, 5), 'y 分离（dy=14 ≥ (22+5)/2=13.5）')
  assert.ok(!aabb(100, 100, 34, 22, 124, 100, 14, 5), '恰好相切不算命中')
  assert.ok(aabb(0, 0, 10, 10, 5, 5, 10, 10), '中心交叉')
})

test('collide: 扫掠判定（dt 钳 50ms 时子弹一步 45px 不穿透）', () => {
  const target = { x: 300, y: 270, w: 34, h: 22 }
  // 上一帧在敌机后侧外 45px，本帧已飞到前侧外（一步跨过敌机）
  const b = { px: 253, py: 270, x: 298, y: 270 }
  assert.ok(sweptBulletHits(b, 14, 5, target), '跨越帧必须命中')
  // 完全错过（目标不在路径上）
  const miss = { px: 253, py: 200, x: 298, y: 200 }
  assert.ok(!sweptBulletHits(miss, 14, 5, target), '路径外不命中')
  // 常规帧（相邻两帧都在敌机附近）也能命中
  const normal = { px: 280, py: 270, x: 295, y: 270 }
  assert.ok(sweptBulletHits(normal, 14, 5, target))
})

test('score: 封顶 9,999,999', () => {
  const run = newRun()
  addScore(run, 9_999_999, 10)
  assert.equal(run.score, SCORE.max)
  addScore(run, 500, 1.5)
  assert.equal(run.score, SCORE.max)
})

test('wave director: 完整一波流程（spawning→waveClear→gap→下一波）', () => {
  const rng = new Rng(1)
  const lvl = LEVELS[0]
  let waveClears = 0
  const d = new WaveDirector(lvl, rng, {
    onWaveClear: () => { waveClears++ },
    onEliteSpawn: () => {},
    onLevelCleared: () => {},
  }, 540)
  // 波 1：5 只 grunt，间隔 900ms → 出场需 4*900=3600ms
  let spawned = 0
  let t = 0
  const step = 100
  // 模拟：不杀死任何敌机（alive=5）→ 导演不出场完不会推进
  for (let i = 0; i < 50; i++) {
    spawned += d.update(step, 5).length
    t += step
    if (spawned >= 5 && t > 4000) break
  }
  assert.equal(spawned, 5, `波1 应出场 5 只, got ${spawned}`)
  assert.equal(d.state, 'spawning')
  // 屏内清空 → 波清 → 3s gap → 波 2 开始出场
  let sawGap = false
  for (let i = 0; i < 40; i++) {
    const st = d.state
    d.update(step, 0)
    if (st === 'spawning' && d.state === 'gap') sawGap = true
  }
  assert.ok(sawGap, '应经过 gap 态')
  assert.equal(waveClears, 1)
  assert.equal(d.waveIdx, 1, '3s 后进入波 2')
  assert.equal(d.state, 'spawning')
})

test('wave director: 5 波全清 → elite → 全灭 → cleared（含双精英关）', () => {
  const rng = new Rng(9)
  let cleared = false
  let eliteSpawns = 0
  let eliteKinds: string[] = []
  for (const idx of [0, 2]) {
    cleared = false
    eliteSpawns = 0
    eliteKinds = []
    const d = new WaveDirector(LEVELS[idx], rng, {
      onWaveClear: () => {},
      onEliteSpawn: () => { eliteSpawns++ },
      onLevelCleared: () => { cleared = true },
    }, 540)
    // 每 500ms 推进，强制屏内清空（alive=0）→ 快速穿过 5 波
    let t = 0
    while (d.state !== 'cleared' && t < 120_000) {
      for (const c of d.update(500, 0)) if (c.kind.startsWith('elite-')) eliteKinds.push(c.kind)
      t += 500
    }
    assert.equal(d.state, 'cleared', `关${idx + 1} 应进入 cleared`)
    assert.ok(cleared, 'levelCleared 回调')
    assert.equal(eliteSpawns, LEVELS[idx].elite.length, `关${idx + 1} 精英数`)
    // 防回归：SpawnCmd 必须带 elite- 前缀（makeUnit 只认前缀形式，裸 key 会抛 unknown unit 冻死游戏循环）
    assert.deepEqual(eliteKinds, LEVELS[idx].elite.map((k) => `elite-${k}`), `关${idx + 1} 精英 SpawnCmd 前缀`)
  }
})

test('constants: 关卡/波次/积分表完整性（数据驱动防呆）', () => {
  assert.equal(LEVELS.length, 3)
  for (const lv of LEVELS) {
    assert.equal(lv.waves.length, 5, `关${lv.id} 应 5 波`)
    for (const w of lv.waves) {
      assert.ok(w.entries.length > 0)
      for (const e of w.entries) {
        assert.ok(['grunt', 'diver', 'bomber'].includes(e.spawn), `未知 spawn: ${e.spawn}`)
        assert.ok(e.t >= 0 && e.count > 0)
      }
    }
    assert.ok(lv.elite.length >= 1)
  }
  assert.equal(SCORE.small, 100)
  assert.equal(SCORE.waveClear, 2000)
  assert.equal(SCORE.elitePhase, 1000)
  assert.equal(SCORE.eliteKill, 5000)
  assert.equal(SCORE.timeBonusPerSec, 50)
  assert.equal(SCORE.max, 9_999_999)
})
