# 安裝

有兩種方式可以使用 Knowmon：

- **[下載安裝檔](#下載安裝檔)**（建議）：不需要安裝其他軟體。
- **[從原始碼執行](#從原始碼執行給開發者)**：給想修改程式碼或試用未發布功能的開發者。

## 下載安裝檔

到 [Releases 頁面](https://github.com/richardlaiis/Knowmon/releases)，在最新版本的 **Assets** 底下下載適合你系統的檔案：

| 系統                           | 檔案                       |
| ------------------------------ | -------------------------- |
| Debian、Ubuntu 及其衍生版      | `knowmon_0.1.0_amd64.deb`  |
| Fedora、RHEL、Rocky、AlmaLinux | `knowmon-0.1.0.x86_64.rpm` |
| 其他發行版（包括 openSUSE）    | `knowmon-0.1.0.AppImage`   |
| Windows（實驗性）              | `knowmon-0.1.0-setup.exe`  |
| macOS，Apple 晶片（實驗性）    | `knowmon-0.1.0-arm64.dmg`  |
| macOS，Intel 處理器（實驗性）  | `knowmon-0.1.0-x64.dmg`    |

Linux 只提供 64 位元 x86（`x86_64`）版本。不確定自己的 Mac 是哪一種？點選蘋果選單 →「關於這台 Mac」：顯示「晶片 Apple M…」是 Apple 晶片，「處理器 Intel…」是 Intel。

AI 功能需要另外安裝 [Ollama](https://ollama.com)；沒有 Ollama 也可以使用 Knowmon。詳見 [設定本地 AI](ai-setup.md)。

### Linux

- **deb**：

  ```bash
  sudo apt install ./knowmon_0.1.0_amd64.deb
  ```

- **rpm**：

  ```bash
  sudo dnf install ./knowmon-0.1.0.x86_64.rpm
  ```

  rpm 的相依套件名稱依照 Fedora 的命名，在 openSUSE 上可能找不到，所以 openSUSE 請改用 AppImage。

裝好後從應用程式選單開啟 Knowmon。移除：`sudo apt remove knowmon` 或 `sudo dnf remove knowmon`。

**AppImage** 不需要安裝，加上執行權限後直接執行：

```bash
chmod +x knowmon-0.1.0.AppImage
./knowmon-0.1.0.AppImage
```

不需要另外安裝 FUSE 2（`libfuse2`）。在 Ubuntu 24.04 之後的版本，AppArmor 會限制 Chromium 的 sandbox，AppImage 偵測到時會自動以 `--no-sandbox` 啟動。App 仍可正常使用，但少了一層保護，所以 Debian／Ubuntu 系統建議使用 deb。

### Windows（實驗性）

> Windows 版由 CI 自動建置與測試，但還沒有在實機上試用過。遇到問題請到 [Issues](https://github.com/richardlaiis/Knowmon/issues) 回報。

執行 `knowmon-0.1.0-setup.exe`。安裝檔沒有程式碼簽章，Windows SmartScreen 會顯示「Windows 已保護您的電腦」：按 **其他資訊 → 仍要執行**。裝好後開始選單與桌面會出現 Knowmon。移除：**設定 → 應用程式 → 已安裝的應用程式 → Knowmon → 解除安裝**。

### macOS（實驗性）

> macOS 版由 CI 自動建置，但還沒有在實機上試用過。遇到問題請到 [Issues](https://github.com/richardlaiis/Knowmon/issues) 回報。

打開 dmg，把 **Knowmon** 拖到「應用程式」資料夾。

Knowmon 沒有經過 Apple 公證，第一次開啟會被 Gatekeeper 擋下，顯示「Knowmon 已損毀，無法打開」或「Apple 無法驗證 Knowmon」之類的訊息。App 並沒有損毀，只是 macOS 會擋下從網路下載、沒有公證的 App。在「終端機」執行下面的指令移除下載標記，之後就能正常開啟：

```bash
xattr -cr /Applications/Knowmon.app
```

每次下載新版本後做一次即可。

## 從原始碼執行（給開發者）

從原始碼執行大約需要十分鐘，大部分時間花在下載。

### 需要準備的軟體

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

### 1. 下載原始碼

```bash
git clone https://github.com/richardlaiis/Knowmon.git
cd Knowmon
```

### 2. 安裝相依套件

```bash
npm install
```

這一步會下載 Electron（約 100 MB）與其他套件。資料庫套件 better-sqlite3 附有預先編譯好的版本，**不需要**安裝 C++ 編譯器，也不需要 rebuild。

### 3. Linux：設定 Electron sandbox 權限

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

### 4. 啟動 Knowmon

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

### 5.（可選）設定本地 AI

安裝 Ollama 並下載模型：

```bash
ollama pull bge-m3
ollama pull qwen3:8b
```

詳細說明見 [設定本地 AI](ai-setup.md)。沒有 Ollama 也可以使用 Knowmon，只是 AI 相關功能無法使用。

### 試用範例 vault

原始碼附有一個範例 vault `test-vault/`，裡面有日記、讀書筆記、專案筆記，適合用來熟悉各項功能。建議**先複製一份**再開啟，以免改到原始碼裡的檔案：

```bash
cp -r test-vault ~/knowmon-test-vault
```

然後在 Knowmon 按 **Open folder**，選擇 `~/knowmon-test-vault`。

> **請放在家目錄底下，不要放在 `/tmp`**：`/tmp` 不支援系統垃圾桶，在那裡刪除筆記會失敗。

## 更新到最新版

### 安裝檔

到 [Releases 頁面](https://github.com/richardlaiis/Knowmon/releases) 下載新版，用同樣的方式覆蓋安裝：

- **deb／rpm**：`sudo apt install ./knowmon_<版本>_amd64.deb` 或 `sudo dnf install ./knowmon-<版本>.x86_64.rpm`。
- **AppImage**：用新檔案取代舊檔案。
- **Windows**：執行新版的 `-setup.exe`。
- **macOS**：把新版 Knowmon 拖到「應用程式」取代舊版，再執行一次 `xattr -cr /Applications/Knowmon.app`。

Knowmon 不會自己檢查更新。想收到新版通知，可以在 GitHub 上按 **Watch → Custom → Releases**。

> **之前自己打包過 1.0.0 的 deb？** 第一次發布前自行打包的安裝檔版本是 1.0.0，apt 會把 0.1.0 視為降級。請先 `sudo apt remove knowmon` 移除舊版再安裝，筆記與設定都會保留。

### 從原始碼

```bash
cd Knowmon
git pull
npm install
npm start
```

Linux 上如果 `npm install` 重新下載了 Electron，記得再做一次第 3 步。

你的筆記存在你自己選的 vault 資料夾裡，與 App 本身無關，更新不會影響它們。App 設定（上次的 vault、Ollama 設定、分頁、主題）也會保留。

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

### Linux：從原始碼執行時一啟動就閃退

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

## 自行打包安裝檔

正式的安裝檔由 GitHub Actions 在各平台建置（見 `docs/releasing.md`）。想從原始碼自己打包：

```bash
npm run build:linux   # Linux：產生 AppImage、deb 與 rpm
npm run build:win     # Windows 安裝檔
npm run build:mac     # macOS dmg（依這台 Mac 的晶片）
```

產生的檔案在 `dist/` 資料夾。**必須在目標作業系統上打包**（例如在 Mac 上打包 macOS 版），因為向量搜尋元件只會安裝建置機器所在平台的版本。

打包 rpm 需要 `rpmbuild`：Fedora 用 `sudo dnf install rpm-build libxcrypt-compat`，Debian／Ubuntu 用 `sudo apt install rpm`。（Fedora 上打包工具內附的 Ruby 需要 `libxcrypt-compat` 提供的 `libcrypt.so.1`，沒裝的話會出現 `error while loading shared libraries: libcrypt.so.1` 而失敗。）只想打包部分格式時可以指定，例如 `npx electron-vite build && npx electron-builder --linux AppImage deb`。

打包版與從原始碼執行的版本共用同一份 App 設定（Linux 為 `~/.config/knowmon/`），所以上次的 vault、Ollama 設定、分頁與主題都會沿用。
