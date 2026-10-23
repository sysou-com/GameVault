import type {
  AdminPackageStatus, GameAdminRow, GameCard, GameDetail,
  Health, PlaySession, UploadResult,
} from './types'

/**
 * API 封装：一律同源相对路径（vite base=/game/ ⇒ /game/api/...），不写死域名（红线）。
 * 生产由 nginx 剥 /game 前缀到 8094；dev 由 vite proxy 等价转发。
 */
const API = import.meta.env.BASE_URL + 'api' // → "/game/api"

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const text = await res.text()
  let body: any = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = { error: { code: 'BAD_JSON', message: '响应不是 JSON' } } }
  }
  if (!res.ok) {
    const e = body?.error ?? {}
    throw new ApiError(e.code ?? `HTTP_${res.status}`, e.message ?? `请求失败（${res.status}）`, res.status)
  }
  return body as T
}

export const api = {
  // 公开（§5.1）
  health: () => http<Health>('/health'),
  games: () => http<GameCard[]>('/games'),
  game: (slug: string) => http<GameDetail>(`/games/${encodeURIComponent(slug)}`),

  // 试玩会话（M1 最小）
  playStart: (gameSlug: string) =>
    http<PlaySession>('/play/start', { method: 'POST', body: JSON.stringify({ gameSlug }) }),
  playEnd: (playSessionId: string, durMs: number) =>
    http<{ ok: boolean }>('/play/end', { method: 'POST', body: JSON.stringify({ playSessionId, durMs }) }),

  // 管理（§5.3；M1 log-only 鉴权，M2 中心 RBAC）
  adminUpload: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(API + '/admin/packages', { method: 'POST', body: fd })
    const text = await res.text()
    let body: any = null
    if (text) {
      try { body = JSON.parse(text) } catch { /* ignore */ }
    }
    if (!res.ok) {
      const e = body?.error ?? {}
      throw new ApiError(e.code ?? `HTTP_${res.status}`, e.message ?? `上传失败（${res.status}）`, res.status)
    }
    return body as UploadResult
  },
  adminPackageStatus: (packageId: string) =>
    http<AdminPackageStatus>(`/admin/packages/${encodeURIComponent(packageId)}`),
  adminPublish: (versionId: number) =>
    http<{ ok: boolean; versionId: number; version: string; entryUrl: string }>(
      `/admin/versions/${versionId}/publish`, { method: 'POST' }),
  adminGames: () => http<{ games: GameAdminRow[] }>('/admin/games').then(r => r.games),
  adminEnable: (slug: string) => http<{ ok: string; slug: string }>(`/admin/games/${encodeURIComponent(slug)}/enable`, { method: 'POST' }),
  adminDisable: (slug: string) => http<{ ok: string; slug: string }>(`/admin/games/${encodeURIComponent(slug)}/disable`, { method: 'POST' }),
}
