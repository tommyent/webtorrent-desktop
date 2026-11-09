const chokidar = require('chokidar')
const path = require('path')
const log = require('./log')

class FolderWatcher {
  constructor ({ window, state }) {
    this.window = window
    this.state = state
    this.torrentsFolderPath = null
    this.watching = false
  }

  isEnabled () {
    return this.state.saved.prefs.autoAddTorrents
  }

  start () {
    // Stop watching previous folder before
    // start watching a new one.
    if (this.watching) this.stop()

    const torrentsFolderPath = this.state.saved.prefs.torrentsFolderPath
    this.torrentsFolderPath = torrentsFolderPath
    if (!torrentsFolderPath) return

    log('Folder Watcher: watching: ', torrentsFolderPath)

    // Watch the folder itself, not a pattern built from its path: characters
    // such as parentheses in a folder name are pattern syntax, and a folder
    // with them was never matched. disableGlobbing keeps the path literal.
    const options = {
      ignoreInitial: true,
      awaitWriteFinish: true,
      disableGlobbing: true,
      // Don't track other files in the folder: a shared Downloads folder has
      // many, and each one being written is polled until it stops growing.
      // The watcher asks about each path twice on Linux and Windows, the second
      // time saying whether it is a file. On a Mac it says so only for what was
      // there at the start, so a new path with another extension counts as a
      // file there (a new folder with a dot in its name still reports the
      // torrents inside it, because Mac events arrive per file).
      ignored: (filePath, stats) => path.resolve(filePath) !== path.resolve(torrentsFolderPath) &&
        (stats ? stats.isFile() : process.platform === 'darwin' && !!path.extname(filePath)) &&
        !/\.torrent$/i.test(filePath)
    }
    this.watcher = chokidar.watch(torrentsFolderPath, options)
    this.watcher
      .on('add', (filePath) => {
        if (!/\.torrent$/i.test(filePath)) return
        log('Folder Watcher: added torrent: ', filePath)
        this.window.dispatch('addTorrent', filePath)
      })

    this.watching = true
  }

  stop () {
    log('Folder Watcher: stop.')
    if (!this.watching) return
    this.watcher.close()
    this.watching = false
  }
}

module.exports = FolderWatcher
