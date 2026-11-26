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
  it('processes every chunk in batches, sending text with the heading', async () => {
    const { db, ollama, embedder, embedded } = setup()
    const a = note(db, 'a.md', ['one', 'two', 'three'])
    const b = note(db, 'b.md', ['four'])
    embedder.wake()
    embedder.wake() // waking it while running doesn't start it twice
    await embedder.idle()
    expect(ollama.embedCalls).toEqual([
      ['a\n\none', 'a\n\ntwo'],
      ['a\n\nthree', 'b\n\nfour']
    ])
    expect(embedded).toEqual([a, b])
    expect(embedProgress(db)).toEqual({ embedded: 2, total: 2 })
    expect(vectorModel(db)).toEqual({ model: 'bge-m3', dim: 32 })
    expect(embedder.busy).toBe(false)
    expect(nearestChunks(db, fakeVector('b\n\nfour'), 1)[0].noteId).toBe(b)
  })

  it('a note modified mid-embedding: old vectors are not written, and new chunks go in the next batch', async () => {
    const { db, ollama, embedder } = setup()
    const a = note(db, 'a.md', ['old'])
    ollama.hold()
    embedder.wake()
    await Promise.resolve()
    setChunks(db, a, [{ line: 1, text: 'new', heading: '' }])
    ollama.release()
    await embedder.idle()
    expect(ollama.embedCalls).toEqual([['a\n\nold'], ['a\n\nnew']])
    expect(listChunks(db, a).map((c) => [c.text, c.embedded])).toEqual([['new', true]])
  })

  it('stops and records the error when offline, and continues when woken after recovering', async () => {
    const { db, ollama, embedder } = setup()
    note(db, 'a.md', ['one'])
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

  it('changing the embedding model invalidates old vectors and recomputes everything', async () => {
    const first = setup('m1')
    note(first.db, 'a.md', ['one'])
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

  it('stop aborts the request in progress and writes nothing afterwards', async () => {
    const { db, ollama, embedder } = setup()
    note(db, 'a.md', ['one'])
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
