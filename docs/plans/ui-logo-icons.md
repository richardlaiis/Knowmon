# UI 改善：Logo 與圖示

## Context

目前應用程式圖示是 Electron 預設的原子圖（`build/icon.*`、`resources/icon.png`），歡迎頁只有一行 `<h1>Knowmon</h1>`，側欄與右側面板的分頁是純文字按鈕，檔案樹用 `▸ ▾` 字元，分頁列的 `×` `+` 也是字元。圖示 SVG 散在 `App.tsx`（`NewNoteIcon`、`NewFolderIcon`、`MoonIcon`、`SunIcon`、`iconProps`）與 `TabBar.tsx`（`SidebarIcon`）。

目標（使用者已選，2026-11-13）：

- Logo 採「B：深色 + 時間軌道」：Polar Night 深底圓角方形、節點連成的 K（代表筆記圖譜），外圈一圈虛線點（時間脈絡）；右上節點 Frost 青 `#88c0d0`、右下節點紫 `#b48ead`。定稿為 `build/icon.svg`。
- 範圍全做：應用程式圖示、歡迎頁與空白頁、側欄與分頁加圖示、檔案樹圖示。

限制：不改 `types.ts`、IPC、DB；**不新增相依套件**（圖示全部手寫 inline SVG，沿用現有 24×24、`currentColor`、stroke 1.8 的風格；不用 lucide 等套件）。不改快捷鍵，所以不用動 shortcuts.md。

## 實作

### 1. Logo 原始檔與應用程式圖示

- 新增 `build/icon.svg`（1024 viewBox 的最終版 Logo，從草稿 B 微調：外圈點在小尺寸下保持可見）。
- 新增 `scripts/gen-icons.mjs`：呼叫系統的 `magick`（ImageMagick，不是 npm 相依）把 SVG 轉成
  - `build/icon.png`（1024×1024）、`resources/icon.png`（512，Linux 視窗圖示，`src/main/index.ts` 已引用）
  - `build/icon.ico`（16/24/32/48/64/128/256 多尺寸）
  - `build/icon.icns`：以 Node 自己組 ICNS（header + `ic07/ic08/ic09/ic10` 四個 PNG 區塊，格式很單純），不需 `iconutil`。
- 產生的檔案提交進 repo（打包不依賴 ImageMagick）；README 開發段落加一行「改 Logo 後跑 `node scripts/gen-icons.mjs`」。

### 2. 圖示元件集中：`src/renderer/src/components/icons.tsx`（新檔）

- 共用 `Icon` 外框（`iconProps` 移過來，`aria-hidden`、預設 18px、可傳 `size`）。
- 從 `App.tsx`、`TabBar.tsx` 搬入既有圖示：NewNote、NewFolder、Moon、Sun、Sidebar。
- 新增：Files、Search、Graph（三個相連節點）、Timeline（時間軸＋刻點）、GoTo（指令／箭頭）、Backlinks（反向箭頭連結）、LocalGraph、Sparkle（AI）、Note（文件）、Folder／FolderOpen、Chevron（旋轉表示展開）、Close、Plus、FolderOpen（歡迎頁按鈕用）。
- `Logo` 元件：inline SVG 版 Logo（與 `build/icon.svg` 同圖形），`role="img"` + `aria-label="Knowmon"`。用 inline 而不是 import 圖檔，CSP 不用改。

### 3. 歡迎頁（`App.tsx` 的 `!vault` 分支）

- 96px Logo、`Knowmon` 標題、一行標語（"Notes linked by what you wrote together, not just by links." 類似語意，實作時定稿）、主要按鈕「📂 圖示 + Open folder」。右上主題切換保留。
- CSS：`.welcome` 置中卡片感（不加背景框，靠間距與字級層次），標題字重與字距調整。

### 4. 空白頁（沒有分頁時）

- 淡化的 Logo（`opacity` 用變數控制、深淺主題都合適）＋原本提示句。
- 快捷鍵改成兩欄清單：左邊 `<kbd>Ctrl</kbd>+<kbd>O</kbd>`、右邊說明（Go to note / Search / Graph / Timeline / Summarize）。清單資料放在 `src/renderer/src/lib/shortcutHints.ts`（純資料 + 把 `"Ctrl+Shift+F"` 拆成按鍵陣列的函式，Mac 顯示 `⌘`），方便測試。
- 新增 `kbd` 樣式（`--code-bg` 底、`--border` 邊、小圓角）。

### 5. 側欄與右側面板分頁

- 左側 `.sidebar-tabs`：Files / Search / Graph / Timeline / Go to… 每個按鈕「圖示 + 文字」。
- 右側 `.side-tabs`：Backlinks / Local graph / AI 同上；AI 的 `attention-dot` 保留。
- 窄寬度處理：`.sidebar`、`.side-panel` 設 `container-type: inline-size`，寬度不足（約 < 300px，實作時對照 `PANE_LIMITS` 調）時用 `@container` 隱藏文字只留圖示（`title` 已有說明，加 `aria-label` 保持可及性）。
- 側欄標題：vault 名稱前加 18px 小 Logo。

### 6. 分頁列（`TabBar.tsx`）

- 分頁標題前加類型圖示：note → Note、graph → Graph、timeline → Timeline（`tabs.ts` 的 `Tab.kind` 直接對應，不改 tabs 模型）。
- `×` 換成 Close 圖示、`+` 換成 Plus 圖示，尺寸與點擊區域維持不變。

