/**
 * 音频（WebAudio 全合成，04 §1.3；requiresGesture=true —— 首次 pointerdown/keydown 后初始化）。
 * 零音频资产（与 neon-raid 同款路线）：
 * - BGM 赛博 lo-fi，**固定 128 BPM 4/4**（04 §1.5 节拍系统数据源：节拍时间线 = k × 60/128 s，
 *   与 rhythm.ts 的 BEAT_DUR_MS 同源；判定用逻辑时钟，音频只负责「听感跟拍」）。
 * - Groove 模式叠加低音层（WebAudio gain 节点分层切换，04 §1.5：连续 3 次 FLOW PERFECT 触发）。
 * - SFX 9 条：基础 6（换道/跳/金币/护盾/检查点/撞毁）+ W4 新增 3（近失「嗖」/FLOW「叮」/boost「轰」）。
 */

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

// 赛博 lo-fi：Bb 味（B 根音 47），128 BPM 4/4 —— 8 步 bass + 16 步 arp + 4 和弦 pad
const BGM = {
  bpm: 128,
  root: 47,
  bass: [0, -1, 0, -1, 3, -1, 3, 5] as number[],
  arp: [12, -1, 15, -1, 19, -1, 15, -1, 12, -1, 15, -1, 22, -1, 19, -1] as number[],
  pad: [[0, 3, 7], [0, 3, 7], [-2, 0, 4], [3, 7, 10]] as number[][],
}

/** BGM 起拍延迟（ms）：startBgm 后首拍距调用时刻。Game 用它对齐逻辑节拍时钟（runTime 起点 −100ms）。 */
export const BGM_START_DELAY_MS = 100

export interface AudioEngine {
  init(volume: number): void
  setVolume(v: number): void
  startBgm(): number // 返回首拍延迟 ms（供逻辑节拍时钟对齐）
  stopBgm(): void
  /** Groove 低音层开关（04 §1.5：×1.5 得分 + 低音层 + 速度线增强）。 */
  setGroove(on: boolean): void
  sfx(name: 'lane' | 'jump' | 'coin' | 'energy' | 'checkpoint' | 'crash' | 'near' | 'flow' | 'flowPerfect' | 'boost'): void
  muted(): boolean
  setMuted(m: boolean): void
}

