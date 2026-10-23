<template>
  <div v-if="detail">
    <div class="head">
      <router-link :to="`/`" class="muted">← 全部游戏</router-link>
      <h1 class="title">{{ detail.title }}</h1>
      <div class="badges">
        <span class="badge engine">{{ engineLabel(detail.engine) }}</span>
        <span class="badge">{{ detail.language }}</span>
        <span class="badge">v{{ detail.liveVersion.version }}</span>
        <span v-for="t in (detail.tags ?? [])" :key="t" class="tag">{{ t }}</span>
      </div>
    </div>

    <div class="layout">
      <div class="main">
        <GameFrame
          :src="detail.liveVersion.entryUrl"
          :slug="detail.slug"
          :size-bytes="detail.liveVersion.sizeBytes"
          :user="user"
          :play-session-id="playSessionId"
        />
      </div>

      <aside class="side">
        <div class="panel">
          <h3>关于</h3>
          <p v-if="detail.subtitle" class="muted">{{ detail.subtitle }}</p>
          <p v-if="detail.description" class="desc">{{ detail.description }}</p>
          <a v-if="detail.techNotesUrl" :href="detail.techNotesUrl" target="_blank" rel="noopener">
            技术拆解 →
          </a>
        </div>
        <div class="panel">
          <h3>当前版本</h3>
          <p class="muted small">
            v{{ detail.liveVersion.version }} · {{ formatBytes(detail.liveVersion.sizeBytes) }}
            · sha256 {{ (detail.liveVersion.sha256 ?? '').slice(0, 12) }}…
          </p>
          <p v-if="detail.builds.length" class="muted small">
            构建：{{ detail.builds.map(b => `${b.platform}(${b.type})`).join('、') }}
          </p>
        </div>
        <div class="panel">
          <h3>排行榜</h3>
          <p class="muted small">M2 开放（登录提交分数 / 全服周榜）。</p>
        </div>
      </aside>
    </div>
  </div>
  <p v-else-if="fatal" class="err">{{ fatal }}</p>
  <p v-else class="muted">加载中…</p>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, ApiError } from '../api'
import type { GameDetail } from '../types'
import { currentPlatformUser, type PlatformUser } from '../sdk/platform'
import GameFrame from '../components/GameFrame.vue'

const props = defineProps<{ slug: string }>()

const detail = ref<GameDetail | null>(null)
const fatal = ref('')
const user = ref<PlatformUser>(currentPlatformUser())
const playSessionId = ref('')

const ENGINE_LABELS: Record<string, string> = {
  'phaser-4': 'Phaser 4',
  threejs: 'Three.js',
  'godot-4.6': 'Godot 4.6',
  'canvas-native': '原生 Canvas',
}
function engineLabel(e: string) { return ENGINE_LABELS[e] ?? e }
function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

onMounted(async () => {
  try {
    detail.value = await api.game(props.slug)
    const s = await api.playStart(props.slug)
    playSessionId.value = s.playSessionId
  } catch (e) {
    fatal.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '加载失败'
  }
})
</script>

<style scoped>
.head { margin-bottom: 18px; }
.head .title { margin: 6px 0 8px; font-size: 26px; }
.badges { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.layout { display: grid; grid-template-columns: 1fr 300px; gap: 18px; }
.side { display: flex; flex-direction: column; gap: 14px; }
.side h3 { margin: 0 0 8px; font-size: 14px; color: var(--text-dim); }
.desc { white-space: pre-wrap; font-size: 14px; margin: 8px 0; }
.small { font-size: 12px; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
}
</style>
