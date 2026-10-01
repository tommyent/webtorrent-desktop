// Casting regressions, using cast.js's built-in test devices (NODE_ENV=test):
// closing the player while a device connects ends that session,
// next/previous track plays the new file on the device, and a device that
// fails or never answers can't leave the player stuck connecting.
const assert = require('node:assert/strict')
const path = require('node:path')
const { mock } = require('node:test')
process.env.NODE_ENV = 'test'

let engine
let held = null // when set, commands wait here, as if IPC delivery were slow
global.window = {
  webtorrent: {
    path,
    config: { STATIC_PATH: __dirname },
    cast: { command: envelope => held ? held.push(envelope) : engine.handle(envelope) },
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
    errors: [],
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
  player.open = open
  engine.getServerInfo = getServerInfo
  const castTo = () => {
    Object.assign(state.playing, { infoHash: 'movie', fileIndex: 0 })
    cast.toggleMenu('chromecast')
    cast.selectDevice(0)
  }

  // A device that never answers times out back to local playback, and a retry works.
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  player.open = () => {}
  castTo()
  for (let i = 0; i < 5; i++) await new Promise(setImmediate)
  assert.equal(state.playing.location, 'chromecast-pending')
  mock.timers.tick(20000)
  mock.timers.reset()
  assert.equal(state.playing.location, 'local', 'connect timeout returns to local playback')
  assert.match(state.errors.at(-1).message, /Could not connect to chromecast-1/)
  assert.equal(engine.activeSession, null)
  player.open = open
  castTo()
  await settle()
  assert.equal(state.playing.location, 'chromecast', 'retry after a timeout connects')

  // Stopping doesn't wait for a device that never confirms it.
  player.stop = () => {}
  cast.stop()
  await settle()
  assert.equal(state.playing.location, 'local', 'stop finishes without the device')
  assert.equal(engine.activeSession, null)

  // A device that answers synchronously must find the attempt already pending.
  player.open = () => {
    if (engine.state.playing.location !== 'chromecast-pending') return
    engine.state.playing.location = 'chromecast'
    engine.onCastUpdate()
  }
  castTo()
  await settle()
  assert.equal(state.playing.location, 'chromecast', 'synchronous connect is not dropped')
  cast.stop()
  await settle()

  // Two starts racing over stream preparation leave one session, not two.
  player.open = open
  const before = released.length
  const errorCount = state.errors.length
  castTo()
  castTo()
  await settle()
  assert.equal(released.length, before + 1, 'the superseded start releases its stream')
  assert.equal(state.errors.length, errorCount)
  assert.equal(state.playing.location, 'chromecast')
  cast.stop()
  await settle()
  assert.equal(engine.activeSession, null)

  // Cast A, Back while A's stream is prepared, cast B: A finishing first must not take over.
  const preparing2 = []
  engine.getServerInfo = (torrent, index) => new Promise(resolve => preparing2.push(() => resolve(getServerInfo(torrent, index))))
  castTo()
  await settle()
  playback.closePlayer()
  Object.assign(state.playing, { infoHash: 'movie', fileIndex: 1 })
  cast.toggleMenu('chromecast')
  cast.selectDevice(0)
  await settle()
  preparing2[0]()
  await settle()
  preparing2[1]()
  await settle()
  assert.equal(engine.state.playing.fileIndex, 1, 'B plays, not the abandoned A')
  assert.equal(released.at(-1), 0, "A's stream released")
  assert.equal(state.playing.location, 'chromecast')
  assert.equal(state.errors.length, errorCount)
  engine.getServerInfo = getServerInfo
  cast.stop()
  await settle()
  assert.equal(engine.activeSession, null)

  // Same, but B's command reaches the engine only after A finished and connected.
  const preparing3 = []
  engine.getServerInfo = (torrent, index) => new Promise(resolve => preparing3.push(() => resolve(getServerInfo(torrent, index))))
  castTo()
  await settle()
  playback.closePlayer()
  held = []
  Object.assign(state.playing, { infoHash: 'movie', fileIndex: 1 })
  cast.toggleMenu('chromecast')
  cast.selectDevice(0)
  preparing3[0]()
  await settle()
  const delivered = held
  held = null
  assert.deepEqual(delivered.map(envelope => envelope.action), ['start', 'stop'], "B's start, then the UI ending A")
  const releasedBefore = released.length
  engine.handle(delivered[0])
  await settle()
  preparing3[1]()
  await settle()
  assert.deepEqual(released.slice(releasedBefore), [0], 'A ended before B took over')
  engine.handle(delivered[1])
  await settle()
  assert.equal(engine.state.playing.fileIndex, 1, 'B plays after a late delivery too')
  assert.equal(state.playing.location, 'chromecast')
  assert.equal(state.errors.length, errorCount, 'no errors')
  engine.getServerInfo = getServerInfo
  cast.stop()
  await settle()
  assert.equal(engine.activeSession, null)

  console.log('Cast regressions passed: close while connecting, next track, queued track changes, stop, connect timeout, unanswered stop, synchronous connect, racing starts, recast after Back, recast with late delivery')
}
main().catch(err => {
  if (engine?.activeSession) engine.stop({ sessionId: engine.activeSession.sessionId })
  console.error(err)
  process.exitCode = 1
})
