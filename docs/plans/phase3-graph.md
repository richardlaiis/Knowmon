# 階段 3 實作計畫：圖譜視圖

完成標準：全域圖與單篇局部圖可互動，1000 篇筆記時不卡頓。

## 已確認的決定（2026-10-07）

- 版面配置用 Web Worker 裡的 `d3-force`（新增相依套件），Cytoscape 負責繪製。
- 同意下方的 `types.ts` 合約變更。
- 尚未建立的筆記（未解析的 wikilink）完全不顯示在圖譜上，所以合約不需要幽靈節點的欄位。
- 全域圖在主區域與編輯器切換。

## 版面配置演算法的實測（2026-10-07）

隨機圖，每篇平均 2 條連結，Node 24 headless 量測：

| 筆記數 | Cytoscape 內建 `cose` | `cytoscape-fcose` | `d3-force`（300 次迭代） |
| --- | --- | --- | --- |
| 300 | 3.3 s | — | — |
| 1000 | 37 s | 9.9 s | 1.8 s |
| 2000 | 超過 2 分鐘 | 34 s | 3.9 s |

`cose` 與 `fcose` 都是一次算完才畫，而且會卡住 UI。`d3-force` 快一個數量級，並且可以放在 Web Worker 裡每一幀回傳座標，邊算邊畫（同 Obsidian 的效果），主執行緒不會被卡住。

**提案**：Cytoscape（已安裝）負責繪製與互動，版面配置交給 Web Worker 裡的 `d3-force`（新相依套件，需同意）。

## 資料（main process）

新增 `getGraph(db)`（`src/main/db/graph.ts`）：

- 節點：所有筆記（path、title、eventDate）。
- 邊：`links` 表中 `type = 'wikilink'` 且 `dst` 不為 NULL 的列，以路徑表示；同一對筆記的多列合併、權重相加；排除連到自己的邊。
- 未建立的目標（`dst IS NULL`）不回傳。
- 1000 篇時查詢應在數十 ms 內完成（加測試）。

## IPC 合約變更（`src/shared/types.ts`，需同意）

```ts
export type LinkType = 'wikilink' // 階段 4、5 會加入 same_session、same_day、sequence、semantic

export interface GraphNode {
  path: string
  title: string
  eventDate: string | null
}

export interface GraphEdge {
  source: string // 筆記路徑
  target: string
  type: LinkType
  weight: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// KnowmonAPI 新增：
graph: {
  get(): Promise<GraphData>
}
```

局部圖在 renderer 由全域資料以 BFS 算出，不另外加 IPC。

## Renderer（`src/renderer/graph/`）

- `model.ts`（純函式，附測試）：鄰接表、`localSubgraph(data, center, depth)`（不分方向的 BFS）、hover 時要高亮的鄰居、依連結數決定節點大小、新節點的初始位置（放在已有位置的鄰居旁邊）。
- `forceLayout.ts`（純函式，附測試）：包裝 d3-force 的模擬（link、charge、center、collide），可固定被拖曳的節點。
- `layout.worker.ts`：在 Worker 執行上面的模擬，每幀以 `Float32Array`（transferable）回傳座標，收斂後停止；收到「拖曳」「資料變更」時重新加熱。
- `GraphView.tsx`：Cytoscape `preset` layout，收到座標時以 `cy.batch()` 更新。
  - 互動：滾輪縮放、拖曳平移、拖曳節點、點擊開啟筆記、hover 高亮該節點與鄰居（其他節點與邊淡化）。
  - 效能設定：`textureOnViewport`、`hideEdgesOnViewport`、縮小時隱藏標籤（`min-zoomed-font-size`）。
  - 顏色讀 `main.css` 的 CSS 變數，切換主題時重新套用樣式。目前開著的筆記以強調色標示。
- 座標快取：同一個 vault 在記憶體中保留節點座標，重新打開圖譜或資料更新時不會整張重排。不寫入磁碟。
- 資料更新：沿用階段 2 的 `indexVersion`，重新取得資料後只增刪有變動的節點與邊，輕度重新加熱。

## 版面

- **全域圖**：在主區域與編輯器切換（側欄按鈕或 `Ctrl/Cmd+G`），開著的筆記保留，切回來時不重新載入。
- **局部圖**：右側面板分成「Backlinks / Local graph」兩個分頁，局部圖可選深度 1–3，點節點開啟筆記。
- 圖譜控制項：標籤開關、重新排列。設定存 localStorage。

## 效能測試

