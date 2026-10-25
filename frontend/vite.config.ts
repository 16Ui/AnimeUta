import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: process.env.ANIMEUTA_PREVIEW_API ? {
      '/api': { target: process.env.ANIMEUTA_PREVIEW_API, changeOrigin: true },
    } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
