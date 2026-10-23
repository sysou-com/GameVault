<template>
  <div class="shell">
    <header class="topbar">
      <div class="tb-left">
        <button
          v-if="isMobile"
          class="hamburger" :class="{ open: menuOpen }"
          :aria-label="menuOpen ? '关闭菜单' : '打开菜单'"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        ><span /><span /><span /></button>
        <router-link to="/" class="brand" @click="menuOpen = false">
          <span class="brand-dot"></span>GameVault<span class="brand-sub">游戏展示与试玩平台</span>
        </router-link>
      </div>
      <nav class="nav">
        <router-link to="/">全部游戏</router-link>
        <router-link v-if="me && adminOk" to="/admin">管理台</router-link>
        <template v-if="me">
          <span class="user-chip" :title="me.email ?? me.id">{{ me.email ?? me.id.slice(0, 8) }}</span>
          <button class="btn ghost small" @click="onLogout">退出</button>
        </template>
        <button v-else class="btn primary small" @click="showLogin = true">登录</button>
      </nav>

      <!-- 移动端菜单（点击展开；02 文档无涉，纯前端 UI；断点 ≤760px） -->
      <transition name="menu">
        <nav v-if="isMobile && menuOpen" class="mobile-menu" @click="menuOpen = false">
          <router-link to="/" class="mm-item">全部游戏</router-link>
          <router-link v-if="me && adminOk" to="/admin" class="mm-item">管理台</router-link>
          <div class="mm-divider"></div>
          <div v-if="me" class="mm-item mm-account">
            <span class="mm-user" :title="me.email ?? me.id">{{ me.email ?? me.id.slice(0, 10) }}</span>
            <button class="btn ghost small" @click.stop="onLogout">退出</button>
          </div>
          <div v-else class="mm-item mm-account">
            <span class="muted">未登录——登录后可提交分数上榜单</span>
            <button class="btn primary small" @click.stop="showLogin = true">登录</button>
          </div>
        </nav>
      </transition>
    </header>
    <div v-if="isMobile && menuOpen" class="menu-mask" @click="menuOpen = false"></div>
    <main class="content">
      <RouterView />
    </main>
    <footer class="footer">
      <span>GameVault · 零安装零登录即玩，登录提交分数上榜</span>
    </footer>

    <!-- 登录弹窗（M2：中心 SSO，表单只调 /manage/api；01 文档 §4） -->
    <div v-if="showLogin" class="modal-mask" @click.self="showLogin = false">
      <div class="modal">
        <h2>登录</h2>
        <p class="muted small">使用 sysou 中心账号（一个账号通 llm / EasyPCB / Weaveora / GameVault）。</p>
        <label class="field">
          <span>邮箱</span>
          <input v-model="email" type="email" autocomplete="username" @keyup.enter="doLogin" />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="password" type="password" autocomplete="current-password" @keyup.enter="doLogin" />
        </label>
        <p v-if="loginErr" class="err small">{{ loginErr }}</p>
        <div class="modal-actions">
          <button class="btn" @click="showLogin = false">取消</button>
          <button class="btn primary" :disabled="busy" @click="doLogin">{{ busy ? '登录中…' : '登录' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView } from 'vue-router'
import { login, logout, restoreSession, user as me } from './session'
import { api } from './api'

const adminOk = ref(false)

/** 移动端断点（≤760px 进汉堡菜单）；监听 resize 实时切换。 */
const isMobile = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
const menuOpen = ref(false)
let mq: MediaQueryList | undefined
function onMqChange() { if (isMobile.value) menuOpen.value = false }
onMounted(() => {
  mq = window.matchMedia('(max-width: 760px)')
  mq.addEventListener('change', onMqChange)
})
onBeforeUnmount(() => mq?.removeEventListener('change', onMqChange))
watch(me, () => { menuOpen.value = false })

/** 拉应用侧权限快照（/api/me/perm，中心 RBAC 裁定 #21）：有任一 gamevault:admin:* 点或 pa → 管理台可见。 */
async function refreshPerm() {
  try {
    const p = await api.perm()
    adminOk.value = p.pa || p.perms.length > 0
  } catch {
    adminOk.value = false // 未登录/中心不可达 → 最小权限（不显示管理台）
  }
}

const showLogin = ref(false)
const busy = ref(false)
const email = ref('')
const password = ref('')
const loginErr = ref('')

async function doLogin() {
  if (busy.value) return
  busy.value = true
  loginErr.value = ''
  try {
    await login(email.value.trim(), password.value)
    showLogin.value = false
    password.value = ''
    void refreshPerm()
  } catch (e) {
    loginErr.value = e instanceof Error ? e.message : '登录失败'
  } finally {
    busy.value = false
  }
}

async function onLogout() {
  adminOk.value = false
  await logout()
}

onMounted(() => {
  void restoreSession().then(() => void refreshPerm())
})
</script>

<style scoped>
.topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 22px; border-bottom: 1px solid var(--line);
  background: var(--bg-panel);
  position: sticky; top: 0; z-index: 10;
}
.tb-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; color: var(--text); text-decoration: none; }
.brand-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--neon); box-shadow: 0 0 8px var(--neon); }
.brand-sub { font-size: 12px; font-weight: 400; color: var(--text-dim); }
.nav { display: flex; align-items: center; gap: 14px; font-size: 14px; }
.nav a { color: var(--text-dim); text-decoration: none; }
.nav a:hover { color: var(--neon); }
.user-chip {
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text-dim); font-size: 13px;
}

