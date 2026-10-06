import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSettings, saveSettings } from './settings'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-settings-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('settings', () => {
  it('沒有設定檔時回傳預設值', () => {
    expect(loadSettings(dir)).toEqual({ lastVault: null })
  })

  it('記住上次開啟的 vault', () => {
    saveSettings(dir, { lastVault: '/home/me/筆記' })
    expect(loadSettings(dir).lastVault).toBe('/home/me/筆記')
  })

  it('設定檔損毀時回傳預設值', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{壞掉')
    expect(loadSettings(dir)).toEqual({ lastVault: null })
  })
})
