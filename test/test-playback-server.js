// Playback server requests: a ready event or server reply for a playback that
// was closed (Back) or replaced must not start a server or mark the new one ready.
const assert = require('node:assert/strict')
const path = require('node:path')
process.env.NODE_ENV = 'test'

const sent = []
const ready = {}
global.window = {
  webtorrent: {
    path,
    config: { STATIC_PATH: __dirname },
    player: { close () {}, update () {} },
    torrent: {
      startServer: (torrentKey, requestId) => sent.push([torrentKey, requestId]),
      stopServer () {},
      onceReady: (infoHash, callback) => { ready[infoHash] = callback }
    },
    window: { setAspectRatio () {} }
  }
}
const PlaybackController = require('../src/renderer/controllers/playback-controller')
const TorrentController = require('../src/renderer/controllers/torrent-controller')
const State = require('../src/renderer/lib/state')

const a = { infoHash: 'a'.repeat(40), torrentKey: 1, status: 'paused' }
const b = { infoHash: 'b'.repeat(40), torrentKey: 2, status: 'seeding' }
const state = { playing: State.getDefaultPlayState(), saved: { prefs: {}, torrents: [a, b] }, window: {} }
const playback = new PlaybackController(state, {}, () => {}, { cancel () {} })
const torrents = new TorrentController(state)
const reply = (torrent, requestId) => ({ localURL: 'http://127.0.0.1:1/webtorrent/' + torrent.infoHash, filePaths: [], requestId })

// Play paused A, Back, play B: A becoming ready afterwards must not revoke B's server.
playback.startServer(a)
playback.closePlayer()
playback.startServer(b)
ready[a.infoHash]()
assert.deepEqual(sent.map(([key]) => key), [b.torrentKey], 'A ready after Back sends nothing')

// Close A and reopen it: the first playback's late reply must not be used.
a.status = 'seeding'
playback.closePlayer()
playback.startServer(a)
const [, first] = sent.at(-1)
playback.closePlayer()
playback.startServer(a)
const [, second] = sent.at(-1)
torrents.torrentServerRunning(reply(a, first))
assert.equal(state.server, null, 'late reply for the closed playback ignored')
assert.equal(state.playing.isReady, false)
torrents.torrentServerRunning(reply(a, second))
assert.equal(state.server.requestId, second)
assert.equal(state.playing.isReady, true)

// External player waiting for A, Back, play B in the app: B's reply must not open B externally.
const MediaController = require('../src/renderer/controllers/media-controller')
const opened = []
window.webtorrent.externalPlayer = { open: (...args) => opened.push(args), quit () {} }
window.webtorrent.torrent.onceServerRunning = callback => { serverRunning = callback }
let serverRunning
const media = new MediaController(state)
playback.closePlayer()
playback.startServer(a)
const [, external] = sent.at(-1)
media.openExternalPlayer()
playback.closePlayer()
playback.startServer(b)
const [, internal] = sent.at(-1)
torrents.torrentServerRunning(reply(a, external))
serverRunning()
torrents.torrentServerRunning(reply(b, internal))
serverRunning()
assert.deepEqual(opened, [], 'abandoned external playback opens nothing')

console.log('Playback server regressions passed: ready after Back, late reply after reopen, external player after Back')
