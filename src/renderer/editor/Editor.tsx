import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { livePreview, markdownSupport } from './livePreview'

export interface EditorProps {
  /** 換筆記或重新載入時改變，會以 doc 重設編輯器內容（同時清掉 undo 歷史） */
  docKey: string
  doc: string
  onChange: (doc: string) => void
  onSave: () => void
  /** true：即時渲染；false：顯示原始 Markdown */
  livePreview: boolean
}

const previewMode = new Compartment()
const previewExtension = (on: boolean): ReturnType<typeof livePreview> => (on ? livePreview() : [])

export function Editor({
  docKey,
  doc,
  onChange,
  onSave,
  livePreview: preview
}: EditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // 用 ref 存 callback，讓 CodeMirror extension 只建立一次
  const callbacks = useRef({ onChange, onSave })
  const previewRef = useRef(preview)
  useEffect(() => {
    callbacks.current = { onChange, onSave }
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
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString())
          })
        ]
      })
    )
    v.focus()
    // doc 只在 docKey 改變時才套用，打字造成的 doc 變化不重設
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  return <div className="editor" ref={host} />
}