export function createAudio(): AudioEngine {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let bgmGain: GainNode | null = null
  let sfxGain: GainNode | null = null
  let grooveGain: GainNode | null = null // Groove 低音层（默认 0 增益）
  let volume = 0.7
  let muted = false
  let timer: number | null = null
  let nextTime = 0
  let step = 0

  const effective = (): number => (muted ? 0 : volume)

  const init = (v: number): void => {
    if (ctx) { setVolume(v); return }
    volume = v
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
    master = ctx.createGain()
    master.gain.value = effective()
    master.connect(ctx.destination)
    bgmGain = ctx.createGain()
    bgmGain.gain.value = 0.42
    bgmGain.connect(master)
    grooveGain = ctx.createGain()
    grooveGain.gain.value = 0
    grooveGain.connect(bgmGain)
    sfxGain = ctx.createGain()
    sfxGain.gain.value = 0.9
    sfxGain.connect(master)
  }

  const setVolume = (v: number): void => {
    volume = v
    if (master && ctx) master.gain.setTargetAtTime(effective(), ctx.currentTime, 0.02)
  }

  const setMuted = (m: boolean): void => {
    muted = m
    setVolume(volume)
  }

  // ---- BGM 调度（lookahead 200ms，step = 16th；128BPM） ----
  const scheduleStep = (s: number, t: number): void => {
    if (!ctx || !bgmGain) return
    const stepDur = 60 / BGM.bpm / 4
    // bass（每 2 step 一拍，8 步循环）
    const b = BGM.bass[(s >> 1) % 8]
    if (b >= 0) blip(t, 'sine', midiHz(BGM.root + b), 0.32, 0.5, bgmGain)
    // Groove 低音层：sub-octave sine（与 bass 同步，gain 层由 setGroove 开关）
    if (b >= 0 && grooveGain) blip(t, 'sine', midiHz(BGM.root + b - 12), 0.34, 0.8, grooveGain)
    // arp（16 步，三角波轻）
    const a = BGM.arp[s % 16]
    if (a >= 0) blip(t, 'triangle', midiHz(BGM.root + 12 + a), 0.16, 0.22, bgmGain)
    // 底鼓：每拍轻击（节奏门判定的「听觉拍点」）
    if (s % 4 === 0) kick(t)
    // pad（每 16 step 换和弦，持续 8 步）
    if (s % 16 === 0) {
      const chord = BGM.pad[(s >> 4) % 4]
      for (const iv of chord) {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = midiHz(BGM.root + 12 + iv)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.05, t + 0.4)
        g.gain.linearRampToValueAtTime(0, t + stepDur * 16)
        osc.connect(g)
        g.connect(bgmGain)
        osc.start(t)
        osc.stop(t + stepDur * 16 + 0.05)
      }
    }
  }

  const kick = (t: number): void => {
    if (!ctx || !bgmGain) return
    blip(t, 'sine', 120, 0.1, 0.25, bgmGain, 45)
  }

  const startBgm = (): number => {
    if (!ctx || timer !== null) return 0
    step = 0
    nextTime = ctx.currentTime + BGM_START_DELAY_MS / 1000
    timer = window.setInterval(() => {
      if (!ctx) return
      const stepDur = 60 / BGM.bpm / 4 // 16th
      while (nextTime < ctx.currentTime + 0.2) {
        scheduleStep(step, nextTime)
        nextTime += stepDur
        step = (step + 1) % 32 // 4 和弦 × 16 步
      }
    }, 80)
    return BGM_START_DELAY_MS
  }

  const stopBgm = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const setGroove = (on: boolean): void => {
    if (ctx && grooveGain) {
      grooveGain.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05)
    }
  }

  // ---- SFX ----
  const blip = (t: number, wave: OscillatorType, freq: number, dur: number, vol: number, dest: AudioNode, freqEnd?: number): void => {
    if (!ctx) return
    const osc = ctx.createOscillator()
    osc.type = wave
    osc.frequency.setValueAtTime(freq, t)
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.connect(g)
    g.connect(dest)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }
  const noise = (t: number, dur: number, vol: number, dest: AudioNode, lpFrom: number, lpTo: number): void => {
    if (!ctx) return
    const n = Math.floor(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(lpFrom, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(40, lpTo), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f); f.connect(g); g.connect(dest)
    src.start(t)
  }

  const sfx = (name: 'lane' | 'jump' | 'coin' | 'energy' | 'checkpoint' | 'crash' | 'near' | 'flow' | 'flowPerfect' | 'boost'): void => {
    if (!ctx || !sfxGain) return
    const t = ctx.currentTime
    switch (name) {
      case 'lane':
        blip(t, 'triangle', 520, 0.07, 0.18, sfxGain, 780)
        break
      case 'jump':
        blip(t, 'square', 330, 0.12, 0.14, sfxGain, 660)
        break
      case 'coin':
        blip(t, 'sine', 1320, 0.09, 0.2, sfxGain)
        blip(t + 0.05, 'sine', 1760, 0.12, 0.16, sfxGain)
        break
      case 'energy':
        blip(t, 'sawtooth', 220, 0.35, 0.12, sfxGain, 880)
        blip(t + 0.05, 'triangle', 440, 0.3, 0.1, sfxGain, 1760)
        break
      case 'checkpoint':
        blip(t, 'sine', 660, 0.15, 0.2, sfxGain)
        blip(t + 0.1, 'sine', 880, 0.15, 0.2, sfxGain)
        blip(t + 0.2, 'sine', 1320, 0.25, 0.2, sfxGain)
        break
      case 'crash':
        noise(t, 0.5, 0.5, sfxGain, 3000, 120)
        blip(t, 'sawtooth', 160, 0.4, 0.2, sfxGain, 40)
        break
      case 'near': // 近失「嗖」（04 §1.3 音频扩展）
        noise(t, 0.18, 0.22, sfxGain, 4000, 200)
        blip(t, 'sine', 900, 0.16, 0.1, sfxGain, 2400)
        break
      case 'flow': // FLOW GOOD「叮」
        blip(t, 'sine', 880, 0.18, 0.2, sfxGain)
        blip(t + 0.06, 'sine', 1174, 0.22, 0.16, sfxGain)
        break
      case 'flowPerfect': // FLOW PERFECT「叮+」
        blip(t, 'sine', 1174, 0.2, 0.22, sfxGain)
        blip(t + 0.07, 'sine', 1760, 0.26, 0.2, sfxGain)
        blip(t + 0.14, 'sine', 2217, 0.3, 0.14, sfxGain)
        break
      case 'boost': // boost「轰」（04 §1.3 音频扩展）
        noise(t, 0.4, 0.3, sfxGain, 2500, 200)
        blip(t, 'sawtooth', 160, 0.45, 0.18, sfxGain, 900)
        break
    }
  }

  return { init, setVolume, startBgm, stopBgm, setGroove, sfx, muted: () => muted, setMuted }
}
