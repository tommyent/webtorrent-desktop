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
      // many, and each one being written is polled until it stops growing. The
      // watcher doesn't always say whether a path is a file (not on a Mac for
      // new files), so anything with another extension counts as one then.
      ignored: (filePath, stats) => path.resolve(filePath) !== path.resolve(torrentsFolderPath) &&
        (stats ? stats.isFile() : !!path.extname(filePath)) && !/\.torrent$/i.test(filePath)
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
