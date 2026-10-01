// To keep the UI snappy, we run WebTorrent in its own hidden window, a separate
// process from the main window.
console.time('init')

const crypto = require('crypto')
const util = require('util')
const { ipcRenderer } = require('electron')
const fs = require('fs')
const mm = require('music-metadata')
const networkAddress = require('network-address')
const path = require('path')

const config = require('../config')
const { TorrentKeyNotFoundError } = require('./lib/errors')
const torrentPoster = require('./lib/torrent-poster')
const createTorrentMetadata = require('./lib/create-torrent')
const { selectFiles, selectedFilesDone } = require('./lib/file-selection')
const CastEngine = require('./cast-engine')

// webtorrent 3 is ESM-only; this file is CommonJS, so it loads via dynamic
// import before anything else runs. The main process waits for the
// 'ipcReadyWebTorrent' signal (sent at the end of init), so the async
// bootstrap is invisible to the rest of the app.
let WebTorrent = null

/**
 * WebTorrent version.
 */
const VERSION = require('../../package.json').version

/**
 * Version number in Azureus-style. Generated from major and minor semver version.
 * For example:
 *   '0.16.1' -> '0016'
 *   '1.2.5' -> '0102'
 */
const VERSION_STR = VERSION
  .replace(/\d*./g, v => `0${v % 100}`.slice(-2))
  .slice(0, 4)

/**
 * Version prefix string (used in peer ID). WebTorrent uses the Azureus-style
 * encoding: '-', two characters for client id ('WW'), four ascii digits for version
 * number, '-', followed by random numbers.
 * For example:
 *   '-WW0102-'...
 */
const VERSION_PREFIX = '-WD' + VERSION_STR + '-'

/**
 * Generate an ephemeral peer ID each time.
 */
const PEER_ID = Buffer.from(VERSION_PREFIX + crypto.randomBytes(9).toString('base64'))
// Integration fixtures use trackers and web seeds, not local peer discovery.
// Disable shared local sockets so sequential Electron tests cannot collide.
const CLIENT_OPTIONS = config.IS_TEST
  ? {
      peerId: PEER_ID,
      dht: false,
      lsd: false,
      utp: false,
      utPex: false,
      natUpnp: false,
      natPmp: false
    }
  // Local peer discovery is off: WebTorrent starts it even for private
  // torrents (only DHT checks), which multicasts their info hash on the LAN.
  // uTP is off: utp-native 2.5.3 dereferences a null sender address when a UDP
  // read fails (e.g. ENETUNREACH after a route change) and crashes the whole
  // engine (webtorrent-desktop-ucn). Peers connect over TCP and WebRTC.
  : { peerId: PEER_ID, lsd: false, utp: false }

// Connect to the WebTorrent and BitTorrent networks. WebTorrent Desktop is a hybrid
// client, as explained here: https://webtorrent.io/faq
let client = null
let bandwidthOptions = null

// WebTorrent-to-HTTP streaming server. webtorrent 3 allows exactly one
// server per client (createServer throws on the second call, even after the
// first server is destroyed), so we create it lazily and share it for the
// client's lifetime.
let serverReady = null
let playbackGrant = null
// Bumped by every start/stop request, so a torrent that becomes ready after its
// player was closed or replaced doesn't publish a server.
let serverRequest = 0
let castEngine = null

// Used for diffing, so we only send progress updates when necessary
let prevProgress = null

// Torrents with unticked files whose ticked files have all finished
const selectionsDone = new WeakSet()

const bootstrap = import('webtorrent').then(async mod => {
  WebTorrent = mod.default
  bandwidthOptions = await ipcRenderer.invoke('getBandwidthLimits')
  client = window.client = new WebTorrent({ ...CLIENT_OPTIONS, ...bandwidthOptions })
  init()
}).catch(err => {
  console.error('Torrent engine could not start:', err)
  ipcRenderer.send('engineStartupFailed', err.message)
})

