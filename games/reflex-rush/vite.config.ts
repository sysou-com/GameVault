import { defineConfig } from 'vite'

// 游戏包被部署在任意深度（/game/g/reflex-rush/<version>/），资源引用必须相对
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'assets',
  },
})
