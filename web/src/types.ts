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
