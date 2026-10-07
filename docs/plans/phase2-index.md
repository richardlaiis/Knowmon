# 階段 2 實作計畫：索引、連結、搜尋

完成標準：反向連結與中文搜尋正常，刪掉資料庫後能完整重建。

## 已確認的決定（2026-10-07）

- 同意下方的 `types.ts` 合約變更與 schema v2。
- 標題一律用檔名（同 Obsidian），frontmatter 的 `title:` 只是一般屬性。
- 包含 `Ctrl/Cmd+點擊` wikilink 開啟；Quick switcher 沒有結果時不建立筆記。

## 解析器（`src/main/indexer/`，純函式）

`parseNote(path, content)` 回傳（標題仍由 `titleFromPath` 從檔名取得）：

- `eventDate`：frontmatter `date:`（YAML 日期、`2026-10-01`、`2026/10/1`、含時間的字串都取日期部分）優先，其次是檔名開頭的 `YYYY-MM-DD`（例如 `2026-10-06.md`、`2026-10-06 會議.md`）。不合法的日期（`2026-02-30`）視為沒有。
- `body`：去掉 frontmatter 的內文（給全文搜尋）。
- `links`：所有 `[[目標]]`、`[[目標|顯示]]`、`[[目標#標題]]`、`![[嵌入]]`，目標去掉 `#...` 與 `.md`。排除程式碼區塊、行內程式碼與 frontmatter 內的。記錄行號，供反向連結顯示上下文。
- frontmatter 損毀（YAML 錯誤）時當作沒有 frontmatter，不中斷索引。

連結解析 `resolveLink(target, paths)` 放在 `src/shared/links.ts`（純函式，main 與 renderer 共用，renderer 點擊連結時用同一套規則）：

1. 不分大小寫。
2. 目標含 `/`：比對路徑結尾（`[[Knowmon/時間脈絡連結]]`）。
3. 否則比對檔名。
4. 多篇同名時取路徑最短者，再依字母序（與 Obsidian 相近）。

## Schema（`SCHEMA_VERSION` 1 → 2，舊 DB 自動重建）

```sql
CREATE TABLE links (
  src    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  dst    INTEGER REFERENCES notes(id) ON DELETE SET NULL, -- NULL = 尚未建立的筆記
  target TEXT,                 -- wikilink 原始目標（未解析的連結靠它在新筆記出現時補上）
  type   TEXT NOT NULL,        -- 'wikilink'；階段 4、5 的邊類型共用此表
  weight REAL NOT NULL DEFAULT 1, -- wikilink：同一篇內連到同一目標的次數
  meta   TEXT                  -- JSON，保留給之後的邊類型
);
CREATE INDEX links_src ON links(src, type);
CREATE INDEX links_dst ON links(dst, type);

CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize='trigram'); -- rowid = notes.id
```

- 階段 1 的 `notes`、`note_events` 不變。`chunks` 與向量表留到階段 5。
- 刪除 DB 後重建：檔案 → 解析 → notes/links/notes_fts；歷程照舊從 events.jsonl 重播。

## 增量索引

- `indexFile` 讀檔時順便算 hash；hash 與 DB 相同就不重新解析（mtime 不同但內容沒變的情況）。
- hash 改變才重新解析並在同一個 transaction 裡更新 `notes`、`links`（src 為該篇的全部重寫）、`notes_fts`。
- 筆記集合改變（新增、改名、刪除）時重新解析 `links.dst`：只更新 `dst IS NULL` 或指向受影響筆記的列，不重讀任何檔案。
- 改名不會改寫其他筆記裡的 `[[舊名]]`（Obsidian 的「改名時更新連結」留到之後，需要寫入使用者檔案，先不做）。

## 全文搜尋

- trigram 只能比對 3 字以上的詞，但中文常見 2 字詞（「習慣」）。查詢依空白切詞：3 字以上的詞走 `MATCH`（bm25 排序），不足 3 字的詞用 `LIKE`（trigram 表上的 LIKE 會全表掃，個人 vault 規模可接受）。所有詞 AND。
- 標題命中排前面。摘要在 main 用 JS 擷取命中位置前後的文字，以 `{ text, match }` 片段回傳，renderer 不需要插入 HTML。

## IPC 合約變更（`src/shared/types.ts`，需同意）

```ts
export interface NoteSummary {
  path: string
  title: string
  eventDate: string | null
  modifiedAt: number
}

export interface TextSegment {
  text: string
  match: boolean // 是否為搜尋命中的部分
}

export interface Backlink {
  path: string // 來源筆記
  title: string
  line: number // 1-based
  context: TextSegment[] // 該行文字，連結部分 match = true
}

export interface SearchHit {
  path: string
  title: string
  snippet: TextSegment[]
}

// KnowmonAPI 新增：
notes.list(): Promise<NoteSummary[]>        // 自動補全、Quick switcher、點擊連結
links.backlinks(path: string): Promise<Backlink[]>
search.query(q: string, limit?: number): Promise<SearchHit[]>
```

## Renderer

- **右側反向連結面板**：顯示目前筆記的反向連結（依來源筆記分組，每列是該行上下文），點擊開啟。開啟筆記、vault 變更時更新。可收合，狀態存 localStorage。
- **點擊 wikilink**：`Ctrl/Cmd+點擊` 開啟（與外部連結相同手勢）；目標不存在時建立新筆記（放在 vault 根目錄）。
- **`[[` 自動補全**：`@codemirror/autocomplete`（已透過 `codemirror` 間接安裝，改成直接列入 dependencies）。依標題與檔名模糊比對；選取後插入能唯一解析的最短目標（同名時加上資料夾），並補上 `]]`。
- **Quick switcher**：`Ctrl/Cmd+O` 開啟對話框，模糊比對標題與路徑，最近開啟的排前面；`Enter` 開啟。
- **搜尋**：側欄上方切換「檔案 / 搜尋」，`Ctrl/Cmd+Shift+F` 直接進入搜尋；輸入後 200ms 查詢，結果顯示標題與高亮摘要。
- 模糊比對（`fuzzyScore`）是 renderer 的純函式，附測試。

## 測試

- `indexer`：frontmatter（含損毀）、日期各種格式與日記檔名、wikilink 各種寫法與程式碼內排除。
- `shared/links`：解析規則（同名、路徑、大小寫）。
- `db`：links/fts 寫入、刪除連帶清除、dst 重新解析。
- `Vault`：寫入後反向連結更新、新筆記補上未解析連結、改名與刪除、外部修改、刪 DB 重建後連結與搜尋一致、hash 未變不重新解析。
- 搜尋：中文 2 字、3 字以上、中英混合、多詞 AND、摘要片段。
- renderer：`fuzzyScore`、補全插入文字。
- 用 `test-vault/` 手動驗證（`[[尚未建立的筆記]]`、frontmatter 日期、日記檔名等）。

## 進行順序（每項完成、測試通過後勾選 roadmap；commit 由使用者自行處理）

1. 解析器 + `shared/links`
2. Schema v2、增量索引
3. FTS 搜尋 API + 搜尋面板
4. 反向連結 API + 面板 + 點擊 wikilink
5. `[[` 自動補全
6. Quick switcher
