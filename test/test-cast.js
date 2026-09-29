// Casting regressions, using cast.js's built-in test devices (NODE_ENV=test):
// closing the player while a device connects ends that session, and
// next/previous track plays the new file on the device.
const assert = require('node:assert/strict')
const path = require('node:path')
process.env.NODE_ENV = 'test'

let engine
global.window = {
  webtorrent: {
    path,
    config: { STATIC_PATH: __dirname },
    cast: { command: envelope => engine.handle(envelope) },
    player: { close () {}, update () {} },
    torrent: { stopServer () {} },
    window: { setAspectRatio () {} }
  }
}
const CastController = require('../src/renderer/controllers/cast-controller')
const PlaybackController = require('../src/renderer/controllers/playback-controller')
const CastEngine = require('../src/renderer/cast-engine')
const State = require('../src/renderer/lib/state')

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

async function main () {
  const summary = { infoHash: 'movie', torrentKey: 1, files: [{ name: 'a.mp4' }, { name: 'b.mp4' }, { name: 'c.mp4' }] }
  const state = {
    playing: State.getDefaultPlayState(),
    saved: { prefs: {}, torrents: [summary] },
    devices: {},
    window: {},
    getPlayingTorrentSummary: () => summary
  }
  const cast = new CastController(state, () => {})
  const playback = new PlaybackController(state, {}, () => {}, cast)
  const released = []
  engine = new CastEngine({
    getTorrent: () => ({ infoHash: 'movie', name: 'Movie', files: summary.files }),
    getServerInfo: async (torrent, fileIndex) =>
      ({ filePaths: summary.files.map(file => file.name), release: () => released.push(fileIndex) }),
    send: envelope => cast.onEvent(envelope)
  })
  cast.scan(true)
  await settle()

  // Closing the player before the device has even reported in ends the session.
  Object.assign(state.playing, { infoHash: 'movie', fileIndex: 0 })
  cast.toggleMenu('chromecast')
  cast.selectDevice(0)
  playback.closePlayer()
  await settle()
  assert.equal(engine.activeSession, null, 'engine session ended')
  assert.deepEqual(released, [0], 'stream released')
  assert.equal(state.playing.location, 'local', 'UI stays off the cast screen')

  // Next track while casting plays the next file on the device.
  Object.assign(state.playing, { infoHash: 'movie', fileIndex: 0 })
  cast.toggleMenu('chromecast')
  cast.selectDevice(0)
  await settle()
  assert.equal(state.playing.location, 'chromecast')
  playback.updatePlayer = (infoHash, index, resume, cb) => {
    state.playing.fileIndex = index
    cb()
  }
  playback.nextTrack()
  await settle()
  assert.equal(engine.state.playing.fileIndex, 1, 'device plays the next file')
  assert.deepEqual(released, [0, 0], 'previous file stream released')
  assert.equal(state.playing.location, 'chromecast')

  // Repeated track changes must reach the device in order, including while
  // the previous load is still connecting. Keep only the latest queued file.
  const player = engine.state.devices.chromecast
  const open = player.open
  const deviceLoads = []
  player.open = () => { deviceLoads.push(engine.state.playing.fileIndex); open() }
  const sessionId = engine.activeSession.sessionId
  await engine.control({ sessionId, command: 'load', value: 0 })
  assert.equal(state.playing.location, 'chromecast-pending')
  const releaseCount = released.length
  await engine.control({ sessionId, command: 'load', value: 1 })
  await engine.control({ sessionId, command: 'load', value: 2 })
  assert.equal(engine.state.playing.fileIndex, 0, 'current load remains alive until the device connects')
  assert.equal(released.length, releaseCount, 'queued changes do not revoke the active load')
  await settle()
  assert.deepEqual(deviceLoads, [0, 2], 'device receives the latest queued file')
  assert.equal(engine.state.playing.fileIndex, 2)

  // A second command can also arrive while the stream itself is being prepared.
  const getServerInfo = engine.getServerInfo
  let finishPreparing
  engine.getServerInfo = (torrent, index) => new Promise(resolve => {
    finishPreparing = () => resolve(getServerInfo(torrent, index))
  })
  const preparing = engine.control({ sessionId, command: 'load', value: 0 })
  await engine.control({ sessionId, command: 'load', value: 1 })
  assert.deepEqual(deviceLoads, [0, 2], 'preparing and queued tracks have not reached the device')

  // The player's stop button ends casting and returns to local playback.
  cast.stop()
  await settle()
  finishPreparing()
  await preparing
  assert.deepEqual(deviceLoads, [0, 2], 'stopping cancels both preparing and queued tracks')
  assert.equal(released.at(-1), 0, 'prepared stream released after stop')
  assert.equal(state.playing.location, 'local')
  assert.equal(engine.activeSession, null)

  console.log('Cast regressions passed: close while connecting, next track, queued track changes, stop')
}
main().catch(err => {
  if (engine?.activeSession) engine.stop({ sessionId: engine.activeSession.sessionId })
  console.error(err)
  process.exitCode = 1
})
