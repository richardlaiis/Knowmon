import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
    // CI's shared machines are slow (on the Intel Mac runner, preparing 1000 notes for the performance tests alone exceeds the default 5 seconds),
    // so relax it like perfBudget (src/main/db/test-utils.ts); keep the default locally
    testTimeout: process.env.CI ? 60_000 : 5_000
  }
})
