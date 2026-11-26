// chokidar is used only as a "something changed" trigger; the actual changes come from Vault.reconcile
import { watch } from 'chokidar'
import type { VaultChange } from '../../shared/types'
import { isIgnored, toRel } from './paths'

export interface Watcher {
  close(): Promise<void>
}

/**
 * Watches the vault and calls onSettled once changes have stopped for debounceMs.
 * Folder additions/deletions don't show up in reconcile's results, so they're passed along directly.
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
