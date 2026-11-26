import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentProposal } from '../../../shared/types'
import { Vault } from '../../vault'
import { applyProposal, NOTE_CHARS, runTool, ToolError, type ToolContext } from './tools'

// 2026-10-18 is a Sunday: this week = 10-12 – 10-18, last week = 10-05 – 10-11
const NOW = new Date(2026, 9, 18, 12).getTime()
const LONG = Array(200)
  .fill('Deep work needs long stretches of focus without interruption.')
  .join(' ')

let root: string
let vault: Vault
let ctx: ToolContext

function write(rel: string, content: string, mtime?: Date): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  if (mtime) fs.utimesSync(abs, mtime, mtime)
}
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-tools-'))
  write(
    'Books/Atomic Habits.md',
    '---\ndate: 2026-10-01\ntags: [book, habits]\n---\n# Atomic Habits\n\nGet 1% better every day. Related: [[Deep Work]], [[A missing note]]\n'
  )
  write('Books/Deep Work.md', `---\ndate: 2026-09-20\n---\n${LONG}`)
  write('Journal/2026-10-12.md', 'Read [[Atomic Habits]] today. Habits are powerful.')
  write('Journal/2026-10-14.md', 'Wrote code and built the timeline.')
  write('Broken.md', '---\ntags: [a\nb: : :\n---\nbody', new Date(2025, 0, 1))
  vault = await Vault.open(root, { now: () => NOW })
  ctx = { vault, now: NOW, queryVector: async () => null }
})

afterEach(async () => {
  await vault.close()
  fs.rmSync(root, { recursive: true, force: true })
})

async function toolError(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ToolError)
    return (e as Error).message
  }
  throw new Error('expected a ToolError')
}

describe('search_notes', () => {
  it('lists the title, path, date and passage of each note', async () => {
    const r = await runTool(ctx, 'search_notes', { query: 'Atomic Habits' })
    expect(r.notes[0]).toEqual({ path: 'Books/Atomic Habits.md', title: 'Atomic Habits' })
    expect(r.text).toMatch(
      /^\d+ notes? found:\n1\. Atomic Habits \(path: Books\/Atomic Habits\.md, date: 2026-10-01\)\n {3}\S/
    )
    expect(r.label).toMatch(/^Search “Atomic Habits” → \d+ notes?$/)
    expect(r.proposal).toBeUndefined()
  })

  it('period is parsed by parseTimeRange; a time written in query counts too', async () => {
    for (const args of [
      { query: 'Atomic Habits', period: 'this week' },
      { query: 'this week Atomic Habits' }
    ]) {
      const r = await runTool(ctx, 'search_notes', args)
      expect(r.notes.map((n) => n.path)).toEqual(['Journal/2026-10-12.md'])
      expect(r.text).toContain('(2026-10-12 – 2026-10-18)')
    }
  })

  it('lists the notes in the range when there is only a time', async () => {
    const r = await runTool(ctx, 'search_notes', { query: 'this week' })
    expect(r.notes.map((n) => n.path)).toEqual(['Journal/2026-10-14.md', 'Journal/2026-10-12.md'])
  })

  it('an unparseable period and an empty query return errors', async () => {
    expect(
      await toolError(runTool(ctx, 'search_notes', { query: 'x', period: 'a long time ago' }))
    ).toMatch(/Could not understand the period "a long time ago"/)
    expect(await toolError(runTool(ctx, 'search_notes', { query: ' ' }))).toMatch(/empty/)
  })

  it('explains when nothing is found', async () => {
    const r = await runTool(ctx, 'search_notes', { query: 'quantum mechanics' })
    expect(r.text).toBe('No notes found.')
    expect(r.notes).toEqual([])
  })
})

