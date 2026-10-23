# 測試

開發者用：自動測試、手動測試清單與幾個除錯指令。安裝與執行見 [README](../README.md)。

## 自動測試

```bash
npx vitest run       # 單元與整合測試
npm run typecheck    # 型別檢查（main/preload 與 renderer 兩個專案）
npm run lint         # ESLint + Prettier 檢查
```

注意：`npx tsc --noEmit` 在根目錄不會檢查任何檔案（根 tsconfig 只有 project references），請用 `npm run typecheck`。

測試檔放在被測檔案旁邊（`*.test.ts`），主要的有：

- `src/main/vault/vault.test.ts`：建立、改名、刪除、外部修改（reconcile）、事件節流、刪掉 DB 後從 `events.jsonl` 重建、chokidar 監聽
- `src/main/db/*.test.ts`：schema、查詢、日誌重播
- `src/main/vault/paths.test.ts`、`tree.test.ts`：路徑安全檢查、檔案樹
- `src/renderer/editor/livePreview.test.ts`：Markdown 即時渲染（哪些標記被隱藏、游標附近顯示原始語法、frontmatter、待辦切換）
- `src/renderer/src/lib/theme.test.ts`：主題切換與記憶
- `src/renderer/editor/autosave.test.ts`、`src/renderer/src/lib/tree.test.ts`：自動儲存、檔案樹路徑工具（含拖曳）
- `src/main/indexer/timeLinks.test.ts`、`src/main/db/time.test.ts`、`src/main/vault/time.test.ts`：時間邊（same_session、same_day、sequence）的推導、何時重算、時間參數的讀寫、DB 重建
- `src/shared/time.test.ts`、`src/renderer/graph/timeFilter.test.ts`、`src/renderer/timeline/model.test.ts`：session 切分、圖譜時間篩選、時間軸分組
- `src/shared/timeRange.test.ts`、`src/renderer/chat/conversation.test.ts`：從問題解析時間範圍（「上個月」「最近 7 天」「last week」）、對話狀態
- `src/main/indexer/chunk.test.ts`、`src/main/db/vectors.test.ts`：切塊、向量表（sqlite-vec）、semantic 邊與 1000 篇的效能
- `src/main/llm/*.test.ts`：Ollama client（假的 fetch）、背景 embedding、混合檢索、總結、問答（關鍵字、context 組裝、引用過濾）；`service.test.ts` 用真的 Vault 加假的 Ollama 測離線、模型未下載、換模型

與真的 Ollama 連線的整合測試預設跳過，需要時執行：

```bash
OLLAMA_IT=1 npx vitest run src/main/llm/ollama.integration.test.ts
```

新功能必須附測試，完成前要確認上面三個指令都通過。

## 手動測試

先複製一份測試 vault。**請放在家目錄底下，不要放在 `/tmp`**：`/tmp` 不支援系統垃圾桶，在那裡刪除筆記會失敗。

```bash
cp -r test-vault ~/knowmon-test-vault
npm run dev
```

