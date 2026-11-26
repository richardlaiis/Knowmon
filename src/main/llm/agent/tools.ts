// Agent tools: the four read-only tools run directly; write tools (create_note, add_tags) only produce proposals,
// written by applyProposal after the user confirms. The model gets compact plain text (small models read JSON less reliably).
// Notes are written as "title (path: …, date: …)": with "title | path", the model copies it as [[title | path]].
import { existsSync } from 'node:fs'
import { createLinkResolver } from '../../../shared/links'
import { parseTimeRange, withoutTimeRange } from '../../../shared/timeRange'
import type {
  AgentProposal,
  AgentToolName,
  DateRange,
  LinkType,
  RetrieveHit,
  TextSegment
} from '../../../shared/types'
import { getNoteByPath, listAllNotes, listLinks } from '../../db'
import { parseNote } from '../../indexer/parse'
import type { Vault } from '../../vault'
import { normalizeRel, resolveInVault, titleFromPath } from '../../vault/paths'
import { keywords, notesInRange } from '../ask'
import type { ToolDefinition } from '../ollama'
import { noteDay, retrieve } from '../retrieve'
import { linkTargets } from '../summarize'
import { addTags, existingTags, normalizeTag } from './tags'

/** Maximum body characters get_note returns at a time (still within TOOL_RESULT_MAX with the header; scaled per settings, see budget.ts) */
export const NOTE_CHARS = 1_200
/** Maximum snippet characters per note in search and list results */
export const HIT_SNIPPET_CHARS = 80
/** Maximum notes listed per type by get_neighbors */
export const NEIGHBORS_PER_TYPE = 10

export interface ToolContext {
  vault: Vault
  /** The query vector; null when offline or vectors aren't built yet (retrieval falls back to full text) */
  queryVector: (text: string) => Promise<number[] | null>
  /** The current time for parsing time phrases such as 「上週」 "last week" */
  now: number
  /** Characters per get_note page; defaults to NOTE_CHARS */
  noteChars?: number
}

export interface NoteRef {
  path: string
  title: string
}

export interface ToolOutcome {
  /** Text returned to the model */
  text: string
  /** A one-line description for the user */
  label: string
  notes: NoteRef[]
  /** Write tools: the proposal waiting for the user's confirmation */
  proposal?: AgentProposal
  /** Other [[links]] allowed to remain in the answer (links in the note text that was read) */
  links?: string[]
}

/** Invalid arguments, missing notes and so on: the message goes back to the model so it can correct itself */
export class ToolError extends Error {}

export const WRITE_TOOLS: ReadonlySet<AgentToolName> = new Set(['create_note', 'add_tags'])

const PERIOD_HELP =
  'Use the user\'s own wording, e.g. "last week", "上個月", "最近 7 天", "2026-09", "2026-09-01 to 2026-09-15".'

const fn = (
  name: AgentToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): ToolDefinition => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } }
})