describe('get_note', () => {
  it('gets the body, date and tags by title, [[title]] or path, without recording open', async () => {
    for (const p of [
      'Atomic Habits',
      '[[Atomic Habits]]',
      'Books/Atomic Habits.md',
      'Books/Atomic Habits'
    ]) {
      const r = await runTool(ctx, 'get_note', { path: p })
      expect(r.text).toBe(
        'Title: Atomic Habits\nPath: Books/Atomic Habits.md\nDate: 2026-10-01\nTags: book, habits\n\n' +
          '# Atomic Habits\n\nGet 1% better every day. Related: [[Deep Work]], [[A missing note]]'
      )
      expect(r.links).toEqual(['Deep Work', 'A missing note'])
    }
    const events = vault.db
      .prepare("SELECT COUNT(*) AS n FROM note_events WHERE kind = 'open'")
      .get()
    expect(events).toEqual({ n: 0 })
  })

  it('reads long notes in parts', async () => {
    const first = await runTool(ctx, 'get_note', { path: 'Deep Work' })
    expect(first.text).toContain(`Showing characters 0–${NOTE_CHARS} of ${LONG.length}`)
    expect(first.text).toContain(`offset=${NOTE_CHARS}`)
    const last = await runTool(ctx, 'get_note', { path: 'Deep Work', offset: LONG.length - 10 })
    expect(last.text).toContain(LONG.slice(-10))
    expect(last.text).not.toContain('to read more')

    // The page size follows the configured context length (ToolContext.noteChars)
    const small = await runTool({ ...ctx, noteChars: 300 }, 'get_note', { path: 'Deep Work' })
    expect(small.text).toContain(`Showing characters 0–300 of ${LONG.length}`)
    expect(small.text).toContain('offset=300')
  })

  it('returns an error for a missing note', async () => {
    expect(await toolError(runTool(ctx, 'get_note', { path: 'No such note' }))).toMatch(
      /Note not found: "No such note"/
    )
  })
})

describe('get_neighbors', () => {
  it('lists links, backlinks and targets not yet created, by type', async () => {
    const r = await runTool(ctx, 'get_neighbors', { path: 'Atomic Habits' })
    expect(r.text).toContain('Links to:\n- Deep Work (path: Books/Deep Work.md)')
    expect(r.text).toContain('Linked from:\n- 2026-10-12 (path: Journal/2026-10-12.md)')
    expect(r.text).toContain("Links to notes that don't exist yet: A missing note")
    expect(r.notes.map((n) => n.title)).toEqual(expect.arrayContaining(['Deep Work', '2026-10-12']))
  })

  it('previous and next notes in the same folder; can take only some types', async () => {
    const r = await runTool(ctx, 'get_neighbors', { path: '2026-10-12', types: ['sequence'] })
    expect(r.text).toContain('Next in folder:\n- 2026-10-14 (path: Journal/2026-10-14.md)')
    expect(r.text).not.toContain('Links to')
    const none = await runTool(ctx, 'get_neighbors', { path: 'Broken', types: ['semantic'] })
    expect(none.text).toBe('Broken has no connections.')
  })
})

describe('list_notes_in_range', () => {
  it('period or from / to, newest first', async () => {
    const a = await runTool(ctx, 'list_notes_in_range', { period: 'this week' })
    expect(a.notes.map((n) => n.title)).toEqual(['2026-10-14', '2026-10-12'])
    expect(a.label).toBe('Notes from 2026-10-12 – 2026-10-18 → 2 notes')
    const b = await runTool(ctx, 'list_notes_in_range', { from: '2026-09-01', to: '2026-10-01' })
    expect(b.notes.map((n) => n.title)).toEqual(['Atomic Habits', 'Deep Work'])
    expect(await toolError(runTool(ctx, 'list_notes_in_range', {}))).toMatch(/period or from\/to/)
  })
})