function init () {
  listenToClientEvents()

  ipcRenderer.on('wt-set-bandwidth', (e, limits) => {
    bandwidthOptions = limits
    client.throttleDownload(limits.downloadLimit)
    client.throttleUpload(limits.uploadLimit)
  })

  ipcRenderer.on('wt-set-global-trackers', (e, globalTrackers) =>
    setGlobalTrackers(globalTrackers))
  ipcRenderer.on('wt-start-torrenting', (e, torrentKey, torrentID, path, fileModtimes, selections, bitfield) =>
    startTorrenting(torrentKey, torrentID, path, fileModtimes, selections, bitfield))
  ipcRenderer.on('wt-stop-torrenting', (e, torrentKey) =>
    stopTorrenting(torrentKey))
  ipcRenderer.on('wt-create-torrent', (e, torrentKey, options) =>
    createTorrent(torrentKey, options))
  ipcRenderer.on('wt-save-torrent-file', (e, torrentKey) =>
    saveTorrentFile(torrentKey))
  ipcRenderer.on('wt-generate-torrent-poster', (e, torrentKey) =>
    generateTorrentPoster(torrentKey))
  ipcRenderer.on('wt-get-audio-metadata', (e, torrentKey, index) =>
    getAudioMetadata(torrentKey, index))
  ipcRenderer.on('wt-start-server', (e, torrentKey, requestId) =>
    startServer(torrentKey, requestId))
  ipcRenderer.on('wt-stop-server', () =>
    stopServer())
  ipcRenderer.on('wt-select-files', (e, torrentKey, selections) => {
    const torrent = getTorrentByKey(torrentKey)
    if (!torrent) return onError(new Error('selectFiles: missing torrent ' + torrentKey))
    whenReady(torrent, () => {
      selectFiles(torrent, selections)
      // A newly ticked file that finishes before the next progress update is reported done too
      checkSelectedFilesDone(torrent)
    })
  })
  ipcRenderer.on('wt-cast-command', (e, envelope) =>
    getCastEngine().handle(envelope))

  ipcRenderer.send('ipcReadyWebTorrent')

  window.addEventListener('error', (e) =>
    ipcRenderer.send('wt-uncaught-error', { message: e.error.message, stack: e.error.stack }),
  true)

  setInterval(updateTorrentProgress, 1000)
  console.timeEnd('init')
}

function getCastEngine () {
  if (!castEngine) {
    castEngine = new CastEngine({
      getTorrent,
      getServerInfo: (torrent, index) => ensureServer().cast(torrent, index, networkAddress()),
      send: envelope => ipcRenderer.send('wt-cast-event', envelope)
    })
  }
  return castEngine
}

function listenToClientEvents () {
  client.on('warning', (err) => ipcRenderer.send('wt-warning', null, err.message))
  client.on('error', (err) => ipcRenderer.send(client.destroyed ? 'wt-error' : 'wt-warning', null, err.message))
}

// Sets the default trackers
function setGlobalTrackers (globalTrackers) {
  globalThis.WEBTORRENT_ANNOUNCE = globalTrackers
}

// Starts a given TorrentID, which can be an infohash, magnet URI, etc.
// Returns a WebTorrent object. See https://git.io/vik9M
function startTorrenting (torrentKey, torrentID, path, fileModtimes, selections, bitfield) {
  console.log('starting torrent %s: %s', torrentKey, torrentID)

  const torrent = client.add(torrentID, {
    path,
    fileModtimes,
    // Saved piece map: WebTorrent spot-checks it instead of re-hashing all data
    // (it ignores a map of the wrong size)
    bitfield: typeof bitfield === 'string' ? new Uint8Array(Buffer.from(bitfield, 'base64')) : undefined
  })
  torrent.key = torrentKey

  // Listen for ready event, progress notifications, etc
  addTorrentEvents(torrent)

  // Only download the files the user wants, not necessarily all files
  torrent.once('ready', () => selectFiles(torrent, selections))
}

// webtorrent 3 made client.get() async; our callers always pass a plain
// infohash, so a sync lookup over client.torrents is equivalent.
// Torrents are looked up by key: one added from a .torrent file or magnet only
// learns its infoHash after an async parse.
function getTorrentByKey (torrentKey) {
  return client.torrents.find(t => t.key === torrentKey) || null
}

