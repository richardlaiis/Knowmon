// vault 層級的設定，存在 <vault>/.knowmon/settings.json（跟著 vault 走）。
// 不存在或損毀時用預設值；寫入時保留檔案中其他欄位，留給之後的設定使用。
import fs from 'node:fs'
import { clampTimeSettings } from '../../shared/time'
import type { TimeSettings } from '../../shared/types'

function readJson(file: string): Record<string, unknown> {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

export function loadTimeSettings(file: string): TimeSettings {
  return clampTimeSettings(readJson(file).time)
}

export function saveTimeSettings(file: string, time: TimeSettings): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...readJson(file), time }, null, 2))
  fs.renameSync(tmp, file)
}
