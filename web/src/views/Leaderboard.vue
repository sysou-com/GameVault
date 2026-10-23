<template>
  <div>
    <div class="head">
      <router-link to="/" class="muted">← 全部游戏</router-link>
      <h1 class="title">{{ detail ? detail.title : props.slug }} · 排行榜</h1>
      <div class="tabs">
        <button class="btn tab" :class="{ active: scope === 'all' }" @click="switchScope('all')">全服</button>
        <button class="btn tab" :class="{ active: scope === 'week' }" @click="switchScope('week')">本周</button>
      </div>
    </div>

    <p v-if="fatal" class="err">{{ fatal }}</p>
    <p v-else-if="loading" class="muted">加载中…</p>
    <template v-else>
      <div v-if="!me" class="panel login-prompt">
        <p>登录即可提交分数参与排名（游客可以随便玩）。</p>
        <p class="muted small">进入试玩后结算页会提示登录；登录入口在页面右上角。</p>
      </div>
      <div v-if="me" class="panel my-rank">
        <template v-if="board.myRank">
          我的名次：<b>第 {{ board.myRank }} 名</b>（{{ board.myScore }} 分）
        </template>
        <template v-else>尚未上榜——打开游戏打一局即可提交。</template>
      </div>

      <div class="panel">
        <table v-if="board.entries.length">
          <thead>
            <tr><th>#</th><th>玩家</th><th>分数</th><th>更新时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in board.entries" :key="t.rank" :class="{ 'row-me': me && t.userId === me.id }">
              <td class="rank">{{ medal(t.rank) }}</td>
              <td class="name" :title="t.userName">{{ t.userName }}<span v-if="me && t.userId === me.id" class="you">（我）</span></td>
              <td class="score">{{ t.score }}</td>
              <td class="muted small">{{ fmtTime(t.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">暂无分数——全服第一个吃螃蟹的就是你。</p>
      </div>
    </template>

    <router-link :to="`/g/${props.slug}`" class="muted back">← 返回游戏页</router-link>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, ApiError } from '../api'
import type { BoardView, GameDetail } from '../types'
import { user as me, restoreSession } from '../session'

const props = defineProps<{ slug: string }>()

const detail = ref<GameDetail | null>(null)
const board = ref<BoardView>({ entries: [], myRank: null, myScore: null })
const scope = ref<'all' | 'week'>('all')
const loading = ref(true)
const fatal = ref('')

function medal(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return String(rank)
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function loadBoard() {
  board.value = await api.leaderboard(props.slug, scope.value)
}

async function switchScope(s: 'all' | 'week') {
  if (scope.value === s) return
  scope.value = s
  await loadBoard()
}

onMounted(async () => {
  await restoreSession()
  try {
    detail.value = await api.game(props.slug)
    await loadBoard()
  } catch (e) {
    fatal.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '加载失败'
  } finally {
    loading.value = false
  }
})

// 登录后返回本页面（或弹窗登录）→ myRank 刷新
watch(me, () => {
  if (!loading.value && !fatal.value) void loadBoard()
})
</script>

<style scoped>
.head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.title { margin: 0; font-size: 24px; }
.tabs { display: flex; gap: 8px; margin-left: auto; }
.tab { border-radius: 8px; }
.tab.active { border-color: var(--neon); color: var(--neon); }
.rank { width: 44px; }
.name { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.score { color: var(--neon); font-variant-numeric: tabular-nums; }
.you { color: var(--neon); font-size: 12px; }
tr.row-me td { background: rgba(34, 211, 238, 0.07); }
.login-prompt { margin-bottom: 14px; }
.my-rank { margin-bottom: 14px; font-size: 14px; }
.back { display: inline-block; margin-top: 18px; font-size: 13px; }
</style>
