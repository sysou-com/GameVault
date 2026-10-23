<template>
  <div>
    <h1 class="page-title">管理台</h1>
    <p v-if="!me" class="warn banner">
      未登录：M2 起管理端点需中心登录态（生产 enforce-auth 已开启，匿名请求 401）；
      权限点级 RBAC（gamevault:admin:*）待中心注册后细校。页面右上角登录。
    </p>
    <p class="muted small">
      M2：上传 → Job 校验/落位 → （needsReview 人工确认闸门）→ 发布（探针失败自动回滚）→ 上下架；
      flagged 分数人工复核。操作者：{{ me ? (me.email ?? me.id) : '（匿名——生产将 401）' }}
    </p>

    <!-- 上传与发布 -->
    <div class="panel upload">
      <h2>上传游戏包</h2>
      <div class="row">
        <input ref="fileRef" type="file" accept=".zip" @change="onPick" />
        <button class="btn primary" :disabled="uploading || !picked" @click="upload">
          {{ uploading ? '处理中…' : '上传并处理' }}
        </button>
        <button v-if="status && ['ready'].includes(status.versionStatus)"
                class="btn primary" :disabled="reviewState() === 'pending' || publishing"
                @click="publish">
          {{ publishing ? '发布中…' : `发布 v${status.version ?? ''} 为 live` }}
        </button>
        <button v-if="status && reviewState() === 'pending'" class="btn" @click="confirmReview">
          确认审查项（解除发布闸门）
        </button>
      </div>

      <div v-if="status" class="status">
        <p>
          包 <code>{{ status.packageId }}</code> · slug
          <code>{{ slugOf }}</code> v{{ status.version }}
        </p>
        <p>
          <span :class="jobCls">Job: {{ status.jobStatus }}</span>
          <span class="sep">/</span>
          <span :class="verCls">版本: {{ status.versionStatus }}</span>
        </p>
        <pre v-if="reportText" class="report">{{ reportText }}</pre>
        <p v-if="reviewState() === 'pending'" class="warn small">⚠ 校验报告存在待人工审查项（上方 review: 行），确认后才可以发布。</p>
        <p v-if="publishMsg" class="ok small">{{ publishMsg }}</p>
      </div>
      <p v-if="uploadErr" class="err">{{ uploadErr }}</p>
    </div>

    <!-- 游戏管理 -->
    <div class="panel">
      <h2>游戏列表（全状态）</h2>
      <p v-if="gamesLoading" class="muted">加载中…</p>
      <table v-else-if="games.length">
        <thead>
          <tr><th>slug</th><th>标题</th><th>状态</th><th>live 版本</th><th>全部版本</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="g in games" :key="g.id">
            <td><code>{{ g.slug }}</code></td>
            <td>{{ g.title }}</td>
            <td><span class="badge">{{ g.status }}</span></td>
            <td>{{ g.liveVersion ?? '—' }}</td>
            <td class="muted small">{{ (g.versions ?? []).join(', ') || '—' }}</td>
            <td class="ops">
              <button v-if="g.status !== 'live'" class="btn small" @click="setStatus(g, 'enable')">上架</button>
              <button v-if="g.status === 'live'" class="btn small danger" @click="setStatus(g, 'disable')">下架</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无游戏记录。</p>
    </div>
    <!-- flagged 分数复核（01 §6.1.5：P99×5 异常分人工裁决；approve 补榜 / reject 维持榜外） -->
    <div class="panel">
      <h2>flagged 分数复核</h2>
      <div class="row">
        <select v-model="flaggedSlug" @change="loadFlagged">
          <option v-for="g in liveGames" :key="g.slug" :value="g.slug">{{ g.title }}（{{ g.slug }}）</option>
        </select>
        <button class="btn small" :disabled="!flaggedSlug" @click="loadFlagged">刷新</button>
      </div>
      <table v-if="flagged.length">
        <thead>
          <tr><th>#</th><th>玩家</th><th>分数</th><th>meta</th><th>提交时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="f in flagged" :key="f.id">
            <td>{{ f.id }}</td>
            <td :title="f.userId">{{ f.userName }}</td>
            <td class="score">{{ f.score }}</td>
            <td class="muted small">{{ metaText(f.meta) }}</td>
            <td class="muted small">{{ fmtTime(f.submittedAt) }}</td>
            <td class="ops">
              <button class="btn small primary" @click="resolveScore(f.id, true)">通过（补榜）</button>
              <button class="btn small danger" @click="resolveScore(f.id, false)">拒绝</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">{{ flaggedSlug ? '无待复核项。' : '选择游戏后查看。' }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, ApiError } from '../api'
import { user as me } from '../session'
import type { AdminPackageStatus, FlaggedRow, GameAdminRow, UploadResult } from '../types'

const fileRef = ref<HTMLInputElement | null>(null)
const picked = ref<File | null>(null)
const uploading = ref(false)
const status = ref<AdminPackageStatus | null>(null)
const uploadErr = ref('')
const publishMsg = ref('')
const publishing = ref(false)
let uploadResult: UploadResult | null = null
let pollTimer: number | undefined

const games = ref<GameAdminRow[]>([])
const gamesLoading = ref(true)
const liveGames = computed(() => games.value.filter(g => g.status === 'live'))

const flaggedSlug = ref('')
const flagged = ref<FlaggedRow[]>([])

