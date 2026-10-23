import { defineConfig } from 'vite'

// 游戏包被部署在任意深度（/game/g/cube-rush/<version>/），资源引用必须相对（02 文档 §2/§3）
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'assets',
    rollupOptions: {
      // 单页游戏：不拆 chunk（04 文档 §2.2）
      output: { inlineDynamicImports: true },
    },
  },
})
