const api = require('../lib/api')

const { dispatch } = require('../lib/dispatcher')
const { TorrentKeyNotFoundError } = require('../lib/errors')
const sound = require('../lib/sound')
const TorrentSummary = require('../lib/torrent-summary')
const { isMagnetLink } = require('../lib/torrent-player')

const instantIoRegex = /^(https:\/\/)?instant\.io\/#/

// The latest start request per torrent; switching it off (or on again) while its
// folder is being checked makes the older request stale.
const pendingStarts = new WeakMap()
// A torrent counts as on from the moment it's switched on
const ACTIVE = ['new', 'downloading', 'seeding']

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
    let name
    if (isMagnetLink(torrentId)) {
      try { name = new URL(torrentId).searchParams.get('dn') || undefined } catch {}
    }

    // Acknowledge the add immediately, even while the hidden engine starts.
    // Unparsed rows are already excluded from saved state.
    // addedTorrentId lets the switch restart it before the engine has parsed it.
    this.state.saved.torrents.unshift({ torrentKey, status: 'new', name, addedTorrentId: torrentId })

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

    // Existing torrent: check that its data is still there. Files appear only
    // once data arrives, so an unfinished torrent just needs its download folder
    // (an unplugged drive shows up there too).
    const request = {}
    pendingStarts.set(s, request)
    api.torrent.checkPath(s.completed ?? !!s.fileModtimes ? fileOrFolder : s.path)
      .then(exists => {
        if (pendingStarts.get(s) !== request) return // paused, removed, or restarted since
        if (exists) return start()
        s.error = 'path-missing'
        s.status = 'paused'
        // Leave the player only if it is showing this torrent (resumes run in the background)
        if (this.state.playing.infoHash === s.infoHash) dispatch('backToList')
      })

    function start () {
      api.torrent.start(
        s.torrentKey,
        TorrentSummary.getTorrentId(s),
        s.path,
        s.fileModtimes,
        s.selections,
        TorrentSummary.getResumeBitfield(s))
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
      if (ACTIVE.includes(torrentSummary.status)) this.pauseTorrent(torrentSummary, false)
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
    pendingStarts.delete(torrentSummary)
    torrentSummary.status = 'paused'
    api.torrent.stop(torrentSummary.torrentKey)

    if (playSound) sound.play('DISABLE')
  }

  prioritizeTorrent (infoHash) {
    this.state.saved.torrents
      // Active torrents only; resuming needs the infoHash (saved across restarts).
      .filter(torrent => ACTIVE.includes(torrent.status) && torrent.infoHash)
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
      // Skip one the user removed or switched back on meanwhile
      const torrentSummary = TorrentSummary.getByKey(this.state, infoHash)
      if (torrentSummary && torrentSummary.status === 'paused') this.toggleTorrent(infoHash)
    })

    // reset paused torrents
    this.state.saved.torrentsToResume = []
  }

  toggleTorrentFile (infoHash, index) {
    const torrentSummary = TorrentSummary.getByKey(this.state, infoHash)
    torrentSummary.selections[index] = !torrentSummary.selections[index]

    // Let the WebTorrent process know to start or stop fetching that file
    if (torrentSummary.status !== 'paused') {
      api.torrent.selectFiles(torrentSummary.torrentKey, torrentSummary.selections)
    }
  }

  confirmDeleteTorrent (infoHash, deleteData) {
    this.state.modal = {
      id: 'remove-torrent-modal',
      infoHash,
      deleteData
    }
  }

  // The header's Remove button: the rows checked in the removal column
  toggleRemovalSelection (torrentKey) {
    const selection = this.state.removalSelection
    this.state.removalSelection = selection.includes(torrentKey)
      ? selection.filter(key => key !== torrentKey)
      : [...selection, torrentKey]
  }

  confirmRemoveSelected () {
    this.state.modal = {
      id: 'remove-torrent-modal',
      torrentKeys: TorrentSummary.getRemovalSelection(this.state),
      deleteData: false
    }
  }

  async deleteTorrents (torrentKeys, deleteData) {
    for (const torrentKey of torrentKeys) {
      // Skip rows another removal already took out
      if (TorrentSummary.getByKey(this.state, torrentKey)) await this.deleteTorrent(torrentKey, deleteData)
    }
  }

  confirmDeleteAllTorrents (deleteData) {
    this.state.modal = {
      id: 'delete-all-torrents-modal',
      deleteData
    }
  }

  // Takes a torrentKey or infoHash
  async deleteTorrent (infoHash, deleteData) {
    const summary = TorrentSummary.getByKey(this.state, infoHash)

    if (summary) {
      try { await deleteTorrentFile(summary, deleteData) } catch (err) {
        dispatch('error', err)
        return
      }

      // remove torrent from saved list. Look it up again: another removal may
      // have changed the list while this one waited for the Trash.
      const current = this.state.saved.torrents.indexOf(summary)
      if (current > -1) this.state.saved.torrents.splice(current, 1)
      this.state.removalSelection = this.state.removalSelection.filter(key => key !== summary.torrentKey)
      dispatch('stateSave')

      // prevent user from going forward to a deleted torrent
      this.state.location.clearForward('player')
      sound.play('DELETE')
    } else {
      throw new TorrentKeyNotFoundError(infoHash)
    }
  }

  async deleteAllTorrents (deleteData) {
    // Go back to list before the current playing torrent is deleted
    if (this.state.location.url() === 'player') {
      dispatch('backToList')
    }

    for (const summary of [...this.state.saved.torrents]) {
      await this.deleteTorrent(summary.torrentKey, deleteData)
    }
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
    const savePath = api.dialogs.showSave(api.path.join(downloadPath, newFileName))

    if (!savePath) return // They clicked Cancel
    console.log('Saving torrent ' + torrentKey + ' to ' + savePath)
    const torrentPath = TorrentSummary.getTorrentPath(torrentSummary)
    api.torrent.copyFile(torrentPath, savePath)
      .catch(err => dispatch('error', err))
  }
}

// Delete all files in a torrent
function moveItemToTrash (torrentSummary) {
  if (TorrentSummary.getFileOrFolder(torrentSummary)) return api.torrent.trashData(torrentSummary.infoHash)
}

async function deleteTorrentFile (torrentSummary, deleteData) {
  pendingStarts.delete(torrentSummary)
  api.torrent.stop(torrentSummary.torrentKey)

  if (deleteData) await moveItemToTrash(torrentSummary)

  // remove torrent and poster files
  await api.torrent.deleteMetadata(
    torrentSummary.torrentFileName,
    torrentSummary.posterFileName
  )
}
