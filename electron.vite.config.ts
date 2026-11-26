import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      // chokidar 5 is ESM-only, so bundle it into main instead of relying on Electron's require(esm)
      externalizeDeps: { exclude: ['chokidar'] }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    // The graph's layout Worker (src/renderer/graph/layout.worker.ts) is loaded as an ES module
    worker: { format: 'es' }
  }
})
