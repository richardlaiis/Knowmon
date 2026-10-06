// chokidar 只當作「有東西變了」的觸發器，實際變更由 Vault.reconcile 比對得出
import { watch } from 'chokidar'
import type { VaultChange } from '../../shared/types'
import { isIgnored, toRel } from './paths'

export interface Watcher {
  close(): Promise<void>
}

/**
 * 監聽 vault，變動停止 debounceMs 後呼叫 onSettled。
 * 資料夾的新增/刪除不會出現在 reconcile 結果裡，所以直接一併傳出。
 */
export function watchVault(
  root: string,
  debounceMs: number,
  onSettled: (dirChanges: VaultChange[]) => Promise<void>
): Watcher {
  let timer: NodeJS.Timeout | null = null
  let dirChanges: VaultChange[] = []

  const watcher = watch(root, {
    ignoreInitial: true,
    ignored: (p) => p !== root && isIgnored(toRel(root, p))
  })

  watcher.on('all', (event, p) => {
    if (event === 'addDir') dirChanges.push({ type: 'add', path: toRel(root, p) })
    if (event === 'unlinkDir') dirChanges.push({ type: 'unlink', path: toRel(root, p) })
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const batch = dirChanges
      dirChanges = []
      onSettled(batch).catch((e) => console.error('[vault] reconcile failed', e))
    }, debounceMs)
  })
  watcher.on('error', (e) => console.error('[vault] watcher error', e))

  return {
    async close() {
      if (timer) clearTimeout(timer)
      await watcher.close()
    }
  }
}