/* 移动端：顶栏压缩 + 汉堡按钮 */
.hamburger {
  width: 40px; height: 40px; flex: none; display: grid; place-content: center; gap: 4px;
  background: transparent; border: 1px solid var(--line); border-radius: 9px; cursor: pointer; padding: 0;
}
.hamburger:hover { border-color: var(--neon); }
.hamburger span {
  display: block; width: 18px; height: 2px; border-radius: 2px; background: var(--text);
  transition: transform 0.2s ease, opacity 0.15s ease;
}
.hamburger.open span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
.hamburger.open span:nth-child(2) { opacity: 0; }
.hamburger.open span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }

/* 下拉菜单：顶栏正下方全宽卡片（滑入动效） */
.mobile-menu {
  position: absolute; top: calc(100% + 8px); left: 10px; right: 10px; z-index: 11;
  display: flex; flex-direction: column;
  background: rgba(17, 22, 36, 0.97); backdrop-filter: blur(10px);
  border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(34, 211, 238, 0.08);
}
.mm-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  min-height: 48px; padding: 10px 16px; font-size: 15px;
  color: var(--text-dim); text-decoration: none; cursor: pointer;
}
.mm-item:hover { color: var(--text); background: rgba(34, 211, 238, 0.06); text-decoration: none; }
.mm-item.router-link-active { color: var(--neon); }
.mm-account { color: var(--text); font-size: 13px; }
.mm-user { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.mm-divider { height: 1px; background: var(--line); flex: none; }
.menu-mask { position: fixed; inset: 0; top: 0; background: rgba(0, 0, 0, 0.4); z-index: 9; }
.menu-enter-active { transition: transform 0.18s ease, opacity 0.18s ease; }
.menu-leave-active { transition: transform 0.14s ease, opacity 0.14s ease; }
.menu-enter-from, .menu-leave-to { transform: translateY(-8px); opacity: 0; }

@media (max-width: 760px) {
  .topbar { padding: 8px 12px; }
  .brand { font-size: 15px; }
  .brand-sub { display: none; }
  .nav { display: none; } /* 桌面导航由 .mobile-menu 取代 */
}

.modal-mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  width: 340px; background: var(--bg-panel); border: 1px solid var(--line);
  border-radius: 12px; padding: 20px;
}
.modal h2 { margin: 0 0 6px; font-size: 18px; }
.field { display: block; margin: 12px 0; }
.field span { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
.field input {
  width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 14px;
  background: var(--bg-panel-2); border: 1px solid var(--line); border-radius: 8px;
  color: var(--text); outline: none;
}
.field input:focus { border-color: var(--neon); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
