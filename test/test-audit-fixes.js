const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const permissions = require('../src/main/file-permissions')
const dataPath = require('../src/main/data-path')
const { load } = require('../src/main/subtitles')
const StreamServer = require('../src/renderer/lib/stream-server')
const createTorrent = require('../src/renderer/lib/create-torrent')
const checkTorrentId = require('../src/main/torrent-id')
const migrations = require('../src/main/migrations')

async function main () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webtorrent-fixes-'))
  const file = path.join(dir, 'sample.srt')
  await fs.writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nHello\n')

  // Torrent IDs: strings only, and magnets keep only the parameters the magnet
  // parser understands (any other key would become a torrent property, such as path).
  const magnetHash = 'c'.repeat(40)
  const hostileMagnet = `magnet:?xt=urn:btih:${magnetHash}&dn=Show&path=/tmp/elsewhere&on=x&so=0-4000000000&tr=udp%3A%2F%2Ft.example%3A1337`
  assert.throws(() => checkTorrentId({ infoHash: magnetHash, path: '/tmp/elsewhere' }), /Invalid torrent ID/)
  for (const scheme of ['magnet:', 'stream-magnet:']) {
    assert.equal(checkTorrentId(hostileMagnet.replace('magnet:', scheme)),
      `magnet:?xt=urn:btih:${magnetHash}&dn=Show&tr=udp%3A%2F%2Ft.example%3A1337`, scheme)
  }
  // The info hash later names a file: only real v1 hashes (40 hex or 32 base32).
  assert.throws(() => checkTorrentId('magnet:?xt=urn:btih:../' + 'a'.repeat(37)), /Invalid magnet link/)
  assert.throws(() => checkTorrentId('magnet:?xt=urn:btih:' + 'g'.repeat(40)), /Invalid magnet link/)
  assert.throws(() => checkTorrentId('magnet:?xt=urn:btih:' + 'g'.repeat(40) + '\nx'), /Invalid magnet link/)
  assert.throws(() => checkTorrentId('magnet:?xt=urn:btih:' + magnetHash + '\n'), /Invalid magnet link/)
  const base32Magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(32)
  assert.equal(checkTorrentId(base32Magnet), base32Magnet)
  const hybridMagnet = `magnet:?xt=urn:btmh:1220${'b'.repeat(64)}&xt=urn:btih:${magnetHash}`
  assert.equal(checkTorrentId(hybridMagnet), hybridMagnet)
  assert.equal(checkTorrentId(file), file)

  // Old migrations copy only to destinations named by a real info hash, and
  // rename or delete only plain file names. fs is stubbed: nothing on disk changes.
  const fsSync = require('node:fs')
  const realFs = { copyFileSync: fsSync.copyFileSync, renameSync: fsSync.renameSync, rmSync: fsSync.rmSync }
  const fsCalls = []
  Object.assign(fsSync, {
    copyFileSync: (src, dst) => fsCalls.push(['copy', dst]),
    renameSync: src => fsCalls.push(['rename', src]),
    rmSync: target => fsCalls.push(['rm', target])
  })
  try {
    migrations.migrate_0_7_0({
      torrents: [
        { infoHash: '../../../../tmp/escape', torrentPath: '/etc/hosts', posterURL: '/etc/hosts.plist' },
        { infoHash: 'a'.repeat(40), torrentPath: '/tmp/legacy.torrent' }
      ]
    })
    assert.deepEqual(fsCalls.map(([op, target]) => [op, path.basename(target)]), [['copy', 'a'.repeat(40) + '.torrent']])
    const wiredCd = name => ({
      torrents: [{ infoHash: '3ba219a8634bf7bae3d848192b2da75ae995589d', files: [], magnetURI: '', posterFileName: name, torrentFileName: name }]
    })
    for (const name of ['../../escape', '', '.', '..']) {
      fsCalls.length = 0
      migrations.migrate_0_17_2(wiredCd(name))
      assert.deepEqual(fsCalls.map(([op]) => op), ['copy'], `no rename or delete for ${JSON.stringify(name)}`)
    }
    fsCalls.length = 0
    migrations.migrate_0_17_2(wiredCd('old.torrent'))
    assert.deepEqual(fsCalls.map(([op]) => op), ['rename', 'rm', 'copy'], 'plain names still migrate')
  } finally {
    Object.assign(fsSync, realFs)
  }
  const [subtitle] = await load([file])
  assert.match(Buffer.from(subtitle.buffer.split(',')[1], 'base64').toString(), /WEBVTT/)
  const vtt = path.join(dir, 'sample.vtt')
  await fs.writeFile(vtt, 'WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n')
  const [original] = await load([vtt])
  assert.equal(Buffer.from(original.buffer.split(',')[1], 'base64').toString(), await fs.readFile(vtt, 'utf8'))
  const saved = { prefs: { externalPlayerPath: '', downloadPath: dir }, torrents: [] }
  permissions.initialize(saved)
  assert.throws(() => permissions.validateSaved({ ...saved, prefs: { ...saved.prefs, externalPlayerPath: '/bin/sh' } }))
  assert.throws(() => permissions.assertSelected(file, 'open'))
  permissions.select([file], 'open')
  permissions.assertSelected(file, 'open')
  assert.equal(permissions.seedOptions({ files: [{ path: file }], path: '/etc', announce: [] }).path, dir)
  // A pick for one purpose authorizes nothing else: choosing the download
  // folder doesn't allow seeding from it, and a subtitle file can't become the
  // external player.
  permissions.select([dir], 'downloadPath')
  assert.throws(() => permissions.seedOptions({ files: [{ path: vtt }], announce: [] }), /native dialog/)
  permissions.select([vtt], 'subtitles')
  assert.throws(() => permissions.validateSaved({ ...saved, prefs: { ...saved.prefs, externalPlayerPath: vtt } }), /native dialog/)
  permissions.select([vtt], 'externalPlayerPath')
  permissions.validateSaved({ ...saved, prefs: { ...saved.prefs, externalPlayerPath: vtt } })
  assert.throws(() => permissions.consumeDestination(file))
  permissions.destination(file)
  permissions.consumeDestination(file)
  assert.throws(() => permissions.consumeDestination(file))
  const torrent = { infoHash: 'a'.repeat(40), path: dir, files: [{ path: 'sample.srt' }] }
  permissions.recordTorrent(torrent)
  dataPath.setTorrentsAccessor(permissions.getTorrents)
  dataPath.assertDataPath(file)
  assert.throws(() => dataPath.assertDataPath(dir))
  assert.throws(() => dataPath.assertDataPath(vtt))
  const link = path.join(dir, 'escape')
  await fs.symlink(os.tmpdir(), link)
  permissions.recordTorrent({ ...torrent, files: [{ path: 'escape/elsewhere' }] })
  assert.throws(() => dataPath.assertDataPath(path.join(link, 'elsewhere')))

  // Individually picked files keep their paths without granting their folders
  // or including unselected siblings.
  const pickedDir = path.join(dir, 'picked')
  const picks = ['one/episode.txt', 'two/episode.txt'].map(p => path.join(pickedDir, p))
  for (const [i, pick] of picks.entries()) {
    await fs.mkdir(path.dirname(pick), { recursive: true })
    await fs.writeFile(pick, 'PICK ' + i)
    await fs.writeFile(path.join(path.dirname(pick), 'unselected.txt'), 'PRIVATE')
  }
  permissions.select(picks, 'open')
  const inspectCreateInput = require('../src/main/renderer-files').inspectCreateInput
  const picked = permissions.seedOptions({ files: await inspectCreateInput(picks), announce: [] })
  assert.deepEqual(picked.files.map(file => file.path), picks)

  // Same-named files in subfolders can't collide; selected links are refused.
  const createDir = path.join(dir, 'create')
  await fs.mkdir(path.join(createDir, 'Season1'), { recursive: true })
  await fs.writeFile(path.join(createDir, 'episode.txt'), 'ROOT')
  await fs.writeFile(path.join(createDir, 'Season1', 'episode.txt'), 'NESTED')
  permissions.select([createDir], 'open')
  const seed = permissions.seedOptions({ files: await inspectCreateInput([createDir]), announce: [] })
  assert.deepEqual(seed.files.map(file => file.path).sort(), [path.join(createDir, 'Season1', 'episode.txt'), path.join(createDir, 'episode.txt')].sort())
  assert.deepEqual([seed.name, seed.path], ['create', dir])
  const outside = path.join(createDir, 'Season1', 'outside')
  await fs.symlink(os.tmpdir(), outside)
  await assert.rejects(inspectCreateInput([createDir]), /symbolic link/)
  assert.throws(() => permissions.seedOptions({ files: [{ path: outside }], announce: [] }))
  await fs.rm(outside)

  // "Remove torrent and data" keeps unrelated files that share the torrent's folder.
  const show = path.join(dir, 'Show')
  const showFiles = ['Show/ep1.mkv', 'Show/extras/ep2.mkv']
  const showTorrent = { infoHash: 'c'.repeat(40), path: dir, files: showFiles.map(p => ({ path: p })) }
  const writeShow = async () => {
    await fs.mkdir(path.join(show, 'extras'), { recursive: true })
    for (const p of showFiles) await fs.writeFile(path.join(dir, p), 'x')
  }
  permissions.recordTorrent(showTorrent)
  const trashed = []
  const trash = async p => { trashed.push(p); await fs.rm(p, { recursive: true }) }
  await writeShow()
  await fs.writeFile(path.join(show, 'notes.txt'), 'mine')
  await dataPath.trashTorrentData(showTorrent.infoHash, trash)
  assert.deepEqual(trashed.sort(), showFiles.map(p => path.join(dir, p)).sort())
  assert.deepEqual(await fs.readdir(show), ['notes.txt'], 'user file kept, emptied torrent folder removed')
  await fs.rm(path.join(show, 'notes.txt'))
  await writeShow()
  trashed.length = 0
  await dataPath.trashTorrentData(showTorrent.infoHash, trash)
  assert.deepEqual(trashed, [show], 'a folder holding only the torrent goes to the Trash as one item')
  await assert.rejects(dataPath.trashTorrentData('d'.repeat(40), trash), /known torrent/)

  let notifications = 0
  global.window = {
    webtorrent: { path, config: { STATIC_PATH: dir }, dock: { downloadFinished () {} }, torrent: { generatePoster () {} } },
    Notification: class { constructor () { notifications++ } }
  }
  const TorrentController = require('../src/renderer/controllers/torrent-controller')
  const summary = { torrentKey: 1, infoHash: 'b'.repeat(40), name: 'sample.srt', path: dir, files: [{ path: 'sample.srt' }] }
  const controller = new TorrentController({ saved: { torrents: [summary] }, playing: { isPaused: true }, window: { isFocused: true }, dock: { badge: 0 } })
  controller.torrentDone(1, { bytesReceived: 1 })
  assert.equal(notifications, 1)
  assert.equal(summary.completed, true)
  controller.torrentProgress({ torrents: [{ torrentKey: 1, ready: false, done: false }] })
  assert.equal(summary.completed, true, 'verification preserves the last known completion')
  controller.torrentProgress({ torrents: [{ torrentKey: 1, ready: true, done: false }] })
  assert.equal(summary.completed, false, 'verified missing data clears completion')
  controller.torrentProgress({ torrents: [{ torrentKey: 1, ready: true, done: true }] })
  assert.equal(summary.completed, true, 'engine completion is retained for paused torrents')
  const TorrentList = require('../build/renderer/pages/torrent-list-page')
  const list = new TorrentList({ state: { saved: { prefs: { sortByName: false } } } })
  const indices = []
  list.renderFileRow = (torrent, file, index) => { indices.push(index); return null }
  list.renderTorrentDetails({ files: [{ path: 'a.mp4' }, { path: '.____padding_file/0' }, { path: 'b.mp4' }] })
  assert.deepEqual(indices, [0, 2])

  // Sorting preserves added order within groups, including paused completions
  // after a restart, and doesn't rearrange the saved list.
  const torrents = [
    { status: 'new' },
    { status: 'paused', completed: false, fileModtimes: [1] },
    { status: 'paused', completed: true },
    { status: 'downloading' },
    { status: 'seeding' },
    { status: 'paused', fileModtimes: [1] }
  ]
  const sortState = { saved: { prefs: { sortCompletedFirst: true }, torrents } }
  const sortedList = new TorrentList({ state: sortState })
  const rendered = []
  sortedList.renderTorrent = torrent => { rendered.push(torrents.indexOf(torrent)); return null }
  sortedList.render()
  assert.deepEqual(rendered, [2, 4, 5, 0, 1, 3])
  sortState.saved.prefs.sortCompletedFirst = false
  rendered.length = 0
  sortedList.render()
  assert.deepEqual(rendered, [0, 1, 2, 3, 4, 5], 'switching back restores added order')

  // Two removals that overlap remove exactly those two torrents from the list.
  const trashWaits = []
  Object.assign(global.window.webtorrent.torrent, {
    stop () {},
    trashData: () => new Promise(resolve => trashWaits.push(resolve)),
    deleteMetadata: async () => {}
  })
  const TorrentListController = require('../src/renderer/controllers/torrent-list-controller')
  // Show an addition before the engine replies, then reuse that row on parse.
  // Failed and duplicate additions must not leave a pending row behind.
  const pendingState = { nextTorrentKey: 1, saved: { prefs: { downloadPath: dir }, torrents: [] } }
  const pendingList = new TorrentListController(pendingState)
  const pendingController = new TorrentController(pendingState)
  global.window.webtorrent.torrent.start = () => {}
  const magnet = 'magnet:?xt=urn:btih:' + 'e'.repeat(40) + '&dn=First%20torrent'
  pendingList.addTorrent(magnet)
  const pending = pendingState.saved.torrents[0]
  assert(pending, 'addition is visible while the engine starts')
  assert.equal(pending.name, 'First torrent')
  assert.equal(pending.infoHash, undefined)
  pendingController.torrentParsed(1, 'e'.repeat(40), magnet)
  assert.equal(pendingState.saved.torrents[0], pending, 'parsed event updates the same row')
  assert.equal(pendingState.saved.torrents.length, 1)
  pendingList.addTorrent(magnet)
  pendingController.torrentError(2, 'Cannot add duplicate torrent ' + 'e'.repeat(40))
  assert.deepEqual(pendingState.saved.torrents, [pending], 'active duplicate leaves the original alone')
  pendingList.addTorrent('not a torrent')
  pendingController.torrentError(3, 'Invalid torrent identifier')
  assert.deepEqual(pendingState.saved.torrents, [pending], 'invalid addition is removed')
  pending.status = 'paused'
  pendingList.addTorrent(magnet)
  pendingController.torrentParsed(4, 'e'.repeat(40), magnet)
  assert.deepEqual(pendingState.saved.torrents, [pending], 'paused duplicate leaves no pending row')

  const abc = ['a', 'b', 'c'].map(c => ({ infoHash: c.repeat(40), path: dir, files: [{ path: c }] }))
  const listController = new TorrentListController({ saved: { torrents: [...abc] }, removalSelection: [], location: { clearForward () {} } })
  const removals = [listController.deleteTorrent(abc[0].infoHash, true), listController.deleteTorrent(abc[1].infoHash, true)]
  trashWaits.forEach(resolve => resolve())
  await Promise.all(removals)
  assert.deepEqual(listController.state.saved.torrents, [abc[2]])

  // An empty or hidden-files-only selection shows the error page, not a crash.
  const CreateTorrentPage = require('../build/renderer/pages/create-torrent-page')
  const CreateTorrentErrorPage = require('../build/renderer/components/create-torrent-error-page')
  for (const files of [[], [{ name: '.hidden', path: path.join(dir, '.hidden'), size: 1 }]]) {
    const page = new CreateTorrentPage({ state: { location: { current: () => ({ files }) } } })
    assert.equal(page.render().type, CreateTorrentErrorPage)
  }
  delete global.window

  const createRequire = require('node:module').createRequire
  const ip = createRequire(path.join(__dirname, '../node_modules/bittorrent-tracker/package.json'))('ip')
  assert.equal(require('node:net').isIP(ip.address()), 4)
  assert.equal(ip.toString(Buffer.from([127, 0, 0, 1])), '127.0.0.1')
  assert.throws(() => ip.isPublic('127.1'))
  assert.equal(ip.isPublic('::ffff:127.0.0.1'), false)
  assert.equal(ip.isPublic('8.8.8.8'), true)

  const { default: WebTorrent } = await import('webtorrent')
  const client = new WebTorrent({ dht: false, tracker: false, lsd: false, utp: false, natUpnp: false, natPmp: false })
  try {
    // Hash and seed the exact files in place, including same-named selections
    // from different folders. Verify actual store reads as well as metadata.
    const selectedMetadata = await createTorrent(picked)
    const selectedTorrent = await new Promise(resolve => client.add(selectedMetadata, { path: picked.path, skipVerify: true }, resolve))
    assert.deepEqual(selectedTorrent.files.map(file => file.path), picks.map(p => path.relative(dir, p)))
    for (const [i, selectedFile] of selectedTorrent.files.entries()) {
      assert.equal(Buffer.from(await selectedFile.arrayBuffer()).toString(), 'PICK ' + i)
      assert.equal(await fs.readFile(picks[i], 'utf8'), 'PICK ' + i)
    }
    const nestedMetadata = await createTorrent(seed)
    const nested = await new Promise(resolve => client.add(nestedMetadata, { path: seed.path, skipVerify: true }, resolve))
    assert.deepEqual(nested.files.map(f => f.path).sort(),
      [path.join('create', 'Season1', 'episode.txt'), path.join('create', 'episode.txt')].sort())
    assert.equal(await fs.readFile(path.join(createDir, 'episode.txt'), 'utf8'), 'ROOT')
    assert.equal(await fs.readFile(path.join(createDir, 'Season1', 'episode.txt'), 'utf8'), 'NESTED')

    // A private torrent announces only to the trackers the user entered, even
    // with a global tracker list set, and still verifies against its files.
    globalThis.WEBTORRENT_ANNOUNCE = ['wss://global.example']
    const privateMetadata = await createTorrent({ ...seed, private: true, announce: ['udp://private.example:1337'] })
    delete globalThis.WEBTORRENT_ANNOUNCE
    const privateParsed = require('parse-torrent')(Buffer.from(privateMetadata))
    assert.deepEqual([privateParsed.announce, privateParsed.private], [['udp://private.example:1337'], true])
    const privateTorrent = await new Promise(resolve => client.add(privateMetadata, { path: seed.path }, resolve))
    assert.equal(privateTorrent.progress, 1, 'every piece verifies against the files on disk')

    // A cleaned magnet keeps the approved download folder and a working torrent.
    const magnetTorrent = client.add(checkTorrentId(hostileMagnet), { path: dir })
    await new Promise(resolve => magnetTorrent.once('infoHash', resolve))
    assert.equal(magnetTorrent.path, dir)
    assert.equal(typeof magnetTorrent.on, 'function')
    magnetTorrent.destroy()

    const seeded = await new Promise(resolve => client.seed(file, { announce: [] }, resolve))
    const streams = new StreamServer(client)
    const grant = await streams.grant(seeded)
    const url = grant.localURL + '/' + grant.filePaths[0]
    const request = (target, headers = {}) => new Promise((resolve, reject) => {
      http.get(target, { headers }, res => {
        let body = ''
        res.on('data', chunk => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body }))
      }).on('error', reject)
    })
    assert.equal(streams.server.address().address, '127.0.0.1')
    assert.equal((await request(url)).body, await fs.readFile(file, 'utf8'))
    assert.equal((await request(url, { Origin: 'https://hostile.example' })).status, 403)
    assert.equal((await request(url, { Host: 'hostile.example' })).status, 403)
    assert.equal((await request(grant.localURL)).status, 403)
    assert.equal((await request(url.split('?')[0])).status, 403)
    grant.release()
    assert.equal((await request(url)).status, 403)
    const cast = await streams.cast(seeded, 0, '127.0.0.1')
    assert.equal((await request(cast.networkURL + '/' + cast.filePaths[0])).status, 200)
    cast.release()
  } finally {
    await new Promise(resolve => client.destroy(resolve))
  }
  console.log('Audit regressions passed: subtitles, grants, symlinks, loopback, origins, hosts, tokens, revocation and casting proxy')
}
main().catch(err => { console.error(err); process.exitCode = 1 })
