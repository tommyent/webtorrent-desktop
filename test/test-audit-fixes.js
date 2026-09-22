const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const permissions = require('../src/main/file-permissions')
const dataPath = require('../src/main/data-path')
const { load } = require('../src/main/subtitles')
const StreamServer = require('../src/renderer/lib/stream-server')

async function main () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webtorrent-fixes-'))
  const file = path.join(dir, 'sample.srt')
  await fs.writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nHello\n')
  const [subtitle] = await load([file])
  assert.match(Buffer.from(subtitle.buffer.split(',')[1], 'base64').toString(), /WEBVTT/)
  const vtt = path.join(dir, 'sample.vtt')
  await fs.writeFile(vtt, 'WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n')
  const [original] = await load([vtt])
  assert.equal(Buffer.from(original.buffer.split(',')[1], 'base64').toString(), await fs.readFile(vtt, 'utf8'))
  const saved = { prefs: { externalPlayerPath: '', downloadPath: dir }, torrents: [] }
  permissions.initialize(saved)
  assert.throws(() => permissions.validateSaved({ ...saved, prefs: { ...saved.prefs, externalPlayerPath: '/bin/sh' } }))
  assert.throws(() => permissions.assertSelected(file))
  permissions.select([file])
  permissions.assertSelected(file)
  assert.equal(permissions.seedOptions({ files: [{ path: file }], path: '/etc', announce: [] }).path, dir)
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

  let notifications = 0
  global.window = {
    webtorrent: { path, config: { STATIC_PATH: dir }, dock: { downloadFinished () {} } },
    Notification: class { constructor () { notifications++ } }
  }
  const TorrentController = require('../src/renderer/controllers/torrent-controller')
  const summary = { torrentKey: 1, infoHash: 'b'.repeat(40), name: 'sample.srt', path: dir, files: [{ path: 'sample.srt' }] }
  const controller = new TorrentController({ saved: { torrents: [summary] }, playing: { isPaused: true }, window: { isFocused: true }, dock: { badge: 0 } })
  controller.torrentDone(1, { bytesReceived: 1 })
  assert.equal(notifications, 1)
  const TorrentList = require('../build/renderer/pages/torrent-list-page')
  const list = new TorrentList({ state: { saved: { prefs: { sortByName: false } } } })
  const indices = []
  list.renderFileRow = (torrent, file, index) => { indices.push(index); return null }
  list.renderTorrentDetails({ files: [{ path: 'a.mp4' }, { path: '.____padding_file/0' }, { path: 'b.mp4' }] })
  assert.deepEqual(indices, [0, 2])
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
