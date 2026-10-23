<template>
  <div>
    <h1 class="page-title">管理台</h1>
    <p class="muted small">
      M1：上传 → Job 校验/落位 → 发布 → 上下架。M2 起接入中心 RBAC（权限点 gamevault:admin:*），
      当前仅日志记录操作者。
    </p>

    <!-- 上传与发布 -->
    <div class="panel upload">
      <h2>上传游戏包</h2>
      <div class="row">
        <input ref="fileRef" type="file" accept=".zip" @change="onPick" />
        <button class="btn primary" :disabled="uploading || !picked" @click="upload">
          {{ uploading ? '处理中…' : '上传并处理' }}
        </button>
        <button v-if="status && ['ready'].includes(status.versionStatus)" class="btn" @click="publish">
          发布 v{{ status.version }} 为 live
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
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { api, ApiError } from '../api'
import type { AdminPackageStatus, GameAdminRow, UploadResult } from '../types'

const fileRef = ref<HTMLInputElement | null>(null)
const picked = ref<File | null>(null)
const uploading = ref(false)
const status = ref<AdminPackageStatus | null>(null)
const uploadErr = ref('')
const publishMsg = ref('')
let uploadResult: UploadResult | null = null
let pollTimer: number | undefined

const games = ref<GameAdminRow[]>([])
const gamesLoading = ref(true)

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
  try {
    const r = await api.adminPublish(uploadResult.versionId)
    publishMsg.value = `已发布 v${r.version} → ${r.entryUrl}`
    await poll()
    await refreshGames()
  } catch (e) {
    uploadErr.value = e instanceof ApiError ? `${e.code}: ${e.message}` : '发布失败'
  }
}

async function refreshGames() {
  try { games.value = await api.adminGames() } catch { /* 轮询失败静默 */ }
  finally { gamesLoading.value = false }
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
