import {
  app,
  BrowserWindow,
  Menu,
  protocol,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ASSET_SCHEME } from '../shared/assets'
import { closeVault, currentVaultRoot, registerIpc } from './ipc'
import { assetResponse } from './vault/assets'

// Settings and localStorage always live in <appData>/knowmon: by default this follows productName, which would become Knowmon in the packaged app, separate from the development build
app.setPath('userData', join(app.getPath('appData'), 'knowmon'))

// Images in notes are read through knowmon-asset://vault/<path>, serving only images inside the current vault (must be registered before ready)
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

/**
 * The application menu. Electron's default menu binds Ctrl/Cmd+W to closing the window;
 * this custom menu removes it so the renderer can use Ctrl/Cmd+W to close tabs.
 */
function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        process.platform === 'darwin' ? { role: 'hide' as const } : { role: 'quit' as const }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(is.dev ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }
  ]
  return Menu.buildFromTemplate(template)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'Knowmon',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.knowmon.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  Menu.setApplicationMenu(buildMenu())
  protocol.handle(ASSET_SCHEME, (req) => assetResponse(currentVaultRoot(), req.url))

  const ctx = { settingsDir: app.getPath('userData') }
  registerIpc(ctx)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  void closeVault()
})
