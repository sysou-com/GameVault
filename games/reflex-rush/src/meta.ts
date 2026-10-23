/** 难度进阶（06 文档 §1.1：连续 3 局 PERFECT 率 ≥60% 解锁专家节奏；localStorage 前缀隔离）。 */
export interface Meta {
  /** 最近连续达成「PERFECT 率 ≥60%」的局数 */
  streakWins: number
  expertUnlocked: boolean
  bestScore: number
  bestStreak: number
}

const PREFIX = 'reflexrush.'
const KEY = PREFIX + 'meta'

const DEFAULT: Meta = { streakWins: 0, expertUnlocked: false, bestScore: 0, bestStreak: 0 }

export function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT }
    const m = JSON.parse(raw) as Partial<Meta>
    return {
      streakWins: Number(m.streakWins) || 0,
      expertUnlocked: Boolean(m.expertUnlocked),
      bestScore: Number(m.bestScore) || 0,
      bestStreak: Number(m.bestStreak) || 0,
    }
  } catch {
    return { ...DEFAULT }
  }
}

/** 局后结算 meta 进度；返回是否新解锁专家模式。 */
export function recordGame(m: Meta, perfectRate: number, score: number, maxStreak: number): { meta: Meta; newlyUnlocked: boolean } {
  const next: Meta = {
    streakWins: perfectRate >= 0.6 ? m.streakWins + 1 : 0,
    expertUnlocked: m.expertUnlocked,
    bestScore: Math.max(m.bestScore, score),
    bestStreak: Math.max(m.bestStreak, maxStreak),
  }
  const newlyUnlocked = !m.expertUnlocked && next.streakWins >= 3
  if (newlyUnlocked) next.expertUnlocked = true
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 存储不可用（隐私模式）：内存态继续 */
  }
  return { meta: next, newlyUnlocked }
}

/** 平台「清空存档」（platform:clearSave）：清本游戏前缀。 */
export function clearSaves(): number {
  let n = 0
  try {
    const drop: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) drop.push(k)
    }
    drop.forEach(k => {
      localStorage.removeItem(k)
      n++
    })
  } catch {
    /* 忽略 */
  }
  return n
}
