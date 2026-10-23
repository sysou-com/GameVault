import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 红线：base 恒 /game/（部署前缀事实，01 文档 §8）；前端不写死域名。
export default defineConfig({
  base: '/game/',
  plugins: [vue()],
  server: {
    port: 5173,
    // dev 同源代理 → 后端 8094（与生产 nginx 剥 /game 前缀等价）
    proxy: {
      '/game/api': {
        target: 'http://127.0.0.1:8094',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/game/, ''),
      },
      // dev 游戏包静态服务（生产 = nginx alias /var/www/gamevault/games/）；
      // 需先跑 dev-static.mjs（监听 8095，根目录 ./data/games）。
      // bypass：SPA 路由（/game/g/{slug}、/game/g/{slug}/play，≤ 4 段）由 Vite 吐 index.html，
      // 游戏资源（/game/g/{slug}/{ver}/…，≥ 5 段）才代理到 8095
      '/game/g': {
        target: 'http://127.0.0.1:8095',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/game\/g/, ''),
        bypass: (req) => {
          const segs = (req.url ?? '').split('/').filter(Boolean)
          return segs.length <= 4 ? req.url : null
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
