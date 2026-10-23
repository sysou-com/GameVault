<template>
  <div class="shell">
    <header class="topbar">
      <router-link to="/" class="brand">
        <span class="brand-dot"></span>GameVault<span class="brand-sub">游戏展示与试玩平台</span>
      </router-link>
      <nav class="nav">
        <router-link to="/">全部游戏</router-link>
        <router-link to="/admin">管理台</router-link>
      </nav>
    </header>
    <main class="content">
      <RouterView />
    </main>
    <footer class="footer">
      <span>GameVault · 零安装零登录即玩</span>
      <span class="footer-m2">登录与排行榜 M2 开放</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
</script>
