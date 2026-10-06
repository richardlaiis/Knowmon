import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'

export interface EditorProps {
  /** 換筆記或重新載入時改變，會以 doc 重設編輯器內容（同時清掉 undo 歷史） */
  docKey: string
  doc: string
  onChange: (doc: string) => void
  onSave: () => void
}

export function Editor({ docKey, doc, onChange, onSave }: EditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // 用 ref 存 callback，讓 CodeMirror extension 只建立一次
  const callbacks = useRef({ onChange, onSave })
  useEffect(() => {
    callbacks.current = { onChange, onSave }
  })

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
          markdown(),
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
