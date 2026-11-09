// A download drive that stops answering, torrents paused for playback when the
// app quits, the watch folder, and path helpers that no longer ask the main process.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
process.env.NODE_ENV = 'test'

const calls = []
const probes = []
const removedMetadata = []
let probeResult = 'ok'
global.window = {
  webtorrent: {
    path,
    config: { STATIC_PATH: __dirname, TORRENT_PATH: '/torrents', POSTER_PATH: '/posters' },
    downloads: { probe: async folder => { probes.push(folder); return probeResult } },
    torrent: {
      start: torrentKey => calls.push(['start', torrentKey]),
      stop: torrentKey => calls.push(['stop', torrentKey]),
      checkPath: async () => true,
      deleteMetadata: async (...names) => { removedMetadata.push(names) }
    }
  }
}
const stub = (name, exports) => {
  const file = require.resolve(path.join(__dirname, '..', 'src', 'main', name))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
stub('log', () => {})

const { setDispatch } = require('../src/renderer/lib/dispatcher')
const dispatched = []
setDispatch(action => dispatched.push(action))
const settle = () => new Promise(resolve => setImmediate(resolve))

async function main () {
  // Extensions and joins computed in the UI match Node's path module
  const localPath = require('../src/renderer/lib/local-path')
  for (const name of ['a.mp4', 'A.MKV', '.hidden', 'noext', 'trailing.', 'a..b', '..', '...', '', 'dir.d/file',
    'dir.d/.hidden', '/abs/dir/movie.final.mp4', 'folder.with.dots/', 'a.b/c.d/', '.a.b']) {
    assert.equal(localPath.extname(name), path.extname(name), 'extname of ' + JSON.stringify(name))
  }
  const posters = path.join(path.sep, 'posters')
  assert.equal(localPath.join(posters, 'abc.jpg'), path.join(posters, 'abc.jpg'))
  assert.equal(localPath.join(posters + path.sep, 'abc.jpg'), path.join(posters + path.sep, 'abc.jpg'))
  // Windows rules, whatever machine runs this
  const windowsPath = localPath.create('\\')
  for (const name of ['a.mp4', 'C:\\dir.d\\movie.MKV', 'C:/dir.d/file', 'C:.mp4', 'C:.torrent', 'C:..', 'C:a.mp4',
    'dir\\.hidden', 'a.b\\c', 'trailing.', '\\\\server\\share\\x.srt']) {
    assert.equal(windowsPath.extname(name), path.win32.extname(name), 'Windows extname of ' + JSON.stringify(name))
  }
  assert.equal(windowsPath.join('C:\\posters', 'abc.jpg'), path.win32.join('C:\\posters', 'abc.jpg'))
  assert.equal(windowsPath.join('C:\\posters\\', 'abc.jpg'), path.win32.join('C:\\posters\\', 'abc.jpg'))
  const TorrentPlayer = require('../src/renderer/lib/torrent-player')
  assert.equal(TorrentPlayer.isPlayable({ name: 'Movie.MKV' }), true)
  assert.equal(TorrentPlayer.isPlayable({ name: '.mp4' }), false, 'a dotfile has no extension')

  // Playback priority: torrents it paused come back, except one paused by hand
  const TorrentListController = require('../src/renderer/controllers/torrent-list-controller')
  const row = (key, letter, status) => ({ torrentKey: key, infoHash: letter.repeat(40), name: letter, status })
  const state = {
    saved: {
      prefs: { downloadPath: '/downloads' },
      torrents: [row(1, 'a', 'downloading'), row(2, 'b', 'downloading'), row(3, 'c', 'downloading')],
      torrentsToResume: []
    },
    removalSelection: [],
    playing: { infoHash: null },
    location: { url: () => 'home', clearForward () {} }
  }
  const list = new TorrentListController(state)
  list.prioritizeTorrent('a'.repeat(40)) // playing a: b and c are paused for it
  assert.deepEqual(state.saved.torrentsToResume, ['b'.repeat(40), 'c'.repeat(40)])
  // The user switches c on, then off again by hand
  list.toggleTorrent(3)
  list.toggleTorrent(3)
  assert.deepEqual(state.saved.torrentsToResume, ['b'.repeat(40)], 'a manual pause leaves the list')
  // Quit and relaunch: saved rows have no keys; startup gives every row one,
  // starts what was on, then resumes what is left on the list
  const relaunched = {
    ...state,
    nextTorrentKey: 1,
    saved: JSON.parse(JSON.stringify(state.saved, (key, value) => key === 'torrentKey' ? undefined : value))
  }
  calls.length = 0
  new TorrentListController(relaunched).resumeAtStartup()
  await settle()
  assert.deepEqual(relaunched.saved.torrents.map(t => t.torrentKey), [1, 2, 3])
  assert.deepEqual(calls, [['start', 1], ['start', 2]], 'the playing torrent and the one paused for playback restart')
  assert.equal(relaunched.saved.torrents[2].status, 'paused', 'the one paused by hand stays off')
  assert.deepEqual(relaunched.saved.torrentsToResume, [])
  list.prioritizeTorrent('a'.repeat(40))
  list.pauseAllTorrents()
  assert.deepEqual(state.saved.torrentsToResume, [], 'Pause all clears the list')

  // Removal boxes: Shift-click checks the rows in between, in the order shown
  const shown = {
    saved: {
      prefs: { sortCompletedFirst: true },
      torrents: [row(1, 'a', 'downloading'), { ...row(2, 'b', 'seeding'), completed: true }, row(3, 'c', 'paused'), row(4, 'd', 'paused')]
    },
    removalSelection: []
  }
  const boxes = new TorrentListController(shown) // shown order: 2, 1, 3, 4
  boxes.toggleRemovalSelection(3, true)
  assert.deepEqual(shown.removalSelection, [3], 'a first Shift-click is a plain click')
  boxes.toggleRemovalSelection(2, true)
  assert.deepEqual([...shown.removalSelection].sort(), [1, 2, 3], 'up to the row shown first, not key order')
  boxes.toggleRemovalSelection(1)
  assert.deepEqual([...shown.removalSelection].sort(), [2, 3], 'a plain click still unchecks one row')
  boxes.selectAllForRemoval()
  assert.deepEqual(shown.removalSelection, [1, 2, 3, 4])
  boxes.selectAllForRemoval()
  assert.deepEqual(shown.removalSelection, [], 'Select all on a full selection clears it')
  const Header = require('../build/renderer/components/header')
  const { renderToStaticMarkup: renderHeader } = require('react-dom/server')
  const header = removalSelection => renderHeader(new Header({
    state: { ...shown, removalSelection, window: { title: '' }, location: { url: () => 'home', hasBack: () => false, hasForward: () => false } }
  }).render())
  assert.ok(!header([]).includes('Select all'), 'the header is unchanged until a row is checked')
  assert.ok(header([1]).includes('>Select all</button>'))
  assert.ok(header([1, 2, 3, 4]).includes('>Select none</button>'))

  // A folder check answers 'stalled' when the drive doesn't, and never stacks checks
  const { probeFolder } = require('../src/main/renderer-files')
  let stats = 0
  const hang = () => { stats++; return new Promise(() => {}) }
  assert.equal(await probeFolder('/share', hang, 20), 'stalled')
  assert.equal(await probeFolder('/share', hang, 20), 'stalled')
  assert.equal(stats, 1, 'no second check while the first still hangs')
  assert.equal(await probeFolder(os.tmpdir()), 'ok')
  assert.equal(await probeFolder(path.join(os.tmpdir(), 'webtorrent-no-such-folder')), 'missing')
  assert.equal(await probeFolder(__filename), 'missing', 'a file is not a folder')

  // The UI checks the folder of a torrent that stays not ready, and only then
  const TorrentController = require('../src/renderer/controllers/torrent-controller')
  const waiting = { torrentKey: 7, infoHash: 'd'.repeat(40), status: 'downloading', path: '/share', progress: { ready: false } }
  const fine = { torrentKey: 8, infoHash: 'e'.repeat(40), status: 'downloading', path: '/local', progress: { ready: true } }
  const tcState = { saved: { prefs: { downloadPath: '/downloads' }, torrents: [waiting, fine] } }
  const controller = new TorrentController(tcState)
  await controller.checkFolders(1000)
  assert.deepEqual(probes, [], 'not checked in the first seconds')
  probeResult = 'stalled'
  await controller.checkFolders(12000)
  assert.deepEqual(probes, ['/share'], 'only the waiting torrent\'s folder')
  assert.deepEqual(tcState.folderStatus, { '/share': 'stalled' })
  assert.ok(dispatched.includes('update'), 'the list redraws when a status changes')
  waiting.progress = { ready: true }
  await controller.checkFolders(20000)
  assert.deepEqual(tcState.folderStatus, {}, 'cleared once the torrent is ready')

  // The row says what the check found, and shows no speed or time left until ready
  const TorrentList = require('../build/renderer/pages/torrent-list-page')
  const { renderToStaticMarkup } = require('react-dom/server')
  const progress = { ready: false, progress: 0, downloaded: 0, length: 635e6, numPeers: 35, downloadSpeed: 2, uploadSpeed: 7 }
  const render = folderStatus => renderToStaticMarkup(new TorrentList({
    state: { folderStatus, saved: { prefs: { downloadPath: '/downloads' } } }
  }).renderTorrentMetadata({ status: 'downloading', path: '/share', progress }))
  assert.ok(render({ '/share': 'stalled' }).includes('>Download folder not responding</span>'))
  assert.ok(render({ '/share': 'missing' }).includes('>Download folder missing</span>'))
  const checking = render({})
  assert.ok(checking.includes('>Checking files</span>'))
  assert.ok(checking.includes('35 peers'))
  assert.ok(!/[↓↑]|remaining/.test(checking), 'no speed or time left before ready')
  const ready = renderToStaticMarkup(new TorrentList({ state: { saved: { prefs: {} } } })
    .renderTorrentMetadata({ status: 'downloading', path: '/share', progress: { ...progress, ready: true } }))
  assert.ok(/↓.*remaining/.test(ready), 'both are back once it is ready')

  // A poster that arrives for a removed torrent is deleted, not left behind
  // ...unless the same torrent was added again meanwhile: it shares the file
  const readded = { torrentKey: 9, infoHash: 'f'.repeat(40), status: 'downloading' }
  tcState.saved.torrents.push(readded)
  controller.torrentPosterSaved(99, 'f'.repeat(40) + '.jpg')
  assert.equal(readded.posterFileName, 'f'.repeat(40) + '.jpg')
  readded.files = [{}]
  controller.torrentPosterSaved(99, 'gone.jpg')
  controller.torrentMetadata(99, { name: 'gone', files: [] })
  controller.torrentAudioMetadata('0'.repeat(40), 0, {})
  await settle()
  assert.deepEqual(removedMetadata, [[null, 'gone.jpg']])

  // The watch folder sees new torrents in a folder whose name has parentheses
  const FolderWatcher = require('../src/main/folder-watcher')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'webtorrent-watch-'))
  try {
    const folder = path.join(base, 'movies (2026) [new]')
    fs.mkdirSync(path.join(folder, 'sub'), { recursive: true })
    const added = []
    const watcher = new FolderWatcher({
      window: { dispatch: (action, filePath) => added.push(path.relative(folder, filePath)) },
      state: { saved: { prefs: { autoAddTorrents: true, torrentsFolderPath: folder } } }
    })
    watcher.start()
    await new Promise(resolve => watcher.watcher.on('ready', resolve))
    fs.writeFileSync(path.join(folder, 'a.torrent'), 'x')
    fs.writeFileSync(path.join(folder, 'sub', 'B.TORRENT'), 'x')
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'x')
    // A folder made after the watch began, with a dot in its name
    fs.mkdirSync(path.join(folder, 'Season.2'))
    await new Promise(resolve => setTimeout(resolve, 500))
    fs.writeFileSync(path.join(folder, 'Season.2', 'c.torrent'), 'x')
    for (let i = 0; i < 100 && added.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 100))
    await new Promise(resolve => setTimeout(resolve, 500))
    const tracked = Object.values(watcher.watcher.getWatched()).flat()
    watcher.stop()
    assert.deepEqual(added.sort(), [path.join('Season.2', 'c.torrent'), 'a.torrent', path.join('sub', 'B.TORRENT')])
    assert.ok(!tracked.includes('notes.txt'), 'other files in the folder are not tracked')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }

  // External player on a drive that hangs: one disk check at a time, and a
  // launch still waiting when playback is abandoned never opens a player
  const cp = require('node:child_process')
  const EventEmitter = require('node:events')
  const spawned = []
  const realSpawn = cp.spawn
  const realRealpath = fs.promises.realpath
  cp.spawn = (command, args) => {
    const proc = new EventEmitter()
    proc.kill = () => {}
    spawned.push(args)
    return proc
  }
  const released = []
  stub('windows', { main: { dispatch () {} }, webtorrent: { send: (...args) => released.push(args) } })
  const externalPlayer = require('../src/main/external-player')
  const hash = 'a'.repeat(40)
  const finished = { torrents: [{ infoHash: hash, completed: true, path: '/share', files: [{ path: 'a.mp4', length: 5 }] }] }
  const streamURL = token => `http://127.0.0.1:9/webtorrent/${hash}/a.mp4?token=${token}`
  try {
    let realpaths = 0
    let answer
    fs.promises.realpath = () => {
      realpaths++
      return new Promise((resolve, reject) => { answer = reject })
    }
    const first = externalPlayer.spawn('/usr/local/bin/mpv', streamURL('one'), 'A', finished)
    await externalPlayer.spawn('/usr/local/bin/mpv', streamURL('two'), 'A', finished)
    await externalPlayer.spawn('/usr/local/bin/mpv', streamURL('three'), 'A', finished)
    assert.equal(realpaths, 1, 'no second disk check while the first still hangs')
    assert.deepEqual(spawned.map(args => args.at(-1)), [streamURL('two'), streamURL('three')], 'later launches get the stream at once')
    externalPlayer.kill()
    answer(new Error('drive gone'))
    await first
    assert.equal(spawned.length, 2, 'the launch that was waiting when playback stopped opens nothing')
    assert.deepEqual(released.at(-1), ['wt-release-external-server', 'one'], 'and gives its stream back')
    await externalPlayer.spawn('/usr/local/bin/mpv', streamURL('four'), 'A', finished)
    assert.equal(realpaths, 2, 'checks again once the hung one has ended')
  } finally {
    cp.spawn = realSpawn
    fs.promises.realpath = realRealpath
  }

  // The update check reports only a newer release, and nothing on an error reply
  const newerVersion = require('../src/main/update-check')
  const requests = []
  const reply = (ok, tag) => async (url, options) => { requests.push(url); return { ok, json: async () => ({ tag_name: tag }) } }
  assert.equal(await newerVersion(reply(true, 'v0.27.0'), '0.26.5'), '0.27.0')
  assert.equal(await newerVersion(reply(true, 'v0.26.5'), '0.26.5'), null)
  assert.equal(await newerVersion(reply(true, 'v0.26.1'), '0.26.5'), null)
  assert.equal(await newerVersion(reply(true, 'nightly'), '0.26.5'), null)
  assert.equal(await newerVersion(reply(false, 'v9.0.0'), '0.26.5'), null)
  assert.ok(requests.every(url => url === 'https://api.github.com/repos/tommyent/webtorrent-desktop/releases/latest'))
  const notice = renderToStaticMarkup(new TorrentList({
    state: { updateAvailable: '0.27.0', saved: { prefs: {}, torrents: [] } }
  }).render())
  assert.ok(notice.includes('WebTorrent 0.27.0 is available'))

  console.log('Slow drive regressions passed: path helpers, resume after quit, manual pause, folder check, row status, late poster, watch folder, external player, removal boxes, update notice')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
