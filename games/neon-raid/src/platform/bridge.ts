/**
 * 平台桥（02 文档 §4.1 消息契约；targetOrigin 恒为 location.origin）。
 * 模式一（同源直连）为主：fetch /game/api/scores 带 localStorage['gamevault.session'] 的裸 JWT（§4.3）；
 * 失败回落 postMessage game:score 由平台展示。
 */
import type { ScoreMeta } from './types.ts'

export interface PlatformUser {
  id?: string
  name?: string
  anonymous?: boolean
}

let platformUser: PlatformUser | null = null
export function getPlatformUser(): PlatformUser | null {
  return platformUser
}

function post(msg: Record<string, unknown>): void {
  try {
    parent.postMessage(msg, location.origin)
  } catch {
    /* 独立运行（脱离平台）时静默 */
  }
}

export function sendReady(p: { version: string; engine: string; dpr: number }): void {
  post({ type: 'game:ready', ...p })
}

export function sendError(code: 'webgl-unavailable' | 'wasm-failed' | 'asset-404' | 'runtime', message: string): void {
  post({ type: 'game:error', code, message })
}

/** 登录态 token（02 §4.3：localStorage 裸 JWT，平台写入前已校验未被污染） */
export function getJwt(): string | null {
  try {
    const v = localStorage.getItem('gamevault.session')
    return typeof v === 'string' && v.length > 40 ? v : null
  } catch {
    return null
  }
}

/**
 * 结算提交（模式一：同源直连；idempotencyKey 幂等，重提不重复计数）。
 * @returns 'ok' 平台已受理 | 'no-auth' 无 token | 'fail' 网络/平台错误
 */
export async function submitScore(score: number, meta: ScoreMeta): Promise<'ok' | 'no-auth' | 'fail'> {
  const token = getJwt()
  if (!token) return 'no-auth'
  try {
    const res = await fetch('/game/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        gameSlug: 'neon-raid',
        score,
        meta,
        clientTs: Date.now(),
        idempotencyKey: crypto.randomUUID(),
      }),
    })
    if (res.ok) return 'ok'
    return 'fail'
  } catch {
    /* 脱离平台运行 / 网络失败 → 回落 postMessage */
    post({ type: 'game:score', score, meta, clientTs: Date.now() })
    return 'fail'
  }
}

export function sendTrack(type: 'start' | 'end' | 'pv', durMs?: number): void {
  post({ type: 'game:track', ...(type !== 'pv' ? {} : {}), kind: type, ...(durMs !== undefined ? { durMs } : {}) })
}

/** 监听平台下行（platform:init 携带登录态；platform:restart） */
export function initBridge(handlers: {
  onInit?: (u: PlatformUser) => void
  onRestart?: () => void
}): void {
  const handler = (e: MessageEvent): void => {
    if (!e.data || typeof e.data !== 'object') return
    const d = e.data as { type?: string; user?: PlatformUser }
    if (d.type === 'platform:init' && d.user) {
      platformUser = d.user
      handlers.onInit?.(d.user)
    } else if (d.type === 'platform:restart') {
      handlers.onRestart?.()
    }
  }
  window.addEventListener('message', handler)
}
