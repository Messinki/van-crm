import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Built asset URLs live under the existing FastAPI /static mount (D-038);
  // the dev server keeps serving from /.
  base: command === 'build' ? '/static/dist/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Dev: uvicorn owns the API on the fixed port 8321.
      '/api': 'http://localhost:8321',
    },
  },
  build: {
    // Served by FastAPI at / (D-038). Gitignored build output.
    outDir: '../app/static/dist',
    emptyOutDir: true,
  },
}))
