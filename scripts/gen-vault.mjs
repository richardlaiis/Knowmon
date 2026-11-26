// Generates a large test vault (for performance tests; put the generated notes outside the repo and don't add them to git)
// Usage: node scripts/gen-vault.mjs <output folder> [notes=1000] [random seed=1]
// A plain JS script can't annotate return types
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import fs from 'node:fs'
import path from 'node:path'

const [out, countArg = '1000', seedArg = '1'] = process.argv.slice(2)
if (!out) {
  console.error('Usage: node scripts/gen-vault.mjs <output folder> [notes] [random seed]')
  process.exit(1)
}
if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
  console.error(`The output folder is not empty: ${out}`)
  process.exit(1)
}
const count = Number(countArg)
let seed = Number(seedArg) || 1
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const pick = (list) => list[Math.floor(random() * list.length)]

// About 1 in 5 topics is Chinese, so large vaults keep exercising CJK labels and trigram search
const topics = [
  'Habits',
  'Focus',
  'Reading',
  'Writing',
  'Time management',
  'Learning',
  'Health',
  'Investing',
  'Design',
  'Programming',
  'Travel',
  'Cooking',
  'Music',
  'Photography',
  'Psychology',
  'History',
  '哲學',
  '科學',
  '工作',
  '家庭'
]
const isChinese = (topic) => /[\u4e00-\u9fff]/.test(topic)
const englishWords = (
  'notes ideas links matter more than the notes themselves because new thinking happens ' +
  'between them a little review every day shows patterns that were not visible before ' +
  'today I wondered how knowledge connects across weeks and projects'
).split(' ')
const chineseChars =
  '今天想到一個關於知識管理的問題筆記之間的連結比筆記本身更重要因為想法是在連結中產生的每天花一點時間整理回顧就能看到新的脈絡'.split(
    ''
  )
const sentence = (chinese) =>
  chinese
    ? Array.from({ length: 12 + Math.floor(random() * 30) }, () => pick(chineseChars)).join('') +
      '。'
    : (() => {
        const w = Array.from({ length: 6 + Math.floor(random() * 14) }, () => pick(englishWords))
        return w[0][0].toUpperCase() + w.join(' ').slice(1) + '.'
      })()

// Some are journal notes (with a date in the file name); the rest go into folders by topic
const notes = []
const journalCount = Math.floor(count * 0.2)
const start = Date.UTC(2025, 0, 1)
for (let i = 0; i < journalCount; i++) {
  const d = new Date(start + i * 86400000).toISOString().slice(0, 10)
  notes.push({ rel: `Journal/${d}.md`, title: d, topic: null })
}
for (let i = notes.length; i < count; i++) {
  const topic = topics[i % topics.length]
  const title = isChinese(topic) ? `${topic} 筆記 ${i}` : `${topic} note ${i}`
  notes.push({ rel: `${topic}/${title}.md`, title, topic })
}

// Links: mostly to the same topic (forming clusters), a few across topics; early notes are more likely to be linked (forming hubs)
const byTopic = new Map()
for (const n of notes) if (n.topic) byTopic.set(n.topic, [...(byTopic.get(n.topic) ?? []), n])
for (const n of notes) {
  const k = Math.floor(random() * 5)
  const links = new Set()
  for (let j = 0; j < k; j++) {
    const pool = n.topic && random() < 0.75 ? byTopic.get(n.topic) : notes
    const target = pool[Math.floor(random() ** 2 * pool.length)]
    if (target !== n) links.add(target.title)
  }
  n.links = [...links]
}

for (const n of notes) {
  const file = path.join(out, n.rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const zh = n.topic !== null && isChinese(n.topic)
  const body = [
    `# ${n.title}`,
    '',
    sentence(zh) + (zh ? '' : ' ') + sentence(zh),
    '',
    ...n.links.map((t) => `- ${zh ? '相關：' : 'Related: '}[[${t}]] ${sentence(zh)}`),
    '',
    sentence(zh)
  ].join('\n')
  const fm =
    n.topic && random() < 0.3
      ? `---\ndate: 2026-0${1 + Math.floor(random() * 9)}-1${Math.floor(random() * 9)}\n---\n`
      : ''
  fs.writeFileSync(file, fm + body)
}
const linkCount = notes.reduce((s, n) => s + n.links.length, 0)
console.log(`Generated ${notes.length} notes and ${linkCount} links → ${out}`)
