/**
 * 确定性随机（03 文档 §2.2：种子存 localStorage，测试可复现）。
 * mulberry32 —— 快速、均匀、可复现。
 */
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }

  /** [0,1) */
  next(): number {
    this.s |= 0
    this.s = (this.s + 0x6d2b79f5) | 0
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [min,max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** [min,max] 整数 */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** 0/1 */
  chance(p: number): boolean {
    return this.next() < p
  }
}

const SEED_KEY = 'neonraid.seed'

/** 每局新种子（存 localStorage，便于回放/调试复现；测试注入固定种子） */
export function freshSeed(): number {
  const s = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0
  try { localStorage.setItem(SEED_KEY, String(s)) } catch { /* 隐私模式 */ }
  return s
}

export function lastSeed(): number {
  try {
    const v = Number(localStorage.getItem(SEED_KEY))
    if (Number.isFinite(v) && v > 0) return v >>> 0
  } catch { /* ignore */ }
  return 12345
}
