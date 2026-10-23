<template>
  <div>
    <h1 class="page-title">全部游戏</h1>
    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="fatal" class="err">{{ fatal }}</p>
    <p v-else-if="games.length === 0" class="muted">
      还没有上架的游戏。M1 首发：极速反应（Reflex Rush）——通过管理台发布后出现在这里。
    </p>

    <div v-else class="grid">
      <router-link v-for="g in games" :key="g.slug" :to="`/g/${g.slug}`" class="card">
        <div class="cover">
          <img :src="g.coverUrl" :alt="g.title" loading="lazy" />
          <span class="badge engine cover-engine">{{ engineLabel(g.engine) }}</span>
        </div>
        <div class="card-body">
          <h2>{{ g.title }}</h2>
          <p v-if="g.subtitle" class="muted">{{ g.subtitle }}</p>
          <div class="tags">
            <span v-for="t in (g.tags ?? [])" :key="t" class="tag">{{ t }}</span>
            <span v-if="g.liveVersion" class="tag ver">v{{ g.liveVersion.version }}</span>
          </div>
          <div v-if="(g.topScores ?? []).length" class="tops">
            <div v-for="t in g.topScores!.slice(0, 3)" :key="t.rank" class="top-row">
              <span class="top-rank">{{ t.rank }}</span>
              <span class="top-name">{{ t.userName }}</span>
              <span class="top-score">{{ t.score }}</span>
            </div>
          </div>
        </div>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, ApiError } from '../api'
import type { GameCard } from '../types'

const games = ref<GameCard[]>([])
const loading = ref(true)
const fatal = ref('')

const ENGINE_LABELS: Record<string, string> = {
  'phaser-4': 'Phaser 4',
  threejs: 'Three.js',
  'godot-4.6': 'Godot 4.6',
  'canvas-native': '原生 Canvas',
}
function engineLabel(e: string) { return ENGINE_LABELS[e] ?? e }

onMounted(async () => {
  try {
    games.value = await api.games()
  } catch (e) {
    fatal.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.page-title { font-size: 24px; margin: 0 0 20px; }
.grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 18px;
}
.card {
  background: var(--bg-panel); border: 1px solid var(--line); border-radius: 12px;
  overflow: hidden; color: var(--text); display: flex; flex-direction: column;
}
.card:hover { border-color: var(--neon); text-decoration: none; }
.cover { position: relative; aspect-ratio: 16 / 9; background: var(--bg-panel-2); }
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-engine { position: absolute; left: 10px; top: 10px; }
.card-body { padding: 14px 16px 16px; }
.card-body h2 { margin: 0 0 4px; font-size: 17px; }
.card-body p { margin: 0 0 10px; font-size: 13px; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; }
.tag.ver { color: var(--neon); }
.tops { margin-top: 10px; display: flex; flex-direction: column; gap: 2px; }
.top-row { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.top-rank { color: var(--text-dim); width: 14px; }
.top-name { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.top-score { color: var(--neon); font-variant-numeric: tabular-nums; }
</style>
