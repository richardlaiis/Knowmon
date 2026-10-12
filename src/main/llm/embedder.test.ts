import { describe, expect, it } from 'vitest'
import { openDb, upsertNote, type DB } from '../db'
import { embedProgress, listChunks, nearestChunks, setChunks, vectorModel } from '../db/vectors'
import { Embedder } from './embedder'
import { OllamaError } from './ollama'
import { fakeOllama, fakeVector } from './test-utils'

function note(db: DB, p: string, texts: string[]): number {
  const id = upsertNote(db, {
    path: p,
    title: p.replace(/\.md$/, ''),
    createdAt: 0,
    modifiedAt: 0,
    eventDate: null,
    contentHash: p
  })
  setChunks(
    db,
    id,
    texts.map((text, i) => ({ line: i + 1, text, heading: '' }))
  )
  return id
}

function setup(model = 'bge-m3'): {
  db: DB
  ollama: ReturnType<typeof fakeOllama>
  embedder: Embedder
  embedded: number[]
} {
  const db = openDb(':memory:')
  const ollama = fakeOllama()
  const embedded: number[] = []
  const embedder = new Embedder({
    db,
    model,
    batchSize: 2,
    embed: (texts, signal) => ollama.embed(model, texts, signal),
    onNotesEmbedded: (ids) => embedded.push(...ids)
  })
  return { db, ollama, embedder, embedded }
}

describe('Embedder', () => {
  it('分批處理所有 chunk，送出的文字帶有標題', async () => {
    const { db, ollama, embedder, embedded } = setup()
    const a = note(db, 'a.md', ['一', '二', '三'])
    const b = note(db, 'b.md', ['四'])
    embedder.wake()
    embedder.wake() // 執行中再喚醒不會重複啟動
    await embedder.idle()
    expect(ollama.embedCalls).toEqual([
      ['a\n\n一', 'a\n\n二'],
      ['a\n\n三', 'b\n\n四']
    ])
    expect(embedded).toEqual([a, b])
    expect(embedProgress(db)).toEqual({ embedded: 2, total: 2 })
    expect(vectorModel(db)).toEqual({ model: 'bge-m3', dim: 32 })
    expect(embedder.busy).toBe(false)
    expect(nearestChunks(db, fakeVector('b\n\n四'), 1)[0].noteId).toBe(b)
  })

  it('embedding 途中筆記被修改：舊的向量不寫入，新的 chunk 下一批處理', async () => {
    const { db, ollama, embedder } = setup()
    const a = note(db, 'a.md', ['舊'])
    ollama.hold()
    embedder.wake()
    await Promise.resolve()
    setChunks(db, a, [{ line: 1, text: '新', heading: '' }])
    ollama.release()
    await embedder.idle()
    expect(ollama.embedCalls).toEqual([['a\n\n舊'], ['a\n\n新']])
    expect(listChunks(db, a).map((c) => [c.text, c.embedded])).toEqual([['新', true]])
  })

  it('離線時停下並記錄錯誤，恢復後再喚醒會繼續', async () => {
    const { db, ollama, embedder } = setup()
    note(db, 'a.md', ['一'])
    ollama.online = false
    embedder.wake()
    await embedder.idle()
    expect(embedder.error).toBeInstanceOf(OllamaError)
    expect(embedProgress(db).embedded).toBe(0)

    ollama.online = true
    embedder.wake()
    await embedder.idle()
    expect(embedder.error).toBeNull()
    expect(embedProgress(db).embedded).toBe(1)
  })

  it('換 embedding 模型時舊向量作廢、全部重算', async () => {
    const first = setup('m1')
    note(first.db, 'a.md', ['一'])
    first.embedder.wake()
    await first.embedder.idle()
    expect(vectorModel(first.db)?.model).toBe('m1')

    const ollama = fakeOllama()
    const second = new Embedder({
      db: first.db,
      model: 'm2',
      embed: (texts, signal) => ollama.embed('m2', texts, signal)
    })
    expect(embedProgress(first.db).embedded).toBe(0)
    second.wake()
    await second.idle()
    expect(vectorModel(first.db)?.model).toBe('m2')
    expect(embedProgress(first.db).embedded).toBe(1)
  })

  it('stop 會中止進行中的請求，之後不再寫入', async () => {
    const { db, ollama, embedder } = setup()
    note(db, 'a.md', ['一'])
    ollama.hold()
    embedder.wake()
    const stopped = embedder.stop()
    ollama.release()
    await stopped
    expect(embedder.error).toBeNull()
    expect(embedProgress(db).embedded).toBe(0)
    embedder.wake()
    await embedder.idle()
    expect(ollama.embedCalls).toHaveLength(1)
  })
})