- `scripts/gen-vault.mjs`：產生 N 篇測試筆記（中文標題、隨機 wikilink、部分日記檔名），輸出到指定資料夾，不放進 git。
- vitest：`getGraph` 在 5000 篇時的耗時、`localSubgraph` 的正確性、`forceLayout` 在 1000 節點收斂所需時間（寬鬆上限，避免機器差異造成誤判）。
- 實際執行 App（和階段 2 一樣用 CDP 驅動）：1000 篇與 3000 篇的 vault，量測開啟圖譜到第一次畫出、版面收斂的時間，以及 hover / 縮放時主執行緒的長任務（Long Tasks），結果記錄在本文件。

## 進行順序（每項完成、測試通過後勾選 roadmap；commit 由使用者自行處理）

1. `getGraph` + IPC + 測試
2. 模型與版面配置（純函式 + Worker）+ 測試
3. 全域圖譜視圖與互動
4. 局部圖面板
5. 產生大型 vault、效能量測與調整

## 效能量測結果（2026-10-07）

環境：Intel Arc（Mesa），Electron offscreen rendering 搭配 GPU（`useSharedTexture`），用 CDP 驅動實際的 App。測試 vault 由 `scripts/gen-vault.mjs` 產生。fps 以 `requestAnimationFrame` 計數，long task 為主執行緒上超過 50ms 的工作。

| 操作 | 1000 篇（1908 連結） | 3000 篇（5799 連結） |
| --- | --- | --- |
| 開啟 vault（建立索引） | 1.8 s | 6.7 s |
| 第一次打開圖譜 | 一次約 0.45 s 的停頓 | 一次約 1 s 的停頓 |
| 排版（Worker 計算，完成後一次套用） | 2.3 s，UI 可操作，~38 fps | 6.8 s，~34 fps |
| 縮放 | ~56 fps | ~46 fps |
| 平移 | ~60 fps | ~54 fps |
| hover 高亮 | ~21 fps，每次 50–80ms | ~7 fps，每次 150–240ms |
| 再次打開圖譜 | 立即（無 long task） | 立即 |

### 過程中的發現與調整

- 一開始每一幀都把座標套到 Cytoscape（邊算邊畫），1000 篇時只有 ~11 fps：Cytoscape canvas 每次整張重畫約 45ms（邊與節點各一半，調整樣式沒有幫助）。改成超過 500 個節點時 Worker 只在收斂後回傳一次座標，期間在工具列顯示進度。
- hover 時對所有元素加上淡化 class 會讓整張圖重新套樣式；超過 500 個節點時只高亮鄰居、不淡化其他元素。
- 全域圖第一次打開後保留在背景（隱藏），再次打開不需要重建。
- 試過 Cytoscape 的實驗性 WebGL renderer：重畫快約一倍（hover ~39 fps），但它以 GPU readback 做點擊判定，測試中完全點不到節點，所以不採用。
- 試過 hover 延遲 60ms 才高亮：沒有可量測的改善（成本主要來自 Cytoscape 對滑鼠移動的處理與重畫），所以沒有保留。
- 使用者決定維持 Cytoscape canvas（2026-10-07）：約 1000 篇以內堪用，筆記數更多時再評估 sigma.js（WebGL）。

## 標籤重疊（2026-10-07）

原本碰撞力只考慮節點的圓（半徑 5–18px），但標籤通常寬 60–150px。實測（Cytoscape 實際的標籤框）：測試 vault 2 組重疊，1000 篇 1696 組（938 個標籤）。

- 碰撞改用「節點＋下方標籤」的矩形（`src/renderer/graph/labelCollide.ts`，格子分區，每步約 O(n)），收斂時再做一次只有碰撞的整理（直接推開仍重疊的框，移動量 2–7px）。
- 只改碰撞不夠：向心力與連結力會把節點擠回去。依參數掃描改為：連結距離 50 → 70、斥力 -90 → -250 且不設 distanceMax、向心力 0.04 → 0.01、碰撞每步 3 次。

| 參數（隨機圖，每篇 2 條連結） | 300 篇 | 1000 篇 | 3000 篇 |
| --- | --- | --- | --- |
| 原本 | 205 組重疊 | 1377 | 8379 |
| 調整後（含收斂整理） | 0 | 0 | 7 |

- App 實測：測試 vault 與 1000 篇皆 0 組重疊；圖譜變得較分散（1000 篇寬度約 2.8 倍），排版時間不變，排版期間 ~55 fps、hover ~50 fps（比原本好，因為元素較不密集）。
