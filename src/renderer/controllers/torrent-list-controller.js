const api = require('../lib/api')

const { dispatch } = require('../lib/dispatcher')
const { TorrentKeyNotFoundError } = require('../lib/errors')
const sound = require('../lib/sound')
const TorrentSummary = require('../lib/torrent-summary')

const instantIoRegex = /^(https:\/\/)?instant\.io\/#/

// Controls the torrent list: creating, adding, deleting, & manipulating torrents
module.exports = class TorrentListController {
  constructor (state) {
    this.state = state
  }

  // Adds a torrent to the list, starts downloading/seeding.
  // TorrentID can be a magnet URI, infohash, or torrent file: https://git.io/vik9M
  addTorrent (torrentId) {
    if (typeof torrentId !== 'string') {
      // Use path string instead of W3C File object
      torrentId = api.droppedFiles.getPath(torrentId)
    }

    // Trim extra spaces off pasted magnet links
    if (typeof torrentId === 'string') {
      torrentId = torrentId.trim()
    }

    // Allow a instant.io link to be pasted
    if (typeof torrentId === 'string' && instantIoRegex.test(torrentId)) {
      torrentId = torrentId.slice(torrentId.indexOf('#') + 1)
    }

    const torrentKey = this.state.nextTorrentKey++
    const path = this.state.saved.prefs.downloadPath

    api.torrent.start(torrentKey, torrentId, path)

    dispatch('backToList')
  }

  // Shows the Create Torrent page with options to seed a given file or folder
  showCreateTorrent (files) {
    // You can only create torrents from the home screen.
    if (this.state.location.url() !== 'home') {
      return dispatch('error', 'Please go back to the torrent list before creating a new torrent.')
    }

    // Files will either be an array of file objects, which we can send directly
    // to the create-torrent screen
    if (files.length === 0 || typeof files[0] !== 'string') {
      this.state.location.go({
        url: 'create-torrent',
        files,
        setup: (cb) => {
          this.state.window.title = 'Create New Torrent'
          cb(null)
        }
      })
      return
    }

    // ... or it will be an array of mixed file and folder paths. Inspect them
    // in the main process, then pass only serializable metadata to this page.
    api.torrent.inspectCreateInput(files)
      .then(allFiles => this.showCreateTorrent(allFiles))
      .catch(err => dispatch('error', err))
  }

  // Creates a new torrent and start seeeding
  createTorrent (options) {
    const state = this.state
    const torrentKey = state.nextTorrentKey++
    api.torrent.create(torrentKey, options)
    state.location.cancel()
  }

  // Starts downloading and/or seeding a given torrentSummary.
  startTorrentingSummary (torrentKey) {
    const s = TorrentSummary.getByKey(this.state, torrentKey)
    if (!s) throw new TorrentKeyNotFoundError(torrentKey)

    // New torrent: give it a path
    if (!s.path) {
      // Use Downloads folder by default
      s.path = this.state.saved.prefs.downloadPath
      return start()
    }

    const fileOrFolder = TorrentSummary.getFileOrFolder(s)

    // New torrent: metadata not yet received
    if (!fileOrFolder) return start()

    // Existing torrent: check that the path is still there
    api.torrent.checkPath(fileOrFolder)
      .then(exists => {
        if (exists) return start()
        s.error = 'path-missing'
        dispatch('backToList')
      })

    function start () {
      api.torrent.start(
        s.torrentKey,
        TorrentSummary.getTorrentId(s),
        s.path,
        s.fileModtimes,
        s.selections)
    }
  }

  setGlobalTrackers (globalTrackers) {
    api.torrent.setGlobalTrackers(globalTrackers)
  }

  // TODO: use torrentKey, not infoHash
  toggleTorrent (infoHash) {
    const torrentSummary = TorrentSummary.getByKey(this.state, infoHash)
    if (torrentSummary.status === 'paused') {
      torrentSummary.status = 'new'
      this.startTorrentingSummary(torrentSummary.torrentKey)
      sound.play('ENABLE')
      return
    }

    this.pauseTorrent(torrentSummary, true)
  }

  pauseAllTorrents () {
    this.state.saved.torrents.forEach((torrentSummary) => {
      if (torrentSummary.status === 'downloading' ||
          torrentSummary.status === 'seeding') {
        torrentSummary.status = 'paused'
        api.torrent.stop(torrentSummary.infoHash)
      }
    })
    sound.play('DISABLE')
  }

  resumeAllTorrents () {
    this.state.saved.torrents.forEach((torrentSummary) => {
      if (torrentSummary.status === 'paused') {
        torrentSummary.status = 'downloading'
        this.startTorrentingSummary(torrentSummary.torrentKey)
      }
    })
    sound.play('ENABLE')
  }

  pauseTorrent (torrentSummary, playSound) {
    torrentSummary.status = 'paused'
    api.torrent.stop(torrentSummary.infoHash)

    if (playSound) sound.play('DISABLE')
  }

  prioritizeTorrent (infoHash) {
    this.state.saved.torrents
      .filter(torrent => ['downloading', 'seeding'].includes(torrent.status)) // Active torrents only.
      .forEach((torrent) => { // Pause all active torrents except the one that started playing.
        if (infoHash === torrent.infoHash) return

        // Pause torrent without playing sounds.
        this.pauseTorrent(torrent, false)

        this.state.saved.torrentsToResume.push(torrent.infoHash)
      })

    console.log('Playback Priority: paused torrents: ', this.state.saved.torrentsToResume)
  }

  resumePausedTorrents () {
    console.log('Playback Priority: resuming paused torrents')
    if (!this.state.saved.torrentsToResume || !this.state.saved.torrentsToResume.length) return
    this.state.saved.torrentsToResume.forEach((infoHash) => {
      this.toggleTorrent(infoHash)
    })

    // reset paused torrents
    this.state.saved.torrentsToResume = []
  }

  toggleTorrentFile (infoHash, index) {
    const torrentSummary = TorrentSummary.getByKey(this.state, infoHash)
    torrentSummary.selections[index] = !torrentSummary.selections[index]

    // Let the WebTorrent process know to start or stop fetching that file
    if (torrentSummary.status !== 'paused') {
      api.torrent.selectFiles(infoHash, torrentSummary.selections)
    }
  }

  confirmDeleteTorrent (infoHash, deleteData) {
    this.state.modal = {
      id: 'remove-torrent-modal',
      infoHash,
      deleteData
    }
  }

  confirmDeleteAllTorrents (deleteData) {
    this.state.modal = {
      id: 'delete-all-torrents-modal',
      deleteData
    }
  }

  // TODO: use torrentKey, not infoHash
  deleteTorrent (infoHash, deleteData) {
    const index = this.state.saved.torrents.findIndex((x) => x.infoHash === infoHash)

    if (index > -1) {
      const summary = this.state.saved.torrents[index]
      deleteTorrentFile(summary, deleteData)

      // remove torrent from saved list
      this.state.saved.torrents.splice(index, 1)
      dispatch('stateSave')

      // prevent user from going forward to a deleted torrent
      this.state.location.clearForward('player')
      sound.play('DELETE')
    } else {
      throw new TorrentKeyNotFoundError(infoHash)
    }
  }

  deleteAllTorrents (deleteData) {
    // Go back to list before the current playing torrent is deleted
    if (this.state.location.url() === 'player') {
      dispatch('backToList')
    }

    this.state.saved.torrents.forEach((summary) => deleteTorrentFile(summary, deleteData))

    this.state.saved.torrents = []
    dispatch('stateSave')

    // prevent user from going forward to a deleted torrent
    this.state.location.clearForward('player')
    sound.play('DELETE')
  }

  toggleSelectTorrent (infoHash) {
    if (this.state.selectedInfoHash === infoHash) {
      this.state.selectedInfoHash = null
    } else {
      this.state.selectedInfoHash = infoHash
    }
  }

  openTorrentContextMenu (infoHash) {
    const torrentSummary = TorrentSummary.getByKey(this.state, infoHash)
    // Native menus can only be built in the main process; clicks come back
    // through the same dispatch() channel the application menu uses.
    api.menu.openTorrentContext({
      infoHash: torrentSummary.infoHash,
      magnetURI: torrentSummary.magnetURI,
      torrentKey: torrentSummary.torrentKey,
      torrentFileName: torrentSummary.torrentFileName,
      fileOrFolder: torrentSummary.files
        ? TorrentSummary.getFileOrFolder(torrentSummary)
        : null,
      sortedByName: this.state.saved.prefs.sortByName
    })
  }

  // Takes a torrentSummary or torrentKey
  // Shows a Save File dialog, then saves the .torrent file wherever the user requests
  saveTorrentFileAs (torrentKey) {
    const torrentSummary = TorrentSummary.getByKey(this.state, torrentKey)
    if (!torrentSummary) throw new TorrentKeyNotFoundError(torrentKey)
    const downloadPath = this.state.saved.prefs.downloadPath
    const newFileName = api.path.parse(torrentSummary.name).name + '.torrent'
    const opts = {
      title: 'Save Torrent File',
      defaultPath: api.path.join(downloadPath, newFileName),
      filters: [
        { name: 'Torrent Files', extensions: ['torrent'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      buttonLabel: 'Save'
    }

    const savePath = api.dialogs.showSave(opts)

    if (!savePath) return // They clicked Cancel
    console.log('Saving torrent ' + torrentKey + ' to ' + savePath)
    const torrentPath = TorrentSummary.getTorrentPath(torrentSummary)
    api.torrent.copyFile(torrentPath, savePath)
      .catch(err => dispatch('error', err))
  }
}

// Delete all files in a torrent
function moveItemToTrash (torrentSummary) {
  const filePath = TorrentSummary.getFileOrFolder(torrentSummary)
  if (filePath) api.torrent.moveDataToTrash(filePath)
}

function deleteTorrentFile (torrentSummary, deleteData) {
  api.torrent.stop(torrentSummary.infoHash)

  // remove torrent and poster files
  api.torrent.deleteMetadata(
    torrentSummary.torrentFileName,
    torrentSummary.posterFileName
  ).catch(err => dispatch('error', err))

  // optionally delete the torrent data
  if (deleteData) moveItemToTrash(torrentSummary)
}
