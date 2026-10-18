import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './markdown'

describe('parseMarkdown', () => {
  it('條列與行內格式', () => {
    expect(parseMarkdown('- **重點**：說明 *斜體* 與 `code`\n- 第二點')).toEqual([
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [
          [
            {
              t: 'p',
              children: [
                { t: 'strong', children: [{ t: 'text', text: '重點' }] },
                { t: 'text', text: '：說明 ' },
                { t: 'em', children: [{ t: 'text', text: '斜體' }] },
                { t: 'text', text: ' 與 ' },
                { t: 'code', text: 'code' }
              ]
            }
          ],
          [{ t: 'p', children: [{ t: 'text', text: '第二點' }] }]
        ]
      }
    ])
  })

  it('wikilink 與別名', () => {
    expect(parseMarkdown('參考 [[深度工作]] 與 [[讀書/原子習慣#第二章|習慣]]。')).toEqual([
      {
        t: 'p',
        children: [
          { t: 'text', text: '參考 ' },
          { t: 'wikilink', target: '深度工作', label: '深度工作' },
          { t: 'text', text: ' 與 ' },
          { t: 'wikilink', target: '讀書/原子習慣', label: '習慣' },
          { t: 'text', text: '。' }
        ]
      }
    ])
  })

  it('標題、有序清單起始數字、巢狀清單', () => {
    const md = '## 總覽\n\n3. 一\n4. 二\n   - 子項'
    expect(parseMarkdown(md)).toEqual([
      { t: 'h', level: 2, children: [{ t: 'text', text: '總覽' }] },
      {
        t: 'list',
        ordered: true,
        start: 3,
        items: [
          [{ t: 'p', children: [{ t: 'text', text: '一' }] }],
          [
            { t: 'p', children: [{ t: 'text', text: '二' }] },
            {
              t: 'list',
              ordered: false,
              start: 1,
              items: [[{ t: 'p', children: [{ t: 'text', text: '子項' }] }]]
            }
          ]
        ]
      }
    ])
  })

  it('外部連結只允許 http(s) 與 mailto', () => {
    expect(parseMarkdown('[網站](https://a.b) [壞](javascript:alert(1))')).toEqual([
      {
        t: 'p',
        children: [
          { t: 'link', href: 'https://a.b', children: [{ t: 'text', text: '網站' }] },
          { t: 'text', text: ' 壞' }
        ]
      }
    ])
  })

  it('程式碼區塊、引用、分隔線', () => {
    expect(parseMarkdown('```js\nlet a = 1\n```\n\n> 引言\n\n---')).toEqual([
      { t: 'code', text: 'let a = 1' },
      { t: 'quote', children: [{ t: 'p', children: [{ t: 'text', text: '引言' }] }] },
      { t: 'hr' }
    ])
  })

  it('串流到一半的語法以文字顯示', () => {
    expect(parseMarkdown('- **未完')).toEqual([
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [[{ t: 'p', children: [{ t: 'text', text: '**未完' }] }]]
      }
    ])
    expect(parseMarkdown('看 [[深度')).toEqual([
      { t: 'p', children: [{ t: 'text', text: '看 [[深度' }] }
    ])
  })

  it('段落內換行變成空白，HTML 以原文顯示', () => {
    expect(parseMarkdown('第一行\n第二行 <b>x</b>')).toEqual([
      {
        t: 'p',
        children: [{ t: 'text', text: '第一行 第二行 <b>x</b>' }]
      }
    ])
  })

  it('citations 開啟時 [n] 解析成引用，程式碼與 wikilink 內不解析', () => {
    expect(parseMarkdown('跑了五公里 [1][2]，見 [[筆記]]。', { citations: true })).toEqual([
      {
        t: 'p',
        children: [
          { t: 'text', text: '跑了五公里 ' },
          { t: 'cite', n: 1 },
          { t: 'cite', n: 2 },
          { t: 'text', text: '，見 ' },
          { t: 'wikilink', target: '筆記', label: '筆記' },
          { t: 'text', text: '。' }
        ]
      }
    ])
    expect(parseMarkdown('`a[1]` [x]', { citations: true })).toEqual([
      {
        t: 'p',
        children: [
          { t: 'code', text: 'a[1]' },
          { t: 'text', text: ' x' }
        ]
      }
    ])
    // 總結（未開啟）時 [1] 照舊當成沒有網址的連結，只顯示文字
    expect(parseMarkdown('結果 [1]')).toEqual([
      { t: 'p', children: [{ t: 'text', text: '結果 1' }] }
    ])
  })
})
