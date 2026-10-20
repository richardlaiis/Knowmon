import { describe, expect, it } from 'vitest'
import {
  assetPathFromUrl,
  assetUrl,
  attachmentFileName,
  imageMarkdown,
  imageMime,
  pastedImageName,
  relativeToNote,
  resolveImageSrc
} from './assets'

describe('圖片路徑', () => {
  it('imageMime 依副檔名判斷，不分大小寫', () => {
    expect(imageMime('a/b.PNG')).toBe('image/png')
    expect(imageMime('x.jpeg')).toBe('image/jpeg')
    expect(imageMime('x.svg')).toBe('image/svg+xml')
    expect(imageMime('x.md')).toBeNull()
    expect(imageMime('png')).toBeNull()
  })

  it('assetUrl 與 assetPathFromUrl 互為反函式', () => {
    for (const rel of ['attachments/Pasted image 1.png', '日記/圖 #1%.png', 'a.png']) {
      const url = assetUrl(rel)
      expect(url).not.toMatch(/[\s#]/)
      expect(assetPathFromUrl(url)).toBe(rel)
    }
    expect(assetUrl('日記/a b.png')).toBe('knowmon-asset://vault/%E6%97%A5%E8%A8%98/a%20b.png')
    expect(assetPathFromUrl('https://vault/a.png')).toBeNull()
    expect(assetPathFromUrl('knowmon-asset://vault/%E0%A4%A.png')).toBeNull()
  })

  it('resolveImageSrc 以筆記所在資料夾為基準', () => {
    expect(resolveImageSrc('日記/a.md', 'img.png')).toBe('日記/img.png')
    expect(resolveImageSrc('日記/a.md', './img.png')).toBe('日記/img.png')
    expect(resolveImageSrc('日記/a.md', '../attachments/x.png')).toBe('attachments/x.png')
    expect(resolveImageSrc('a.md', 'attachments/x.png')).toBe('attachments/x.png')
    expect(resolveImageSrc('a.md', '<attachments/Pasted image 1.png>')).toBe(
      'attachments/Pasted image 1.png'
    )
    expect(resolveImageSrc('a.md', 'a%20b.png')).toBe('a b.png')
    // 不合法的百分比編碼照原文
    expect(resolveImageSrc('a.md', '100%.png')).toBe('100%.png')
  })

  it('resolveImageSrc 只接受 vault 內的相對路徑', () => {
    expect(resolveImageSrc('a.md', 'https://example.com/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', 'data:image/png;base64,AAAA')).toBeNull()
    expect(resolveImageSrc('a.md', 'file:///etc/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', 'C:/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', '/home/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', 'a\\b.png')).toBeNull()
    expect(resolveImageSrc('日記/a.md', '../../x.png')).toBeNull()
    expect(resolveImageSrc('a.md', '.knowmon/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', 'notes.md')).toBeNull()
    expect(resolveImageSrc('a.md', '  ')).toBeNull()
  })

  it('relativeToNote 與 imageMarkdown', () => {
    expect(relativeToNote('a.md', 'attachments/x.png')).toBe('attachments/x.png')
    expect(relativeToNote('日記/a.md', 'attachments/x.png')).toBe('../attachments/x.png')
    expect(relativeToNote('a/b/c.md', 'a/x.png')).toBe('../x.png')
    expect(relativeToNote('a/b/c.md', 'a/b/x.png')).toBe('x.png')
    expect(relativeToNote('ab/c.md', 'a/x.png')).toBe('../a/x.png')
    expect(imageMarkdown('日記/a.md', 'attachments/x.png')).toBe('![](../attachments/x.png)')
    expect(imageMarkdown('a.md', 'attachments/Pasted image 1.png')).toBe(
      '![](<attachments/Pasted image 1.png>)'
    )
    // 產生的語法再解析回來是同一個檔案
    for (const [note, target] of [
      ['日記/a.md', 'attachments/Pasted image (1).png'],
      ['a/b/c.md', 'a/圖.png']
    ]) {
      const src = /^!\[\]\((.*)\)$/.exec(imageMarkdown(note, target))![1]
      expect(resolveImageSrc(note, src)).toBe(target)
    }
  })

  it('pastedImageName：截圖用時間命名，其他保留原名', () => {
    const d = new Date(2026, 9, 20, 9, 5, 3)
    expect(pastedImageName('image.png', 'image/png', d)).toBe('Pasted image 20261020090503.png')
    expect(pastedImageName('', 'image/jpeg', d)).toBe('Pasted image 20261020090503.jpg')
    expect(pastedImageName('架構圖.webp', 'image/webp', d)).toBe('架構圖.webp')
    expect(pastedImageName('screenshot', 'image/png', d)).toBe('screenshot.png')
  })

  it('attachmentFileName 清理檔名，拒絕非圖片', () => {
    expect(attachmentFileName('../../etc/x.png')).toBe('x.png')
    expect(attachmentFileName('C:\\tmp\\a.png')).toBe('a.png')
    expect(attachmentFileName('a:b?#1%.png')).toBe('a-b--1-.png')
    expect(attachmentFileName('..hidden.png')).toBe('hidden.png')
    expect(() => attachmentFileName('x.md')).toThrow()
    expect(() => attachmentFileName('.png')).toThrow()
    expect(() => attachmentFileName('')).toThrow()
  })
})