| #   | 操作                                                                          | 預期結果                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 按「Open folder」，選 `~/knowmon-test-vault`                                  | 左側出現檔案樹，資料夾排在前面                                                                                                                                     |
| 2   | 點「歡迎」，打幾個字，等約 1 秒                                               | `cat ~/knowmon-test-vault/歡迎.md` 看得到新內容                                                                                                                    |
| 3   | 按 `Ctrl+S`                                                                   | 立即存檔                                                                                                                                                           |
| 4   | 按側邊欄上方的新增筆記 / 新增資料夾圖示，或在檔案樹按右鍵                     | 檔案樹中出現名稱輸入框，輸入名稱後按 Enter 才建立（筆記開在新分頁）；Esc 或空白名稱取消，不會留下檔案                                                              |
| 5   | 右鍵 →「Rename」                                                              | 磁碟上的檔案跟著改名；開著的筆記不會被關掉                                                                                                                         |
| 6   | 把筆記或資料夾拖到另一個資料夾、筆記上，或檔案樹空白處                        | 移進目標資料夾（拖到空白處就移到根目錄）；停在收合的資料夾上約 0.6 秒會自動展開                                                                                    |
| 7   | 右鍵 →「Delete」                                                              | 跳出確認視窗，檔案移到系統垃圾桶                                                                                                                                   |
| 8   | 開著「歡迎」，在終端機執行 `echo '# 外部改的' > ~/knowmon-test-vault/歡迎.md` | 編輯器自動換成新內容                                                                                                                                               |
| 9   | 打字後 0.5 秒內馬上做第 8 項                                                  | 出現提示列，可以選「Load external version」或「Keep my version」                                                                                                   |
| 10  | 在終端機新增、`rm`、`mv` 筆記                                                 | 檔案樹自動更新                                                                                                                                                     |
| 11  | 開一篇有標題、粗體、連結、清單、`- [ ]` 的筆記                                | 標記符號隱藏、顯示渲染結果；游標移進粗體或連結時顯示原始語法；點核取方塊會切換並存檔；`Ctrl+E` 切換原始碼模式                                                      |
| 12  | 按側邊欄上方（或歡迎畫面右上角）的月亮／太陽圖示                              | 在米白淺色與深色主題間切換，程式碼顏色跟著換；重新開啟 App 後維持上次的選擇                                                                                        |
| 13  | 按 `Ctrl+Shift+F`，依序搜尋 `習慣`、`原子習慣`、`中英混合 search`             | 2 字與 3 字以上的中文、中英混合都找得到；標題命中的排前面，摘要標示命中的字                                                                                        |
| 14  | 開「深度工作」，看右側 Backlinks 面板                                         | 列出「2026-10-04」「歡迎」「原子習慣」與連結所在那一行；標題列的「Backlinks」按鈕可收合                                                                            |
| 15  | 在編輯器輸入 `[[原子`                                                         | 跳出補全選單（顯示所在資料夾），按 Enter 插入 `[[原子習慣]]`，不會多出 `]]`                                                                                        |
| 16  | `Ctrl+點擊` `[[原子習慣]]`；再 `Ctrl+點擊` 深度工作裡的 `[[尚未建立的筆記]]`  | 前者開啟該筆記；後者在 vault 根目錄建立新筆記，它的 Backlinks 列出「深度工作」                                                                                     |
| 17  | 按 `Ctrl+O`，輸入 `深度`，按 Enter                                            | 開啟「深度工作」；沒輸入時最近開過的筆記排在最前面                                                                                                                 |
| 18  | 按 `Ctrl+G`（或側欄的「Graph」）                                              | 主區域顯示全域圖譜；滾輪縮放、拖曳背景平移、拖曳節點；hover 時高亮該筆記與相連的筆記；點節點切回編輯器並開啟該筆記                                                 |
| 19  | 右側面板切到「Local graph」，切換 Depth 1–3                                   | 只顯示目前筆記與相連的筆記，目前的筆記以強調色標示；換筆記時跟著更新                                                                                               |
| 20  | 切換深色模式                                                                  | 圖譜顏色跟著換                                                                                                                                                     |
| 21  | 截圖後在筆記裡 `Ctrl+V`；或從檔案管理員把圖片拖進編輯器                       | 圖片存到 `<vault>/attachments/`（截圖命名為 `Pasted image 時間.png`，拖進來的保留原檔名，同名加編號），插入 `![](相對路徑)` 並顯示圖片；游標移到該行時顯示原始語法 |
| 22  | 手動寫 `![](不存在.png)`、`![](https://…/a.png)`                              | 前者顯示紅色的「Image not found」；網址與絕對路徑不渲染（只支援相對於筆記的路徑）                                                                                  |

### 分頁與面板

