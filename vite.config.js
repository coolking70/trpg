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
