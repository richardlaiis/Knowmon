import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
    // CI 的共用機器慢（Intel Mac runner 準備 1000 篇筆記的效能測試就超過預設的 5 秒），
    // 與 perfBudget（src/main/db/test-utils.ts）一樣放寬；本機維持預設
    testTimeout: process.env.CI ? 60_000 : 5_000
  }
})
