import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Only the pure logic is unit tested. Rendering and feel are verified in a
    // real browser, since a headless assertion cannot tell you if a jump feels good.
    include: ['src/**/*.test.ts'],
  },
})
