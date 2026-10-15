import { app, BrowserWindow, shell, session } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { initDatabase } from './database'
import { registerIpcHandlers } from './ipc'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 920,
    minHeight: 600,
    backgroundColor: '#09090b',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  })

  // The app needs no browser permissions (camera, location, notifications, ...), so deny them all.
  // Network requests are not "permissions" and are unaffected.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  win.once('ready-to-show', () => win.show())

  // Open external links in the system browser, not Electron (web links only)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite sets ELECTRON_RENDERER_URL in dev mode
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDatabase()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
