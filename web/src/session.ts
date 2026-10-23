/**
 * 登录态（M2，01 文档 §4/§7）：sysou-manage 中心 SSO。
 *
 * <p>会话键（同 origin 四家兄弟应用同形，裁定 #29/#30 模式）：
 * <ul>
 *   <li>{@code sysou.session}（共享）：{accessToken, refreshToken, appCode, savedAt} —— 中心登录写入，
 *       兄弟应用互读实现静默 SSO；</li>
 *   <li>{@code gamevault.session}（游戏可见）：裸 JWT —— 平台验证有效后发布给同源 iframe 游戏
 *       （02 文档 §4.3：写前校验未被污染，值必须与当前内存 token 一致才写）。</li>
 * </ul>
 * 前端不存密码、不做本地登录页；登录表单只调中心 /manage/api/auth/login（与兄弟前端同款）。
 * 生产同域 /manage/api；dev 可用 VITE_MANAGE_API_BASE 指向本地/隧道中心。
 */
import { ref } from 'vue'
import { api } from './api'
import type { Me } from './types'

export const SYSOU_SESSION_KEY = 'sysou.session'
export const GAME_SESSION_KEY = 'gamevault.session'

export interface SysouSession {
  accessToken: string
  refreshToken: string
  appCode: string
  savedAt: number
}

/** 模块级响应式登录态（App.vue 顶栏 / 各视图共用）。 */
export const user = ref<Me | null>(null)
export const restoring = ref(false)

let inMemoryToken: string | null = null

export function currentToken(): string | null {
  return inMemoryToken
}

export function isLogged(): boolean {
  return user.value != null
}

export function loadSharedSession(): SysouSession | null {
  try {
    const raw = localStorage.getItem(SYSOU_SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as SysouSession
    if (typeof s?.accessToken !== 'string' || typeof s.refreshToken !== 'string') return null
    return s
  } catch {
    return null
  }
}

export function saveSharedSession(accessToken: string, refreshToken: string, appCode = 'gamevault'): void {
  try {
    localStorage.setItem(SYSOU_SESSION_KEY, JSON.stringify({ accessToken, refreshToken, appCode, savedAt: Date.now() } satisfies SysouSession))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

export function clearSharedSession(): void {
  try {
    localStorage.removeItem(SYSOU_SESSION_KEY)
    localStorage.removeItem(GAME_SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 启动恢复：读共享会话 → /api/me 后端验签（不是前端自解析）→ 发布游戏可见 token。
 * 中心不可达/令牌过期 → 游客态（返回 false），不阻塞试玩（01 §7 游客策略）。
 */
export async function restoreSession(): Promise<boolean> {
  if (restoring.value) return isLogged()
  restoring.value = true
  try {
    const s = loadSharedSession()
    if (!s) return false
    inMemoryToken = s.accessToken
    try {
      user.value = await api.me()
    } catch {
      inMemoryToken = null
      user.value = null
      return false
    }
    publishSession(s.accessToken)
    return true
  } finally {
    restoring.value = false
  }
}

/**
 * 02 文档 §4.3：把中心 JWT 发布到游戏可见键（同源 iframe 可读）。
 * 防污染：仅当内存 token 有效，且现有值与之相同（或为空）时写入——
 * 游戏读到的值恒等于平台内存 token。
 */
export function publishSession(token: string): void {
  if (token !== inMemoryToken) return
  try {
    const existing = localStorage.getItem(GAME_SESSION_KEY)
    if (existing === null || existing === token) {
      localStorage.setItem(GAME_SESSION_KEY, token)
    }
  } catch {
    /* ignore */
  }
}

/** 登录（表单 → 中心 /manage/api/auth/login → 存共享会话 → 走 restore 验签）。 */
export async function login(email: string, password: string): Promise<void> {
  const manageBase: string = import.meta.env.VITE_MANAGE_API_BASE ?? '/manage/api'
  const res = await fetch(`${manageBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const text = await res.text()
  let body: { accessToken?: string; refreshToken?: string; error?: { code?: string; message?: string } } | null = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = null }
  }
  if (!res.ok || !body?.accessToken) {
    const e = body?.error ?? {}
    throw new Error(e.message ?? `登录失败（${res.status}）`)
  }
  saveSharedSession(body.accessToken, body.refreshToken ?? '')
  await restoreSession()
}

/** 登出：清本地两键 + 尽力通知中心（best-effort）。 */
export async function logout(): Promise<void> {
  const token = inMemoryToken
  inMemoryToken = null
  user.value = null
  clearSharedSession()
  if (token) {
    const manageBase: string = import.meta.env.VITE_MANAGE_API_BASE ?? '/manage/api'
    try {
      await fetch(`${manageBase}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      /* 中心不可达不影响本地登出 */
    }
  }
}