| #   | 操作                                                         | 預期結果                                                                                |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 23  | 點檔案樹的筆記，再點另一篇                                   | 第二篇取代目前的分頁                                                                    |
| 24  | `Ctrl+點擊`（或中鍵）另一篇筆記                              | 開在新分頁；再點已開著的筆記會切過去，不重複開                                          |
| 25  | 在一個分頁打字，切到別的分頁再切回來，按 `Ctrl+Z`            | 內容與 undo 歷程都還在                                                                  |
| 26  | `Ctrl+G`、`Ctrl+Tab`、`Ctrl+W`、`Ctrl+T`                     | 開圖譜分頁（只會有一個）、切換分頁、只關閉分頁（視窗不會關）、以新分頁開 Quick switcher |
| 27  | 拖曳分頁、右鍵分頁                                           | 調整順序；右鍵可「Close / Close others」                                                |
| 28  | 拖曳檔案樹與編輯器、編輯器與右側面板之間的分隔線；雙擊分隔線 | 調整寬度；雙擊恢復預設                                                                  |
| 29  | `Ctrl+B`、`Ctrl+Alt+B` 或分頁列兩端的按鈕                    | 開關左側欄、右側面板                                                                    |
| 30  | 關掉 App 再開同一個 vault                                    | 分頁、面板寬度與開關都還原                                                              |

### 時間層

兩種時間、各種時間邊的規則與圖譜篩選的意思見 [`time-layer.md`](time-layer.md)。

時間邊需要編輯歷程。剛複製的 vault 只有每篇一筆 `create`，先在 App 裡編輯幾篇筆記（同一段時間內編輯的會連在一起），或調整下面的設定。

| #   | 操作                                                                                     | 預期結果                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 31  | 依序編輯「原子習慣」「深度工作」（間隔不到 30 分鐘），按 `Ctrl+G`                        | 兩篇之間多一條 Session 邊（橘色虛線）；`日記/` 裡的三篇以 Sequence 邊（實線）串起來                                                |
| 32  | 圖譜工具列點 Links / Session / Same day / Sequence                                       | 對應類型的邊顯示或隱藏，版面跟著微調；重開 App 後維持上次的選擇                                                                    |
| 33  | 拖動圖譜的時間滑桿，取消勾選「Undated」，切換「Event date / Written」                    | 範圍外的筆記消失但其他節點不移動；工具列顯示「N of M notes」；「Reset」恢復全部                                                    |
| 34  | 按 `Ctrl+Shift+T`（或側欄的「Timeline」）                                                | 開啟時間軸分頁：「Event date」依日期列出有日期的筆記；「Written」依天列出 session（時間範圍與編輯的筆記，新建的標示 new）          |
| 35  | 點時間軸上方的長條、點筆記、`Ctrl+點擊`筆記                                              | 捲到該月；在目前分頁開啟；在新分頁開啟                                                                                             |
| 36  | 時間軸或圖譜工具列按「Settings」，把 Session gap 改成 5、Same-day window 改成 1，按 Save | `cat ~/knowmon-test-vault/.knowmon/settings.json` 看得到新值；圖譜的 Session 邊變少、日記之間多了 Same day 邊；時間軸 session 變短 |
| 37  | 右側面板切到「Local graph」，切換邊類型                                                  | 局部圖只沿著選取的類型找相連的筆記                                                                                                 |

### AI（階段 5）

需要 Ollama 與 `bge-m3`、`qwen3:8b`（`ollama pull bge-m3`、`ollama pull qwen3:8b`）。開啟 vault 後，側欄底部會顯示「Indexing N/M」，背景 embedding 完成後變成「AI ready」（test-vault 約 10 秒）。

