import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { NoteSummary } from '../../shared/types'
import { imagePaste, notePath } from './images'
import { livePreview, markdownSupport } from './livePreview'
import { wikilinks } from './wikilinks'

export interface EditorProps {
  /** Note path: relative image paths are based on its folder; changes on rename without resetting the content */
  path: string
  /** Changes when switching notes or reloading, resetting the editor content to doc (which also clears undo history) */
  docKey: string
  doc: string
  onChange: (doc: string) => void
  onSave: () => void
  /** true: live rendering; false: raw Markdown */
  livePreview: boolean
  /** Note list for [[ autocompletion */
  getNotes: () => Promise<NoteSummary[]>
  /** Ctrl/Cmd+click on a wikilink */
  onOpenLink: (target: string, newTab: boolean) => void
  /** Whether this tab is the current one; it takes focus when switched back to (hidden tabs don't steal focus) */
  active?: boolean
  /** The selection changed (for summarizing the selection); an empty string when nothing is selected */
  onSelectionChange?: (text: string) => void
  /** Scrolls to this line and puts the cursor at its start; jumps again when n changes (even for the same line) */
  reveal?: { line: number; n: number } | null
  /** Saves a pasted or dropped image and returns its vault-relative path */
  saveAttachment: (notePath: string, fileName: string, data: Uint8Array) => Promise<string>
  onError: (e: unknown) => void
}

const previewMode = new Compartment()
const previewExtension = (on: boolean): ReturnType<typeof livePreview> => (on ? livePreview() : [])
const pathConf = new Compartment()

export function Editor({
  path,
  docKey,
  doc,
  onChange,
  onSave,
  livePreview: preview,
  getNotes,
  onOpenLink,
  active = true,
  onSelectionChange,
  reveal = null,
  saveAttachment,
  onError
}: EditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Keep callbacks in refs so the CodeMirror extension is created only once
  const callbacks = useRef({
    onChange,
    onSave,
    getNotes,
    onOpenLink,
    onSelectionChange,
    saveAttachment,
    onError
  })
  const previewRef = useRef(preview)
  const pathRef = useRef(path)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
    if (active) view.current?.focus()
  }, [active])
  useEffect(() => {
    callbacks.current = {
      onChange,
      onSave,
      getNotes,
      onOpenLink,
      onSelectionChange,
      saveAttachment,
      onError
    }
  })

  // On rename only the path is updated (images re-resolved), without rebuilding the editor
  useEffect(() => {
    pathRef.current = path
    view.current?.dispatch({ effects: pathConf.reconfigure(notePath.of(path)) })
  }, [path])

  // Switch between live rendering and source mode without rebuilding the editor (keeping the cursor and undo history)
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
          pathConf.of(notePath.of(pathRef.current)),
          imagePaste({
            save: (...args) => callbacks.current.saveAttachment(...args),
            onError: (e) => callbacks.current.onError(e)
          }),
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
    // doc is applied only when docKey changes; doc changes from typing don't reset it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey])

  // Jump to the given line (search results); runs after the effect that loads content, so it also works when a note first opens
  // When an external change reloads the note (docKey changes), don't jump back to the same position
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
