// 筆記切塊：供 embedding 與檢索使用。純函式，不碰檔案系統與 DB。
//
// 先依 Markdown 標題切成章節，章節內以空行分段（圍欄程式碼視為一段），
// 依序累積到約 maxChars 字；單一段落過長時依句子再切，句子仍過長時硬切。

export const CHUNK_CHARS = 800

export interface Chunk {
  /** 起始行（1-based），對應原檔（frontmatter 已換成空行） */
  line: number
  text: string
  /** 所在章節的標題路徑（「背景 › 細節」），沒有標題時為空字串 */
  heading: string
}

interface Block {
  line: number
  text: string
  heading: string
  /** 標題行本身：開始新的 chunk */
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

/** 送進 embedding 的文字：加上筆記標題與章節，讓短的段落也有上下文 */
export function embeddingText(title: string, chunk: Pick<Chunk, 'heading' | 'text'>): string {
  const path = chunk.heading ? `${title} › ${chunk.heading}` : title
  return `${path}\n\n${chunk.text}`
}

/** 依空行與標題切段；圍欄程式碼整段保留 */
function splitBlocks(body: string): Block[] {
  const lines = body.split('\n').map((l) => l.replace(/\r$/, ''))
  const blocks: Block[] = []
  const trail: string[] = [] // trail[i] = 第 i+1 級標題
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

/** 依句子（中英文句號、問號、驚嘆號、換行）切開過長的段落，句子仍過長時硬切 */
function splitLong(text: string, maxChars: number): { text: string; lineOffset: number }[] {
  // 在句末標點（英文句點後須接空白，避免切開 3.14）與換行之後切開，不丟掉任何字元
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
