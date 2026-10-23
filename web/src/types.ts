/**
 * 与后端契约对齐（01 文档 §5；字段英文，文案中文）。
 */

export interface LiveVersion {
  version: string
  entryUrl: string
  sizeBytes: number
  sha256: string
}

export interface GameCard {
  slug: string
  title: string
  subtitle: string | null
  engine: string
  language: string
  coverUrl: string
  tags: string[] | null
  liveVersion: LiveVersion | null
  /** M2：Top3 分数（api 模块组合；空榜 = []） */
  topScores?: BoardEntry[]
}

export interface Build {
  platform: string
  type: string
  url: string
  sizeBytes: number
  sha256: string
}

export interface GameDetail {
  slug: string
  title: string
  subtitle: string | null
  engine: string
  language: string
  coverUrl: string
  description: string | null
  techNotesUrl: string | null
  /** JSON 字符串（N0 预留：screenshots/trailer/external_links，前端只透传不解析） */
  media: string
  tags: string[] | null
  liveVersion: LiveVersion
  builds: Build[]
  scores: unknown[]
  achievements: unknown[]
}

export interface Health {
  service: string
  ok: boolean
}

/** M2 登录态（GET /api/me；后端验签后返回）。 */
export interface Me {
  id: string
  email: string | null
  roles: string[]
  platformAdmin: boolean
}

/** 榜单条目（01 文档 §5.1）。 */
export interface BoardEntry {
  rank: number
  userId: string
  userName: string
  score: number
  meta: Record<string, unknown> | null
  updatedAt: string | null
}

export interface BoardView {
  entries: BoardEntry[]
  myRank: number | null
  myScore: number | null
}

/** 我的分数历史（GET /api/me/scores）。 */
export interface ScoreRow {
  id: number
  score: number
  meta: Record<string, unknown> | null
  clientTs: string
  submittedAt: string
  status: string
  rejectReason: string | null
}

/** 我的成就（GET /api/me/achievements）。 */
export interface GrantView {
  code: string
  title: string
  description: string
  iconUrl: string | null
  grantedAt: string
}

/** 提分响应（POST /api/scores；status: ok | flagged）。 */
export interface ScoreSubmitResponse {
  status: string
  rank: number | null
  score: number | null
  unlocked: string[]
  note: string | null
}

/** flagged 复核（管理台，01 §6.1.5）。 */
export interface FlaggedRow {
  id: number
  userId: string
  userName: string
  score: number
  meta: Record<string, unknown> | null
  submittedAt: string
  rejectReason: string | null
}

export interface AdminPackageStatus {
  packageId: string
  jobStatus: string
  versionStatus: string
  entryUrl: string | null
  report: string | null
  version: string | null
}

export interface GameAdminRow {
  id: number
  slug: string
  title: string
  status: string
  liveVersion: string | null
  versions: string[]
}

export interface PlaySession {
  playSessionId: string
}

export interface UploadResult {
  packageId: string
  jobId: string
  slug: string
  version: string
  versionId: number
}