const NOTE_PARAM = { type: 'string', description: 'Path or title of the note' }

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  fn(
    'search_notes',
    "Search the user's notes by keywords and meaning. Returns the most relevant notes with a short passage from each.",
    {
      query: { type: 'string', description: 'What to look for (keywords or a short question)' },
      period: {
        type: 'string',
        description: `Only when the user's request mentions a time: the time range of the notes. Otherwise leave it out. ${PERIOD_HELP}`
      },
      limit: { type: 'integer', description: 'Maximum number of notes (default 5, at most 10)' }
    },
    ['query']
  ),
  fn(
    'get_note',
    'Read the full text of one note, with its date and tags. Long notes are returned in parts; use offset to read further.',
    {
      path: NOTE_PARAM,
      offset: { type: 'integer', description: 'Character offset to start reading from (default 0)' }
    },
    ['path']
  ),
  fn(
    'get_neighbors',
    'List notes connected to a note: wikilinks in both directions, notes edited in the same session, notes with a close event date, the previous and next note in the same folder, and semantically similar notes.',
    {
      path: NOTE_PARAM,
      types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['wikilink', 'same_session', 'same_day', 'sequence', 'semantic']
        },
        description: 'Only these connection types (default: all)'
      }
    },
    ['path']
  ),
  fn(
    'list_notes_in_range',
    'List the notes in a time range (by the date the note is about, or when it was last modified), newest first.',
    {
      period: { type: 'string', description: `The time range. ${PERIOD_HELP}` },
      from: { type: 'string', description: 'Start date YYYY-MM-DD (instead of period)' },
      to: { type: 'string', description: 'End date YYYY-MM-DD (instead of period)' },
      limit: { type: 'integer', description: 'Maximum number of notes (default 10, at most 15)' }
    },
    []
  ),
  fn(
    'create_note',
    'Create a new Markdown note. The user reviews and confirms it before it is written. Never overwrites an existing note.',
    {
      path: {
        type: 'string',
        description: 'Path of the new note relative to the vault, e.g. "整理/比較.md"'
      },
      content: { type: 'string', description: 'Full Markdown content of the note' }
    },
    ['path', 'content']
  ),
  fn(
    'add_tags',
    "Add tags to a note's frontmatter. The user confirms before it is written.",
    {
      path: NOTE_PARAM,
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add, without #' }
    },
    ['path', 'tags']
  )
]

export const isToolName = (name: string): name is AgentToolName =>
  TOOL_DEFINITIONS.some((t) => t.function.name === name)

// ---- Arguments ----

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

function int(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : def
}

/** An array of strings; models sometimes send a comma-separated string */
function strings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean)
  return str(v)
    .split(/[,，、\s]+/)
    .filter(Boolean)
}

function parsePeriod(period: string, now: number): DateRange {
  const m = parseTimeRange(period, now)
  if (!m) throw new ToolError(`Could not understand the period "${period}". ${PERIOD_HELP}`)
  return m.range
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A note's path or title (optionally with [[ ]] and .md) → the note */
function resolveNote(ctx: ToolContext, input: unknown): NoteRef & { date: string } {
  const raw = str(input)
    .trim()
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/^\/+/, '')
  if (!raw) throw new ToolError('The path is empty.')
  const db = ctx.vault.db
  const exact = getNoteByPath(db, raw) ?? getNoteByPath(db, `${raw}.md`)
  const path =
    exact?.path ?? createLinkResolver(listAllNotes(db).map((n) => n.path))(raw.replace(/\|.*$/, ''))
  const note = path ? getNoteByPath(db, path) : null
  if (!note) throw new ToolError(`Note not found: "${raw}". Use search_notes to find its path.`)
  return { path: note.path, title: note.title, date: noteDay(note) }
}

// ---- Output ----

