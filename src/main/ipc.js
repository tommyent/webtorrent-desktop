module.exports = {
  init,
  setModule
}

const electron = require('electron')
const { app, ipcMain } = electron
const log = require('./log')
const menu = require('./menu')
const rendererFiles = require('./renderer-files')
const windows = require('./windows')

// Messages from the main process, to be sent once the WebTorrent process starts
const messageQueueMainToWebTorrent = []

// Will hold modules injected from the app that will be used on fired
// IPC events.
const modules = {}

function setModule (name, module) {
  modules[name] = module
}

function assertMainSender (event) {
  if (!windows.main.win || event.sender !== windows.main.win.webContents) {
    throw new Error('Rejected IPC from unknown renderer')
  }
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

  ipcMain.on('rendererConfig', e => {
    assertMainSender(e)
    const config = require('../config')
    e.returnValue = {
      APP_NAME: config.APP_NAME,
      APP_VERSION: config.APP_VERSION,
      APP_WINDOW_TITLE: config.APP_WINDOW_TITLE,
      DEFAULT_DOWNLOAD_PATH: config.DEFAULT_DOWNLOAD_PATH,
      DEFAULT_ANNOUNCE_LIST: require('create-torrent').announceList,
      DELAYED_INIT: config.DELAYED_INIT,
      IS_PORTABLE: config.IS_PORTABLE,
      IS_PRODUCTION: config.IS_PRODUCTION,
      IS_TEST: config.IS_TEST,
      PLATFORM: process.platform,
      POSTER_PATH: config.POSTER_PATH,
      STATIC_PATH: config.STATIC_PATH,
      TORRENT_PATH: config.TORRENT_PATH,
      WINDOW_MIN_HEIGHT: config.WINDOW_MIN_HEIGHT,
      WINDOW_MIN_WIDTH: config.WINDOW_MIN_WIDTH
    }
  })
  ipcMain.on('rendererPath', (e, operation, args) => {
    assertMainSender(e)
    const path = require('path')
    if (operation === 'sep') {
      e.returnValue = path.sep
    } else if (['basename', 'dirname', 'extname', 'join', 'parse', 'relative'].includes(operation) &&
               Array.isArray(args) && args.every(arg => typeof arg === 'string')) {
      e.returnValue = path[operation](...args)
    } else {
      e.returnValue = null
    }
  })

  ipcMain.handle('stateLoad', e => {
    assertMainSender(e)
    if (!modules.stateStore) throw new Error('State store is not ready')
    return modules.stateStore.getSaved()
  })
  ipcMain.handle('stateSave', async (e, saved) => {
    assertMainSender(e)
    if (!modules.stateStore) throw new Error('State store is not ready')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      throw new TypeError('Invalid saved state')
    }
    await modules.stateStore.save(saved)
  })
  ipcMain.handle('stateSaveImmediate', async (e, saved) => {
    assertMainSender(e)
    if (!modules.stateStore) throw new Error('State store is not ready')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      throw new TypeError('Invalid saved state')
    }
    await modules.stateStore.save(saved)
    if (app.isQuitting) app.emit('stateSaved')
  })
  ipcMain.handle('checkDownloadPath', (e, filePath) => {
    assertMainSender(e)
    return rendererFiles.checkDownloadPath(filePath)
  })
  ipcMain.handle('torrentPathExists', (e, filePath) => {
    assertMainSender(e)
    return rendererFiles.pathExists(filePath)
  })
  ipcMain.handle('inspectCreateInput', (e, inputPaths) => {
    assertMainSender(e)
    return rendererFiles.inspectCreateInput(inputPaths)
  })
  ipcMain.handle('copyTorrentFile', (e, source, destination) => {
    assertMainSender(e)
    return rendererFiles.copyTorrentFile(source, destination)
  })
  ipcMain.handle('deleteTorrentMetadata', (e, torrentFileName, posterFileName) => {
    assertMainSender(e)
    return rendererFiles.deleteTorrentMetadata(torrentFileName, posterFileName)
  })

  ipcMain.handle('sendTelemetry', (e, data) => {
    assertMainSender(e)
    return require('./telemetry').send(data)
  })
  ipcMain.handle('loadSubtitles', (e, filePaths) => {
    assertMainSender(e)
    return require('./subtitles').load(filePaths)
  })

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

  ipcMain.on('openPath', (e, filePath) => {
    require('./data-path').assertDataPath(filePath)
    require('./shell').openPath(filePath)
  })
  ipcMain.on('showItemInFolder', (e, filePath) => {
    require('./data-path').assertDataPath(filePath)
    require('./shell').showItemInFolder(filePath)
  })
  ipcMain.on('moveItemToTrash', (e, filePath) => {
    require('./data-path').assertDataPath(filePath)
    require('./shell').moveItemToTrash(filePath)
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

  ipcMain.on('openExternalPlayer', (e, filePath, mediaURL, title) => {
    const externalPlayer = require('./external-player')
    const shortcuts = require('./shortcuts')
    const thumbar = require('./thumbar')

    // Never spawn a renderer-named binary: the process image comes only from
    // the user's configured player path in the authoritative saved state (or
    // null, which falls back to VLC auto-detect). The renderer still supplies
    // the media URL and title, which are args to that player, not an executable.
    const saved = modules.stateStore && modules.stateStore.getSaved()
    const playerPath = (saved && saved.prefs && saved.prefs.externalPlayerPath) || null

    menu.togglePlaybackControls(false)
    shortcuts.disable()
    thumbar.disable()
    externalPlayer.spawn(playerPath, mediaURL, title)
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

    if (name === 'ipcReadyWebTorrent') {
      if (windows.webtorrent.win && e.sender === windows.webtorrent.win.webContents) {
        return oldEmit.call(ipcMain, name, e, ...args)
      }
      log('ignored %s from unknown renderer', name)
      return
    }

    if (!windows.main.win || e.sender !== windows.main.win.webContents) {
      log('ignored %s from unknown renderer', name)
      return
    }

    // Emit all other events normally
    oldEmit.call(ipcMain, name, e, ...args)
  }
}
