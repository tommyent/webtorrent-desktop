const api = require('../lib/api')

const TorrentSummary = require('../lib/torrent-summary')
const sound = require('../lib/sound')
const { dispatch } = require('../lib/dispatcher')

// Fast resume trusts the saved piece map, and a crash or force quit keeps only
// what was last saved: save unfinished torrents' maps this often while they download
const MAP_SAVE_INTERVAL = 60 * 1000

// A torrent that is on but still not ready after this long gets its download
// folder checked, to tell a drive that stopped answering from slow peers
const FOLDER_CHECK_AFTER = 10 * 1000

module.exports = class TorrentController {
  constructor (state) {
    this.state = state
    this.mapSavedAt = Date.now()
    this.mapSavedDownloads = ''
    this.waitingSince = new Map() // torrentKey -> when it was first seen not ready
  }

  // Called every few seconds. Fills state.folderStatus (folder -> 'ok',
  // 'missing' or 'stalled') for the folders of torrents that are slow to start.
  async checkFolders (now = Date.now()) {
    const folders = new Set()
    const waiting = new Set()
    for (const s of this.state.saved.torrents) {
      const starting = s.status === 'new' || (s.status === 'downloading' && !(s.progress && s.progress.ready))
      if (!starting || s.error) continue
      waiting.add(s.torrentKey)
      if (!this.waitingSince.has(s.torrentKey)) this.waitingSince.set(s.torrentKey, now)
      if (now - this.waitingSince.get(s.torrentKey) >= FOLDER_CHECK_AFTER) {
        folders.add(s.path || this.state.saved.prefs.downloadPath)
      }
    }
    for (const key of this.waitingSince.keys()) if (!waiting.has(key)) this.waitingSince.delete(key)

    const status = {}
    await Promise.all([...folders].filter(Boolean).map(async folder => {
      status[folder] = await api.downloads.probe(folder).catch(() => undefined)
    }))
    const changed = JSON.stringify(status) !== JSON.stringify(this.state.folderStatus || {})
    this.state.folderStatus = status
    if (changed) dispatch('update')
  }

  torrentParsed (torrentKey, infoHash, magnetURI) {
    let torrentSummary = this.getTorrentSummary(torrentKey)
    console.log('got infohash for %s torrent %s',
      torrentSummary ? 'existing' : 'new', torrentKey)

    if (!torrentSummary || !torrentSummary.infoHash) {
      const torrents = this.state.saved.torrents

      // Check if an existing (non-active) torrent has the same info hash
      if (torrents.some(t => t !== torrentSummary && t.infoHash === infoHash)) {
        if (torrentSummary) torrents.splice(torrents.indexOf(torrentSummary), 1)
        api.torrent.stop(torrentKey)
        return dispatch('error', 'Cannot add duplicate torrent')
      }

      if (!torrentSummary) {
        torrentSummary = {
          torrentKey,
          status: 'new'
        }
        torrents.unshift(torrentSummary)
      }
      sound.play('ADD')
    }

    torrentSummary.infoHash = infoHash
    torrentSummary.magnetURI = magnetURI
    delete torrentSummary.addedTorrentId // parsed: keep the original input out of saved state
    dispatch('update')
  }

  torrentWarning (torrentKey, message) {
    console.log('warning for torrent %s: %s', torrentKey, message)
  }

  torrentError (torrentKey, message) {
    // TODO: WebTorrent needs semantic errors
    if (message.startsWith('Cannot add duplicate torrent')) {
      // Remove infohash from the message
      message = 'Cannot add duplicate torrent'
    }
    dispatch('error', message)

    const torrentSummary = this.getTorrentSummary(torrentKey)
    if (torrentSummary) {
      if (!torrentSummary.infoHash) {
        const torrents = this.state.saved.torrents
        torrents.splice(torrents.indexOf(torrentSummary), 1)
      } else {
        console.log('Pausing torrent %s due to error: %s', torrentSummary.infoHash, message)
        torrentSummary.status = 'paused'
      }
      dispatch('update')
    }
  }

  // The engine stopped a magnet that turned out to be private. Remove its row
  // so the tracker's .torrent file can be added without a duplicate.
  torrentPrivateMagnet (torrentKey) {
    const torrentSummary = this.getTorrentSummary(torrentKey)
    if (torrentSummary) {
      const torrents = this.state.saved.torrents
      torrents.splice(torrents.indexOf(torrentSummary), 1)
      dispatch('stateSave')
    }
    dispatch('error', 'This is a private torrent, so WebTorrent won\'t download it from a magnet link. ' +
      'Open the .torrent file from your tracker instead.')
  }

  torrentMetadata (torrentKey, torrentInfo) {
    // Summarize torrent
    const torrentSummary = this.getTorrentSummary(torrentKey)
    if (!torrentSummary) return // removed before its metadata arrived
    torrentSummary.status = 'downloading'
    torrentSummary.name = torrentSummary.displayName || torrentInfo.name
    torrentSummary.path = torrentInfo.path
    // TODO: make torrentInfo immutable, save separately as torrentSummary.info
    // For now, check whether torrentSummary.files has already been set:
    const hasDetailedFileInfo = torrentSummary.files && torrentSummary.files[0].path
    if (!hasDetailedFileInfo) {
      torrentSummary.files = torrentInfo.files
    }
    if (!torrentSummary.selections) {
      torrentSummary.selections = torrentSummary.files.map((x) => true)
    }
    dispatch('update')

    // Save the .torrent file, if it hasn't been saved already
    if (!torrentSummary.torrentFileName) api.torrent.saveFile(torrentKey)

    // Auto-generate a poster image, if it hasn't been generated already
    if (!torrentSummary.posterFileName) api.torrent.generatePoster(torrentKey)
  }

  torrentDone (torrentKey, torrentInfo) {
    // Update the torrent summary
    const torrentSummary = this.getTorrentSummary(torrentKey)
    torrentSummary.status = 'seeding'
    // Only when every file is complete: a torrent with unticked files is done
    // for the user but keeps its resume map and path check
    if (torrentInfo.complete) torrentSummary.completed = true
    dispatch('stateSave')

    // A poster that couldn't be made mid-download gets another try with all the data
    if (!torrentSummary.posterFileName) api.torrent.generatePoster(torrentKey)

    // Notify the user that a torrent finished, but only if we actually DL'd at least part of it.
    // Don't notify if we merely finished verifying data files that were already on disk.
    if (torrentInfo.bytesReceived > 0) {
      if (!this.state.window.isFocused) {
        this.state.dock.badge += 1
      }
      showDoneNotification(torrentSummary, this.state.playing.isPaused)
      api.dock.downloadFinished(getTorrentPath(torrentSummary))
    }

    dispatch('update')
  }

  torrentProgress (progressInfo) {
    // Overall progress across all active torrents, 0 to 1, or -1 to hide the progress bar
    // Hide progress bar when client has no torrents, or progress is 100%
    const progress = (!progressInfo.hasActiveTorrents || progressInfo.progress === 1)
      ? -1
      : progressInfo.progress

    // Show progress bar under the WebTorrent taskbar icon, on OSX
    this.state.dock.progress = progress

    // Update progress for each individual torrent
    progressInfo.torrents.forEach((p) => {
      const torrentSummary = this.getTorrentSummary(p.torrentKey)
      if (!torrentSummary) {
        console.log('warning: got progress for missing torrent %s', p.torrentKey)
        return
      }
      torrentSummary.progress = p
      if (p.ready && torrentSummary.completed !== p.done) {
        torrentSummary.completed = p.done
        dispatch('stateSave')
      }
      // A newly ticked file still has data to fetch
      if (p.ready && !p.done && !p.selectedDone && torrentSummary.status === 'seeding') {
        torrentSummary.status = 'downloading'
      }
    })

    // Per torrent: a total could stay the same while one torrent leaves and another gains data
    const downloads = progressInfo.torrents
      .filter(p => p.ready && !p.done)
      .map(p => p.torrentKey + ':' + p.downloaded)
      .join()
    if (downloads !== this.mapSavedDownloads && Date.now() - this.mapSavedAt >= MAP_SAVE_INTERVAL) {
      this.mapSavedAt = Date.now()
      this.mapSavedDownloads = downloads
      dispatch('stateSave')
    }

    // TODO: Find an efficient way to re-enable this line, which allows subtitle
    //       files which are completed after a video starts to play to be added
    //       dynamically to the list of subtitles.
    // checkForSubtitles()
  }

  torrentFileModtimes (torrentKey, fileModtimes) {
    const torrentSummary = this.getTorrentSummary(torrentKey)
    if (!torrentSummary) throw new Error('Not saving modtimes for deleted torrent ' + torrentKey)
    torrentSummary.fileModtimes = fileModtimes
    dispatch('stateSave')
  }

  torrentFileSaved (torrentKey, torrentFileName) {
    console.log('torrent file saved %s: %s', torrentKey, torrentFileName)
    const torrentSummary = this.getTorrentSummary(torrentKey)
    if (!torrentSummary) return // removed before its .torrent file was cached
    torrentSummary.torrentFileName = torrentFileName
    dispatch('stateSave')
  }

  torrentPosterSaved (torrentKey, posterFileName) {
    const torrentSummary = this.getTorrentSummary(torrentKey)
    if (!torrentSummary) {
      // Removed while its poster was being made: don't leave the image behind.
      // Posters are named by info hash, so the same torrent added again shares
      // the file: give it the poster instead of deleting it.
      const again = this.state.saved.torrents.find(t => t.infoHash && posterFileName.startsWith(t.infoHash + '.'))
      if (!again) return api.torrent.deleteMetadata(null, posterFileName).catch(console.error)
      if (again.posterFileName) return
      again.posterFileName = posterFileName
      return dispatch('stateSave')
    }
    torrentSummary.posterFileName = posterFileName
    dispatch('stateSave')
  }

  torrentAudioMetadata (infoHash, index, info) {
    const torrentSummary = this.getTorrentSummary(infoHash)
    if (!torrentSummary) return // removed while its tags were being read
    const fileSummary = torrentSummary.files[index]
    fileSummary.audioInfo = info
    dispatch('update')
  }

  torrentServerRunning (serverInfo) {
    // A reply can arrive after its playback was closed or replaced
    if (serverInfo.requestId !== this.state.playing.serverRequestId) return
    this.state.server = serverInfo
    this.state.playing.isReady = true
  }

  // Gets a torrent summary {name, infoHash, status} from state.saved.torrents
  // Returns undefined if we don't know that infoHash
  getTorrentSummary (torrentKey) {
    return TorrentSummary.getByKey(this.state, torrentKey)
  }
}

function getTorrentPath (torrentSummary) {
  let itemPath = TorrentSummary.getFileOrFolder(torrentSummary)
  if (torrentSummary.files.length > 1) {
    itemPath = api.path.dirname(itemPath)
  }
  return itemPath
}

function showDoneNotification (torrent, isPaused) {
  const notif = new window.Notification('Download Complete', {
    body: torrent.name,
    silent: true
  })

  notif.onclick = () => {
    api.app.show()
  }

  // Only play notification sound if player is inactive
  if (isPaused) sound.play('DONE')
}
