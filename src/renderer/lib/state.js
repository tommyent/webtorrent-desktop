const debounce = require('debounce')
const LocationHistory = require('location-history')

const api = require('./api')
const config = require('./config')

const SAVE_DEBOUNCE_INTERVAL = 1000

const State = module.exports = {
  getDefaultPlayState,
  load,
  save (...args) {
    State.save = debounce(save, SAVE_DEBOUNCE_INTERVAL)
    State.save(...args)
  },
  saveImmediate
}

function getDefaultState () {
  return {
    client: null,
    server: null,
    prev: {
      title: null,
      progress: -1,
      badge: null
    },
    location: new LocationHistory(),
    window: {
      bounds: null,
      isFocused: true,
      isFullScreen: false,
      title: config.APP_WINDOW_TITLE
    },
    selectedInfoHash: null,
    playing: getDefaultPlayState(),
    devices: {},
    dock: {
      badge: 0,
      progress: 0
    },
    modal: null,
    errors: [],
    nextTorrentKey: 1,
    saved: {},
    getPlayingTorrentSummary,
    getPlayingFileSummary,
    getExternalPlayerName,
    getGlobalTrackers,
    shouldHidePlayerControls
  }
}

function getDefaultPlayState () {
  return {
    infoHash: null,
    fileIndex: null,
    fileName: null,
    location: 'local',
    type: null,
    currentTime: 0,
    duration: 1,
    isReady: false,
    isPaused: true,
    isStalled: false,
    lastTimeUpdate: 0,
    mouseStationarySince: 0,
    playbackRate: 1,
    volume: 1,
    subtitles: {
      tracks: [],
      selectedIndex: -1,
      showMenu: false
    },
    audioTracks: {
      tracks: [],
      selectedIndex: 0,
      showMenu: false
    },
    aspectRatio: 0
  }
}

function getPlayingTorrentSummary () {
  const infoHash = this.playing.infoHash
  return this.saved.torrents.find(torrent => torrent.infoHash === infoHash)
}

function getPlayingFileSummary () {
  const torrentSummary = this.getPlayingTorrentSummary()
  if (!torrentSummary) return null
  return torrentSummary.files[this.playing.fileIndex]
}

function getExternalPlayerName () {
  const playerPath = this.saved.prefs.externalPlayerPath
  if (!playerPath) return 'VLC'
  return api.path.basename(playerPath).split('.')[0]
}

function shouldHidePlayerControls () {
  return this.location.url() === 'player' &&
    this.playing.mouseStationarySince !== 0 &&
    new Date().getTime() - this.playing.mouseStationarySince > 2000 &&
    !this.playing.mouseInControls &&
    !this.playing.isPaused &&
    this.playing.location === 'local'
}

function getGlobalTrackers () {
  return this.saved.prefs.globalTrackers || []
}

function load (cb) {
  api.state.load()
    .then(saved => {
      const state = getDefaultState()
      state.saved = saved
      cb(null, state)
    }, cb)
}

function save (state) {
  persist(state, api.state.save)
}

function saveImmediate (state) {
  persist(state, api.state.saveImmediate)
}

function persist (state, write) {
  const copy = Object.assign({}, state.saved)
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

  write(copy).catch(err => console.error(err))
}
