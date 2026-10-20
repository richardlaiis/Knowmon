// 筆記中的圖片：即時渲染用的圖片 widget，以及在編輯器貼上／拖進圖片。
// 路徑規則（只支援相對於筆記的路徑）見 shared/assets.ts。
import { Facet, type Extension } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import { assetUrl, imageMarkdown, pastedImageName } from '../../shared/assets'

/** 目前編輯的筆記路徑；圖片的相對路徑以它所在的資料夾為基準 */
export const notePath = Facet.define<string, string>({
  combine: (values) => values[values.length - 1] ?? ''
})

export class ImageWidget extends WidgetType {
  constructor(
    /** vault 相對路徑 */
    readonly path: string,
    readonly alt: string
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.path === this.path && other.alt === this.alt
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-lp-image'
    const img = document.createElement('img')
    img.src = assetUrl(this.path)
    img.alt = this.alt
    img.title = this.alt || this.path
    img.draggable = false
    // 圖片載入後高度才確定，讓 CodeMirror 重新量測行高
    img.onload = () => view.requestMeasure()
    img.onerror = () => {
      wrap.classList.add('cm-lp-image-missing')
      wrap.textContent = `Image not found: ${this.path}`
      view.requestMeasure()
    }
    wrap.append(img)
    return wrap
  }
  /** 點擊圖片時讓編輯器把游標放在這裡（顯示原始語法） */
  ignoreEvent(): boolean {
    return false
  }
}

export interface ImagePasteOptions {
  /** 存入圖片，回傳 vault 相對路徑（notes.saveAttachment） */
  save: (notePath: string, fileName: string, data: Uint8Array) => Promise<string>
  onError: (e: unknown) => void
}

function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((f) => f.type.startsWith('image/'))
}

/**
 * 貼上或拖進圖片時存到 vault（attachments/），在游標或放開的位置插入 ![](相對路徑)。
 * 剪貼簿同時有文字時（例如從文書軟體複製）照一般文字貼上。
 */
export function imagePaste(opts: ImagePasteOptions): Extension {
  const insert = async (view: EditorView, files: File[], pos: number | null): Promise<void> => {
    const saved: string[] = []
    try {
      for (const f of files) {
        const name = pastedImageName(f.name, f.type, new Date())
        const data = new Uint8Array(await f.arrayBuffer())
        saved.push(await opts.save(view.state.facet(notePath), name, data))
      }
    } catch (e) {
      opts.onError(e)
    }
    // 存檔期間編輯器可能已關閉；筆記可能改名，所以用插入時的路徑計算相對路徑
    if (saved.length === 0 || !view.dom.isConnected) return
    const note = view.state.facet(notePath)
    const text = saved.map((p) => imageMarkdown(note, p)).join('\n')
    const range =
      pos === null
        ? view.state.selection.main
        : { from: Math.min(pos, view.state.doc.length), to: Math.min(pos, view.state.doc.length) }
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length },
      scrollIntoView: true,
      userEvent: 'input.paste'
    })
  }

  return EditorView.domEventHandlers({
    paste(e, view) {
      const files = imageFiles(e.clipboardData)
      if (files.length === 0 || e.clipboardData?.getData('text/plain')) return false
      e.preventDefault()
      void insert(view, files, null)
      return true
    },
    drop(e, view) {
      const files = imageFiles(e.dataTransfer)
      if (files.length === 0) return false
      e.preventDefault()
      void insert(view, files, view.posAtCoords({ x: e.clientX, y: e.clientY }))
      return true
    }
  })
}
