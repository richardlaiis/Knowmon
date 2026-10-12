import { describe, expect, it } from 'vitest'
import { chunkMarkdown, embeddingText } from './chunk'
import { parseNote } from './parse'

describe('chunkMarkdown', () => {
  it('空白筆記沒有 chunk', () => {
    expect(chunkMarkdown('')).toEqual([])
    expect(chunkMarkdown('\n\n  \n')).toEqual([])
  })

  it('短筆記是一塊，行號從第一個非空行開始', () => {
    expect(chunkMarkdown('\n\n今天天氣很好。\n去了圖書館。\n')).toEqual([
      { line: 3, text: '今天天氣很好。\n去了圖書館。', heading: '' }
    ])
  })

  it('標題開始新的 chunk，並記下標題路徑', () => {
    const body = [
      '# 專案',
      '簡介',
      '',
      '## 背景',
      '起因',
      '',
      '### 細節',
      '內容',
      '',
      '## 計畫',
      '下一步'
    ].join('\n')
    expect(chunkMarkdown(body)).toEqual([
      { line: 1, text: '# 專案\n\n簡介', heading: '專案' },
      { line: 4, text: '## 背景\n\n起因', heading: '專案 › 背景' },
      { line: 7, text: '### 細節\n\n內容', heading: '專案 › 背景 › 細節' },
      { line: 10, text: '## 計畫\n\n下一步', heading: '專案 › 計畫' }
    ])
  })

  it('同一章節的段落累積到上限才切開', () => {
    const para = (c: string): string => c.repeat(30)
    const body = [para('甲'), '', para('乙'), '', para('丙')].join('\n')
    const chunks = chunkMarkdown(body, 70)
    expect(chunks.map((c) => [c.line, c.text.length])).toEqual([
      [1, 62],
      [5, 30]
    ])
  })

  it('過長的段落依句子切開，行號跟著句子', () => {
    const sentence = '這是一個句子。'.repeat(3) // 21 字
    const body = ['前言', '', sentence + '\n' + sentence + '\n' + sentence].join('\n')
    const chunks = chunkMarkdown(body, 30)
    expect(chunks[0]).toEqual({ line: 1, text: '前言', heading: '' })
    expect(chunks.slice(1).map((c) => c.line)).toEqual([3, 4, 5])
    expect(chunks.slice(1).every((c) => c.text.length <= 30)).toBe(true)
    // 句子依序裝滿每一塊，不遺漏任何字
    const joined = chunks
      .slice(1)
      .map((c) => c.text.replace(/\n/g, ''))
      .join('')
    expect(joined).toBe(sentence.repeat(3))
  })

  it('英文句子也能切開；沒有標點的超長文字硬切', () => {
    const en = 'First sentence here. Second one is here. Third.'
    expect(chunkMarkdown(en, 25).map((c) => c.text)).toEqual([
      'First sentence here.',
      'Second one is here.',
      'Third.'
    ])
    expect(chunkMarkdown('x'.repeat(25), 10).map((c) => c.text.length)).toEqual([10, 10, 5])
  })

  it('圍欄程式碼不從中間切開，裡面的 # 不是標題', () => {
    const body = ['說明', '```py', '# 註解', '', 'print(1)', '```', '結尾'].join('\n')
    expect(chunkMarkdown(body)).toEqual([
      { line: 1, text: '說明\n\n```py\n# 註解\n\nprint(1)\n```\n\n結尾', heading: '' }
    ])
    const chunks = chunkMarkdown(body, 26)
    expect(chunks.map((c) => c.line)).toEqual([1, 2, 7])
    expect(chunks[1].text).toBe('```py\n# 註解\n\nprint(1)\n```')
  })

  it('配合 parseNote：frontmatter 不進 chunk，行號與原檔一致', () => {
    const { body } = parseNote('a.md', '---\ndate: 2026-10-01\ntags: [x]\n---\n# 標題\n內文')
    expect(chunkMarkdown(body)).toEqual([{ line: 5, text: '# 標題\n\n內文', heading: '標題' }])
  })
})

describe('embeddingText', () => {
  it('加上筆記標題與章節', () => {
    expect(embeddingText('筆記', { heading: '背景', text: '內容' })).toBe('筆記 › 背景\n\n內容')
    expect(embeddingText('筆記', { heading: '', text: '內容' })).toBe('筆記\n\n內容')
  })
})
