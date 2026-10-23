import { createRouter, createWebHistory } from 'vue-router'

// SPA 路由挂在 /game/ 下（nginx try_files 兜底到 /game/index.html，01 文档 §4/§8）
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/Home.vue') },
    { path: '/g/:slug', name: 'game', component: () => import('./views/GameDetail.vue'), props: true },
    { path: '/admin', name: 'admin', component: () => import('./views/Admin.vue') },
  ],
})
