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
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
