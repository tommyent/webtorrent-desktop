const appConfig = require('application-config')('WebTorrent')
const path = require('path')

const config = require('../config')

appConfig.filePath = path.join(config.CONFIG_PATH, 'config.json')

module.exports = {
  load,
  save,
  defaultExternalPlayer
}

async function load () {
  let saved
  try {
    saved = await appConfig.read()
    if (saved.version && (!saved.prefs || !Array.isArray(saved.torrents))) {
      throw new SyntaxError('Invalid saved-state structure')
    }
  } catch (err) {
    if (!(err instanceof SyntaxError) && err.name !== 'JSONError') throw err
    const fs = require('fs/promises')
    const backup = appConfig.filePath + '.invalid-' + Date.now()
    await fs.copyFile(appConfig.filePath, backup, require('fs').constants.COPYFILE_EXCL)
    const { app, dialog } = require('electron')
    app.whenReady().then(() => dialog.showErrorBox('Preferences could not be read',
      'The damaged preferences were preserved at ' + backup + '. Your downloaded files have not been changed.'))
    saved = {}
  }

  if (!saved || !saved.version) {
    console.log('Missing config file: Creating new one')
    saved = setupSavedState()
  }

  const state = { saved }
  require('./migrations').run(state)
  if (!saved.prefs.globalTrackers) saved.prefs.globalTrackers = []
  for (const key of ['downloadLimitKiB', 'uploadLimitKiB']) {
    saved.prefs[key] ??= 0
    try { require('../renderer/lib/bandwidth').toBytes(saved.prefs[key]) } catch { saved.prefs[key] = 0 }
  }
  // Tests keep the same prefs on every machine, whatever players it has
  if (!config.IS_TEST) defaultExternalPlayer(saved.prefs)
  return saved
}

// With no player chosen, files the built-in player can't handle (e.g. Dolby
// audio) go to VLC. If VLC isn't installed but IINA is, use IINA instead.
// Set here, at load, so it counts as the trusted starting value.
function defaultExternalPlayer (prefs, exists = require('fs').existsSync, platform = process.platform) {
  if (platform !== 'darwin' || prefs.externalPlayerPath) return
  if (!exists('/Applications/VLC.app') && exists('/Applications/IINA.app')) {
    prefs.externalPlayerPath = '/Applications/IINA.app'
  }
}

async function save (saved) {
  console.log('Saving state to ' + appConfig.filePath)

  const copy = Object.assign({}, saved)
  copy.torrents = copy.torrents
    .filter(torrent => torrent.infoHash)
    .map(item => {
      const torrent = {}
      for (const key in item) {
        if (key === 'progress' || key === 'torrentKey' || key === 'error') continue
        torrent[key] = item[key]
      }
      return torrent
    })

  await appConfig.write(copy)
}

function setupSavedState () {
  const { copyFileSync, mkdirSync, readFileSync } = require('fs')
  const parseTorrent = require('parse-torrent')

  const saved = {
    prefs: {
      downloadPath: config.DEFAULT_DOWNLOAD_PATH,
      isFileHandler: false,
      openExternalPlayer: false,
      externalPlayerPath: '',
      startup: false,
      soundNotifications: true,
      autoAddTorrents: false,
      torrentsFolderPath: '',
      highestPlaybackPriority: true,
      downloadLimitKiB: 0,
      uploadLimitKiB: 0,
      globalTrackers: []
    },
    torrents: config.DEFAULT_TORRENTS.map(createTorrentObject),
    torrentsToResume: [],
    version: config.APP_VERSION
  }

  mkdirSync(config.POSTER_PATH, { recursive: true })
  mkdirSync(config.TORRENT_PATH, { recursive: true })

  config.DEFAULT_TORRENTS.forEach((torrent, index) => {
    const infoHash = saved.torrents[index].infoHash
    copyFileSync(
      path.join(config.STATIC_PATH, torrent.posterFileName),
      path.join(config.POSTER_PATH, infoHash + path.extname(torrent.posterFileName))
    )
    copyFileSync(
      path.join(config.STATIC_PATH, torrent.torrentFileName),
      path.join(config.TORRENT_PATH, infoHash + '.torrent')
    )
  })

  return saved

  function createTorrentObject (torrent) {
    const buffer = readFileSync(path.join(config.STATIC_PATH, torrent.torrentFileName))
    const parsedTorrent = parseTorrent(buffer)

    return {
      status: 'paused',
      infoHash: parsedTorrent.infoHash,
      name: torrent.name,
      displayName: torrent.name,
      posterFileName: parsedTorrent.infoHash + path.extname(torrent.posterFileName),
      torrentFileName: parsedTorrent.infoHash + '.torrent',
      magnetURI: parseTorrent.toMagnetURI(parsedTorrent),
      files: parsedTorrent.files,
      selections: parsedTorrent.files.map(() => true),
      testID: torrent.testID
    }
  }
}