const fmtRange = (r: DateRange): string => (r.from === r.to ? r.from : `${r.from} – ${r.to}`)
const plain = (segments: readonly TextSegment[]): string =>
  segments
    .map((s) => s.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function hitList(ctx: ToolContext, hits: readonly RetrieveHit[]): string {
  return hits
    .map((h, i) => {
      const note = getNoteByPath(ctx.vault.db, h.path)
      const date = note ? noteDay(note) : ''
      const full = plain(h.snippet)
      const snippet =
        full.length > HIT_SNIPPET_CHARS ? `${full.slice(0, HIT_SNIPPET_CHARS)}…` : full
      return `${i + 1}. ${h.title} (path: ${h.path}, date: ${date})${snippet ? `\n   ${snippet}` : ''}`
    })
    .join('\n')
}

const refs = (hits: readonly { path: string; title: string }[]): NoteRef[] =>
  hits.map((h) => ({ path: h.path, title: h.title }))

// ---- Tools ----

/** Description shown for a running step (before results arrive, or on error) */
export function callLabel(name: AgentToolName, args: Record<string, unknown>): string {
  const a = (k: string): string => str(args[k]).trim()
  switch (name) {
    case 'search_notes':
      return `Search “${a('query')}”${a('period') ? ` · ${a('period')}` : ''}`
    case 'get_note':
      return `Read ${a('path')}`
    case 'get_neighbors':
      return `Connections of ${a('path')}`
    case 'list_notes_in_range':
      return `Notes from ${a('period') || `${a('from')} – ${a('to')}`}`
    case 'create_note':
      return `Create ${a('path')}`
    case 'add_tags':
      return `Add tags to ${a('path')}`
  }
}

export async function runTool(
  ctx: ToolContext,
  name: AgentToolName,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  switch (name) {
    case 'search_notes':
      return searchNotesTool(ctx, args)
    case 'get_note':
      return getNoteTool(ctx, args)
    case 'get_neighbors':
      return getNeighborsTool(ctx, args)
    case 'list_notes_in_range':
      return listInRangeTool(ctx, args)
    case 'create_note':
      return proposeNote(ctx, args)
    case 'add_tags':
      return proposeTags(ctx, args)
  }
}

async function searchNotesTool(
  ctx: ToolContext,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const query = str(args.query).trim()
  const period = str(args.period).trim()
  const limit = int(args.limit, 5, 1, 10)
  let range = period ? parsePeriod(period, ctx.now) : null
  let text = query
  // Models often put the time in query (「上週 深度工作」, "last week deep work")
  if (!range) {
    const m = parseTimeRange(query, ctx.now)
    if (m) {
      range = m.range
      text = withoutTimeRange(query, m)
    }
  }
  if (!text.trim() && !range) throw new ToolError('The query is empty.')
  const db = ctx.vault.db
  const kws = keywords(text)
  let hits: RetrieveHit[] = []
  if (kws.length > 0 || !range) {
    const qv = await ctx.queryVector(text)
    hits = retrieve(db, text, qv, { limit, ...(range ?? {}) }, kws).hits
  }
  if (hits.length === 0 && range) hits = notesInRange(db, range, limit)
  const scope = range ? ` (${fmtRange(range)})` : ''
  const label = `Search “${text.trim() || query}”${scope} → ${plural(hits.length, 'note')}`
  if (hits.length === 0) return { text: `No notes found${scope}.`, label, notes: [] }
  return {
    text: `${plural(hits.length, 'note')} found${scope}:\n${hitList(ctx, hits)}`,
    label,
    notes: refs(hits)
  }
}

async function getNoteTool(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome> {
  const note = resolveNote(ctx, args.path)
  const parsed = parseNote(note.path, await ctx.vault.peek(note.path))
  // The blank lines that replaced the frontmatter aren't needed
  const body = parsed.body.replace(/^\s*\n/, '')
  const tags = existingTags(parsed.frontmatter)
  const offset = int(args.offset, 0, 0, Math.max(0, body.length))
  const end = Math.min(body.length, offset + (ctx.noteChars ?? NOTE_CHARS))
  const header = [
    `Title: ${note.title}`,
    `Path: ${note.path}`,
    `Date: ${note.date}`,
    tags.length ? `Tags: ${tags.join(', ')}` : ''
  ].filter(Boolean)
  const more =
    end < body.length || offset > 0
      ? `\n\n(Showing characters ${offset}–${end} of ${body.length}.${end < body.length ? ` Call get_note with offset=${end} to read more.` : ''})`
      : ''
  return {
    text: `${header.join('\n')}\n\n${body.slice(offset, end).trim() || '(empty)'}${more}`,
    label: `Read ${note.title}${offset > 0 ? ` (from ${offset})` : ''}`,
    notes: [{ path: note.path, title: note.title }],
    links: linkTargets(body)
  }
}

const NEIGHBOR_TYPES: LinkType[] = ['wikilink', 'same_session', 'same_day', 'sequence', 'semantic']

async function getNeighborsTool(
  ctx: ToolContext,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const note = resolveNote(ctx, args.path)
  const asked = strings(args.types).filter((t): t is LinkType =>
    NEIGHBOR_TYPES.includes(t as LinkType)
  )
  const types = new Set(asked.length ? asked : NEIGHBOR_TYPES)
  // graph() first recomputes stale time edges and semantic edges
  const graph = await ctx.vault.graph()
  const titles = new Map(graph.nodes.map((n) => [n.path, n.title]))

  type Item = { path: string; weight: number }
  const groups = new Map<string, Item[]>()
  const add = (group: string, path: string, weight: number): void => {
    const list = groups.get(group) ?? []
    const same = list.find((i) => i.path === path)
    if (same) same.weight += weight
    else list.push({ path, weight })
    groups.set(group, list)
  }
  for (const e of graph.edges) {
    if (!types.has(e.type) || (e.source !== note.path && e.target !== note.path)) continue
    const out = e.source === note.path
    const other = out ? e.target : e.source
    if (e.type === 'wikilink') add(out ? 'Links to' : 'Linked from', other, e.weight)
    else if (e.type === 'same_session') add('Edited in the same session', other, e.weight)
    else if (e.type === 'same_day') add('Close event date', other, e.weight)
    else if (e.type === 'sequence') add(out ? 'Next in folder' : 'Previous in folder', other, 1)
    else add('Semantically similar', other, e.weight)
  }

  const lines: string[] = []
  const notes = new Map<string, NoteRef>()
  for (const [group, items] of groups) {
    const top = items.sort((a, b) => b.weight - a.weight).slice(0, NEIGHBORS_PER_TYPE)
    lines.push(`${group}:`)
    for (const i of top) {
      const title = titles.get(i.path) ?? titleFromPath(i.path)
      notes.set(i.path, { path: i.path, title })
      const detail =
        group === 'Semantically similar'
          ? `, similarity ${i.weight.toFixed(2)}`
          : group === 'Edited in the same session'
            ? `, ${plural(Math.round(i.weight), 'session')}`
            : ''
      lines.push(`- ${title} (path: ${i.path}${detail})`)
    }
  }
  // Links to notes that don't exist yet
  if (types.has('wikilink')) {
    const id = getNoteByPath(ctx.vault.db, note.path)!.id
    const missing = listLinks(ctx.vault.db, 'wikilink')
      .filter((l) => l.src === id && l.dst === null && l.target)
      .map((l) => l.target!)
    if (missing.length) lines.push(`Links to notes that don't exist yet: ${missing.join(', ')}`)
  }
  return {
    text: lines.length
      ? `Connections of ${note.title} (${note.path}):\n${lines.join('\n')}`
      : `${note.title} has no connections.`,
    label: `Connections of ${note.title} → ${plural(notes.size, 'note')}`,
    notes: [...notes.values()]
  }
}

function listInRangeTool(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const period = str(args.period).trim()
  const from = str(args.from).trim()
  const to = str(args.to).trim()
  let range: DateRange
  if (period) range = parsePeriod(period, ctx.now)
  else if (DAY.test(from) || DAY.test(to)) {
    const a = DAY.test(from) ? from : '1900-01-01'
    const b = DAY.test(to) ? to : '2100-12-31'
    range = a <= b ? { from: a, to: b } : { from: b, to: a }
  } else throw new ToolError(`Give a period or from/to dates (YYYY-MM-DD). ${PERIOD_HELP}`)
  const hits = notesInRange(ctx.vault.db, range, int(args.limit, 10, 1, 15))
  const label = `Notes from ${fmtRange(range)} → ${plural(hits.length, 'note')}`
  if (hits.length === 0) return { text: `No notes from ${fmtRange(range)}.`, label, notes: [] }
  return {
    text: `${plural(hits.length, 'note')} from ${fmtRange(range)} (newest first):\n${hitList(ctx, hits)}`,
    label,
    notes: refs(hits)
  }
}

// ---- Write tools: proposals ----

/** Path for a new note: append .md, reject escaping the vault and hidden folders, never overwrite an existing note */
export function newNotePath(ctx: ToolContext, input: unknown): string {
  let p = str(input).trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p) throw new ToolError('The path is empty.')
  if (!/\.md$/i.test(p)) p += '.md'
  try {
    p = normalizeRel(p)
  } catch (e) {
    throw new ToolError((e as Error).message)
  }
  if (getNoteByPath(ctx.vault.db, p) || existsSync(resolveInVault(ctx.vault.root, p))) {
    throw new ToolError(`A note already exists at ${p}. Choose another path.`)
  }
  return p
}

/** Links in the content pointing to missing notes (marked in the preview) */
function missingLinks(ctx: ToolContext, content: string): string[] {
  const resolve = createLinkResolver(listAllNotes(ctx.vault.db).map((n) => n.path))
  return linkTargets(content).filter((t) => resolve(t) === null)
}

function proposeNote(ctx: ToolContext, args: Record<string, unknown>): ToolOutcome {
  const path = newNotePath(ctx, args.path)
  const content = str(args.content)
  if (!content.trim()) throw new ToolError('The content is empty.')
  return {
    text: '',
    label: `Create ${path}`,
    notes: [],
    proposal: { kind: 'create_note', path, content, missingLinks: missingLinks(ctx, content) }
  }
}

function tagEdit(content: string, tags: readonly string[]): ReturnType<typeof addTags> {
  try {
    return addTags(content, tags)
  } catch (e) {
    throw new ToolError((e as Error).message)
  }
}

async function proposeTags(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome> {
  const note = resolveNote(ctx, args.path)
  const tags = strings(args.tags).map(normalizeTag).filter(Boolean)
  if (tags.length === 0) throw new ToolError('No tags were given.')
  const edit = tagEdit(await ctx.vault.peek(note.path), tags)
  const ref = { path: note.path, title: note.title }
  if (edit.added.length === 0) {
    return {
      text: `"${note.title}" already has these tags: ${tags.join(', ')}. Nothing to change.`,
      label: `${note.title} already has ${tags.map((t) => `#${t}`).join(' ')}`,
      notes: [ref]
    }
  }
  return {
    text: '',
    label: `Add ${edit.added.map((t) => `#${t}`).join(' ')} to ${note.title}`,
    notes: [ref],
    proposal: {
      kind: 'add_tags',
      path: note.path,
      title: note.title,
      tags: edit.added,
      before: edit.before,
      after: edit.after
    }
  }
}

// ---- Write tools: after the user confirms ----

/**
 * Writes a proposal. edited is the user's modified version (only create_note's path / content and
 * add_tags' tags are used). add_tags rereads the file at write time, so edits made while waiting aren't overwritten.
 */
export async function applyProposal(
  ctx: ToolContext,
  proposal: AgentProposal,
  edited?: AgentProposal
): Promise<ToolOutcome> {
  if (proposal.kind === 'create_note') {
    const e = edited?.kind === 'create_note' ? edited : null
    const path = e && e.path !== proposal.path ? newNotePath(ctx, e.path) : proposal.path
    const content = e ? e.content : proposal.content
    await ctx.vault.create(path, content)
    const title = titleFromPath(path)
    const changed = path !== proposal.path || content !== proposal.content
    return {
      text: `Created the note "${title}" at ${path}.${changed ? ' The user edited it before saving.' : ''}`,
      label: `Created ${path}`,
      notes: [{ path, title }],
      proposal: { ...proposal, path, content, missingLinks: missingLinks(ctx, content) }
    }
  }
  const tags = (edited?.kind === 'add_tags' ? edited.tags : proposal.tags)
    .map(normalizeTag)
    .filter(Boolean)
  const ref = { path: proposal.path, title: proposal.title }
  if (tags.length === 0) {
    return {
      text: 'The user removed all the tags, so nothing was changed.',
      label: `No tags added to ${proposal.title}`,
      notes: [ref]
    }
  }
  let added: string[] = []
  await ctx.vault.update(proposal.path, (content) => {
    const edit = tagEdit(content, tags)
    added = edit.added
    return edit.content
  })
  const list = added.map((t) => `#${t}`).join(' ')
  return {
    text: added.length
      ? `Added tags ${added.join(', ')} to "${proposal.title}".`
      : `"${proposal.title}" already had these tags; nothing was changed.`,
    label: added.length ? `Added ${list} to ${proposal.title}` : `${proposal.title} unchanged`,
    notes: [ref],
    proposal: { ...proposal, tags }
  }
}
