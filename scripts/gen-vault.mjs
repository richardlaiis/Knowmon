// 產生大型測試 vault（效能測試用；產生的筆記請放在 repo 以外，不要加入 git）
// 用法：node scripts/gen-vault.mjs <輸出資料夾> [筆記數=1000] [亂數種子=1]
// 純 JS 腳本無法標註回傳型別
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import fs from 'node:fs'
import path from 'node:path'

const [out, countArg = '1000', seedArg = '1'] = process.argv.slice(2)
if (!out) {
  console.error('用法：node scripts/gen-vault.mjs <輸出資料夾> [筆記數] [亂數種子]')
  process.exit(1)
}
if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
  console.error(`輸出資料夾不是空的：${out}`)
  process.exit(1)
}
const count = Number(countArg)
let seed = Number(seedArg) || 1
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const pick = (list) => list[Math.floor(random() * list.length)]

const topics = [
  '習慣',
  '專注',
  '閱讀',
  '寫作',
  '時間管理',
  '學習',
  '健康',
  '投資',
  '設計',
  '程式',
  '旅行',
  '烹飪',
  '音樂',
  '攝影',
  '心理學',
  '歷史',
  '哲學',
  '科學',
  '工作',
  '家庭'
]
const words =
  '今天想到一個關於知識管理的問題筆記之間的連結比筆記本身更重要因為想法是在連結中產生的每天花一點時間整理回顧就能看到新的脈絡'.split(
    ''
  )
const sentence = () =>
  Array.from({ length: 12 + Math.floor(random() * 30) }, () => pick(words)).join('') + '。'

// 一部分是日記（檔名帶日期），其餘依主題分資料夾
const notes = []
const journalCount = Math.floor(count * 0.2)
const start = Date.UTC(2025, 0, 1)
for (let i = 0; i < journalCount; i++) {
  const d = new Date(start + i * 86400000).toISOString().slice(0, 10)
  notes.push({ rel: `日記/${d}.md`, title: d, topic: null })
}
for (let i = notes.length; i < count; i++) {
  const topic = topics[i % topics.length]
  const title = `${topic} 筆記 ${i}`
  notes.push({ rel: `${topic}/${title}.md`, title, topic })
}

// 連結：多半連到同主題（形成群集），少數跨主題；早期筆記較容易被連（形成樞紐）
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
  const body = [
    `# ${n.title}`,
    '',
    sentence() + sentence(),
    '',
    ...n.links.map((t) => `- 相關：[[${t}]] ${sentence()}`),
    '',
    sentence()
  ].join('\n')
  const fm =
    n.topic && random() < 0.3
      ? `---\ndate: 2026-0${1 + Math.floor(random() * 9)}-1${Math.floor(random() * 9)}\n---\n`
      : ''
  fs.writeFileSync(file, fm + body)
}
const linkCount = notes.reduce((s, n) => s + n.links.length, 0)
console.log(`已產生 ${notes.length} 篇筆記、${linkCount} 個連結 → ${out}`)
