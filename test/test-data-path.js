const test = require('tape')
const path = require('path')
const dataPath = require('../src/main/data-path')

const rejects = (t, promise, pattern, message) =>
  promise.then(() => t.fail(message), err => t.match(err.message, pattern, message))

test('data-path: confines shell paths to known torrent download dirs', async function (t) {
  const root = path.join(path.sep, 'downloads', 'movies')
  dataPath.setTorrentsAccessor(() => [{ path: root, files: [{ path: 'a.mp4' }, { path: 'sub/b.mkv' }] }, { path: null }, null])

  // Allowed: the root itself and files/dirs under it
  await rejects(t, dataPath.assertDataPath(root), /known torrent/, 'download directory is never torrent data')
  await dataPath.assertDataPath(path.join(root, 'a.mp4')).then(() => t.pass('a file under it'), err => t.fail('a file under it' + ': ' + err.message))
  await dataPath.assertDataPath(path.join(root, 'sub', 'b.mkv')).then(() => t.pass('a nested file'), err => t.fail('a nested file' + ': ' + err.message))

  // Rejected: escapes, siblings, absolute-elsewhere, and junk
  await rejects(t, dataPath.assertDataPath(path.join(path.sep, 'etc', 'passwd')), /known torrent/, 'system path')
  await rejects(t, dataPath.assertDataPath(path.join(root, '..', 'other', 'x')), /known torrent/, 'traversal out of root')
  await rejects(t, dataPath.assertDataPath(path.join(path.sep, 'downloads', 'movies-evil')), /known torrent/, 'sibling prefix, not contained')
  await rejects(t, dataPath.assertDataPath(''), /Invalid data path/, 'empty string')
  await rejects(t, dataPath.assertDataPath(undefined), /Invalid data path/, 'non-string')

  // Rejected when no torrents are known
  dataPath.setTorrentsAccessor(() => [])
  await rejects(t, dataPath.assertDataPath(root), /known torrent/, 'nothing allowed with no torrents')

  t.end()
})
