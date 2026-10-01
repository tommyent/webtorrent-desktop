// File checkboxes, run through the real engine with WebTorrent clients on
// loopback. WebTorrent 3 deselects by range and calls a torrent done only when
// every file is complete: a ticked file next to an unticked one must still
// finish, and a torrent with unticked files is done for the user without
// claiming to be complete (no completion flag, modtimes or lost resume map).
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
process.env.NODE_ENV = 'test'

// The engine window's IPC, recorded
const ipc = new EventEmitter()
const sent = []
ipc.send = (name, ...args) => sent.push([name, ...args])
const electron = require.resolve('electron')
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { ipcRenderer: ipc } }
global.window = { addEventListener () {} }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webtorrent-selection-'))
const opts = { dht: false, tracker: false, lsd: false, utPex: false, natUpnp: false, natPmp: false, utp: false }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until (what, test, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(50)) {
    const result = test()
    if (result) return result
  }
  throw new Error('timed out waiting for ' + what)
}
const messages = (name, key) => sent.filter(([n, k]) => n === name && k === key)
const lastProgress = key => {
  const progress = sent.filter(([n]) => n === 'wt-progress').at(-1)[1]
  return { ...progress, torrent: progress.torrents.find(t => t.torrentKey === key) }
}

// 16 KiB pieces: a.bin is pieces 0-2, b.bin 2-5, c.bin 5-7 (each pair shares a piece)
async function seedPack (seeder, name, fill) {
  const pack = path.join(dir, 'seed', name)
  fs.mkdirSync(pack, { recursive: true })
  const sizes = { 'a.bin': 40000, 'b.bin': 50000, 'c.bin': 30000 }
  for (const [file, size] of Object.entries(sizes)) fs.writeFileSync(path.join(pack, file), Buffer.alloc(size, fill + file[0]))
  return new Promise(resolve => seeder.seed(pack, { pieceLength: 16384, announceList: [] }, resolve))
}

async function main () {
  require('../src/renderer/webtorrent')
  await until('engine', () => sent.some(([name]) => name === 'ipcReadyWebTorrent'))
  const { default: WebTorrent } = await import('webtorrent')
  const seeder = new WebTorrent(opts)
  const first = await seedPack(seeder, 'first', 'x')
  const second = await seedPack(seeder, 'second', 'y')
  assert.deepEqual(first.announce, [], 'no trackers: peers are connected by hand')
  const peer = '127.0.0.1:' + seeder.address().port

  async function start (key, seed, selections) {
    ipc.emit('wt-start-torrenting', {}, key, seed.torrentFile, path.join(dir, 'download'), undefined, selections, undefined)
    const torrent = window.client.torrents.find(t => t.key === key)
    await new Promise(resolve => torrent.ready ? resolve() : torrent.once('ready', resolve))
    torrent.addPeer(peer)
    return torrent
  }
  const fileNamed = (torrent, name) => torrent.files.find(f => f.name === name)

  // a ticked, b and c not: a finishes, including the piece it shares with b
  const torrent = await start(1, first, [true, false, false])
  const [a, b, c] = ['a.bin', 'b.bin', 'c.bin'].map(name => fileNamed(torrent, name))
  const done = await until('done for the ticked file', () => messages('wt-done', 1)[0])
  assert.equal(done[2].complete, false, 'done for the user, not complete')
  assert.equal(a.done, true)
  assert.equal(torrent.bitfield.get(2), true, 'shared piece downloaded')
  assert.equal(b.done || c.done || torrent.done, false)
  await until('progress', () => lastProgress(1).torrent.selectedDone)
  assert.equal(lastProgress(1).torrent.done, false)
  assert.equal(lastProgress(1).hasActiveTorrents, false, 'no dock progress bar left waiting')
  assert.deepEqual(messages('wt-file-modtimes', 1), [], 'no modtimes for a partial torrent')

  // Ticking b after that: downloading again (slowed so progress can show it), then done once b is in
  seeder.throttleUpload(20000)
  ipc.emit('wt-select-files', {}, 1, [true, true, false])
  await until('downloading again', () => !lastProgress(1).torrent.selectedDone)
  seeder.throttleUpload(-1)
  await until('second done', () => messages('wt-done', 1).length === 2)
  assert.equal(messages('wt-done', 1)[1][2].complete, false)

  // c ticked, then unticked before any of it arrives: done again right away,
  // not only at the next progress update
  ipc.emit('wt-select-files', {}, 1, [true, true, true])
  ipc.emit('wt-select-files', {}, 1, [true, true, false])
  assert.equal(messages('wt-done', 1).length, 3, 'done again without waiting')
  assert.equal(messages('wt-done', 1)[2][2].complete, false)
  assert.equal(b.done, true)
  assert.equal(torrent.bitfield.get(5), true, 'piece shared with unticked c')
  assert.equal(c.done || torrent.done, false)

  // Streaming the unticked c survives another selection change, and completing
  // it that way makes the torrent truly complete
  const data = c.arrayBuffer()
  ipc.emit('wt-select-files', {}, 1, [true, true, false])
  assert.deepEqual(Buffer.from(await data), Buffer.alloc(30000, 'xc'))
  const complete = await until('complete', () => messages('wt-done', 1)[3])
  assert.equal(complete[2].complete, true)
  await until('modtimes once complete', () => messages('wt-file-modtimes', 1).length === 1)

  // Unticking after completion changes nothing
  ipc.emit('wt-select-files', {}, 1, [true, false, false])
  await wait(1200)
  assert.equal(torrent.done, true)
  assert.equal(messages('wt-done', 1).length, 4)
  assert.equal(lastProgress(1).torrent.selectedDone, false)

  // Nothing ticked: nothing downloads and nothing is reported done
  const empty = await start(2, second, [false, false, false])
  await wait(1500)
  assert.equal(empty.wires.length > 0, true, 'connected')
  assert.equal(empty.downloaded, 0)
  assert.deepEqual(messages('wt-done', 2), [])
  assert.equal(lastProgress(2).torrent.selectedDone, false)

  await new Promise(resolve => seeder.destroy(resolve))
  await new Promise(resolve => window.client.destroy(resolve))
  fs.rmSync(dir, { recursive: true, force: true })

  uiChecks()
  console.log('File selection passed: shared pieces, done with unticked files, ticking after done, streaming, complete, nothing ticked')
  process.exit(0)
}

