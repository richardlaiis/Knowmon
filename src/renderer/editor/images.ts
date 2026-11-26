// Images in notes: the image widget for live rendering, and pasting/dropping images into the editor.
// For the path rules (only paths relative to the note), see shared/assets.ts.
import { Facet, type Extension } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import { assetUrl, imageMarkdown, pastedImageName } from '../../shared/assets'

/** Path of the note being edited; relative image paths are based on its folder */
export const notePath = Facet.define<string, string>({
  combine: (values) => values[values.length - 1] ?? ''
})

export class ImageWidget extends WidgetType {
  constructor(
    /** Vault-relative path */
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
    // The height is only known after the image loads, so have CodeMirror measure the line again
    img.onload = () => view.requestMeasure()
    img.onerror = () => {
      wrap.classList.add('cm-lp-image-missing')
      wrap.textContent = `Image not found: ${this.path}`
      view.requestMeasure()
    }
    wrap.append(img)
    return wrap
  }
  /** Where the editor puts the cursor when the image is clicked (showing the raw syntax) */
  ignoreEvent(): boolean {
    return false
  }
}

export interface ImagePasteOptions {
  /** Saves an image and returns its vault-relative path (notes.saveAttachment) */
  save: (notePath: string, fileName: string, data: Uint8Array) => Promise<string>
  onError: (e: unknown) => void
}

function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((f) => f.type.startsWith('image/'))
}

/**
 * When an image is pasted or dropped, saves it to the vault (attachments/) and inserts ![](relative path) at the cursor or drop position.
 * When the clipboard also has text (for example copied from a word processor), it's pasted as ordinary text.
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
    // The editor may have closed while saving, and the note may have been renamed, so the relative path uses the path at insertion time
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
