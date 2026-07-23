const test = require('tape')
const path = require('path')
const dataPath = require('../src/main/data-path')

test('data-path: confines shell paths to known torrent download dirs', function (t) {
  const root = path.join(path.sep, 'downloads', 'movies')
  dataPath.setTorrentsAccessor(() => [{ path: root }, { path: null }, null])

  // Allowed: the root itself and files/dirs under it
  t.doesNotThrow(() => dataPath.assertDataPath(root), 'the download dir itself')
  t.doesNotThrow(() => dataPath.assertDataPath(path.join(root, 'a.mp4')), 'a file under it')
  t.doesNotThrow(() => dataPath.assertDataPath(path.join(root, 'sub', 'b.mkv')), 'a nested file')

  // Rejected: escapes, siblings, absolute-elsewhere, and junk
  t.throws(() => dataPath.assertDataPath(path.join(path.sep, 'etc', 'passwd')), /known torrent/, 'system path')
  t.throws(() => dataPath.assertDataPath(path.join(root, '..', 'other', 'x')), /known torrent/, 'traversal out of root')
  t.throws(() => dataPath.assertDataPath(path.join(path.sep, 'downloads', 'movies-evil')), /known torrent/, 'sibling prefix, not contained')
  t.throws(() => dataPath.assertDataPath(''), /Invalid data path/, 'empty string')
  t.throws(() => dataPath.assertDataPath(undefined), /Invalid data path/, 'non-string')

  // Rejected when no torrents are known
  dataPath.setTorrentsAccessor(() => [])
  t.throws(() => dataPath.assertDataPath(root), /known torrent/, 'nothing allowed with no torrents')

  t.end()
})
