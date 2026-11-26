// Time limits for performance tests: checked against the design targets locally; CI's shared machines (GitHub Actions sets CI=true)
// are several times slower than a development machine and inconsistent (the Intel Mac runner is about 6× slower), so relax them 10× and only catch order-of-magnitude regressions
export const PERF_SCALE_CI = 10

export function perfBudget(ms: number, env: NodeJS.ProcessEnv = process.env): number {
  return env.CI ? ms * PERF_SCALE_CI : ms
}
