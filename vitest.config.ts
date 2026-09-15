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
    // Geometry suites are memory-heavy; leave room for the running WebGL preview.
    maxWorkers: 2,
    // Only the pure logic is unit tested. Rendering and feel are verified in a
    // real browser, since a headless assertion cannot tell you if a jump feels good.
    //
    // `tools` is here because the offline lightmap bake lives there and is real code
    // with real failure modes - a PNG encoder, a BVH and a rasteriser. It shipped
    // with 58 tests that this include pattern had been silently excluding, which is
    // the same class of bug as the rest of this project's history: the tests existed,
    // passed locally when pointed at directly, and never ran in the suite.
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
})
