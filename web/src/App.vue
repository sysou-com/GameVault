<template>
  <div class="shell">
    <header class="topbar">
      <router-link to="/" class="brand">
        <span class="brand-dot"></span>GameVault<span class="brand-sub">游戏展示与试玩平台</span>
      </router-link>
      <nav class="nav">
        <router-link to="/">全部游戏</router-link>
        <router-link v-if="me" to="/admin">管理台</router-link>
        <template v-if="me">
          <span class="user-chip" :title="me.email ?? me.id">{{ me.email ?? me.id.slice(0, 8) }}</span>
          <button class="btn ghost small" @click="onLogout">退出</button>
        </template>
        <button v-else class="btn primary small" @click="showLogin = true">登录</button>
      </nav>
    </header>
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
import { onMounted, ref } from 'vue'
import { login, logout, restoreSession, user as me } from './session'

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
  } catch (e) {
    loginErr.value = e instanceof Error ? e.message : '登录失败'
  } finally {
    busy.value = false
  }
}

async function onLogout() {
  await logout()
}

onMounted(() => {
  void restoreSession()
})
</script>

<style scoped>
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 22px; border-bottom: 1px solid var(--line);
  background: var(--bg-panel);
  position: sticky; top: 0; z-index: 10;
}
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
