<template>
  <div class="player">
    <div class="player-bar">
      <span class="muted bar-label">试玩窗口</span>
      <span v-if="state === 'timeout'" class="warn">加载超时</span>
      <span v-if="error" class="err">{{ error }}</span>
      <span v-if="scoreToast" class="ok">{{ scoreToast }}</span>
      <span class="spacer"></span>
      <button class="btn" @click="restart" :disabled="state !== 'ready'">重新开始</button>
      <button class="btn" @click="clearSave" :disabled="state !== 'ready'">清空存档</button>
      <button class="btn fs-btn" @click="toggleFs" :disabled="state !== 'ready'" title="全屏试玩" aria-label="全屏">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
        <span class="fs-label">全屏</span>
      </button>
    </div>

    <div ref="stageRef" class="stage">
      <div v-if="state === 'loading'" class="overlay">
        <div class="spinner"></div>
        <p>游戏加载中（约 {{ (sizeBytes / 1024 / 1024).toFixed(1) }} MB）…</p>
        <p class="muted small">20 秒未就绪会提示重试；网络不佳时可稍后再来。</p>
      </div>
      <div v-else-if="state === 'timeout'" class="overlay">
        <p class="warn">加载超时</p>
        <p class="muted">可能是网络较慢或浏览器不支持（需现代 Chrome/Edge/Firefox/Safari）。</p>
        <button class="btn primary" @click="retry">重试</button>
      </div>
      <div v-else-if="state === 'error'" class="overlay">
        <p class="err">游戏启动失败</p>
        <p class="muted">{{ error }}</p>
        <button class="btn primary" @click="retry">重试</button>
      </div>
      <iframe
        ref="frameRef"
        v-show="state === 'ready'"
        class="game-frame"
        :src="frameSrc"
        :sandbox="SANDBOX"
        :allow="ALLOW"
        allowfullscreen
        :referrerpolicy="no-referrer-when-downgrade"
        @load="onLoad"
      ></iframe>

      <!-- 全屏态浮层控件：退出按钮 + 竖屏横屏提示（触屏） -->
      <button v-if="isFs" class="fs-exit" @click="toggleFs" aria-label="退出全屏">✕</button>
      <div v-if="isFs && isTouch && isPortrait" class="fs-rotate">📱 横屏体验更好</div>
    </div>

    <div v-if="isTouch" class="touch-hint">
      触屏设备请横屏游玩，点击「重新开始」可再来一局。
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { PlatformUser } from '../sdk/platform'
import { api, ApiError } from '../api'

/**
 * iframe 播放器（02 文档 §4.1/§4.2）：
 * - sandbox 给 allow-scripts/allow-same-origin/allow-pointer-lock/allow-autoplay/allow-popups-to-escape-sandbox，
 *   **不给 allow-top-navigation**（游戏不能劫持顶层页）。
 * - 监听 game:ready / game:error / game:score / game:track；20s 超时 UI。
 * - M2：game:score 走模式二代理（平台代发 POST /api/scores，带内存 token），
 *   成功回 platform:score-result 给游戏（02 §4.2 模式二；模式一由游戏同源直连自行 fetch）。
 */
const props = defineProps<{
  src: string
  slug: string
  sizeBytes: number
  user: PlatformUser
  playSessionId: string
}>()

// sandbox 合法 flag 不含 allow-autoplay（autoplay 走 allow 特性策略，HTML 规范）；不给 allow-top-navigation（游戏不能劫持顶层页）
const SANDBOX = 'allow-scripts allow-same-origin allow-pointer-lock allow-popups-to-escape-sandbox'
// 注意：pointer-lock 是 sandbox 特性（已在 SANDBOX），不是 Permissions-Policy 特性，放进 allow 会触发浏览器警告；本类游戏（触屏/键盘）也不需要指针锁定
const ALLOW = 'autoplay'

type State = 'loading' | 'ready' | 'timeout' | 'error'
const frameRef = ref<HTMLIFrameElement | null>(null)
const state = ref<State>('loading')
const error = ref('')
const frameSrc = ref('')
const scoreToast = ref('')

