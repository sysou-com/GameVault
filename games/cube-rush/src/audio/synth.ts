/**
 * 音频（WebAudio 全合成，04 §1.3；requiresGesture=true —— 首次 pointerdown/keydown 后初始化）。
 * 零音频资产（与 neon-raid 同款路线）：BGM 一首赛博 lo-fi（lookahead 调度循环），SFX 6 条。
 */

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

// 赛博 lo-fi：Bb minor 味（B 根音 47），8 步 bass + 16 步 arp + 4 和弦 pad
const BGM = {
  bpm: 104,
  root: 47,
  bass: [0, -1, 0, -1, 3, -1, 3, 5] as number[],
  arp: [12, -1, 15, -1, 19, -1, 15, -1, 12, -1, 15, -1, 22, -1, 19, -1] as number[],
  pad: [[0, 3, 7], [0, 3, 7], [-2, 0, 4], [3, 7, 10]] as number[][],
}

export interface AudioEngine {
  init(volume: number): void
  setVolume(v: number): void
  startBgm(): void
  stopBgm(): void
  sfx(name: 'lane' | 'jump' | 'coin' | 'energy' | 'checkpoint' | 'crash'): void
  muted(): boolean
  setMuted(m: boolean): void
}

export function createAudio(): AudioEngine {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let bgmGain: GainNode | null = null
  let sfxGain: GainNode | null = null
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

  // ---- BGM 调度（lookahead 200ms，step = 16th） ----
  const scheduleStep = (s: number, t: number): void => {
    if (!ctx || !bgmGain) return
    // bass（每 2 step 一拍，8 步循环）
    const b = BGM.bass[(s >> 1) % 8]
    if (b >= 0) blip(t, 'sine', midiHz(BGM.root + b), 0.32, 0.5, bgmGain)
    // arp（16 步，三角波轻）
    const a = BGM.arp[s % 16]
    if (a >= 0) blip(t, 'triangle', midiHz(BGM.root + 12 + a), 0.16, 0.22, bgmGain)
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
        g.gain.linearRampToValueAtTime(0, t + (BGM.bpm / 60) * 4)
        osc.connect(g)
        g.connect(bgmGain)
        osc.start(t)
        osc.stop(t + (BGM.bpm / 60) * 4 + 0.05)
      }
    }
  }

  const startBgm = (): void => {
    if (!ctx || timer !== null) return
    step = 0
    nextTime = ctx.currentTime + 0.1
    timer = window.setInterval(() => {
      if (!ctx) return
      const stepDur = 60 / BGM.bpm / 4 // 16th
      while (nextTime < ctx.currentTime + 0.2) {
        scheduleStep(step, nextTime)
        nextTime += stepDur
        step = (step + 1) % 32 // 4 和弦 × 16 步
      }
    }, 80)
  }

  const stopBgm = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
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

  const sfx = (name: 'lane' | 'jump' | 'coin' | 'energy' | 'checkpoint' | 'crash'): void => {
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
    }
  }

  return { init, setVolume, startBgm, stopBgm, sfx, muted: () => muted, setMuted }
}
