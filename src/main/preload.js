const { clipboard, contextBridge, ipcRenderer, shell, webUtils } = require('electron')

const config = ipcRenderer.sendSync('rendererConfig')

function on (channel, listener) {
  const handler = (event, ...args) => listener(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

function once (channel, listener) {
  const handler = (event, ...args) => listener(...args)
  ipcRenderer.once(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('webtorrent', {
  config,
  app: {
    ready: () => ipcRenderer.send('ipcReady'),
    getWindowInfo: () => ipcRenderer.sendSync('getWindowInfo'),
    onDispatch: callback => on('dispatch', callback),
    onError: callback => on('error', callback),
    onFullscreenChanged: callback => on('fullscreenChanged', callback),
    onLog: callback => on('log', callback),
    onWindowBoundsChanged: callback => on('windowBoundsChanged', callback),
    show: () => ipcRenderer.send('show')
  },
  cast: {
    command: envelope => ipcRenderer.send('wt-cast-command', envelope),
    onEvent: callback => on('wt-cast-event', callback)
  },
  clipboard: {
    readText: () => clipboard.readText()
  },
  dialogs: {
    openFiles: () => ipcRenderer.send('openFiles'),
    openTorrentFile: () => ipcRenderer.send('openTorrentFile'),
    showOpen: options => ipcRenderer.sendSync('showOpenDialogSync', options),
    showSave: options => ipcRenderer.sendSync('showSaveDialogSync', options)
  },
  dock: {
    downloadFinished: filePath => ipcRenderer.send('downloadFinished', filePath),
    setBadge: value => ipcRenderer.send('setBadge', value)
  },
  downloads: {
    checkPath: filePath => ipcRenderer.invoke('checkDownloadPath', filePath)
  },
  externalPlayer: {
    check: filePath => new Promise(resolve => {
      once('checkForExternalPlayer', resolve)
      ipcRenderer.send('checkForExternalPlayer', filePath)
    }),
    open: (filePath, mediaURL, title) =>
      ipcRenderer.send('openExternalPlayer', filePath, mediaURL, title),
    openInstallPage: () => shell.openExternal('https://www.videolan.org/vlc/'),
    quit: () => ipcRenderer.send('quitExternalPlayer')
  },
  droppedFiles: {
    getPath: file => webUtils.getPathForFile(file)
  },
  folderWatcher: {
    start: () => ipcRenderer.send('startFolderWatcher'),
    stop: () => ipcRenderer.send('stopFolderWatcher')
  },
  handlers: {
    setDefault: enabled => ipcRenderer.send('setDefaultFileHandler', enabled),
    setStartup: enabled => ipcRenderer.send('setStartup', enabled)
  },
  menu: {
    openTorrentContext: info => ipcRenderer.send('openTorrentListContextMenu', info),
    setAllowNavigation: enabled => ipcRenderer.send('setAllowNav', enabled)
  },
  path: {
    basename: value => ipcRenderer.sendSync('rendererPath', 'basename', [value]),
    dirname: value => ipcRenderer.sendSync('rendererPath', 'dirname', [value]),
    extname: value => ipcRenderer.sendSync('rendererPath', 'extname', [value]),
    join: (...parts) => ipcRenderer.sendSync('rendererPath', 'join', parts),
    parse: value => ipcRenderer.sendSync('rendererPath', 'parse', [value]),
    relative: (from, to) => ipcRenderer.sendSync('rendererPath', 'relative', [from, to]),
    sep: ipcRenderer.sendSync('rendererPath', 'sep', [])
  },
  player: {
    close: () => ipcRenderer.send('onPlayerClose'),
    open: () => ipcRenderer.send('onPlayerOpen'),
    pause: () => ipcRenderer.send('onPlayerPause'),
    play: () => ipcRenderer.send('onPlayerPlay'),
    update: (hasNext, hasPrevious) =>
      ipcRenderer.send('onPlayerUpdate', hasNext, hasPrevious)
  },
  shell: {
    openReleasePage: () =>
      shell.openExternal('https://github.com/webtorrent/webtorrent-desktop/releases')
  },
  state: {
    load: () => ipcRenderer.invoke('stateLoad'),
    save: saved => ipcRenderer.invoke('stateSave', saved),
    saveImmediate: saved => ipcRenderer.invoke('stateSaveImmediate', saved)
  },
  subtitles: {
    load: filePaths => ipcRenderer.invoke('loadSubtitles', filePaths)
  },
  telemetry: {
    send: data => ipcRenderer.invoke('sendTelemetry', data)
  },
  torrent: {
    create: (torrentKey, options) => ipcRenderer.send('wt-create-torrent', torrentKey, options),
    checkPath: filePath => ipcRenderer.invoke('torrentPathExists', filePath),
    copyFile: (source, destination) =>
      ipcRenderer.invoke('copyTorrentFile', source, destination),
    deleteMetadata: (torrentFileName, posterFileName) =>
      ipcRenderer.invoke('deleteTorrentMetadata', torrentFileName, posterFileName),
    generatePoster: torrentKey => ipcRenderer.send('wt-generate-torrent-poster', torrentKey),
    getAudioMetadata: (infoHash, index) =>
      ipcRenderer.send('wt-get-audio-metadata', infoHash, index),
    inspectCreateInput: inputPaths => ipcRenderer.invoke('inspectCreateInput', inputPaths),
    onAudioMetadata: callback => on('wt-audio-metadata', callback),
    onDone: callback => on('wt-done', callback),
    onError: callback => on('wt-error', callback),
    onFileModtimes: callback => on('wt-file-modtimes', callback),
    onFileSaved: callback => on('wt-file-saved', callback),
    onMetadata: callback => on('wt-metadata', callback),
    onParsed: callback => on('wt-parsed', callback),
    onPoster: callback => on('wt-poster', callback),
    onProgress: callback => on('wt-progress', callback),
    onServerRunning: callback => on('wt-server-running', callback),
    onUncaughtError: callback => on('wt-uncaught-error', callback),
    onWarning: callback => on('wt-warning', callback),
    onceReady: (infoHash, callback) => once('wt-ready-' + infoHash, callback),
    onceServerRunning: callback => once('wt-server-running', callback),
    moveDataToTrash: filePath => ipcRenderer.send('moveItemToTrash', filePath),
    openPath: filePath => ipcRenderer.send('openPath', filePath),
    saveFile: torrentKey => ipcRenderer.send('wt-save-torrent-file', torrentKey),
    selectFiles: (infoHash, selections) =>
      ipcRenderer.send('wt-select-files', infoHash, selections),
    setGlobalTrackers: trackers => ipcRenderer.send('wt-set-global-trackers', trackers),
    start: (...args) => ipcRenderer.send('wt-start-torrenting', ...args),
    startServer: infoHash => ipcRenderer.send('wt-start-server', infoHash),
    stop: infoHash => ipcRenderer.send('wt-stop-torrenting', infoHash),
    stopServer: () => ipcRenderer.send('wt-stop-server')
  },
  window: {
    setAspectRatio: ratio => ipcRenderer.send('setAspectRatio', ratio),
    setBounds: (bounds, maximize) => ipcRenderer.send('setBounds', bounds, maximize),
    setProgress: progress => ipcRenderer.send('setProgress', progress),
    setTitle: title => ipcRenderer.send('setTitle', title),
    toggleFullScreen: enabled => ipcRenderer.send('toggleFullScreen', enabled)
  }
})
