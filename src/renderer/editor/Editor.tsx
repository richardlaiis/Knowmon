import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { NoteSummary } from '../../shared/types'
import { livePreview, markdownSupport } from './livePreview'
import { wikilinks } from './wikilinks'

export interface EditorProps {
  /** 換筆記或重新載入時改變，會以 doc 重設編輯器內容（同時清掉 undo 歷史） */
  docKey: string
  doc: string
  onChange: (doc: string) => void
  onSave: () => void
  /** true：即時渲染；false：顯示原始 Markdown */
  livePreview: boolean
  /** [[ 自動補全用的筆記清單 */
  getNotes: () => Promise<NoteSummary[]>
  /** Ctrl/Cmd+點擊 wikilink */
  onOpenLink: (target: string, newTab: boolean) => void
  /** 所在分頁是否為目前的分頁；切回來時取得焦點（隱藏的分頁不搶焦點） */
  active?: boolean
  /** 選取範圍改變（總結選取文字用），沒有選取時為空字串 */
  onSelectionChange?: (text: string) => void
  /** 捲到這一行並把游標放在行首；n 改變時再跳一次（同一行也會跳） */
  reveal?: { line: number; n: number } | null
}

const previewMode = new Compartment()
const previewExtension = (on: boolean): ReturnType<typeof livePreview> => (on ? livePreview() : [])

export function Editor({
  docKey,
  doc,
  onChange,
  onSave,
  livePreview: preview,
  getNotes,
  onOpenLink,
  active = true,
  onSelectionChange,
  reveal = null
}: EditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // 用 ref 存 callback，讓 CodeMirror extension 只建立一次
  const callbacks = useRef({ onChange, onSave, getNotes, onOpenLink, onSelectionChange })
  const previewRef = useRef(preview)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
    if (active) view.current?.focus()
  }, [active])
  useEffect(() => {
    callbacks.current = { onChange, onSave, getNotes, onOpenLink, onSelectionChange }
  })

  // 切換即時渲染／原始碼模式，不重建編輯器（保留游標與 undo 歷史）
  useEffect(() => {
    previewRef.current = preview
    view.current?.dispatch({ effects: previewMode.reconfigure(previewExtension(preview)) })
  }, [preview])

  useEffect(() => {
    const v = new EditorView({ parent: host.current! })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
  }, [])

  useEffect(() => {
    const v = view.current
    if (!v) return
    v.setState(
      EditorState.create({
        doc,
        extensions: [
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                callbacks.current.onSave()
                return true
              }
            }
          ]),
          basicSetup,
          markdownSupport(),
          previewMode.of(previewExtension(previewRef.current)),
          wikilinks({
            getNotes: () => callbacks.current.getNotes(),
            onOpen: (target, newTab) => callbacks.current.onOpenLink(target, newTab)
          }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString())
            if (u.selectionSet || u.docChanged) {
              const { from, to } = u.state.selection.main
              callbacks.current.onSelectionChange?.(u.state.sliceDoc(from, to))
            }
          })
        ]
      })
    )
    if (activeRef.current) v.focus()
    // doc 只在 docKey 改變時才套用，打字造成的 doc 變化不重設
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  // 跳到指定的行（搜尋結果）；在載入內容的 effect 之後執行，所以第一次開啟筆記時也有效
  // 外部修改重新載入時（docKey 改變）不再跳回同一個位置
  const revealLine = reveal?.line
  const revealN = reveal?.n
  const revealed = useRef<number | null>(null)
  useEffect(() => {
    const v = view.current
    if (!v || revealLine === undefined || revealN === undefined) return
    if (revealed.current === revealN) return
    revealed.current = revealN
    const line = v.state.doc.line(Math.min(Math.max(1, revealLine), v.state.doc.lines))
    v.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: 'center' })
    })
    if (activeRef.current) v.focus()
  }, [docKey, revealLine, revealN])

  return <div className="editor" ref={host} />
}
