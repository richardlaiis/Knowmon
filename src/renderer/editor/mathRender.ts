// Renders TeX with KaTeX into DOM nodes (used by the editor widgets, table cells and AI replies).
// katex.render() builds the nodes with createElement, so no HTML string is inserted.
// trust stays false: \href, \url, \includegraphics, \htmlClass etc. are rejected.
import katex from 'katex'

const CACHE_LIMIT = 500
const cache = new Map<string, HTMLElement>()

/** Rendering result: a KaTeX element, or the raw TeX marked as an error */
export function renderMath(tex: string, display: boolean): HTMLElement {
  const key = `${display ? 'D' : 'I'}${tex}`
  let el = cache.get(key)
  if (el) {
    // Most recently used goes last
    cache.delete(key)
  } else {
    el = build(tex, display)
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  }
  cache.set(key, el)
  return el.cloneNode(true) as HTMLElement
}

function build(tex: string, display: boolean): HTMLElement {
  const el = document.createElement('span')
  el.className = display ? 'math math-display' : 'math math-inline'
  try {
    katex.render(tex, el, {
      displayMode: display,
      throwOnError: true,
      // Text such as Chinese inside math is fine; don't warn in the console
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml'
    })
  } catch (e) {
    el.className = 'math math-error'
    el.textContent = tex
    el.title = e instanceof Error ? e.message : String(e)
  }
  return el
}