// The UI side: a partial done shows as seeding but keeps the resume map,
// goes back to downloading when a file is ticked, and selection changes are saved.
function uiChecks () {
  const dispatched = []
  require('../src/renderer/lib/dispatcher').setDispatch(action => dispatched.push(action))
  const posters = []
  const selections = []
  let notifications = 0
  let written
  Object.assign(window, {
    Notification: class { constructor () { notifications++ } },
    webtorrent: {
      path,
      config: { STATIC_PATH: dir, TORRENT_PATH: dir },
      dock: { downloadFinished () {} },
      state: { saveImmediate: copy => { written = copy; return Promise.resolve() } },
      torrent: {
        generatePoster: key => posters.push(key),
        selectFiles: (key, chosen) => selections.push([key, [...chosen]])
      }
    }
  })
  const TorrentController = require('../src/renderer/controllers/torrent-controller')
  const TorrentListController = require('../src/renderer/controllers/torrent-list-controller')
  const State = require('../src/renderer/lib/state')
  const summary = {
    torrentKey: 1,
    infoHash: 'f'.repeat(40),
    name: 'pack',
    path: dir,
    status: 'downloading',
    files: [{ path: 'pack/a.bin' }, { path: 'pack/b.bin' }],
    selections: [true, false]
  }
  const state = { saved: { prefs: {}, torrents: [summary] }, playing: { isPaused: true }, window: { isFocused: true }, dock: { badge: 0 } }
  const torrents = new TorrentController(state)
  const progress = selectedDone => ({ torrents: [{ torrentKey: 1, ready: true, done: false, selectedDone, bitfield: { buffer: new Uint8Array([0xe0]) } }] })

  torrents.torrentProgress(progress(false))
  torrents.torrentDone(1, { bytesReceived: 1, complete: false })
  assert.equal(summary.status, 'seeding')
  assert.notEqual(summary.completed, true)
  assert.equal(notifications, 1)
  assert.deepEqual(posters, [1])
  torrents.torrentProgress(progress(true))
  assert.equal(summary.status, 'seeding', 'stays done while the ticked files are')
  State.saveImmediate(state)
  assert.equal(written.torrents[0].bitfield, '4A==', 'resume map kept')

  const list = new TorrentListController(state)
  dispatched.length = 0
  list.toggleTorrentFile(summary.infoHash, 1)
  assert.deepEqual(selections, [[1, [true, true]]])
  assert.deepEqual(dispatched, ['stateSave'], 'selection saved')
  torrents.torrentProgress(progress(false))
  assert.equal(summary.status, 'downloading', 'newly ticked file still downloading')

  torrents.torrentDone(1, { bytesReceived: 1, complete: true })
  assert.equal(summary.completed, true)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
