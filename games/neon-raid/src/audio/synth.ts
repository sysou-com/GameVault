/**
 * 音频（WebAudio 全合成，03 文档 §1.4：requiresGesture=true —— 首次 pointerdown/keydown 后初始化）。
 * 零音频资产（与 reflex-rush 同款路线）：BGM 每关一首程序化 synthwave（lookahead 调度），SFX 6 条。
 */

interface TrackDef {
  bpm: number
  root: number          // midi 根音
  bass: number[]        // 8 步（半音偏移，-1 = 休止）
  arp: number[]         // 16 步
  pad: number[][]       // 4 和弦（三和弦半音）
  wave: OscillatorType
}

const TRACKS: TrackDef[] = [
  // 关 1 夜航：沉稳巡航（A minor）
  { bpm: 104, root: 45, bass: [0, -1, 0, -1, 3, -1, 3, -1], arp: [12, 15, 19, 15, 12, 15, 19, 22, 12, 15, 19, 15, 10, 12, 15, 12], pad: [[0, 3, 7], [0, 3, 7], [-2, 0, 4], [3, 7, 10]], wave: 'triangle' },
  // 关 2 静电风暴：急促（F# minor）
  { bpm: 128, root: 42, bass: [0, 0, -1, 0, 2, 2, -1, 2], arp: [12, 16, 19, 16, 12, 16, 19, 24, 11, 15, 18, 15, 11, 15, 18, 23], pad: [[0, 2, 6], [0, 2, 6], [5, 7, 11], [0, 2, 6]], wave: 'square' },
  // 关 3 核心突袭：高压（C minor，双拍密度）
  { bpm: 140, root: 36, bass: [0, -1, 0, 0, 5, -1, 5, 3], arp: [12, 15, 19, 15, 21, 19, 15, 12, 10, 13, 17, 13, 15, 17, 21, 24], pad: [[0, 3, 7], [5, 8, 12], [-1, 2, 6], [0, 3, 7]], wave: 'sawtooth' },
]

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bgmGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private volume = 0.7
  private timer: number | null = null
  private nextNoteTime = 0
  private step = 0
  private track: TrackDef | null = null
  ready = false

  /** 首次用户交互后调用（自动播放策略） */
  init(volume: number): void {
    if (this.ctx) { this.setVolume(volume); return }
    this.volume = volume
    try {
      this.ctx = new AudioContext()
    } catch {
      this.ctx = null
      return
    }
    this.master = this.ctx.createGain()
    this.master.gain.value = volume
    this.master.connect(this.ctx.destination)
    this.bgmGain = this.ctx.createGain()
    this.bgmGain.gain.value = 0.4
    this.bgmGain.connect(this.master)
    this.sfxGain = this.ctx.createGain()
    this.sfxGain.gain.value = 0.9
    this.sfxGain.connect(this.master)
    this.ready = true
  }

  setVolume(v: number): void {
    this.volume = v
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  /** 开启某关 BGM（levelIdx 0..2） */
  startBgm(levelIdx: number): void {
    if (!this.ctx || !this.bgmGain) return
    this.stopBgm()
    this.track = TRACKS[Math.max(0, Math.min(TRACKS.length - 1, levelIdx))]
    this.step = 0
    this.nextNoteTime = this.ctx.currentTime + 0.08
    this.timer = window.setInterval(() => this.schedule(), 25)
  }

  stopBgm(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    this.track = null
  }

  private schedule(): void {
    const ctx = this.ctx
    const t = this.track
    if (!ctx || !t) return
    const stepDur = 60 / t.bpm / 4 // 16 分音符
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      const when = this.nextNoteTime
      const s = this.step
      // 贝斯（8 步循环）
      const b = t.bass[s % 8]
      if (b >= 0) this.tone(when, midiHz(t.root + b), stepDur * 0.9, 'square', 0.16, this.bgmGain!, 600)
      // 琶音（16 步）
      const a = t.arp[s % 16]
      this.tone(when, midiHz(t.root + 12 + a), stepDur * 0.5, t.wave === 'square' ? 'square' : 'triangle', 0.05, this.bgmGain!, 2400)
      // 踩镲（每 2 步）
      if (s % 2 === 0) this.noise(when, 0.03, s % 8 === 4 ? 0.09 : 0.04, 7000, this.bgmGain!)
      // 垫底（每 8 步换和弦）
      if (s % 8 === 0) {
        const chord = t.pad[Math.floor(s / 8) % 4]
        for (const n of chord) this.tone(when, midiHz(t.root + 12 + n), stepDur * 7.5, 'sawtooth', 0.03, this.bgmGain!, 900)
      }
      this.nextNoteTime += stepDur
      this.step++
    }
  }

  // ---- SFX ----
  sfx(name: 'shoot' | 'explode' | 'explodeBig' | 'pickup' | 'warn' | 'hit' | 'shield' | 'boom'): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    switch (name) {
      case 'shoot':
        this.tone(t, 880, 0.05, 'square', 0.05, this.sfxGain, 3000)
        this.tone(t + 0.02, 620, 0.04, 'square', 0.035, this.sfxGain, 2600)
        break
      case 'explode':
        this.noise(t, 0.16, 0.22, 1800, this.sfxGain)
        this.tone(t, 160, 0.14, 'sine', 0.18, this.sfxGain, 400)
        break
      case 'explodeBig':
        this.noise(t, 0.5, 0.4, 900, this.sfxGain)
        this.tone(t, 90, 0.42, 'sine', 0.3, this.sfxGain, 300)
        this.tone(t + 0.05, 60, 0.5, 'triangle', 0.2, this.sfxGain, 220)
        break
      case 'pickup':
        this.tone(t, 660, 0.06, 'square', 0.07, this.sfxGain, 3200)
        this.tone(t + 0.06, 880, 0.06, 'square', 0.07, this.sfxGain, 3200)
        this.tone(t + 0.12, 1320, 0.09, 'square', 0.07, this.sfxGain, 3600)
        break
      case 'warn':
        this.tone(t, 520, 0.14, 'square', 0.1, this.sfxGain, 1200)
        this.tone(t + 0.18, 390, 0.14, 'square', 0.1, this.sfxGain, 1200)
        break
      case 'hit':
        this.noise(t, 0.2, 0.3, 1200, this.sfxGain)
        this.tone(t, 220, 0.24, 'sawtooth', 0.16, this.sfxGain, 700)
        break
      case 'shield':
        this.tone(t, 1200, 0.18, 'sine', 0.12, this.sfxGain, 5000)
        this.tone(t + 0.04, 1600, 0.2, 'sine', 0.08, this.sfxGain, 5600)
        break
      case 'boom': // 清屏 AOE
        this.noise(t, 0.7, 0.5, 500, this.sfxGain)
        this.tone(t, 55, 0.6, 'sine', 0.35, this.sfxGain, 260)
        break
    }
  }

  private tone(when: number, freq: number, dur: number, type: OscillatorType, vol: number, dest: GainNode, lp = 4000): void {
    const ctx = this.ctx
    if (!ctx) return
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, when)
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, when)
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = lp
    o.connect(f); f.connect(g); g.connect(dest)
    o.start(when)
    o.stop(when + dur + 0.02)
  }

  private noise(when: number, dur: number, vol: number, lp: number, dest: GainNode): void {
    const ctx = this.ctx
    if (!ctx) return
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = lp
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, when)
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    src.connect(f); f.connect(g); g.connect(dest)
    src.start(when)
    src.stop(when + dur + 0.02)
  }
}

export const audio = new AudioEngine()
