import { defineConfig } from 'vitest/config'

// The scoring engine is pure math, so tests run in the plain node environment
// (no DOM) for speed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
