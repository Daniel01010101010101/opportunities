import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// BASE_PATH lo define el workflow de GitHub Pages ("/<repositorio>/"). En local es "/".
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@config': fileURLToPath(new URL('../config', import.meta.url)),
    },
  },
  server: { fs: { allow: ['..'] } },
  define: {
    __GITHUB_REPO__: JSON.stringify(process.env.GITHUB_REPOSITORY || process.env.VITE_GITHUB_REPO || ''),
    __BUILD_SHA__: JSON.stringify((process.env.GITHUB_SHA || '').slice(0, 7)),
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], vendor: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
})
