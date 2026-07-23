const api = require('../lib/api')

module.exports = class FolderWatcherController {
  start () {
    console.log('-- IPC: start folder watcher')
    api.folderWatcher.start()
  }

  stop () {
    console.log('-- IPC: stop folder watcher')
    api.folderWatcher.stop()
  }
}