const isTouch = typeof window !== 'undefined' && 'ontouchstart' in window
const isPortrait = ref(typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches)
const isFs = ref(false)
const TIMEOUT_MS = 20_000
let timer: number | undefined
const startTs = { v: Date.now() }
const ui = reactive({ inited: false })

function post(msg: string, payload?: unknown) {
  const w = frameRef.value?.contentWindow
  if (w) w.postMessage(JSON.parse(JSON.stringify({ type: msg, ...(payload ?? {}) })), location.origin)
}

function clearTimer() { if (timer !== undefined) { clearTimeout(timer); timer = undefined } }

function startLoading() {
  clearTimer()
  state.value = 'loading'
  error.value = ''
  // 用 query 破缓存 + 强制重载
  frameSrc.value = props.src + (props.src.includes('?') ? '&' : '?') + '_t=' + Date.now()
  timer = window.setTimeout(() => {
    if (state.value === 'loading') state.value = 'timeout'
  }, TIMEOUT_MS)
}

function onLoad() {
  // iframe 文档就绪：发送 platform:init（游戏据此决定登录引导）
  if (!ui.inited) {
    ui.inited = true
    post('platform:init', { user: props.user, session: { playSessionId: props.playSessionId, ts: Date.now() } })
  }
}

function onMessage(e: MessageEvent) {
  // 规则①：只认平台 iframe 自己发的（02 文档 §4.1）
  if (frameRef.value && e.source !== frameRef.value.contentWindow) return
  let m: { type: string } & Record<string, any>
  if (typeof e.data === 'string') {
    try { m = JSON.parse(e.data) } catch { return }
  } else {
    m = e.data as any
  }
  if (!m || typeof m.type !== 'string') return

  switch (m.type) {
    case 'game:ready':
      clearTimer()
      state.value = 'ready'
      break
    case 'game:error':
      clearTimer()
      state.value = 'error'
      error.value = m.message ?? m.code ?? '未知错误'
      break
    case 'game:score': {
      // M2：模式二代理——平台代发提分（游戏侧模式一同源直连优先，这里是回落路径）
      void submitScore(m)
      break
    }
    case 'game:track':
      // M3 起进 play_session/遥测；M1 仅调试可见
      console.debug('[telemetry]', m)
      break
  }
}

function retry() { startLoading() }
function restart() { post('platform:restart') }
function clearSave() { post('platform:clearSave') }

// ---------- 全屏（纯前端能力；iOS 16+ / Android / 桌面均支持容器级 requestFullscreen） ----------
const stageRef = ref<HTMLDivElement | null>(null)
let portraitMq: MediaQueryList | undefined
const onPortraitChange = (e: MediaQueryListEvent) => { isPortrait.value = e.matches }

async function toggleFs() {
  const el = stageRef.value
  if (!el) return
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else if (el.requestFullscreen) {
      // navigationUI: 'hide' —— 全屏时隐藏移动端浏览器地址栏，把屏幕让给游戏（不支持的浏览器忽略该参数）
      await el.requestFullscreen({ navigationUI: 'hide' } as Parameters<typeof el.requestFullscreen>[0])
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen()
    } else {
      toast('当前浏览器不支持全屏')
    }
  } catch { /* 手势被拒/嵌套全屏等：静默 */ }
}

function onFsChange() {
  isFs.value = !!document.fullscreenElement
  if (isFs.value && isTouch) {
    // 触屏全屏尝试锁定横屏（仅 Android 支持；不支持则静默降级——游戏 FIT 缩放横竖屏均可玩）
    void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {})
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  portraitMq = window.matchMedia('(orientation: portrait)')
  isPortrait.value = portraitMq.matches
  portraitMq.addEventListener('change', onPortraitChange)
  startLoading()
})

/**
 * 模式二提分（02 文档 §4.2）：平台拿内存 token 代发 POST /api/scores，
 * 结果回 platform:score-result（游戏据此展示排名/解锁；同源模式游戏自己 fetch，不走这里）。
 */
