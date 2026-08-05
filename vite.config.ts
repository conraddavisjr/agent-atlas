import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // three is large and rarely changes; splitting it keeps app rebuilds cheap
    // for returning players and lets scene chunks stay small.
    rollupOptions: {
      output: {
        // Function form rather than the object map: Vite 8's bundler only accepts
        // a callback here.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three'
          return undefined
        },
      },
    },
  },
})
