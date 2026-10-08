# 階段 4 實作計畫：時間層

完成標準：時間軸視圖可用，圖譜能依時間範圍與邊類型篩選。

## 已確認的決定（2026-10-08）

- 同意下方的 `types.ts` 合約變更。
- `sequence` 的「同一主題」為同一資料夾（不用 tags，不改 schema）。
- 時間參數存在 vault 內的 `.knowmon/settings.json`。

## 時間邊的定義

三種邊都由純函式從 `notes` 與 `note_events` 推導（`src/main/indexer/timeLinks.ts`；session 切分在 `src/shared/time.ts`，main 與 renderer 共用），結果寫入 `links` 表（`type` 為 `same_session` / `same_day` / `sequence`，`dst` 一定不為 NULL）。

| 類型           | 規則                                                                                                                                                                             | 方向    | 權重                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| `same_session` | 把全 vault 的 `edit` 事件依時間排序，相鄰兩筆間隔超過 `sessionGapMinutes`（預設 30）就切成新的 session（與網站分析的 session 逾時相同）。同一個 session 內被編輯的筆記兩兩相連。 | 無      | 共同出現的 session 數 |
| `same_day`     | `event_date` 相差 ≤ `sameDayWindowDays`（預設 0，即同一天）。                                                                                                                    | 無      | `1 / (1 + 相差天數)`  |
| `sequence`     | 同一個資料夾（含 vault 根目錄）裡有 `event_date` 的筆記，依日期（同日依路徑）排序，相鄰兩篇相連。例如 `日記/` 裡每天連到下一天。                                                 | 早 → 晚 | 1                     |

- 只看 `edit`，不看 `open`（只是閱讀）與 `create`（第一次開啟既有 vault 時，每篇都用 birthtime 記一筆 `create`；git clone 之類的情況會讓全部筆記擠在同一刻，變成完全圖）。
- **大量變更保護**：一個 session 編輯超過 `sessionMaxNotes`（預設 20）篇時視為批次操作（外部同步、全域取代、git pull），該 session 不產生邊。
- 無方向的邊以路徑字典序較小者為 `source` 存一列。

### 何時重算

時間邊依賴事件、`event_date`、路徑與設定，任何一項改變都可能影響全 vault，所以不做增量：

- `Vault` 在記錄事件、重新索引、改名、刪除、修改設定時標記 dirty。
- `graph()` 讀取前若 dirty 就整批重算（一個 transaction：刪掉三種時間邊，再寫入）。1000 篇、5 萬筆事件預估數十 ms，會加測試量測。
- DB 被刪除時跟著重建（事件從 `events.jsonl` 重播後重算），不需要 schema 變更，`SCHEMA_VERSION` 不變。

## 設定

時間參數存在 **vault 內** `<vault>/.knowmon/settings.json`（跟著 vault 走，與 `.obsidian/` 類似；不存在時用預設值）。main 驗證並限制範圍：

| 參數                | 預設 | 範圍  |
| ------------------- | ---- | ----- |
| `sessionGapMinutes` | 30   | 5–240 |
| `sessionMaxNotes`   | 20   | 2–200 |
| `sameDayWindowDays` | 0    | 0–7   |

UI：時間軸與全域圖譜工具列上的齒輪按鈕，打開一個小對話框編輯這三個值。階段 8 的設定頁再整合。

## IPC 合約變更（`src/shared/types.ts`，需同意）

```ts
export type LinkType = 'wikilink' | 'same_session' | 'same_day' | 'sequence' // 階段 5 加入 semantic

export interface GraphNode {
  path: string
  title: string
  eventDate: string | null
  /** 有 create / edit 事件的日期（本地時區 YYYY-MM-DD，遞增），圖譜「寫作時間」篩選用 */
  activeDays: string[]
}
// GraphEdge 不變（type 已是 LinkType）。同一對筆記可能同時有多種類型的邊。

/** 時間軸「寫作時間」模式用：create / edit 事件 */
export interface ActivityEvent {
  path: string
  title: string
  ts: number
  kind: 'create' | 'edit'
}

export interface TimeSettings {
  sessionGapMinutes: number
  sessionMaxNotes: number
  sameDayWindowDays: number
}

// KnowmonAPI 新增：
timeline: {
  /** [from, to) 之間的 create / edit 事件，依時間排序 */
  activity(from: number, to: number): Promise<ActivityEvent[]>
}
settings: {
  getTime(): Promise<TimeSettings>
  /** 寫入並回傳實際套用（限制範圍後）的值；時間邊會重算 */
  setTime(s: Partial<TimeSettings>): Promise<TimeSettings>
}
```

