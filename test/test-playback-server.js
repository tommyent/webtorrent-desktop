// Playback server requests: a ready event or server reply for a playback that
// was closed (Back) or replaced must not start a server or mark the new one ready.
const assert = require('node:assert/strict')
const path = require('node:path')
process.env.NODE_ENV = 'test'

const sent = []
const stopped = []
const ready = {}
global.window = {
  webtorrent: {
    path,
    config: { STATIC_PATH: __dirname },
    player: { close () {}, update () {} },
    torrent: {
      startServer: (torrentKey, requestId) => sent.push([torrentKey, requestId]),
      stopServer: keepExternal => stopped.push(keepExternal),
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
const quit = []
window.webtorrent.externalPlayer = { open: (...args) => opened.push(args), quit: () => quit.push(true) }
window.webtorrent.torrent.onceServerRunning = callback => { serverRunning = callback }
let serverRunning
const media = new MediaController(state)
playback.closePlayer()
playback.startServer(a)
const [, external] = sent.at(-1)
media.openExternalPlayer()
playback.closePlayer()
assert.equal(stopped.at(-1), false, 'Back before external launch revokes the stream')
playback.startServer(b)
const [, internal] = sent.at(-1)
torrents.torrentServerRunning(reply(a, external))
serverRunning()
torrents.torrentServerRunning(reply(b, internal))
serverRunning()
assert.deepEqual(opened, [], 'abandoned external playback opens nothing')

state.playing.fileIndex = 0
state.server = { ...reply(a, 1), filePaths: ['a.mp4?token=kept'], token: 'kept' }
media.openExternalPlayer()
assert.equal(state.playing.externalPlayerOpened, true)
assert.equal(state.playing.externalPlayerToken, 'kept')
playback.closePlayer()
assert.equal(stopped.at(-1), true, 'Back after external launch keeps its stream')
assert.deepEqual(quit, [], 'Back leaves the external player running')

// Windows taskbar toolbar buttons map (hasNext, hasPrevious) in the same order as menu.
const thumbarButtons = []
const windowsFile = require.resolve('../src/main/windows')
require.cache[windowsFile] = {
  id: windowsFile,
  filename: windowsFile,
  loaded: true,
  exports: { main: { win: { setThumbarButtons: buttons => thumbarButtons.push(buttons.map(b => b.flags)) } } }
}
const thumbar = require('../src/main/thumbar')
thumbar.enable()
thumbar.onPlayerUpdate(true, false)
assert.deepEqual(thumbarButtons.at(-1), [['disabled'], undefined, ['enabled']])
thumbar.onPlayerUpdate(false, true)
assert.deepEqual(thumbarButtons.at(-1), [['enabled'], undefined, ['disabled']])

// Hover-preview <video> only mounts for hovered local video (never audio or casting).
const Player = require('../build/renderer/pages/player-page')
const { renderToStaticMarkup } = require('react-dom/server')
const previewState = (type, location, previewXCoord) => {
  const playing = Object.assign(State.getDefaultPlayState(), {
    type, location, previewXCoord, infoHash: a.infoHash, fileIndex: 0, fileName: 'a.mp4'
  })
  const summary = { infoHash: a.infoHash, name: 'A', files: [{ name: 'a.mp4', length: 100 }] }
  return {
    playing,
    saved: { torrents: [summary] },
    window: { isFullScreen: false },
    devices: { items: [] },
    server: { localURL: 'http://127.0.0.1:1/webtorrent/' + a.infoHash, filePaths: ['a.mp4?token=t'] },
    getPlayingTorrentSummary: () => summary,
    getPlayingFileSummary: () => summary.files[0]
  }
}
global.window.Image = function () {}
global.document = { querySelector: selector => selector === 'body' ? { clientWidth: 800 } : null }
try {
  for (const [type, location] of [['audio', 'local'], ['video', 'chromecast'], ['video', 'local']]) {
    const markup = renderToStaticMarkup(new Player({ state: previewState(type, location, null) }).render())
    assert.equal(markup.includes('id="preview"'), false, `no preview video for ${type}/${location}`)
  }
  const hovered = renderToStaticMarkup(new Player({ state: previewState('video', 'local', 120) }).render())
  assert.ok(hovered.includes('id="preview"'), 'hovered local video mounts preview')
  assert.ok(hovered.includes('http://127.0.0.1:1/webtorrent/' + a.infoHash + '/a.mp4?token=t'))
} finally {
  delete global.document
  delete global.window.Image
}

console.log('Playback server regressions passed: ready after Back, late reply, external stream after Back, thumbar flags, hover preview')