/** Job/版本状态着色（模板 :class 绑定）。 */
const jobCls = computed(() => {
  const s = status.value?.jobStatus ?? ''
  if (s === 'done') return 'ok'
  if (s === 'dead' || s === 'failed') return 'err'
  return 'warn'
})
const verCls = computed(() => {
  const s = status.value?.versionStatus ?? ''
  if (s === 'ready' || s === 'live') return 'ok'
  if (s === 'failed') return 'err'
  return 'muted'
})

const slugOf = ref('')
const reportText = ref('')

function onPick() {
  picked.value = fileRef.value?.files?.[0] ?? null
  uploadErr.value = ''
  reportText.value = ''
}

function parseReport(raw: string | null): string {
  if (!raw) return ''
  try {
    const r = JSON.parse(raw)
    if (Array.isArray(r.report)) {
      return r.ok && r.report.length === 0
        ? '✓ 校验全部通过'
        : r.report.map((x: unknown) => String(x)).join('\n')
    }
    return raw
  } catch {
    return raw
  }
}

/** needsReview 闸门状态（02 §6：review 项未确认 → 禁发布）。 */
function reviewState(): 'none' | 'pending' | 'confirmed' {
  const raw = status.value?.report
  if (!raw) return 'none'
  try {
    const r = JSON.parse(raw)
    if (!r.needsReview) return 'none'
    return r.reviewConfirmedAt ? 'confirmed' : 'pending'
  } catch {
    return 'none'
  }
}

async function confirmReview() {
  if (!uploadResult) return
  try {
    await api.adminConfirmReview(uploadResult.versionId)
    await poll()
    publishMsg.value = '审查项已确认，可发布'
  } catch (e) {
    uploadErr.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '确认失败'
  }
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function metaText(meta: Record<string, unknown> | null): string {
  if (!meta || Object.keys(meta).length === 0) return '—'
  return Object.entries(meta).map(([k, v]) => `${k}=${String(v)}`).join(' ')
}

async function loadFlagged() {
  if (!flaggedSlug.value) return
  try {
    const r = await api.adminFlaggedScores(flaggedSlug.value)
    flagged.value = r.scores
  } catch (e) {
    uploadErr.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '复核队列加载失败'
  }
}

async function resolveScore(id: number, approve: boolean) {
  try {
    if (approve) await api.adminApproveScore(id)
    else await api.adminRejectScore(id)
    await loadFlagged()
  } catch (e) {
    alert(e instanceof ApiError ? `${e.code}: ${e.message}` : '裁决失败')
  }
}

async function upload() {
  if (!picked.value) return
  uploading.value = true
  uploadErr.value = ''
  publishMsg.value = ''
  status.value = null
  slugOf.value = ''
  try {
    uploadResult = await api.adminUpload(picked.value)
    slugOf.value = uploadResult.slug
    // Job 状态轮询（长动作后台化，前端不堵）
    pollTimer = window.setInterval(poll, 2000)
    await poll()
  } catch (e) {
    uploadErr.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '上传失败'
    uploading.value = false
  }
}

async function poll() {
  if (!uploadResult) return
  try {
    const st = await api.adminPackageStatus(uploadResult.packageId)
    status.value = st
    reportText.value = parseReport(st.report)
    if (['done', 'dead'].includes(st.jobStatus) || ['ready', 'failed'].includes(st.versionStatus)) {
      window.clearInterval(pollTimer)
      uploading.value = false
    }
  } catch (e) {
    uploadErr.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '状态轮询失败'
  }
}

async function publish() {
  if (!uploadResult) return
  publishing.value = true
  publishMsg.value = ''
  try {
    const r = await api.adminPublish(uploadResult.versionId)
    publishMsg.value = `已发布 v${r.version} → ${r.entryUrl}`
    await poll()
    await refreshGames()
  } catch (e) {
    uploadErr.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '发布失败'
    if (e instanceof ApiError && e.code === 'NEEDS_REVIEW_CONFIRM') {
      uploadErr.value += '（先点「确认审查项」）'
    }
  } finally {
    publishing.value = false
  }
}

async function refreshGames() {
  try { games.value = await api.adminGames() } catch { /* 轮询失败静默 */ }
  finally { gamesLoading.value = false }
  if (!flaggedSlug.value && liveGames.value.length) flaggedSlug.value = liveGames.value[0].slug
}

async function setStatus(g: GameAdminRow, action: 'enable' | 'disable') {
  try {
    if (action === 'enable') await api.adminEnable(g.slug)
    else await api.adminDisable(g.slug)
    await refreshGames()
  } catch (e) {
    alert(e instanceof ApiError ? `${e.code}: ${e.message}` : '操作失败')
  }
}

onMounted(() => {
  refreshGames()
})
onBeforeUnmount(() => {
  if (pollTimer !== undefined) window.clearInterval(pollTimer)
})
</script>

<style scoped>
.page-title { font-size: 24px; margin: 0 0 8px; }
.banner { background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.4); border-radius: 8px; padding: 8px 12px; font-size: 13px; }
.score { color: var(--neon); font-weight: 600; }
.upload { margin-bottom: 18px; }
.upload h2, .panel h2 { margin: 0 0 12px; font-size: 16px; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
input[type='file'] { color: var(--text-dim); font-size: 13px; }
.status { margin-top: 14px; }
.status .sep { margin: 0 8px; }
code { background: var(--bg-panel-2); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
pre.report {
  background: #0d1120; border: 1px solid var(--line); border-radius: 8px;
  padding: 10px; font-size: 12px; overflow-x: auto; margin: 10px 0 0;
  white-space: pre-wrap; word-break: break-all;
}
.ops { white-space: nowrap; }
.btn.small { padding: 3px 10px; font-size: 12px; }
</style>
