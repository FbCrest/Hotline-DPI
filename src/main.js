'use strict'

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme } = require('electron')
const path    = require('path')
const { exec } = require('child_process')
const fs      = require('fs')

// Force dark theme cho context menu của tray
nativeTheme.themeSource = 'dark'

const backend = require('./backend')

let mainWindow
let tray
let isConnected = false

// Pipe backend logs → renderer
backend.setLogCallback((msg) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('backend-log', msg)
  }
})

// ===== WINDOW =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 620,
    minWidth: 800, minHeight: 580,
    frame: false, transparent: false,
    backgroundColor: '#0d0f0d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide() }
  })
}

// ===== TRAY =====
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 })
    : nativeImage.createEmpty()

  tray = new Tray(icon)
  tray.setToolTip('Hotline DPI')
  updateTrayMenu()
  tray.on('click', () => { mainWindow.show(); mainWindow.focus() })
}

function updateTrayMenu() {
  const dotGreen = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'dot-green.png'))
  const dotRed   = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'dot-red.png'))

  const menu = Menu.buildFromTemplate([
    {
      label: isConnected ? 'PROTECTED' : 'NOT CONNECTED',
      icon: isConnected ? dotGreen : dotRed,
      enabled: false
    },
    { type: 'separator' },
    { label: 'Open', click: () => { mainWindow.show(); mainWindow.focus() } },
    {
      label: isConnected ? 'Disconnect' : 'Connect',
      click: () => {
        mainWindow.show(); mainWindow.focus()
        mainWindow.webContents.send('tray-toggle-connect')
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: async () => {
        app.isQuitting = true
        if (isConnected) await backend.disconnect()
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

// ===== IPC HANDLERS =====

ipcMain.handle('save-settings', async (_, settings) => {
  try {
    const settingsFile = path.join(
      require('os').homedir(), '.hotlinedpi', 'settings.json'
    )
    const dir = path.dirname(settingsFile)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8')
    return true
  } catch { return false }
})

ipcMain.handle('load-settings', async () => {
  try {
    const settingsFile = path.join(
      require('os').homedir(), '.hotlinedpi', 'settings.json'
    )
    if (!fs.existsSync(settingsFile)) return null
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  } catch { return null }
})

ipcMain.handle('check-admin', async () => backend.checkAdmin())

ipcMain.handle('connect', async (_, config) => {
  try {
    await backend.connect(config)
    isConnected = true
    updateTrayMenu()
    return { success: true, message: 'SUCCESS Kết nối hoàn tất' }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('disconnect', async () => {
  try {
    await backend.disconnect()
    isConnected = false
    updateTrayMenu()
    return { success: true, message: 'SUCCESS Đã ngắt kết nối' }
  } catch (e) {
    return { success: false, message: e.message }
  }
})

ipcMain.handle('get-adapters', async () => {
  const all = await backend.getAllAdapters()
  return all
})

ipcMain.handle('get-current-dns', async () => backend.getDnsInfo())

ipcMain.handle('set-dns-quick', async (_, profile) => backend.setDnsQuick(profile))

ipcMain.handle('test-connections', async () => backend.testConnections())

ipcMain.handle('open-network-adapter', () => exec('control.exe ncpa.cpl'))

ipcMain.on('window-minimize', () => mainWindow.minimize())
ipcMain.on('window-close',    () => mainWindow.hide())
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})

// ===== APP LIFECYCLE =====

app.whenReady().then(async () => {
  createWindow()
  createTray()
  await backend.recoveryCheck()
})

app.on('window-all-closed', e => e.preventDefault())

app.on('before-quit', async () => {
  app.isQuitting = true
  if (isConnected) {
    try { await backend.disconnect() } catch {}
  }
})

process.on('uncaughtException', async (err) => {
  console.error('Uncaught:', err)
  try { await backend.disconnect() } catch {}
  process.exit(1)
})