function whenReady (torrent, fn) {
  if (torrent.ready) fn()
  else torrent.once('ready', fn)
}

function stopTorrenting (torrentKey) {
  console.log('--- STOP TORRENTING: ', torrentKey)
  const torrent = getTorrentByKey(torrentKey)
  if (torrent) torrent.destroy()
}

// Create a new torrent, start seeding
async function createTorrent (torrentKey, options) {
  console.log('creating torrent', torrentKey, options)
  try {
    const metadata = await createTorrentMetadata(options)
    // The files have just been hashed in place; seed their existing store.
    const torrent = client.add(metadata, { path: options.path, skipVerify: true })
    torrent.key = torrentKey
    addTorrentEvents(torrent)
    ipcRenderer.send('wt-new-torrent')
  } catch (err) {
    ipcRenderer.send('wt-error', torrentKey, err.message)
  }
}

function addTorrentEvents (torrent) {
  torrent.on('warning', (err) =>
    ipcRenderer.send('wt-warning', torrent.key, err.message))
  torrent.on('error', (err) =>
    ipcRenderer.send('wt-error', torrent.key, err.message))
  torrent.on('infoHash', () => {
    // No info dictionary yet means a magnet link, a bare info hash or a
    // hash-only file: whether the torrent is private isn't known until its
    // metadata arrives.
    torrent.startedWithoutInfo = !torrent.info
    ipcRenderer.send('wt-parsed', torrent.key, torrent.infoHash, torrent.magnetURI)
  })
  torrent.on('metadata', torrentMetadata)
  torrent.on('ready', torrentReady)
  torrent.on('done', torrentDone)

  function torrentMetadata () {
    // Stop a magnet that turns out to be private: WebTorrent can't switch DHT
    // and peer exchange off for a running torrent, and a private torrent should
    // come from its tracker's .torrent file. (WebTorrent supports destroying a
    // torrent from its 'metadata' handler.)
    if (torrent.private && torrent.startedWithoutInfo) {
      torrent.destroy()
      return ipcRenderer.send('wt-private-magnet', torrent.key)
    }
    const info = getTorrentInfo(torrent)
    ipcRenderer.send('wt-metadata', torrent.key, info)

    updateTorrentProgress()
  }

  function torrentReady () {
    const info = getTorrentInfo(torrent)
    ipcRenderer.send('wt-ready', torrent.key, info)
    ipcRenderer.send('wt-ready-' + torrent.infoHash, torrent.key, info)

    updateTorrentProgress()
  }

  function torrentDone () {
    const info = getTorrentInfo(torrent)
    ipcRenderer.send('wt-done', torrent.key, { ...info, complete: true })

    updateTorrentProgress()

    torrent.getFileModtimes((err, fileModtimes) => {
      if (err) return onError(err)
      ipcRenderer.send('wt-file-modtimes', torrent.key, fileModtimes)
    })
  }
}

// Produces a JSON saveable summary of a torrent
function getTorrentInfo (torrent) {
  return {
    infoHash: torrent.infoHash,
    magnetURI: torrent.magnetURI,
    name: torrent.name,
    path: torrent.path,
    files: torrent.files.map(getTorrentFileInfo),
    bytesReceived: torrent.received
  }
}

// Produces a JSON saveable summary of a file in a torrent
function getTorrentFileInfo (file) {
  return {
    name: file.name,
    length: file.length,
    path: file.path
  }
}