async function submitScore(m: Record<string, any>) {
  const score = Number(m.score)
  if (!Number.isFinite(score)) {
    toast('分数格式不正确')
    return
  }
  try {
    const r = await api.submitScore({
      gameSlug: props.slug,
      score,
      meta: (m.meta ?? {}) as Record<string, unknown>,
      clientTs: Number(m.clientTs) || Date.now(),
      idempotencyKey: typeof m.idempotencyKey === 'string' ? m.idempotencyKey : crypto.randomUUID(),
      playSessionId: props.playSessionId || undefined,
    })
    if (r.status === 'flagged') {
      toast(`${score} 分已提交，异常待复核（暂不上榜）`)
    } else {
      toast(r.rank != null ? `本局 ${score} 分 · 全服第 ${r.rank} 名` : `本局 ${score} 分已提交`)
    }
    if (r.unlocked && r.unlocked.length) {
      window.setTimeout(() => toast(`🏆 解锁成就 ${r.unlocked!.length} 个`), 600)
    }
    post('platform:score-result', { ok: true, status: r.status, rank: r.rank, unlocked: r.unlocked, note: r.note })
  } catch (e) {
    const msg = e instanceof ApiError ? `${e.code}: ${e.message}` : '提交失败'
    toast(`本局 ${score} 分（提交失败：${msg}）`)
    post('platform:score-result', { ok: false, error: msg })
  }
}

function toast(msg: string) {
  scoreToast.value = msg
  window.setTimeout(() => { scoreToast.value = '' }, 6000)
}

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('webkitfullscreenchange', onFsChange)
  portraitMq?.removeEventListener('change', onPortraitChange)
  clearTimer()
  // 试玩会话结束（M1 最小：时长 + 是否完成=已 ready）
  const durMs = Date.now() - startTs.v
  if (props.playSessionId && durMs > 0) {
    fetch(import.meta.env.BASE_URL + 'api/play/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playSessionId: props.playSessionId, durMs }),
    }).catch(() => { /* 静默：遥测不影响玩家 */ })
  }
})
</script>

<style scoped>
.player { display: flex; flex-direction: column; gap: 10px; }
.player-bar { display: flex; align-items: center; gap: 10px; font-size: 13px; flex-wrap: wrap; }
.spacer { flex: 1; }
.stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}
/* 全屏态：容器占满视口（16:9 游戏由 Phaser FIT 自适配，竖屏自动上下留黑边） */
.stage:fullscreen, .stage:-webkit-full-screen {
  width: 100vw; height: 100vh; aspect-ratio: auto;
  border: 0; border-radius: 0;
}
.fs-btn { display: inline-flex; align-items: center; gap: 6px; }
.fs-exit {
  position: absolute; top: 10px; right: 10px; z-index: 5;
  width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line);
  background: rgba(17, 22, 36, 0.85); color: var(--text); font-size: 15px; cursor: pointer;
}
.fs-exit:hover { border-color: var(--neon); color: var(--neon); }
.fs-rotate {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 5;
  font-size: 13px; color: var(--text); background: rgba(17, 22, 36, 0.85);
  border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; white-space: nowrap;
  animation: rotate-hint 2.4s ease-in-out infinite;
}
@keyframes rotate-hint {
  0%, 100% { transform: translateX(-50%) rotate(0deg); }
  50% { transform: translateX(-50%) rotate(90deg); }
}
.game-frame { width: 100%; height: 100%; border: 0; display: block; touch-action: manipulation; }
.overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 20px;
}
.spinner {
  width: 28px; height: 28px; border-radius: 50%;
  border: 3px solid var(--line); border-top-color: var(--neon);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg) } }
.small { font-size: 12px; }
.touch-hint {
  font-size: 12px; color: var(--text-dim);
  background: var(--bg-panel); border: 1px solid var(--line);
  border-radius: 8px; padding: 8px 12px; text-align: center;
}
@media (max-width: 760px) {
  .bar-label { display: none; }        /* 腾出空间给按钮 */
  .player-bar { gap: 8px; }
  .player-bar .btn { padding: 6px 10px; font-size: 12px; }
  .stage { border-radius: 10px; }      /* 手机上稍微紧凑 */
}
</style>
