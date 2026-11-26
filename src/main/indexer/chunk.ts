// Note chunking for embedding and retrieval. Pure functions, no file system or DB access.
//
// First split into sections by Markdown heading, then into paragraphs by blank lines within a section (fenced code counts as one paragraph),
// accumulating up to about maxChars characters; an overlong paragraph is split by sentence, and a sentence that's still too long is cut hard.

export const CHUNK_CHARS = 800

export interface Chunk {
  /** Starting line (1-based) in the original file (with frontmatter replaced by blank lines) */
  line: number
  text: string
  /** Heading path of the section ("Background › Details"); an empty string when there's no heading */
  heading: string
}

interface Block {
  line: number
  text: string
  heading: string
  /** The heading line itself: starts a new chunk */
  isHeading: boolean
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

export function chunkMarkdown(body: string, maxChars = CHUNK_CHARS): Chunk[] {
  const chunks: Chunk[] = []
  let current: Block[] = []
  let size = 0
  const flush = (): void => {
    const first = current.find((b) => b.text.trim())
    if (first) {
      chunks.push({
        line: current[0].line,
        text: current.map((b) => b.text).join('\n\n'),
        heading: current[0].heading
      })
    }
    current = []
    size = 0
  }

  for (const block of splitBlocks(body)) {
    if (block.isHeading) flush()
    if (block.text.length > maxChars) {
      flush()
      for (const piece of splitLong(block.text, maxChars)) {
        chunks.push({
          line: block.line + piece.lineOffset,
          text: piece.text,
          heading: block.heading
        })
      }
      continue
    }
    if (size > 0 && size + block.text.length > maxChars) flush()
    current.push(block)
    size += block.text.length + 2
  }
  flush()
  return chunks
}

/** Text sent for embedding: prefixed with the note title and section so short passages have context */
export function embeddingText(title: string, chunk: Pick<Chunk, 'heading' | 'text'>): string {
  const path = chunk.heading ? `${title} › ${chunk.heading}` : title
  return `${path}\n\n${chunk.text}`
}

/** Splits into paragraphs by blank lines and headings; fenced code is kept whole */
function splitBlocks(body: string): Block[] {
  const lines = body.split('\n').map((l) => l.replace(/\r$/, ''))
  const blocks: Block[] = []
  const trail: string[] = [] // trail[i] = heading of level i+1
  let heading = ''
  let buf: string[] = []
  let start = 0
  let fence: string | null = null

  const push = (): void => {
    if (buf.some((l) => l.trim())) {
      blocks.push({ line: start + 1, text: buf.join('\n').trim(), heading, isHeading: false })
    }
    buf = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = FENCE.exec(line)
    if (fence) {
      buf.push(line)
      if (
        f &&
        f[1][0] === fence[0] &&
        f[1].length >= fence.length &&
        !line.slice(f[0].length).trim()
      ) {
        fence = null
        push()
      }
      continue
    }
    if (f) {
      push()
      fence = f[1]
      start = i
      buf.push(line)
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      push()
      const level = h[1].length
      trail.length = level - 1
      trail[level - 1] = h[2]
      heading = trail.filter(Boolean).join(' › ')
      blocks.push({ line: i + 1, text: line.trim(), heading, isHeading: true })
      continue
    }
    if (!line.trim()) {
      push()
      continue
    }
    if (buf.length === 0) start = i
    buf.push(line)
  }
  push()
  return blocks
}

/** Splits an overlong paragraph by sentence (Chinese and English periods, question marks, exclamation marks, line breaks); a sentence that's still too long is cut hard */
function splitLong(text: string, maxChars: number): { text: string; lineOffset: number }[] {
  // Split after sentence-ending punctuation (an English period must be followed by whitespace, so 3.14 isn't split) and line breaks, without dropping any characters
  const sentences = text.split(/(?<=[。！？]|[.!?](?=\s)|\n)/)
  const out: { text: string; lineOffset: number }[] = []
  let buf = ''
  let bufStart = 0
  let pos = 0
  const emit = (): void => {
    if (buf.trim()) out.push({ text: buf.trim(), lineOffset: countNewlines(text, bufStart) })
    buf = ''
  }
  for (const s of sentences) {
    if (!s) continue
    if (buf && buf.length + s.length > maxChars) emit()
    if (!buf) bufStart = pos
    if (s.length > maxChars) {
      for (let i = 0; i < s.length; i += maxChars) {
        buf = s.slice(i, i + maxChars)
        bufStart = pos + i
        emit()
      }
    } else {
      buf += s
    }
    pos += s.length
  }
  emit()
  return out
}

function countNewlines(text: string, end: number): number {
  let n = 0
  for (let i = 0; i < end; i++) if (text[i] === '\n') n++
  return n
}
