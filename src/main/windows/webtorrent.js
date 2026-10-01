const webtorrent = module.exports = {
  init,
  send,
  show,
  toggleDevTools,
  failed: false,
  win: null
}

const { app, BrowserWindow } = require('electron')

const config = require('../../config')

function init () {
  webtorrent.failed = false
  const win = webtorrent.win = new BrowserWindow({
    backgroundColor: '#1E1E1E',
    center: true,
    fullscreen: false,
    fullscreenable: false,
    height: 150,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: 'webtorrent-hidden-window',
    useContentSize: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableBlinkFeatures: 'AudioVideoTracks',
      backgroundThrottling: false
    },
    width: 150
  })

  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.session.setPermissionRequestHandler((contents, permission, respond) => respond(false))
  win.webContents.on('render-process-gone', (event, details) => {
    if (app.isQuitting || webtorrent.failed) return
    webtorrent.failed = true
    app.ipcReadyWebTorrent = false
    app.emit('webtorrentStopped')
    require('../log')('Torrent engine stopped:', details.reason, details.exitCode)
    const notify = () => require('./main').dispatch('engineStopped')
    if (app.ipcReady) notify()
    else app.once('ipcReady', notify)
  })
  win.loadURL(config.WINDOW_WEBTORRENT)

  // Prevent killing the WebTorrent process
  win.on('close', e => {
    if (app.isQuitting) {
      return
    }
    e.preventDefault()
    win.hide()
  })
}

function show () {
  if (!webtorrent.win) return
  webtorrent.win.show()
}

function send (...args) {
  if (webtorrent.failed || !webtorrent.win || webtorrent.win.webContents.isDestroyed()) return
  webtorrent.win.webContents.send(...args)
}

function toggleDevTools () {
  if (!webtorrent.win) return
  if (webtorrent.win.webContents.isDevToolsOpened()) {
    webtorrent.win.webContents.closeDevTools()
    webtorrent.win.hide()
  } else {
    webtorrent.win.webContents.openDevTools({ mode: 'detach' })
  }
}
