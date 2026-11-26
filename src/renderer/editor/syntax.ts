// Markdown text helpers shared by live rendering and tables (independent of CodeMirror's view)
import type { Text } from '@codemirror/state'

/** End position of the YAML frontmatter at the start of the document (including the closing ---), or 0 if there is none */
export function frontmatterEnd(doc: Text): number {
  const head = doc.sliceString(0, Math.min(doc.length, 20_000))
  const m = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?=\r?\n|$)/.exec(head)
  return m ? m[0].length : 0
}

/** [[target]] and [[target|label]]; reset lastIndex before use (matchAll copies it automatically) */
export const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g

/** Splits a wikilink's content (between [[ ]]): the start of the target and of the label within the content */
export function splitWikilink(inner: string): { target: string; textStart: number } {
  const pipe = inner.indexOf('|')
  return {
    // In tables it's written [[target\|label]], so a trailing \ on the target doesn't count
    target: (pipe >= 0 ? inner.slice(0, pipe).replace(/\\$/, '') : inner).trim(),
    textStart: pipe >= 0 ? pipe + 1 : 0
  }
}
