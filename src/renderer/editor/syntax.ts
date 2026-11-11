// 即時渲染與表格共用的 Markdown 文字工具（不依賴 CodeMirror 的 view）
import type { Text } from '@codemirror/state'

/** 文件開頭 YAML frontmatter 的結束位置（含結尾的 ---），沒有則回傳 0 */
export function frontmatterEnd(doc: Text): number {
  const head = doc.sliceString(0, Math.min(doc.length, 20_000))
  const m = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?=\r?\n|$)/.exec(head)
  return m ? m[0].length : 0
}

/** [[目標]] 與 [[目標|顯示文字]]；使用前要重設 lastIndex（matchAll 會自動複製） */
export const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g

/** 拆開 wikilink 的內容（[[ ]] 之間）：目標與顯示文字在內容中的起點 */
export function splitWikilink(inner: string): { target: string; textStart: number } {
  const pipe = inner.indexOf('|')
  return {
    target: (pipe >= 0 ? inner.slice(0, pipe) : inner).trim(),
    textStart: pipe >= 0 ? pipe + 1 : 0
  }
}
