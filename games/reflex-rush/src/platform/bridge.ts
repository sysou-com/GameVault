/**
 * 平台桥（02 文档 §4.1 消息契约；targetOrigin 恒为 location.origin）。
 * 本游戏为全平台第一个跑通方（06 文档 §3）。
 */

export interface ReadyPayload {
  version: string
  engine: string
  dpr: number
  webgpu?: boolean
}

export interface ScoreMeta {
  perfect: number
  streak: number
  avgDeviationMs: number
  expertMode: boolean
}

function post(msg: Record<string, unknown>): void {
  try {
    parent.postMessage(msg, location.origin)
  } catch {
    /* 独立运行（脱离平台）时静默 */
  }
}

/** 首帧渲染后调用（平台隐藏加载态） */
export function sendReady(p: ReadyPayload): void {
  post({ type: 'game:ready', ...p })
}

export function sendError(code: 'webgl-unavailable' | 'wasm-failed' | 'asset-404' | 'runtime', message: string): void {
  post({ type: 'game:error', code, message })
}

/** 结算提交（模式一优先：同源直连 /game/api/scores；M1 平台未开放，回落 postMessage 由平台展示） */
export async function sendScore(score: number, meta: ScoreMeta, token: string | null): Promise<void> {
  if (token) {
    try {
      const res = await fetch(location.href.startsWith('http') ? '/game/api/scores' : '/game/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          gameSlug: 'reflex-rush',
          score,
          meta,
          clientTs: Date.now(),
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      if (res.ok) return // 平台已受理，无需再 postMessage
    } catch {
      /* 网络失败 → 回落 postMessage */
    }
  }
  post({ type: 'game:score', score, meta, clientTs: Date.now() })
}

/** 遥测（M3 起平台消费 play_session） */
export function sendTrack(type: 'start' | 'end' | 'pv', durMs?: number): void {
  post({ type: 'game:track', type, ...(durMs !== undefined ? { durMs } : {}) })
}

/** 监听平台下行消息（init/restart/clearSave） */
export function onPlatform(message: string, cb: (data: Record<string, unknown>) => void): () => void {
  const handler = (e: MessageEvent) => {
    if (e.data && typeof e.data === 'object' && (e.data as { type?: string }).type === message) {
      cb(e.data as Record<string, unknown>)
    }
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
