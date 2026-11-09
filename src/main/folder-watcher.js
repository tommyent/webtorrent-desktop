const chokidar = require('chokidar')
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
      // Don't track other files in the folder (a shared Downloads folder has
      // many). Where the watcher gives no file details, the check below decides.
      ignored: (filePath, stats) => !!stats && stats.isFile() && !/\.torrent$/i.test(filePath)
    }
    this.watcher = chokidar.watch(torrentsFolderPath, options)
    this.watcher
      .on('add', (path) => {
        if (!/\.torrent$/i.test(path)) return
        log('Folder Watcher: added torrent: ', path)
        this.window.dispatch('addTorrent', path)
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