// Every time we resolve a magnet URI, save the torrent file so that we can use
// it on next startup. Starting with the full torrent metadata will be faster
// than re-fetching it from peers using ut_metadata.
function saveTorrentFile (torrentKey) {
  const torrent = getTorrent(torrentKey)
  // The info hash names the file, so it must be a real one.
  if (!/^[0-9a-f]{40}$/.test(torrent.infoHash)) return
  const torrentPath = path.join(config.TORRENT_PATH, torrent.infoHash + '.torrent')

  fs.access(torrentPath, fs.constants.R_OK, err => {
    const fileName = torrent.infoHash + '.torrent'
    if (!err) {
      // We've already saved the file
      return ipcRenderer.send('wt-file-saved', torrentKey, fileName)
    }

    // Otherwise, save the .torrent file, under the app config folder
    fs.mkdir(config.TORRENT_PATH, { recursive: true }, _ => {
      fs.writeFile(torrentPath, torrent.torrentFile, err => {
        if (err) return console.log('error saving torrent file %s: %o', torrentPath, err)
        console.log('saved torrent file %s', torrentPath)
        return ipcRenderer.send('wt-file-saved', torrentKey, fileName)
      })
    })
  })
}

// Save a JPG that represents a torrent.
// Auto chooses either a frame from a video file, an image, etc
// Metadata and done can both ask for a poster; one attempt at a time is enough
const postersInProgress = new Set()

function generateTorrentPoster (torrentKey) {
  if (postersInProgress.has(torrentKey)) return
  const torrent = getTorrent(torrentKey)
  postersInProgress.add(torrentKey)
  // Video posters stream a frame over the shared server, so it must be up
  ensureServer().grant(torrent).then(grant => {
    torrentPoster(torrent, grant.baseURL, (err, buf, extension) => {
      grant.release()
      postersInProgress.delete(torrentKey)
      if (err) return console.log('error generating poster: %o', err)
      // save it for next time
      fs.mkdir(config.POSTER_PATH, { recursive: true }, err => {
        if (err) return console.log('error creating poster dir: %o', err)
        const posterFileName = torrent.infoHash + extension
        const posterFilePath = path.join(config.POSTER_PATH, posterFileName)
        fs.writeFile(posterFilePath, buf, err => {
          if (err) return console.log('error saving poster: %o', err)
          // show the poster
          ipcRenderer.send('wt-poster', torrentKey, posterFileName)
        })
      })
    }, grant.token)
  }).catch(err => {
    postersInProgress.delete(torrentKey)
    onError(err)
  })
}

function updateTorrentProgress () {
  client.torrents.forEach(checkSelectedFilesDone)
  const progress = getTorrentProgress()
  // TODO: diff torrent-by-torrent, not once for the whole update
  if (prevProgress && util.isDeepStrictEqual(progress, prevProgress)) {
    return /* don't send heavy object if it hasn't changed */
  }
  ipcRenderer.send('wt-progress', progress)
  prevProgress = progress
}

// WebTorrent's 'done' needs every file. A torrent with unticked files is done
// for the user once its ticked files are: reported as not complete, so the UI
// keeps its resume map and saves no file modtimes.
function checkSelectedFilesDone (torrent) {
  if (!torrent.ready || !selectedFilesDone(torrent)) return selectionsDone.delete(torrent)
  if (selectionsDone.has(torrent)) return
  selectionsDone.add(torrent)
  ipcRenderer.send('wt-done', torrent.key, { ...getTorrentInfo(torrent), complete: false })
}

function getTorrentProgress () {
  // First, track overall progress
  const progress = client.progress
  const hasActiveTorrents = client.torrents.some(torrent =>
    torrent.progress !== 1 && !selectionsDone.has(torrent))

  // Track progress for every file in each torrent
  // TODO: ideally this would be tracked by WebTorrent, which could do it
  // more efficiently than looping over torrent.bitfield
  const torrentProg = client.torrents.map(torrent => {
    const fileProg = torrent.files && torrent.files.map(file => {
      const numPieces = file._endPiece - file._startPiece + 1
      let numPiecesPresent = 0
      for (let piece = file._startPiece; piece <= file._endPiece; piece++) {
        if (torrent.bitfield.get(piece)) numPiecesPresent++
      }
      return {
        startPiece: file._startPiece,
        endPiece: file._endPiece,
        numPieces,
        numPiecesPresent
      }
    })
    return {
      torrentKey: torrent.key,
      ready: torrent.ready,
      done: torrent.done,
      selectedDone: selectionsDone.has(torrent),
      progress: torrent.progress,
      downloaded: torrent.downloaded,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      numPeers: torrent.numPeers,
      length: torrent.length,
      bitfield: torrent.bitfield,
      files: fileProg
    }
  })

  return {
    torrents: torrentProg,
    progress,
    hasActiveTorrents
  }
}

