# 安裝

Knowmon 目前還沒有發布安裝檔，需要從原始碼執行。整個過程大約十分鐘，大部分時間花在下載。

## 需要準備的軟體

| 軟體                          | 版本               | 用途                         | 確認方式        |
| ----------------------------- | ------------------ | ---------------------------- | --------------- |
| [Node.js](https://nodejs.org) | 22 以上（建議 24） | 執行與建置 Knowmon，內含 npm | `node -v`       |
| [Git](https://git-scm.com)    | 任何近期版本       | 下載原始碼                   | `git --version` |
| [Ollama](https://ollama.com)  | 任何近期版本       | **可選**，AI 功能才需要      | `ollama -v`     |

支援 Linux、macOS、Windows。下面只有標示「Linux」的步驟是 Linux 專屬。

> **安裝 Node.js 的建議**：用 [nvm](https://github.com/nvm-sh/nvm)（Linux / macOS）或 [nvm-windows](https://github.com/coreybutler/nvm-windows) 安裝，之後切換版本比較方便：
>
> ```bash
> nvm install 24
> nvm use 24
> ```

## 1. 下載原始碼

```bash
git clone https://github.com/richardlaiis/Knowmon.git
cd Knowmon
```

## 2. 安裝相依套件

```bash
npm install
```

這一步會下載 Electron（約 100 MB）與其他套件。資料庫套件 better-sqlite3 附有預先編譯好的版本，**不需要**安裝 C++ 編譯器，也不需要 rebuild。

## 3. Linux：設定 Electron sandbox 權限

> 只有 Linux 需要。macOS 與 Windows 請跳過。

第一次執行前要做一次，否則 App 會直接閃退，並出現 `The SUID sandbox helper binary was found, but is not configured correctly`：

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

每次重新安裝 `node_modules`（例如刪掉後重跑 `npm install`）都要再做一次。

不想用 `sudo` 的話，可以改用下面的指令啟動（關閉 sandbox，只建議在自己的電腦上這樣做）：

```bash
npx electron-vite dev -- --no-sandbox
```

## 4. 啟動 Knowmon

有兩種方式，擇一即可：

```bash
# 方式 A：一般使用（建議）
npm start
```

```bash
# 方式 B：開發模式（修改程式碼時會自動更新畫面）
npm run dev
```

看到歡迎畫面與 **Open folder** 按鈕就成功了。接下來請看 [快速開始](quickstart.md)。

> `npm start` 每次啟動前都會先建置一次，需要幾秒鐘。第一次之後想省下這段時間，可以用 `npm start -- --skipBuild` 直接執行上次建置好的版本（更新原始碼後請再用一次 `npm start`）。

## 5.（可選）設定本地 AI

安裝 Ollama 並下載模型：

```bash
ollama pull bge-m3
ollama pull qwen3:8b
```

詳細說明見 [設定本地 AI](ai-setup.md)。沒有 Ollama 也可以使用 Knowmon，只是 AI 相關功能無法使用。

## 試用範例 vault

原始碼附有一個範例 vault `test-vault/`，裡面有日記、讀書筆記、專案筆記，適合用來熟悉各項功能。建議**先複製一份**再開啟，以免改到原始碼裡的檔案：

```bash
cp -r test-vault ~/knowmon-test-vault
```

然後在 Knowmon 按 **Open folder**，選擇 `~/knowmon-test-vault`。

> **請放在家目錄底下，不要放在 `/tmp`**：`/tmp` 不支援系統垃圾桶，在那裡刪除筆記會失敗。

## 更新到最新版

```bash
cd Knowmon
git pull
npm install
npm start
```

Linux 上如果 `npm install` 重新下載了 Electron，記得再做一次第 3 步。

你的筆記存在你自己選的 vault 資料夾裡，與原始碼資料夾無關，更新不會影響它們。

## 安裝時的常見問題

### `Electron failed to install correctly`

Electron 的執行檔沒有下載成功（常見於網路不穩）。補下載即可：

```bash
node node_modules/electron/install.js
```

下載一直失敗時，可以改用鏡像站：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

### Linux：App 一啟動就閃退

多半是沒有做第 3 步的 sandbox 設定。看終端機是否出現 `SUID sandbox helper` 的訊息。

### 終端機出現一些警告訊息

以下訊息在 Linux 上屬於正常現象，可以忽略：

| 訊息                                                           | 原因                                           |
| -------------------------------------------------------------- | ---------------------------------------------- |
| `vaInitialize failed: unknown libva error`                     | 沒有硬體影片解碼驅動，改用軟體解碼             |
| `components/dbus/xdg/request.cc ... Request cancelled by user` | 在選擇資料夾的對話框按了取消                   |
| `GLib-GObject ... has no handler with id`                      | 把檔案移到垃圾桶時產生的警告，檔案仍會正常刪除 |
| `wayland_object.cc ... Binding to ... version`                 | Wayland 協定版本提示                           |

### `node` 版本太舊

`node -v` 顯示低於 22 時，請升級 Node.js（見上方 nvm 的說明），然後刪掉 `node_modules` 重新 `npm install`。

## 自行打包安裝檔（實驗性）

> 打包流程還在開發中（開發路線的階段 8）。Linux 的打包版已驗證可用（包括 AI 功能）；Windows 與 macOS 尚未驗證。

```bash
npm run build:linux   # Linux：產生 AppImage 與 deb
npm run build:win     # Windows 安裝檔（未驗證）
npm run build:mac     # macOS dmg（未驗證）
```

產生的檔案在 `dist/` 資料夾。**必須在目標作業系統上打包**（例如在 Mac 上打包 macOS 版），因為向量搜尋元件只會安裝建置機器所在平台的版本。

### 安裝 Linux 版

- **deb**（Debian、Ubuntu 等）：

  ```bash
  sudo apt install ./dist/knowmon_1.0.0_amd64.deb
  ```

  之後從應用程式選單開啟 Knowmon。安裝腳本會自動處理 sandbox 權限，不需要做上面第 3 步。移除：`sudo apt remove knowmon`。

- **AppImage**（其他發行版）：

  ```bash
  chmod +x dist/knowmon-1.0.0.AppImage
  ./dist/knowmon-1.0.0.AppImage
  ```

  不需要另外安裝 FUSE 2（`libfuse2`）。在 Ubuntu 24.04 之後的版本，AppArmor 會限制 Chromium 的 sandbox，AppImage 偵測到時會自動以 `--no-sandbox` 啟動。App 仍可正常使用，但少了一層保護，所以 Debian／Ubuntu 系統建議使用 deb。

打包版與從原始碼執行的版本共用同一份 App 設定（Linux 為 `~/.config/knowmon/`），所以上次的 vault、Ollama 設定、分頁與主題都會沿用。
