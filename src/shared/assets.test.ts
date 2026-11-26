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

describe('image paths', () => {
  it('imageMime goes by the extension, case-insensitively', () => {
    expect(imageMime('a/b.PNG')).toBe('image/png')
    expect(imageMime('x.jpeg')).toBe('image/jpeg')
    expect(imageMime('x.svg')).toBe('image/svg+xml')
    expect(imageMime('x.md')).toBeNull()
    expect(imageMime('png')).toBeNull()
  })

  it('assetUrl and assetPathFromUrl are inverses', () => {
    for (const rel of ['attachments/Pasted image 1.png', '日記/圖 #1%.png', 'a.png']) {
      const url = assetUrl(rel)
      expect(url).not.toMatch(/[\s#]/)
      expect(assetPathFromUrl(url)).toBe(rel)
    }
    // Non-ASCII folder names and spaces are percent-encoded
    expect(assetUrl('日記/a b.png')).toBe('knowmon-asset://vault/%E6%97%A5%E8%A8%98/a%20b.png')
    expect(assetPathFromUrl('https://vault/a.png')).toBeNull()
    expect(assetPathFromUrl('knowmon-asset://vault/%E0%A4%A.png')).toBeNull()
  })

  it("resolveImageSrc is relative to the note's folder", () => {
    expect(resolveImageSrc('Journal/a.md', 'img.png')).toBe('Journal/img.png')
    expect(resolveImageSrc('Journal/a.md', './img.png')).toBe('Journal/img.png')
    expect(resolveImageSrc('Journal/a.md', '../attachments/x.png')).toBe('attachments/x.png')
    expect(resolveImageSrc('a.md', 'attachments/x.png')).toBe('attachments/x.png')
    expect(resolveImageSrc('a.md', '<attachments/Pasted image 1.png>')).toBe(
      'attachments/Pasted image 1.png'
    )
    expect(resolveImageSrc('a.md', 'a%20b.png')).toBe('a b.png')
    // Invalid percent-encoding is kept as written
    expect(resolveImageSrc('a.md', '100%.png')).toBe('100%.png')
  })

  it('resolveImageSrc only accepts relative paths inside the vault', () => {
    expect(resolveImageSrc('a.md', 'https://example.com/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', 'data:image/png;base64,AAAA')).toBeNull()
    expect(resolveImageSrc('a.md', 'file:///etc/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', 'C:/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', '/home/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', 'a\\b.png')).toBeNull()
    expect(resolveImageSrc('Journal/a.md', '../../x.png')).toBeNull()
    expect(resolveImageSrc('a.md', '.knowmon/x.png')).toBeNull()
    expect(resolveImageSrc('a.md', 'notes.md')).toBeNull()
    expect(resolveImageSrc('a.md', '  ')).toBeNull()
  })

  it('relativeToNote and imageMarkdown', () => {
    expect(relativeToNote('a.md', 'attachments/x.png')).toBe('attachments/x.png')
    expect(relativeToNote('Journal/a.md', 'attachments/x.png')).toBe('../attachments/x.png')
    expect(relativeToNote('a/b/c.md', 'a/x.png')).toBe('../x.png')
    expect(relativeToNote('a/b/c.md', 'a/b/x.png')).toBe('x.png')
    expect(relativeToNote('ab/c.md', 'a/x.png')).toBe('../a/x.png')
    expect(imageMarkdown('Journal/a.md', 'attachments/x.png')).toBe('![](../attachments/x.png)')
    expect(imageMarkdown('a.md', 'attachments/Pasted image 1.png')).toBe(
      '![](<attachments/Pasted image 1.png>)'
    )
    // The generated syntax parses back to the same file
    for (const [note, target] of [
      ['Journal/a.md', 'attachments/Pasted image (1).png'],
      ['a/b/c.md', 'a/image.png']
    ]) {
      const src = /^!\[\]\((.*)\)$/.exec(imageMarkdown(note, target))![1]
      expect(resolveImageSrc(note, src)).toBe(target)
    }
  })

  it('pastedImageName: screenshots are named by time, others keep their names', () => {
    const d = new Date(2026, 9, 20, 9, 5, 3)
    expect(pastedImageName('image.png', 'image/png', d)).toBe('Pasted image 20261020090503.png')
    expect(pastedImageName('', 'image/jpeg', d)).toBe('Pasted image 20261020090503.jpg')
    expect(pastedImageName('架構圖.webp', 'image/webp', d)).toBe('架構圖.webp')
    expect(pastedImageName('screenshot', 'image/png', d)).toBe('screenshot.png')
  })

  it('attachmentFileName cleans the name and rejects non-images', () => {
    expect(attachmentFileName('../../etc/x.png')).toBe('x.png')
    expect(attachmentFileName('C:\\tmp\\a.png')).toBe('a.png')
    expect(attachmentFileName('a:b?#1%.png')).toBe('a-b--1-.png')
    expect(attachmentFileName('..hidden.png')).toBe('hidden.png')
    expect(() => attachmentFileName('x.md')).toThrow()
    expect(() => attachmentFileName('.png')).toThrow()
    expect(() => attachmentFileName('')).toThrow()
  })
})