function startServer (torrentKey, requestId) {
  const request = ++serverRequest
  const torrent = getTorrentByKey(torrentKey)
  if (!torrent) return onError(new Error('Unknown torrent'))
  whenReady(torrent, () => startServerFromReadyTorrent(torrent, request, requestId))
}

function ensureServer () {
  if (!serverReady) {
    serverReady = new (require('./lib/stream-server'))(client)
  }
  return serverReady
}

// requestId is the UI's playback id, echoed so it can drop replies for an earlier playback
async function startServerFromReadyTorrent (torrent, request, requestId) {
  if (request !== serverRequest) return
  releaseGrant()
  try {
    const grant = await ensureServer().grant(torrent)
    if (request !== serverRequest) return grant.release()
    playbackGrant = grant
    const { release, baseURL, token, ...info } = grant
    ipcRenderer.send('wt-server-running', { ...info, requestId })
  } catch (err) {
    onError(err)
  }
}

function releaseGrant () {
  if (playbackGrant) playbackGrant.release()
  playbackGrant = null
}

function stopServer () {
  serverRequest++
  releaseGrant()
}

console.log('Initializing...')

function getAudioMetadata (torrentKey, index) {
  const torrent = getTorrentByKey(torrentKey)
  if (!torrent) return onError(new Error('Unknown torrent'))
  whenReady(torrent, () => sendAudioMetadata(torrent, index))
}

function sendAudioMetadata (torrent, index) {
  const infoHash = torrent.infoHash
  const file = torrent.files[index]

  // Set initial matadata to display the filename first.
  const metadata = { title: file.name }
  ipcRenderer.send('wt-audio-metadata', infoHash, index, metadata)

  const options = {
    native: false,
    skipCovers: true,
    fileSize: file.length,
    observer: () => {
      ipcRenderer.send('wt-audio-metadata', infoHash, index, {
        common: metadata.common,
        format: metadata.format
      })
    }
  }
  const onMetadata = file.done
    // If completed; use direct file access
    ? mm.parseFile(path.join(torrent.path, file.path), options)
    // otherwise stream. webtorrent 3 exposes files as web streams, which
    // music-metadata handles via parseWebStream (its Node-stream reader
    // chokes on webtorrent's streamx read(n) behavior).
    : mm.parseWebStream(file.stream(), { path: file.name, size: file.length }, options)

  onMetadata
    .then(
      metadata => {
        ipcRenderer.send('wt-audio-metadata', infoHash, index, metadata)
        console.log(`metadata for file='${file.name}' completed.`)
      },
      err => {
        console.log(
          `error getting audio metadata for ${infoHash}:${index}`,
          err
        )
      }
    )
}

// Gets a WebTorrent handle by torrentKey
// Throws an Error if we're not currently torrenting anything w/ that key
function getTorrent (torrentKey) {
  const ret = client.torrents.find((x) => x.key === torrentKey)
  if (!ret) throw new TorrentKeyNotFoundError(torrentKey)
  return ret
}

function onError (err) {
  console.log(err)
}

// TODO: remove this once the following bugs are fixed:
// https://bugs.chromium.org/p/chromium/issues/detail?id=490143
// https://github.com/electron/electron/issues/7212
window.testOfflineMode = async () => {
  console.log('Test, going OFFLINE')
  // The test harness calls this directly, so it can arrive before the async
  // webtorrent import has finished; executeJavaScript awaits the promise.
  await bootstrap
  // Destroy the online client (and its server) so the replacement client
  // doesn't leak sockets or fight over the shared-server slot.
  await new Promise(resolve => client.destroy(resolve))
  serverReady = null
  client = window.client = new WebTorrent({
    ...CLIENT_OPTIONS,
    ...bandwidthOptions,
    tracker: false,
    webSeeds: false
  })
  listenToClientEvents()
}
