# 計畫：使用說明新增「遠端 Ollama」頁面

## Context

有些使用者（例如只有一台效能差的筆電）想用另一台電腦的 GPU 跑 AI，但仍在本機用 Knowmon 的 GUI。程式其實已經支援：AI 設定的 Ollama address（`LlmSettings.baseUrl`，`src/shared/llm.ts`）可以指向任何 http(s) 位址，所有 LLM 呼叫都走這個 URL。缺的是文件：目前只有 `ai-setup.md` 設定表一句「可以指向區網中另一台有 GPU 的電腦」，沒有教怎麼安裝（尤其沒有 root 時）、怎麼安全連線。

這次只寫文件，不改程式、不動合約（`types.ts`、schema、相依套件都不碰）。

## 要做的事

### 1. 存計畫

把本計畫存為 `docs/plans/remote-ollama.md`（CLAUDE.md 規定）。

### 2. 新頁面 `docs/user-guide/zh-TW/remote-ollama.md` 與 `docs/user-guide/en/remote-ollama.md`

中英文內容一致，風格比照 `ai-setup.md`（短段落、表格、bash 區塊）。大綱：

1. **什麼時候用**：本機跑不動模型；運算（總結、問答、Agent、embedding）在遠端，筆記與索引留在本機。筆記內容會送到遠端那台機器。
2. **在遠端安裝 Ollama**
   - 有 root：官方 `install.sh`（連到 `ai-setup.md`）。
   - 沒有 root：從 GitHub releases 下載 `ollama-linux-<arch>.tar.zst` 解到 `~/.local`、加 PATH；沒有 `zstd` 時在本機解壓成 `.tar` 再 `scp`；AMD 顯卡另外解 `-rocm` 包；GPU 只需要驅動（`nvidia-smi` 檢查）。
   - 啟動：`ollama serve`，用 `tmux` 讓它在登出後繼續跑；`curl .../api/version` 確認；`ollama pull bge-m3`、`qwen3:8b`。
3. **連線方式**（三選一，表格比較）
   - **SSH tunnel（推薦）**：`ssh -N -L 11434:127.0.0.1:11434 user@host`，Knowmon 位址維持預設，遠端不用開對外 port。
   - **Tailscale 等私人網路**：遠端 `OLLAMA_HOST=0.0.0.0`，位址填 `http://<tailscale IP>:11434`。
   - **同一個區網直連**：同上，填區網 IP。
4. **在 Knowmon 設定**：AI 分頁 → Settings → Ollama address；模型選單會列出遠端已下載的模型；這個設定所有 vault 共用。
5. **安全**：Ollama 沒有驗證，不要開到公網；共用機器上即使只聽 `127.0.0.1`，同機其他帳號仍連得到。
6. **共用伺服器的注意事項**：`OLLAMA_MODELS` 換存放位置（家目錄配額）；port 被占用時改 `OLLAMA_HOST=127.0.0.1:<port>`、tunnel 對應改；GPU 被別人占用時可能變慢或退回 CPU。
7. **疑難排解**：AI offline → 檢查 tunnel / `ollama serve` 是否還在、位址是否正確；斷線後 Knowmon 每 30 秒自動重試（現有行為，見 `ai-setup.md`）。

不寫未實測的內容（例如 2 秒連線檢查在高延遲網路是否誤判）。

### 3. 連到新頁面

- `docs/user-guide/{zh-TW,en}/README.md`：「AI 功能（可選）」清單加一行。
- `docs/user-guide/{zh-TW,en}/ai-setup.md`：設定表 Ollama address 的說明連到新頁。
- `docs/user-guide/{zh-TW,en}/faq.md`：「AI 很慢」那條連到新頁；「我的筆記會被傳到網路上嗎？」補一句：使用遠端 Ollama 時內容會送到那台機器。

### 4. 收尾

- `docs/roadmap.md`：沒有對應項目，不勾選；不涉及設計決定，不改 `architecture.md`。
- 沒有程式碼變更，不需新測試；仍跑 `npm run lint`（確認 prettier 若涵蓋 md 也通過）。

## 驗證

- 新頁與修改處的相對連結都能對到檔案（`grep` 檢查連結目標存在、錨點標題一致）。
- 中英文頁的章節數與指令一致。
- 本機實測一次：`ollama serve` 在別的 port（例如 `OLLAMA_HOST=127.0.0.1:11500`）、用 `ssh -N -L` 或直接把 Knowmon 位址改成 `http://127.0.0.1:11500`，確認狀態變成 AI ready、能列出模型。若本機沒有 Ollama 就跳過，並在回報中說明。
- `npm run lint` 通過。

## 結果（2026-11-11）

- 本機另開 `OLLAMA_HOST=127.0.0.1:11500 ollama serve`，用 `cleanLlmSettings` + `createOllama` 連 `http://127.0.0.1:11500/`：`version`、`models`、`embed` 都正常；`OLLAMA_HOST` 同時決定 `ollama pull` 連到哪個 server（文件中的說法）。
- 本機沒有 sshd，SSH tunnel 沒有實測；tunnel 只是 port 轉發，對 Knowmon 來說與上面的非預設位址相同。
- 已確認 release 檔名（`ollama-linux-amd64.tar.zst`，v0.40.16）與解開後的結構（`bin/ollama`、`lib/ollama/`）。
