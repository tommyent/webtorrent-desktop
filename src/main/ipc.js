module.exports = {
  init,
  setModule
}

const electron = require('electron')
const { app, ipcMain } = electron
const log = require('./log')
const menu = require('./menu')
const windows = require('./windows')

// Messages from the main process, to be sent once the WebTorrent process starts
const messageQueueMainToWebTorrent = []

// Will hold modules injected from the app that will be used on fired
// IPC events.
const modules = {}

function setModule (name, module) {
  modules[name] = module
}

function init () {
  ipcMain.once('ipcReady', e => {
    app.ipcReady = true
    app.emit('ipcReady')
  })

  ipcMain.once('ipcReadyWebTorrent', e => {
    app.ipcReadyWebTorrent = true
    log('sending %d queued messages from the main win to the webtorrent window',
      messageQueueMainToWebTorrent.length)
    messageQueueMainToWebTorrent.forEach(message => {
      windows.webtorrent.send(message.name, ...message.args)
      log('webtorrent: sent queued %s', message.name)
    })
  })

  ipcMain.handle('sendTelemetry', (e, data) =>
    require('./telemetry').send(data))

  /**
   * Dialog
   */

  ipcMain.on('openTorrentFile', () => {
    const dialog = require('./dialog')
    dialog.openTorrentFile()
  })
  ipcMain.on('openFiles', () => {
    const dialog = require('./dialog')
    dialog.openFiles()
  })
  ipcMain.handle('loadSubtitles', (e, filePaths) =>
    require('./subtitles').load(filePaths))

  /**
   * Dock
   */

  ipcMain.on('setBadge', (e, ...args) => {
    const dock = require('./dock')
    dock.setBadge(...args)
  })
  ipcMain.on('downloadFinished', (e, ...args) => {
    const dock = require('./dock')
    dock.downloadFinished(...args)
  })

  /**
   * Player Events
   */

  ipcMain.on('onPlayerOpen', () => {
    const powerSaveBlocker = require('./power-save-blocker')
    const shortcuts = require('./shortcuts')
    const thumbar = require('./thumbar')

    menu.togglePlaybackControls(true)
    powerSaveBlocker.enable()
    shortcuts.enable()
    thumbar.enable()
  })

  ipcMain.on('onPlayerUpdate', (e, ...args) => {
    const thumbar = require('./thumbar')

    menu.onPlayerUpdate(...args)
    thumbar.onPlayerUpdate(...args)
  })

  ipcMain.on('onPlayerClose', () => {
    const powerSaveBlocker = require('./power-save-blocker')
    const shortcuts = require('./shortcuts')
    const thumbar = require('./thumbar')

    menu.togglePlaybackControls(false)
    powerSaveBlocker.disable()
    shortcuts.disable()
    thumbar.disable()
  })

  ipcMain.on('onPlayerPlay', () => {
    const powerSaveBlocker = require('./power-save-blocker')
    const thumbar = require('./thumbar')

    powerSaveBlocker.enable()
    thumbar.onPlayerPlay()
  })

  ipcMain.on('onPlayerPause', () => {
    const powerSaveBlocker = require('./power-save-blocker')
    const thumbar = require('./thumbar')

    powerSaveBlocker.disable()
    thumbar.onPlayerPause()
  })

  /**
   * Folder Watcher Events
   */

  ipcMain.on('startFolderWatcher', () => {
    if (!modules.folderWatcher) {
      log('IPC ERR: folderWatcher module is not defined.')
      return
    }

    modules.folderWatcher.start()
  })

  ipcMain.on('stopFolderWatcher', () => {
    if (!modules.folderWatcher) {
      log('IPC ERR: folderWatcher module is not defined.')
      return
    }

    modules.folderWatcher.stop()
  })

  /**
   * Shell
   */

  ipcMain.on('openPath', (e, ...args) => {
    const shell = require('./shell')
    shell.openPath(...args)
  })
  ipcMain.on('showItemInFolder', (e, ...args) => {
    const shell = require('./shell')
    shell.showItemInFolder(...args)
  })
  ipcMain.on('moveItemToTrash', (e, ...args) => {
    const shell = require('./shell')
    shell.moveItemToTrash(...args)
  })

  /**
   * File handlers
   */

  ipcMain.on('setDefaultFileHandler', (e, flag) => {
    const handlers = require('./handlers')

    if (flag) handlers.install()
    else handlers.uninstall()
  })

  /**
   * Auto start on login
   */

  ipcMain.on('setStartup', (e, flag) => {
    const startup = require('./startup')

    if (flag) startup.install()
    else startup.uninstall()
  })

  /**
   * Windows: Main
   */

  const main = windows.main

  ipcMain.on('setAspectRatio', (e, ...args) => main.setAspectRatio(...args))
  ipcMain.on('setBounds', (e, ...args) => main.setBounds(...args))
  ipcMain.on('setProgress', (e, ...args) => main.setProgress(...args))
  ipcMain.on('setTitle', (e, ...args) => main.setTitle(...args))
  ipcMain.on('show', () => main.show())
  ipcMain.on('toggleFullScreen', (e, ...args) => main.toggleFullScreen(...args))
  ipcMain.on('setAllowNav', (e, ...args) => menu.setAllowNav(...args))

  /**
   * Synchronous helpers for the renderer. These replaced @electron/remote:
   * every call site was a sync remote.* lookup, so the handlers are sync too.
   */

  ipcMain.on('getPath', (e, key) => {
    e.returnValue = typeof key === 'string' ? app.getPath(key) : ''
  })

  ipcMain.on('getWindowInfo', (e) => {
    const win = main.win
    e.returnValue = {
      isVisible: !!win && win.isVisible(),
      isMaximized: !!win && win.isMaximized()
    }
  })

  ipcMain.on('showOpenDialogSync', (e, opts) => {
    e.returnValue = electron.dialog.showOpenDialogSync(main.win, Object(opts))
  })

  ipcMain.on('showSaveDialogSync', (e, opts) => {
    e.returnValue = electron.dialog.showSaveDialogSync(main.win, Object(opts))
  })

  ipcMain.on('openTorrentListContextMenu', (e, info) =>
    require('./torrent-list-context-menu').open(info))

  /**
   * External Media Player
   */

  ipcMain.on('checkForExternalPlayer', (e, path) => {
    const externalPlayer = require('./external-player')

    externalPlayer.checkInstall(path, err => {
      windows.main.send('checkForExternalPlayer', !err)
    })
  })

  ipcMain.on('openExternalPlayer', (e, ...args) => {
    const externalPlayer = require('./external-player')
    const shortcuts = require('./shortcuts')
    const thumbar = require('./thumbar')

    menu.togglePlaybackControls(false)
    shortcuts.disable()
    thumbar.disable()
    externalPlayer.spawn(...args)
  })

  ipcMain.on('quitExternalPlayer', () => {
    const externalPlayer = require('./external-player')
    externalPlayer.kill()
  })

  /**
   * Message passing
   */

  const oldEmit = ipcMain.emit
  ipcMain.emit = (name, e, ...args) => {
    // Relay messages between the main window and the WebTorrent hidden window
    if (name.startsWith('wt-') && !app.isQuitting) {
      if (windows.webtorrent.win && e.sender === windows.webtorrent.win.webContents) {
        // Send message to main window
        windows.main.send(name, ...args)
        log('webtorrent: got %s', name)
      } else if (!windows.main.win || e.sender !== windows.main.win.webContents) {
        log('webtorrent: ignored %s from unknown renderer', name)
      } else if (app.ipcReadyWebTorrent) {
        // Send message to webtorrent window
        windows.webtorrent.send(name, ...args)
        log('webtorrent: sent %s', name)
      } else {
        // Queue message for webtorrent window, it hasn't finished loading yet
        messageQueueMainToWebTorrent.push({
          name,
          args
        })
        log('webtorrent: queueing %s', name)
      }
      return
    }

    // Emit all other events normally
    oldEmit.call(ipcMain, name, e, ...args)
  }
}
