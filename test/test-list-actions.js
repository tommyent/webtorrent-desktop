// Torrent list actions: the start/pause switch, and removing the rows checked
// for removal from the header's Remove button.
const assert = require('node:assert/strict')
const path = require('node:path')
process.env.NODE_ENV = 'test'

const calls = []
const pathChecks = []
const checked = []
const dispatched = []
global.window = {
  webtorrent: {
    path,
    config: { STATIC_PATH: __dirname, TORRENT_PATH: '/torrents' },
    torrent: {
      start: torrentKey => calls.push(['start', torrentKey]),
      stop: torrentKey => calls.push(['stop', torrentKey]),
      checkPath: checkedPath => new Promise(resolve => { checked.push(checkedPath); pathChecks.push(resolve) }),
      deleteMetadata: async () => {},
      trashData: async infoHash => { if (infoHash === 'b'.repeat(40)) throw new Error('could not trash') }
    }
  }
}
const { setDispatch } = require('../src/renderer/lib/dispatcher')
const TorrentListController = require('../src/renderer/controllers/torrent-list-controller')

const errors = []
setDispatch((action, ...args) => {
  dispatched.push(action)
  if (action === 'error') errors.push(args[0])
})
const settle = () => new Promise(resolve => setImmediate(resolve))

async function main () {
  const row = (key, letter) => ({
    torrentKey: key,
    infoHash: letter.repeat(40),
    name: letter,
    status: 'paused',
    path: '/downloads',
    files: [{ path: letter + '.mp4' }],
    torrentFileName: letter + '.torrent'
  })
  const state = {
    saved: { prefs: {}, torrents: [row(1, 'a'), row(2, 'b'), { torrentKey: 3, status: 'new', name: 'unparsed' }] },
    removalSelection: [],
    playing: { infoHash: null },
    location: { url: () => 'home', clearForward () {} }
  }
  const list = new TorrentListController(state)
  const a = state.saved.torrents[0]

  // Switched on, then off while its folder is checked: no start is sent afterwards.
  list.toggleTorrent(1)
  assert.equal(a.status, 'new', 'shows as on right away')
  list.toggleTorrent(1)
  pathChecks.shift()(true)
  await settle()
  assert.deepEqual(calls, [['stop', 1]])
  assert.equal(a.status, 'paused')

  // On, off, on: only the latest start goes out.
  calls.length = 0
  list.toggleTorrent(1)
  list.toggleTorrent(1)
  list.toggleTorrent(1)
  pathChecks.shift()(true)
  pathChecks.shift()(true)
  await settle()
  assert.deepEqual(calls, [['stop', 1], ['start', 1]])

  // Pause All includes a torrent that is still starting.
  calls.length = 0
  list.pauseAllTorrents()
  assert.deepEqual(calls, [['stop', 1], ['stop', 3]])
  assert.equal(a.status, 'paused')

  // Pause All or Remove while the folder is checked: no start afterwards either.
  calls.length = 0
  list.toggleTorrent(1)
  list.pauseAllTorrents()
  pathChecks.shift()(true)
  await settle()
  assert.deepEqual(calls, [['stop', 1]], 'Pause All cancels a pending start')
  const b = state.saved.torrents[1]
  list.toggleTorrent(2)
  const removing = list.deleteTorrent(2, false)
  pathChecks.shift()(true)
  await removing
  await settle()
  assert(!calls.some(([action, key]) => action === 'start' && key === 2), 'Remove cancels a pending start')
  state.saved.torrents.splice(1, 0, Object.assign(b, { status: 'paused' }))

  // A missing folder turns the switch back off. An unfinished torrent may have no
  // files yet, so only its download folder is checked; a background resume never
  // closes the player of another torrent.
  list.toggleTorrent(1)
  assert.equal(checked.at(-1), '/downloads', 'unfinished: download folder')
  pathChecks.shift()(false)
  await settle()
  assert.equal(a.status, 'paused')
  assert.equal(a.error, 'path-missing')
  assert(!dispatched.includes('backToList'), 'player left alone')
  delete a.error

  // A completed torrent's own file must still be there; if it's the one playing, leave the player.
  a.completed = true
  state.playing.infoHash = a.infoHash
  list.toggleTorrent(1)
  assert.equal(checked.at(-1), path.join('/downloads', 'a.mp4'), 'completed: its file')
  pathChecks.shift()(false)
  await settle()
  assert(dispatched.includes('backToList'))
  Object.assign(state.playing, { infoHash: null })
  delete a.completed
  delete a.error

  // Check rows, including one that hasn't loaded yet, and remove them with their data.
  for (const key of [1, 2, 3]) list.toggleRemovalSelection(key)
  list.toggleRemovalSelection(3)
  list.toggleRemovalSelection(3)
  assert.deepEqual(state.removalSelection, [1, 2, 3])
  list.confirmRemoveSelected()
  assert.deepEqual(state.modal, { id: 'remove-torrent-modal', torrentKeys: [1, 2, 3], deleteData: false })
  await list.deleteTorrents(state.modal.torrentKeys, true)
  assert.deepEqual(state.saved.torrents.map(t => t.torrentKey), [2], 'a failed removal stays listed')
  assert.deepEqual(state.removalSelection, [2], 'and stays checked')
  assert.equal(errors.length, 1)

  // Pressing Remove again with rows already gone doesn't throw.
  await list.deleteTorrents([1, 2, 3], false)
  assert.deepEqual(state.saved.torrents, [])
  assert.deepEqual(state.removalSelection, [])

  // A row switched off before the engine parsed it restarts with what was added.
  const TorrentController = require('../src/renderer/controllers/torrent-controller')
  const { getRemovalSelection } = require('../src/renderer/lib/torrent-summary')
  const torrents = new TorrentController(state)
  Object.assign(state, { nextTorrentKey: 10 })
  state.saved.prefs.downloadPath = '/downloads'
  const hash = 'd'.repeat(40)
  const magnet = 'magnet:?xt=urn:btih:' + hash + '&dn=D'
  const started = []
  window.webtorrent.torrent.start = (torrentKey, torrentId) => started.push([torrentKey, torrentId])
  list.addTorrent(magnet)
  list.toggleTorrent(10)
  list.toggleTorrent(10)
  assert.deepEqual(started, [[10, magnet], [10, magnet]])
  torrents.torrentParsed(10, hash, magnet)
  assert.equal(state.saved.torrents[0].addedTorrentId, undefined, 'parsed rows keep no copy of the input')

  // Checked rows that leave the list another way don't keep "Remove (1)" up.
  list.addTorrent(magnet)
  list.toggleRemovalSelection(11)
  torrents.torrentParsed(11, hash, magnet)
  assert.deepEqual(getRemovalSelection(state), [], 'rejected duplicate')
  list.addTorrent(magnet.replace(hash, 'e'.repeat(40)))
  list.toggleRemovalSelection(12)
  torrents.torrentPrivateMagnet(12)
  assert.deepEqual(getRemovalSelection(state), [], 'private magnet stopped')
  list.toggleRemovalSelection(10)
  list.confirmRemoveSelected()
  assert.deepEqual(state.modal.torrentKeys, [10], 'only rows still listed')

  console.log('List action regressions passed: switch during path check, on/off/on, pause all, missing folder, multi-remove, restart before parse, checked rows that leave')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
