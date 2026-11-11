# 表格即時渲染

## Context

GFM 表格已經會被解析（`markdownSupport()` 用 `markdownLanguage`，語法樹有 `Table / TableHeader / TableRow / TableCell / TableDelimiter`），但 `livePreview.ts` 沒有處理這些節點，所以即時渲染模式下表格仍是一行行的 `| a | b |` 原始碼。使用者指南的 FAQ 也寫著「Tables aren't rendered」。

目標：游標不在表格裡時，整張表格換成渲染好的表格；游標進入（點某一格、方向鍵移入）就整張變回原始 Markdown 編輯（使用者決定，2026-11-11：不做格子內直接編輯）。行為和程式碼區塊、圖片一致。不改 `types.ts`、IPC、DB，不加相依套件。

範圍：只做編輯器。AI 總結／回答裡的表格不在這次範圍（FAQ 照實保留這一點）。

## 技術重點

- **必須用 StateField 提供裝飾**：取代跨越換行的 replace 裝飾（block widget）不能由 ViewPlugin 提供，所以表格放在新的 StateField，不塞進現有 `livePreviewPlugin`。`livePreview()` 改為回傳 `[livePreviewPlugin, tableField]`，原始碼模式（Compartment 關掉）自然不渲染。
- StateField 在 `docChanged`、`selection` 改變、或 `syntaxTree(startState) !== syntaxTree(state)`（背景解析完成會發 transaction）時重算；只走訪 Document 的直接子節點找 `Table`，成本很低。
- 只渲染**頂層**表格（Document 的直接子節點）。在引用 `>` 或清單裡的表格保持原樣（整行取代會吃掉 `> ` 標記）。frontmatter 範圍內的不處理。
- 取代範圍：表格第一行的行首到最後一行的行尾，`Decoration.replace({ widget, block: true })`。游標或任何選取範圍碰到 `[from, to]` 就不取代。方向鍵上下移進表格時游標會落在表格起點／終點，因此會自動展開原始碼。
- `livePreviewPlugin` 遇到未展開的 `Table` 時 `return false`，不再為被取代的內容算裝飾（wikilink 的正則也要排除這個範圍）。

## 實作

### 新檔 `src/renderer/editor/tables.ts`

1. 純函式 `parseTable(state, node): TableModel`
   - `align: ('left' | 'center' | 'right' | null)[]`，從分隔列（`:--`、`:-:`、`--:`）取得。
   - `header` 與 `rows`：每格 `{ from, to, inline: InlineSpan[] }`，`from/to` 存**相對表格起點**的位移（widget 不因表格以外的編輯失效，點擊時再加上 `view.posAtDOM(widget)`）。
   - 欄數以表頭為準：列太短補空格，太長截掉（GFM 規則）。
   - 行內內容依語法樹轉成 span：`StrongEmphasis`、`Emphasis`、`Strikethrough`（隱藏標記）、`InlineCode`、`Link`（文字 + `data-url`）、wikilink（沿用 `[[目標|文字]]` 正則與 `data-target`）、`Escape`（`\|` → `|`）；其餘當純文字。圖片在格子裡只顯示 alt 文字。
2. `tableDecorations(state): DecorationSet` 與 `tableField`（StateField，`provide: EditorView.decorations.from`）。
3. `TableWidget`
   - `toDOM` 用 `createElement` + `textContent` 建 `<table class="cm-lp-table">`（不插入 HTML），外層 `div.cm-lp-table-wrap` 讓過寬的表格水平捲動。
   - `eq` 比較表格原文（含位移資訊），內容不變就不重建 DOM。
   - `ignoreEvent() → false`，`estimatedHeight` 依列數估算。
   - 點擊：一般點擊把游標放到該格原始碼的文字開頭（`data-offset`）→ 表格展開；`Ctrl/Cmd+點擊` 連結交給系統瀏覽器（重用 `isOpenableUrl`）、wikilink 開筆記（需要把 `wikilinks()` 的 `onOpen` 接到表格 widget：在 `tables.ts` 讀 `data-target`，透過一個 facet 或由 `wikilinks.ts` 的 mousedown 先判斷 `target.closest('[data-target]')`，實作時選後者以免多一條 callback 路徑）。

### 修改

- `src/renderer/editor/livePreview.ts`：`livePreview()` 加入 `tableField`；`buildDecorations` 跳過未展開的頂層表格（包含 wikilink 迴圈）。把 wikilink 正則、`touches` 等需要共用的小工具抽成匯出，`tables.ts` 重用，不重寫。
- `src/renderer/editor/wikilinks.ts`：mousedown 先看點擊目標是否為表格 widget 裡的 `[data-target]`。
- `src/renderer/src/assets/main.css`：`.cm-lp-table-wrap`、`.cm-lp-table`（邊框、表頭底色、`th/td` 對齊、padding），顏色全部用既有 CSS 變數（`--border`、`--muted` 等，實作時對照 main.css 實際名稱），深淺主題都不用另外寫。
- 原始碼展開時不另加樣式（維持一般 Markdown 顯示）。

## 文件

- 先把本計畫存到 `docs/plans/table-rendering.md`。
- `docs/architecture.md`「Renderer」加一條表格的設計（StateField 的原因、只渲染頂層、游標進入展開）。
- `docs/roadmap.md` 階段 8 加一項並勾選。
- `docs/testing.md`：測試清單加 `tables.test.ts`；手動測試清單加表格項目。
- 使用者指南（中英）：`notes-and-editing.md` 的支援表格加「Table」一列；`faq.md` 的「Tables aren't rendered」改成只剩 AI 總結／回答不渲染。快捷鍵沒有變動。

## 測試（`src/renderer/editor/tables.test.ts`，沿用 `livePreview.test.ts` 的 `stateOf` 寫法）

- `parseTable`：對齊、表頭與內容、`\|` 跳脫、欄數不足補空／過多截掉、行內樣式 span（粗體、程式碼、連結、wikilink 含 `|顯示文字`）。
- 裝飾：游標在表格外 → 一個 block widget，範圍是整行；游標在任一格、選取範圍跨進表格 → 沒有 widget；兩張表格只展開游標所在的那張。
- 不渲染：引用／清單內的表格、frontmatter、只有表頭沒有分隔列的「表格」。
- `buildDecorations` 不再對被取代的表格產生裝飾。

## 驗證

1. `npx vitest run`、`npm run typecheck`、`npm run lint` 全過。
2. `cp -r test-vault ~/knowmon-test-vault`，`npm run dev` 開啟後建一篇含表格的筆記，確認：渲染、對齊、寬表格水平捲動、點格子跳到該格原始碼、方向鍵進出、`Ctrl+E` 切換、`Ctrl+點擊` 表格裡的連結與 wikilink、深淺主題、表格上下有其他區塊時行號與捲動正常。