### 7. 檔案樹（`FileTree.tsx`）

- `▸ ▾` 換成 Chevron SVG（展開時 `rotate(90deg)` 加短 transition）。
- 資料夾顯示 Folder／FolderOpen 圖示，筆記顯示 Note 圖示（`--muted` 色，選取列時 `--fg`）；新增項目的輸入列也顯示對應圖示。
- `.tree-icon` 寬度由 12px 調整為容納 chevron + 類型圖示，縮排 `8 + depth * 14` 保持。

### 8. 其他小幅打磨（只在上述元件內）

- 圖示按鈕 hover/active 狀態統一（`.icon` 類別），`:focus-visible` 外框用 `--accent`。
- 不動編輯器、圖譜、時間軸、AI 面板內部版面。

## 測試（vitest，`src/**/*.test.ts`，environment node）

- `src/renderer/src/components/icons.test.ts`：用 `react-dom/server` 的 `renderToStaticMarkup` + `createElement`，確認每個匯出的圖示都輸出 `<svg aria-hidden="true">`、用 `currentColor`、`size` 參數生效；`Logo` 有 `role="img"` 與 `aria-label`。
- `src/renderer/src/lib/shortcutHints.test.ts`：按鍵拆分（`Ctrl+Shift+F` → `['Ctrl','Shift','F']`）、Mac 時 `Ctrl` → `⌘`。
- `scripts/gen-icons.mjs` 的 ICNS 組裝抽成可匯入的函式並測 header（`icns` magic、總長度、各區塊 type/長度）。若 scripts 不在 vitest include 範圍，測試檔放 `scripts/` 並在 `vitest.config.ts` include 加上 `scripts/**/*.test.mjs`（需你同意；否則改成手動驗證）。

## 文件

- `docs/architecture.md` Renderer 章節：圖示集中在 `components/icons.tsx`、手寫 SVG 不加套件；Logo 原始檔 `build/icon.svg`、用 `scripts/gen-icons.mjs` 產生各平台圖示；側欄窄寬度只顯示圖示（container query）。
- `docs/roadmap.md` 勾選／新增此項。
- 使用者指南若有截圖或描述「Files/Search 文字分頁」的段落，同步更新文字描述。

## 驗證

1. `npx vitest run`、`npm run typecheck`、`npm run lint` 全過。
2. `node scripts/gen-icons.mjs` 後檢視 `build/icon.png`、用 `magick identify build/icon.ico` 確認多尺寸、`file build/icon.icns`。
3. `cp -r test-vault ~/knowmon-test-vault` → `npm run dev`：截圖檢查歡迎頁、空白頁、側欄（寬／窄）、右側面板、分頁列、檔案樹展開收合，深淺主題各一次；確認視窗／dock 圖示換成新 Logo。

## 實作調整（2026-11-13）

- 預設側欄寬 280px 放不下五個「圖示 + 文字」：Files／Search（切換側欄內容）保留文字，Graph／Timeline／Quick switcher（開分頁的動作）改成只有圖示、靠右（tooltip 有名稱與快捷鍵）。container query 門檻：側欄 ≤ 240px、右側面板 ≤ 290px 時隱藏文字。
- 空白頁的 Logo 原本打算半透明，實測在淺色底發灰，改成不透明 64px；Logo 在深色主題下和背景太接近，歡迎頁、空白頁、側欄的 Logo 都加 `box-shadow` 細邊框。
- vitest 的 `include` 加上 `scripts/**/*.test.mjs`（測 ICNS 組裝）。
- 使用者指南：`interface.md` 的側欄說明，以及 graph／time／search 裡「左側欄的 Graph／Timeline／Go to…」改成描述圖示（中英文）。

## 後續：設定入口（2026-11-13）

使用者回饋：Settings 沒有圖示、入口不明顯，希望放在左下角。

- 新增 `SettingsIcon`（齒輪）與 `components/SettingsMenu.tsx`：側欄底部改成 `.sidebar-footer`，左邊齒輪、右邊 AI 狀態。齒輪彈出往上展開的選單：**Time & links…**（`TimeSettingsDialog`）、**AI (Ollama)…**（`LlmSettingsDialog`，`llmStatus` 為 null 時停用）。點外面、Esc、視窗失焦關閉。
- 圖譜工具列、時間軸工具列、AI 分頁原有的 Settings 按鈕加上齒輪圖示。
- 不合併兩個對話框、不加快捷鍵（roadmap「設定頁」另議）。
- 文件：`interface.md`（中英）新增「設定」小節；`architecture.md` Renderer 記錄設定入口。

## 後續：README（2026-11-13）

- `README.md` 開頭改成置中的標題區：`build/icon.svg`（128px，直接引用 SVG，不另存 PNG）、標題、一句標語、使用說明／English guide／快速開始連結（取代原本的「使用說明」一行）。不加 shields.io 徽章。
- 功能說明後加 App 截圖，`<picture>` 依讀者主題顯示 `docs/images/screenshot-light.png` 或 `screenshot-dark.png`（各約 124 KB；test-vault 的「歡迎」筆記 + Local graph 深度 2）。
- 重拍方式記在 `docs/architecture.md`「開發環境注意事項」。