「事件時間」模式的時間軸只需要 `notes.list()` 已有的 `eventDate`，不另外加 IPC。

## 時間軸視圖（`src/renderer/timeline/`）

新的分頁種類 `timeline`（和圖譜一樣最多一個），由側欄「Timeline」按鈕或 `Ctrl/Cmd+Shift+T` 開啟。

- 兩種模式（切換鈕，偏好存 localStorage `knowmon.timeline.mode`）：
  - **事件時間**：有 `event_date` 的筆記依日期分組（新的在上）；底部顯示「N 篇沒有日期」。
  - **寫作時間**：依天分組，每天再分成 session（`14:02–15:10 · 3 篇`），列出該 session 編輯的筆記，新建立的標示「new」。session 切分與 `same_session` 用同一個函式、同一個設定。
- 上方一條月份長條圖（每月筆記數），點擊捲到該月。
- 點筆記取代目前分頁，`Ctrl/Cmd+點擊`或中鍵開新分頁（與其他地方一致）；目前開著的筆記以強調色標示。
- 分組、session、長條圖都是純函式（`timeline/model.ts`），附測試。

## 圖譜篩選

- **邊類型**：工具列四個可切換的色塊（Links / Session / Same day / Sequence），全域圖與局部圖都有，偏好各自存 localStorage（`knowmon.graph.types`、`knowmon.graph.localTypes`），預設全開。邊類型影響版面（時間邊也參與排版），切換時沿用座標快取、輕度重新加熱，不會整張重排。
- **時間範圍**（只在全域圖）：
  - 時間軸可選「事件時間」（`eventDate`）或「寫作時間」（`activeDays` 有任一天落在範圍內）。
  - 雙把手滑桿，範圍為所有日期的最小到最大值，顯示起訖日期；「Reset」恢復全範圍。
  - 沒有日期的筆記：「Undated」勾選框決定是否顯示（預設顯示；寫作時間模式下每篇都有日期）。
  - 時間篩選只隱藏節點（Cytoscape `display: none`，相連的邊一起隱藏），**不重新排版**，拖動滑桿時節點在固定位置出現、消失。大型圖譜以 `requestAnimationFrame` 節流套用。
- 邊的樣式：每種類型一個顏色（`main.css` 新增 `--edge-session`、`--edge-day`、`--edge-sequence`，深淺色各一組），`same_session` 虛線、`same_day` 點線。
- `edgeId` 加上類型（同一對筆記可能有多種邊）；`filterGraph(data, filter)` 為純函式，附測試。

## 進行順序

1. `shared/time.ts`（session 切分、三種邊的推導）+ 測試
2. 設定讀寫、時間邊寫入 DB、`getGraph` 加上 `activeDays` 與時間邊、IPC + 測試（含重算效能）
3. 圖譜邊類型篩選與樣式
4. 圖譜時間滑桿
5. 時間軸視圖 + 分頁
6. 設定對話框
7. 用 `test-vault/` 實際執行 App 驗證；更新 README（快捷鍵、手動測試）、`architecture.md`、`roadmap.md`

## 實作結果（2026-10-08）

- 依計畫完成，`types.ts` 的變更與上面相同；沒有新增相依套件，schema 不變。
- 測試：新增 37 個（共 234 個），含 1000 篇、5 萬筆編輯事件時重算時間邊 < 500ms。
- 用 `test-vault/` 的副本加上合成的編輯歷程實際執行 App（CDP 驅動）驗證：時間邊與預期一致；時間滑桿篩選後節點位置不變；時間軸兩種模式；設定對話框存檔後 `settings.json` 更新、時間邊立即重算；深色主題。
- 過程中的調整：側欄多了「Timeline」按鈕後放不下，改為可換行；時間軸的時間改用 24 小時制（AM/PM 會換行）；深色主題的 `sequence` 顏色改用 Nord 紫色（原本的藍色和一般連結太像）。
- 已知限制：haystack 邊不支援箭頭，`sequence` 的方向沒有畫出來；同一對筆記的多種邊重疊在同一條線上。
