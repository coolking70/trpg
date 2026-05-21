import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // 支持 GitHub Pages 部署到子路径（CI 环境通过 VITE_BASE 注入）
  base: process.env.VITE_BASE || '/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 700, // Three.js 单独 chunk 后主包 < 200KB
    rollupOptions: {
      output: {
        manualChunks: {
          // Three.js 体积大且仅 3D 骰子用到，单独 chunk 让主包加载更快
          three: ['three'],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
