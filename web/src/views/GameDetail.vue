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
          :user="frameUser"
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
          <div v-if="boardLoading" class="muted small">加载中…</div>
          <template v-else>
            <div v-if="board.entries.length === 0" class="muted small">
              <template v-if="me">暂无分数——打完一局提交即上全服榜。</template>
              <template v-else>暂无分数。登录后提交即上全服榜。</template>
            </div>
            <div v-else class="board-mini">
              <div v-for="t in board.entries.slice(0, 5)" :key="t.rank" class="board-row" :class="{ me: me && t.userId === me.id }">
                <span class="rank">{{ t.rank }}</span>
                <span class="name" :title="t.userName">{{ t.userName }}</span>
                <span class="score">{{ t.score }}</span>
              </div>
            </div>
            <div v-if="me && board.myRank" class="muted small my-rank">我的名次：第 {{ board.myRank }} 名（{{ board.myScore }} 分）</div>
            <div v-if="me && board.myRank == null" class="muted small my-rank">尚未上榜——玩一局试试</div>
            <router-link :to="`/g/${props.slug}/board`" class="board-more">查看完整榜单（全服/周）→</router-link>
          </template>
        </div>
        <div class="panel">
          <h3>成就</h3>
          <div v-if="(detail.achievements ?? []).length === 0" class="muted small">本游戏暂无成就定义。</div>
          <div v-else class="ach-list">
            <div v-for="a in detail.achievements as unknown as AchievementDef[]" :key="a.code" class="ach-row" :class="{ unlocked: isUnlocked(a.code) }">
              <span class="ach-title">{{ isUnlocked(a.code) ? '✓ ' : '🔒 ' }}{{ a.title }}</span>
              <span class="muted small">{{ a.description }}</span>
            </div>
          </div>
        </div>
        <div v-if="me" class="panel">
          <h3>我的分数</h3>
          <div v-if="myScores.length === 0" class="muted small">暂无提交记录。</div>
          <div v-else class="score-list">
            <div v-for="s in myScores.slice(0, 5)" :key="s.id" class="score-row">
              <span class="score">{{ s.score }}</span>
              <span class="muted small">{{ fmtTime(s.submittedAt) }}</span>
              <span v-if="s.status === 'flagged'" class="warn small">待复核</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
  <p v-else-if="fatal" class="err">{{ fatal }}</p>
  <p v-else class="muted">加载中…</p>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, ApiError } from '../api'
import type { BoardView, GameDetail, GrantView, ScoreRow } from '../types'
import { user as me, restoreSession } from '../session'
import { platformUser, type PlatformUser } from '../sdk/platform'
import GameFrame from '../components/GameFrame.vue'

/** 成就定义（后端 CatalogApi.GameDetail.achievements 实际元素类型） */
interface AchievementDef {
  id: number
  code: string
  title: string
  description: string
  rule: Record<string, unknown> | null
  iconUrl: string | null
}

const props = defineProps<{ slug: string }>()

const detail = ref<GameDetail | null>(null)
const fatal = ref('')
const playSessionId = ref('')
const frameUser = ref<PlatformUser>({ anonymous: true })
const board = ref<BoardView>({ entries: [], myRank: null, myScore: null })
const boardLoading = ref(true)
const myScores = ref<ScoreRow[]>([])
const myGrants = ref<GrantView[]>([])

function isUnlocked(code: string): boolean {
  return myGrants.value.some(g => g.code === code)
}
function fmtTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

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
  await restoreSession()
  frameUser.value = await platformUser()
  try {
    detail.value = await api.game(props.slug)
    const s = await api.playStart(props.slug)
    playSessionId.value = s.playSessionId
    await refreshBoardAndMine()
  } catch (e) {
    fatal.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '加载失败'
  } finally {
    boardLoading.value = false
  }
})

/** 登录态变化（App.vue 弹窗登录/退出）→ 重拉榜单（myRank）与我的数据 + 刷新 iframe 用户态。 */
watch(me, async () => {
  frameUser.value = await platformUser()
  if (!detail.value) return
  await refreshBoardAndMine()
})

async function refreshBoardAndMine() {
  try {
    board.value = await api.leaderboard(props.slug, 'all')
    if (me.value) {
      const [sc, gr] = await Promise.all([
        api.myScores(props.slug).catch(() => [] as ScoreRow[]),
        api.myAchievements(props.slug).catch(() => [] as GrantView[]),
      ])
      myScores.value = sc
      myGrants.value = gr
    } else {
      myScores.value = []
      myGrants.value = []
    }
  } catch {
    /* 榜单/我的数据加载失败不阻断试玩 */
  }
}
</script>

<style scoped>
.head { margin-bottom: 18px; }
.head .title { margin: 6px 0 8px; font-size: 26px; }
.badges { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.layout { display: grid; grid-template-columns: 1fr 300px; gap: 18px; }
.side { display: flex; flex-direction: column; gap: 14px; }
.side h3 { margin: 0 0 8px; font-size: 14px; color: var(--text-dim); }
.desc { white-space: pre-wrap; font-size: 14px; margin: 8px 0; }
.board-mini { display: flex; flex-direction: column; gap: 3px; }
.board-row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
.board-row.me .name { color: var(--neon); }
.board-row .rank { width: 16px; color: var(--text-dim); }
.board-row .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-row .score { color: var(--neon); font-variant-numeric: tabular-nums; }
.my-rank { margin-top: 8px; }
.board-more { display: inline-block; margin-top: 8px; font-size: 12px; }
.ach-list, .score-list { display: flex; flex-direction: column; gap: 6px; }
.ach-row { display: flex; flex-direction: column; font-size: 13px; }
.ach-row.unlocked .ach-title { color: var(--ok); }
.ach-title { font-size: 13px; }
.score-row { display: flex; align-items: baseline; gap: 10px; }
.score-row .score { color: var(--neon); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.small { font-size: 12px; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
}
</style>
