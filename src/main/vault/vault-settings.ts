// vault 層級的設定，存在 <vault>/.knowmon/settings.json（跟著 vault 走）。
// 不存在或損毀時用預設值；寫入時保留檔案中其他欄位。
import fs from 'node:fs'
import { clampSemanticSettings } from '../../shared/llm'
import { clampTimeSettings } from '../../shared/time'
import type { SemanticSettings, TimeSettings } from '../../shared/types'

function readJson(file: string): Record<string, unknown> {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

function saveSection(file: string, key: string, value: unknown): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...readJson(file), [key]: value }, null, 2))
  fs.renameSync(tmp, file)
}

export function loadTimeSettings(file: string): TimeSettings {
  return clampTimeSettings(readJson(file).time)
}

export function saveTimeSettings(file: string, time: TimeSettings): void {
  saveSection(file, 'time', time)
}

export function loadSemanticSettings(file: string): SemanticSettings {
  return clampSemanticSettings(readJson(file).semantic)
}

export function saveSemanticSettings(file: string, semantic: SemanticSettings): void {
  saveSection(file, 'semantic', semantic)
}