describe('create_note', () => {
  it('creates a proposal without writing; appends .md and marks missing links', async () => {
    const r = await runTool(ctx, 'create_note', {
      path: 'Summaries/Comparison',
      content: '[[Atomic Habits]] and [[Deep Work]], [[New topic]]'
    })
    expect(r.proposal).toEqual({
      kind: 'create_note',
      path: 'Summaries/Comparison.md',
      content: '[[Atomic Habits]] and [[Deep Work]], [[New topic]]',
      missingLinks: ['New topic']
    })
    expect(fs.existsSync(path.join(root, 'Summaries/Comparison.md'))).toBe(false)
  })

  it('rejects existing notes, paths escaping the vault, hidden folders and empty content', async () => {
    const make = (p: string, content = 'x'): Promise<unknown> =>
      runTool(ctx, 'create_note', { path: p, content })
    expect(await toolError(make('Books/Atomic Habits.md'))).toMatch(/already exists/)
    expect(await toolError(make('../outside.md'))).toMatch(/outside the vault/)
    expect(await toolError(make('.knowmon/x.md'))).toMatch(/Hidden/)
    expect(await toolError(make('New.md', '  '))).toMatch(/empty/)
  })

  it("writes after confirmation; the user's edited path and content take precedence", async () => {
    const { proposal } = await runTool(ctx, 'create_note', {
      path: 'Comparison.md',
      content: 'First draft'
    })
    const edited: AgentProposal = {
      ...proposal!,
      path: 'Summaries/Comparison v2',
      content: 'Edited'
    } as AgentProposal
    const r = await applyProposal(ctx, proposal!, edited)
    expect(read('Summaries/Comparison v2.md')).toBe('Edited')
    expect(fs.existsSync(path.join(root, 'Comparison.md'))).toBe(false)
    expect(r.notes).toEqual([{ path: 'Summaries/Comparison v2.md', title: 'Comparison v2' }])
    expect(r.text).toContain('The user edited it')
    expect(vault.list().map((n) => n.path)).toContain('Summaries/Comparison v2.md')
  })

  it('does not overwrite when someone created a note with the same name while waiting', async () => {
    const { proposal } = await runTool(ctx, 'create_note', {
      path: 'Comparison.md',
      content: 'First draft'
    })
    write('Comparison.md', 'Written by someone else')
    await expect(applyProposal(ctx, proposal!)).rejects.toThrow(/already exists/)
    expect(read('Comparison.md')).toBe('Written by someone else')
  })
})

describe('add_tags', () => {
  it('the proposal includes the frontmatter before and after; existing tags are not duplicated', async () => {
    const r = await runTool(ctx, 'add_tags', { path: 'Atomic Habits', tags: ['#habits', 'review'] })
    expect(r.proposal).toEqual({
      kind: 'add_tags',
      path: 'Books/Atomic Habits.md',
      title: 'Atomic Habits',
      tags: ['review'],
      before: '---\ndate: 2026-10-01\ntags: [book, habits]\n---\n',
      after: '---\ndate: 2026-10-01\ntags: [book, habits, review]\n---\n'
    })
    expect(read('Books/Atomic Habits.md')).toContain('tags: [book, habits]\n')
  })

  it('no confirmation needed when every tag exists; comma-separated strings are accepted', async () => {
    const r = await runTool(ctx, 'add_tags', { path: 'Atomic Habits', tags: 'book, habits' })
    expect(r.proposal).toBeUndefined()
    expect(r.text).toContain('already has these tags')
  })

  it('returns an error for corrupt frontmatter', async () => {
    expect(await toolError(runTool(ctx, 'add_tags', { path: 'Broken', tags: ['x'] }))).toMatch(
      /not valid YAML/
    )
  })

  it('rereads the file on confirmation, keeping edits made while waiting; individual tags can be removed', async () => {
    const { proposal } = await runTool(ctx, 'add_tags', {
      path: '2026-10-12',
      tags: ['journal', 'review']
    })
    await vault.write(
      'Journal/2026-10-12.md',
      'Read [[Atomic Habits]] today. Added a paragraph in the evening.'
    )
    const edited = { ...proposal!, tags: ['review'] } as AgentProposal
    const r = await applyProposal(ctx, proposal!, edited)
    expect(read('Journal/2026-10-12.md')).toBe(
      '---\ntags: [review]\n---\nRead [[Atomic Habits]] today. Added a paragraph in the evening.'
    )
    expect(r.label).toBe('Added #review to 2026-10-12')
  })

  it('writes nothing when the user removes every tag', async () => {
    const { proposal } = await runTool(ctx, 'add_tags', { path: '2026-10-14', tags: ['x'] })
    const before = read('Journal/2026-10-14.md')
    const r = await applyProposal(ctx, proposal!, { ...proposal!, tags: [] } as AgentProposal)
    expect(read('Journal/2026-10-14.md')).toBe(before)
    expect(r.text).toContain('nothing was changed')
  })
})
