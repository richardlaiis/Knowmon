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
  it('returns the defaults when there is no settings file', () => {
    expect(loadSettings(dir)).toEqual({ lastVault: null })
  })

  it('remembers the last opened vault', () => {
    saveSettings(dir, { lastVault: '/home/me/Notes' })
    expect(loadSettings(dir).lastVault).toBe('/home/me/Notes')
  })

  it('returns the defaults when the settings file is corrupt', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{broken')
    expect(loadSettings(dir)).toEqual({ lastVault: null })
  })
})
