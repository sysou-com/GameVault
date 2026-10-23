import type {
  AdminPackageStatus, BoardView, FlaggedRow, GameAdminRow, GameCard, GameDetail,
  GrantView, Health, Me, PlaySession, ScoreRow, ScoreSubmitResponse, UploadResult,
} from './types'
import { currentToken } from './session'

/**
 * API 封装：一律同源相对路径（vite base=/game/ ⇒ /game/api/...），不写死域名（红线）。
 * 生产由 nginx 剥 /game 前缀到 8094；dev 由 vite proxy 等价转发。
 * M2：已登录时自动附 Authorization（中心 JWT；01 文档 §5.2）。
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
  const token = currentToken()
  const res = await fetch(API + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

  // M2 榜单（§5.1；登录请求附 myRank）
  leaderboard: (slug: string, scope: 'all' | 'week') =>
    http<BoardView>(`/games/${encodeURIComponent(slug)}/leaderboard?scope=${scope}`),

  // M2 登录态（§5.2；AuthFilter 对 /api/scores 与 /api/me/** 硬 401）
  me: () => http<Me>('/me'),
  // M2 RBAC（中心 §4.6 裁定 #21）：应用侧权限快照 —— 浏览器必须走应用侧，不直调中心
  //（nginx 上 /manage/internal/ 一律 404）；前端据此控制管理台可见性，后端硬校在 AdminController。
  perm: () => http<{ pv: number; perms: string[]; pa: boolean }>('/me/perm'),
  submitScore: (body: {
    gameSlug: string
    score: number
    meta?: Record<string, unknown>
    clientTs?: number
    idempotencyKey?: string
    playSessionId?: string
  }) => http<ScoreSubmitResponse>('/scores', { method: 'POST', body: JSON.stringify(body) }),
  myScores: (gameSlug: string) =>
    http<ScoreRow[]>(`/me/scores?gameSlug=${encodeURIComponent(gameSlug)}`),
  myAchievements: (gameSlug: string) =>
    http<GrantView[]>(`/me/achievements?gameSlug=${encodeURIComponent(gameSlug)}`),

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

  // M2 管理：needsReview 闸门 + flagged 复核（02 §6 / 01 §6.1.5）
  adminConfirmReview: (versionId: number) =>
    http<{ ok: string; versionId: string }>(`/admin/versions/${versionId}/confirm-review`, { method: 'POST' }),
  adminFlaggedScores: (slug: string) =>
    http<{ scores: FlaggedRow[] }>(`/admin/scores/flagged?slug=${encodeURIComponent(slug)}`),
  adminApproveScore: (id: number) => http<{ ok: string }>(`/admin/scores/${id}/approve`, { method: 'POST' }),
  adminRejectScore: (id: number) => http<{ ok: string }>(`/admin/scores/${id}/reject`, { method: 'POST' }),
}
