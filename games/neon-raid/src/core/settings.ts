/**
 * 设置与进度（03 文档 §2.1：本游戏无存档，localStorage 仅存设置）。
 * 前缀 neonraid.（manifest.saves.localStoragePrefix）。
 */
export interface Settings {
  volume: number        // 0..1
  shake: boolean        // 震屏开关（静电风暴的闪电干扰也走此开关，03 §1.1 可关）
  unlockedLevel: number // 1..3
  bestScore: number
}

const KEY = 'neonraid.settings'
const DEFAULTS: Settings = { volume: 0.7, shake: true, unlockedLevel: 1, bestScore: 0 }

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const v = JSON.parse(raw) as Partial<Settings>
    return {
      volume: clamp(Number(v.volume ?? DEFAULTS.volume), 0, 1),
      shake: v.shake !== false,
      unlockedLevel: clamp(Math.round(Number(v.unlockedLevel ?? 1)), 1, 3),
      bestScore: Math.max(0, Math.round(Number(v.bestScore ?? 0))),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 隐私模式 */ }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