| #   | 操作                                                           | 預期結果                                                                                                        |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 38  | 開「原子習慣」，按 `Ctrl+Shift+S`（或筆記上方的「Summarize」） | 右側面板切到「AI」，逐字顯示繁體中文的條列總結（約 15–30 秒）；`[[深度工作]]` 可點擊；可 Stop、Copy、Regenerate |
| 39  | 選取一段文字再按 `Ctrl+Shift+S`                                | 標題顯示「Selection in …」，只總結選取的部分                                                                    |
| 40  | 搜尋切到「Hybrid」，輸入 `培養好習慣的方法` 按 Enter           | 沒有完全相同字詞也找得到「原子習慣」等筆記，標示 meaning（向量）、text（全文）、linked（圖譜鄰居）              |
| 41  | 點 Hybrid 的結果                                               | 開啟筆記並捲到最相關的段落                                                                                      |
| 42  | 設定 Hybrid 的日期範圍後按 Enter                               | 只列出 event date（沒有的話用最後修改日）在範圍內的筆記                                                         |
| 43  | `Ctrl+G`，工具列切換「Semantic」                               | 內容相似的筆記之間有洋紅色的 Semantic 邊；「Settings」可調整相似度門檻與每篇上限                                |
| 44  | 結束 Ollama（`systemctl stop ollama` 或關掉 `ollama serve`）   | 側欄變成「AI offline」，AI 分頁顯示原因；搜尋、圖譜、編輯照常；Hybrid 退回關鍵字結果並提示                      |
| 45  | 重新啟動 Ollama                                                | 30 秒內自動恢復（或按 AI 分頁的「Retry」）                                                                      |
| 46  | AI 分頁按「Settings」                                          | 可改 Ollama 位址與模型；換 embedding 模型會重新索引所有筆記                                                     |
| 47  | AI 分頁切到「EN」再按 Regenerate                               | 用英文條列總結，`[[原子習慣]]` 等連結保持原文、可點擊；切回「中文」恢復繁體中文；重開 App 後仍記得選擇          |
| 48  | 總結內容有粗體、清單、程式碼時                                 | 以格式顯示（不是原始 Markdown 符號）；串流途中未完成的語法先顯示為文字                                          |
| 49  | 總結一篇沒有任何 `[[連結]]` 的筆記                             | 總結裡沒有可點的連結，也沒有 `[[` 符號；有連結的筆記只會出現原文中的連結                                        |

### 問答（階段 6）

同樣需要 Ollama。AI 分頁上方切換「Chat / Agent / Summary」，`Ctrl+Shift+A` 直接打開對話。

| #   | 操作                                                   | 預期結果                                                                                                      |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 50  | `Ctrl+Shift+A`，輸入 `深度工作的重點是什麼？` 按 Enter | 先顯示「Searching notes…」，再逐字顯示繁體中文回答（約 5 秒）；句子後面有上標的引用編號，下方列出被引用的來源 |
| 51  | 點回答裡的引用編號或下方的來源                         | 開啟該筆記並捲到引用的段落；`Ctrl+點擊`開在新分頁                                                             |
| 52  | 輸入 `2026-10-04 到 2026-10-06 之間做了什麼？`         | 輸入時輸入框上方出現「2026-10-04 – 2026-10-06」；回答上方顯示「Notes from …」，來源只有這三天的日記           |
| 53  | 輸入 `上週寫了什麼？` 後按範圍旁的 ×，再送出           | 範圍變成刪除線的「No date filter」，送出後不篩選日期                                                          |
| 54  | 按「Date range…」選日期再送出                          | 只用該範圍的筆記回答；送出後範圍恢復成自動偵測                                                                |
| 55  | 接著問 `那第二點呢？`                                  | 沿用前一題的主題回答（對話脈絡）                                                                              |
| 56  | 問 `What are the key ideas of Atomic Habits?`          | 用英文回答，引用「原子習慣」                                                                                  |
| 57  | 問筆記裡沒有的問題（例如 `薛丁格方程式怎麼推導？`）    | 回答「筆記裡沒有相關內容」，不自己編造；來源收在「sources searched」裡                                        |
| 58  | 回答中按「Copy」貼到筆記                               | 引用編號變成 `[[來源標題]]` 連結                                                                              |
| 59  | 回答途中按「Stop」；按「New chat」                     | 停止並顯示「Stopped.」；清空對話。換 vault 時對話也會清空                                                     |
| 60  | Ollama 停止時                                          | 輸入框顯示「Ollama is offline」，Ask 按鈕停用                                                                 |

