<template>
  <div class="player">
    <div class="player-bar">
      <span class="muted">试玩窗口</span>
      <span v-if="state === 'timeout'" class="warn">加载超时</span>
      <span v-if="error" class="err">{{ error }}</span>
      <span v-if="scoreToast" class="ok">{{ scoreToast }}</span>
      <span class="spacer"></span>
      <button class="btn" @click="restart" :disabled="state !== 'ready'">重新开始</button>
      <button class="btn" @click="clearSave" :disabled="state !== 'ready'">清空存档</button>
    </div>

    <div class="stage">
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
        referrerpolicy="no-referrer-when-downgrade"
        @load="onLoad"
      ></iframe>
    </div>

    <div v-if="isTouch" class="touch-hint">
      触屏设备请横屏游玩，点击「重新开始」可再来一局。
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { PlatformUser } from '../sdk/platform'

/**
 * iframe 播放器（02 文档 §4.1/§4.2）：
 * - sandbox 给 allow-scripts/allow-same-origin/allow-pointer-lock/allow-autoplay/allow-popups-to-escape-sandbox，
 *   **不给 allow-top-navigation**（游戏不能劫持顶层页）。
 * - 监听 game:ready / game:error / game:score / game:track；20s 超时 UI。
 * - M1 游客态：game:score 以提示条反馈（服务端提交链 M2 开放）。
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
const ALLOW = 'pointer-lock; autoplay'

type State = 'loading' | 'ready' | 'timeout' | 'error'
const frameRef = ref<HTMLIFrameElement | null>(null)
const state = ref<State>('loading')
const error = ref('')
const frameSrc = ref('')
const scoreToast = ref('')

const isTouch = typeof window !== 'undefined' && 'ontouchstart' in window
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
      // M1：无登录/无 /api/scores（M2 开放），先给本地反馈；M2 起走同源直连或 postMessage 代理
      const s = Number(m.score)
      scoreToast.value = `本局 ${s} 分（提交排行榜 M2 开放，本机已记）`
      window.setTimeout(() => { scoreToast.value = '' }, 6000)
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

onMounted(() => {
  window.addEventListener('message', onMessage)
  startLoading()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
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
.player-bar { display: flex; align-items: center; gap: 10px; font-size: 13px; }
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
</style>
