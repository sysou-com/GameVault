/** WebAudio 合成音（06 文档 §1.3：0 音频资产；首交互后初始化，audio.requiresGesture）。 */
export class Sfx {
  private ctx: AudioContext | null = null

  /** 首次用户手势时调用（自动播放策略） */
  ensure(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
      } catch {
        this.ctx = null
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => { /* 忽略：静音降级 */ })
    }
  }

  /** 命中：440Hz（GOOD/OK）/ 880Hz（PERFECT）正弦 50ms */
  hit(perfect: boolean): void {
    this.tone(perfect ? 880 : 440, 'sine', 0.05, 0.25)
  }

  /** MISS：110Hz 方波 100ms */
  miss(): void {
    this.tone(110, 'square', 0.1, 0.18)
  }

  private tone(freq: number, type: OscillatorType, durS: number, gainV: number): void {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    try {
      const t0 = ctx.currentTime
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      g.gain.setValueAtTime(gainV, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durS)
      osc.connect(g).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + durS + 0.02)
    } catch {
      /* 音频失败不影响游戏 */
    }
  }
}