### Agent（階段 7）

同樣需要 Ollama。AI 分頁切到「Agent」，或按 `Ctrl+Shift+G`。每個任務約 1–4 分鐘（只用 CPU 時；有 GPU 會快很多）。

| #   | 操作                                                                                     | 預期結果                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 61  | `Ctrl+Shift+G`，輸入 `2026-10-04 到 2026-10-06 之間寫了哪些筆記？它們各自連到哪些筆記？` | 依序出現步驟（轉圈 → ✓）：「Notes from 2026-10-04 – 2026-10-06 → 3 notes」、三次「Connections of …」；最後的回答連結可點擊               |
| 62  | 點開一個步驟                                                                             | 顯示工具參數與結果中的筆記；點筆記開啟，`Ctrl+點擊`開新分頁                                                                              |
| 63  | 輸入 `把「原子習慣」和「深度工作」整理成一篇比較筆記，存在「整理」資料夾`                | 讀完兩篇後出現確認卡片：可修改的路徑與內容；不存在的連結會標示出來。Agent 按鈕、AI 分頁與側欄底部顯示提醒（「Agent: confirm a change」） |
| 64  | 按「Reject」                                                                             | 步驟變成刪除線（✕），沒有建立任何檔案；回答說明沒有完成                                                                                  |
| 65  | 再送一次同樣的任務，修改路徑或內容後按「Apply」                                          | 用修改後的路徑與內容建立筆記，檔案樹立刻出現；步驟下方的筆記名稱可點擊開啟                                                               |
| 66  | 開著「2026-10-04」，輸入 `幫 2026-10-04 這篇日記加上「回顧」標籤`                        | 確認卡片顯示標籤 chip（可按 × 拿掉）與 frontmatter 前後對照；Apply 後開著的分頁自動重新載入，frontmatter 有 `tags: [回顧]`               |
| 67  | 對已經有該標籤的筆記再要求一次                                                           | 不出現確認卡片，回答說已經有了                                                                                                           |
| 68  | 等待確認時按「Stop」                                                                     | 停止並顯示「Stopped.」，提案不會寫入；「New task」清空                                                                                   |
| 69  | 在 Settings 換成不支援工具的模型後送出任務                                               | 顯示「does not support tool calling」，請換模型                                                                                          |

### 大型 vault 效能測試

```bash
node scripts/gen-vault.mjs ~/knowmon-1000 1000   # 產生 1000 篇測試筆記（第三個參數是亂數種子）
```

用 App 開啟 `~/knowmon-1000` 後按 `Ctrl+G`。排版在背景計算，工具列顯示進度，完成前也可以操作。量測結果見 [`plans/phase3-graph.md`](plans/phase3-graph.md)。

### 檢查編輯歷程

```bash
cat ~/knowmon-test-vault/.knowmon/events.jsonl
sqlite3 ~/knowmon-test-vault/.knowmon/index.db \
  "select n.path, e.kind, datetime(e.ts/1000,'unixepoch','localtime')
   from note_events e join notes n on n.id = e.note_id order by e.ts"
```

第一次開啟時，每篇筆記會各記一筆 `create`，之後是操作產生的 `open` / `edit`。同一篇筆記的同一種事件，60 秒內只會記一筆。

### 測試 DB 重建

關掉 App 後執行 `rm ~/knowmon-test-vault/.knowmon/index.db*`，再重新開啟同一個 vault，用上面的 sqlite3 指令檢查。歷程應該跟刪除前完全一樣，`events.jsonl` 也不會多出重複的紀錄。搜尋結果與反向連結也應與刪除前相同（連結與全文索引都從 Markdown 檔重建）。向量會在背景重新 embedding（需要 Ollama）。

從階段 1 升級的 vault 第一次開啟時，因為 schema 版本改變，`index.db` 會自動重建一次。
