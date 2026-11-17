// 效能測試的時間上限：本機照設計目標檢查；CI 的共用機器（GitHub Actions 會設 CI=true）
// 比開發機慢好幾倍且不穩定（Intel Mac runner 約慢 6 倍），放寬 10 倍，只抓數量級的退化
export const PERF_SCALE_CI = 10

export function perfBudget(ms: number, env: NodeJS.ProcessEnv = process.env): number {
  return env.CI ? ms * PERF_SCALE_CI : ms
}
