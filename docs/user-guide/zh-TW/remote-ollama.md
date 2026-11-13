# 使用遠端電腦的 Ollama

> 先讀過 [設定本地 AI](ai-setup.md)，了解 AI 功能用到哪些模型。

如果你的電腦跑不動語言模型，可以讓另一台電腦（有 GPU 的桌機、實驗室或公司的伺服器）執行 Ollama，Knowmon 照樣在你自己的電腦上使用：

- **在遠端執行**：總結、問答、Agent、語意索引（embedding）的運算。
- **留在本機**：筆記檔案、索引資料庫、圖譜、搜尋，以及所有非 AI 功能。

> 使用遠端 Ollama 時，筆記內容（要總結的筆記、問題、檢索到的段落）會送到那台電腦處理。請只連到你信任的機器。

## 1. 在遠端電腦安裝 Ollama

### 有管理員（root）權限

和本機安裝一樣，用官方安裝程式：

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 沒有管理員權限

官方安裝程式需要 `sudo`，改成手動解壓縮到自己的家目錄即可。先用 `uname -m` 看 CPU 架構：`x86_64` 用 `amd64`，`aarch64` 用 `arm64`。

```bash
mkdir -p ~/.local
curl -fL https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst \
  | tar --zstd -x -C ~/.local
```

解開後會有 `~/.local/bin/ollama` 與 `~/.local/lib/ollama/`。把 `~/.local/bin` 加進 PATH（寫進 `~/.bashrc`，重新登入後生效）：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

- **出現 `tar: zstd: Cannot exec`**：遠端沒有 `zstd`。在你自己的電腦下載並解成 `.tar` 再傳過去：

  ```bash
  # 在你的電腦
  curl -fLO https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst
  zstd -d ollama-linux-amd64.tar.zst
  scp ollama-linux-amd64.tar 使用者@遠端:
  # 在遠端
  mkdir -p ~/.local && tar -xf ollama-linux-amd64.tar -C ~/.local
  ```

- **AMD 顯示卡**：再下載 `ollama-linux-amd64-rocm.tar.zst`，用同樣方式解到 `~/.local`。
- **GPU**：Ollama 已經附帶 CUDA 函式庫，只需要顯示卡驅動。執行 `nvidia-smi` 有輸出就表示驅動已裝好；驅動需要管理員安裝。沒有 GPU 也能執行，只是慢。

### 啟動並下載模型

```bash
ollama serve
```

要讓 Ollama 在你登出 SSH 後繼續執行，最簡單的方式是放在 `tmux`（或 `screen`）裡：

```bash
tmux new -s ollama   # 開一個 tmux 工作階段
ollama serve
# 按 Ctrl+B 再按 D 離開，Ollama 繼續執行；之後用 tmux attach -t ollama 回來
```

在遠端另開一個終端機，確認 Ollama 有回應並下載模型：

```bash
curl http://127.0.0.1:11434/api/version
ollama pull bge-m3
ollama pull qwen3:8b
```

## 2. 從你的電腦連過去

| 方式                 | 適合                             | Knowmon 的 Ollama address            |
| -------------------- | -------------------------------- | ------------------------------------ |
| SSH tunnel（推薦）   | 你能用 SSH 登入遠端              | 維持預設 `http://127.0.0.1:11434`    |
| Tailscale 等私人網路 | 兩台電腦都能裝 Tailscale         | `http://<遠端的 Tailscale IP>:11434` |
| 同一個區網直連       | 兩台電腦在同一個家用或辦公室網路 | `http://<遠端的區網 IP>:11434`       |

### SSH tunnel（推薦）

在**你自己的電腦**執行，使用 Knowmon 期間保持開著：

```bash
ssh -N -L 11434:127.0.0.1:11434 使用者@遠端
```

這會把你電腦上的 `127.0.0.1:11434` 轉到遠端的 Ollama。Knowmon 的設定不用改，遠端的 Ollama 也不用對外開放。

- 你的電腦上已經有 Ollama 在跑、占用 11434 時，改用別的本機 port，例如 `-L 11500:127.0.0.1:11434`，Knowmon 的位址填 `http://127.0.0.1:11500`。
- 要在背景執行，可以加上 `-f`：`ssh -f -N -L ...`。

### Tailscale 或區網直連

遠端的 Ollama 預設只接受來自本機的連線，要讓它接受其他電腦連線：

```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

然後在 Knowmon 填遠端的 IP。用 `0.0.0.0` 前先看下面的「安全」。

## 3. 在 Knowmon 設定

1. 打開右側的 **AI** 分頁，按 **Settings**。
2. **Ollama address** 填上一步的位址（用 SSH tunnel 且沒改 port 時不用動）。
3. 儲存後，左側欄底部應該在幾秒內變成 **AI ready**（或先顯示 **Indexing**）。模型選單會列出**遠端**已下載的模型。

這個設定所有 vault 共用。之後不用遠端時，把位址改回 `http://127.0.0.1:11434` 即可。

## 安全

- **Ollama 沒有密碼或任何驗證。** 連得到它的人都能使用它，也能看到送進去的內容。**不要把 Ollama 直接開放到網際網路上**（例如在有公開 IP 的伺服器上用 `0.0.0.0`）。SSH tunnel 與 Tailscale 都只有你自己連得到。
- **共用的伺服器**：即使 Ollama 只聽 `127.0.0.1`，同一台機器上的其他帳號仍然連得到你的 Ollama。這點無法用設定擋掉，筆記很私密時請考慮清楚。

## 共用伺服器的注意事項

- **家目錄容量不夠**：模型預設存在 `~/.ollama/models`，`bge-m3` 加 `qwen3:8b` 約 6 GB。可以改放到其他磁碟，`ollama serve` 與 `ollama pull` 前都要設定：

  ```bash
  export OLLAMA_MODELS=/其他磁碟/你的帳號/ollama-models
  ```

- **11434 已經被占用**（其他人也在跑 Ollama，`ollama serve` 顯示 `address already in use`）：換一個 port，SSH tunnel 對應過去，Knowmon 的設定不用改：

  ```bash
  # 在遠端
  OLLAMA_HOST=127.0.0.1:11500 ollama serve
  # 在你的電腦
  ssh -N -L 11434:127.0.0.1:11500 使用者@遠端
  ```

  在遠端下 `ollama pull` 時也要帶同樣的 `OLLAMA_HOST`，否則它會連到別人的 Ollama。

- **GPU 被別人占用**：顯示卡記憶體不夠時，模型可能變慢或改用 CPU 執行。

## 疑難排解

| 狀況                                | 檢查                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| AI offline                          | SSH tunnel 還開著嗎？遠端的 `ollama serve` 還在跑嗎（`tmux attach -t ollama`）？位址正確嗎？  |
| 模型選單是空的或缺模型              | 在**遠端**執行 `ollama list`，缺的用 `ollama pull` 下載                                       |
| `ssh` 顯示 `Address already in use` | 你電腦上的 11434 已被占用（通常是本機的 Ollama），改用別的本機 port，見上面 SSH tunnel 的說明 |
| 很慢                                | 在遠端執行 `nvidia-smi`，確認 Ollama 有用到 GPU                                               |

連線中斷時 Knowmon 會每 30 秒自動重試，恢復連線後就會自動接上，也可以在 AI 分頁按 **Retry**。
