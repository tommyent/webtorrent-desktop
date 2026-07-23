// Confines renderer-supplied filesystem paths to torrent download directories
// the main process actually knows about. The sandboxed renderer can name any
// string; the shell sinks (openPath / trashItem / showItemInFolder) must only
// ever touch downloaded torrent data, never arbitrary host paths. Same
// containment discipline as renderer-files.js's metadata-path checks, applied
// to the download roots in the authoritative saved state.
const path = require('path')

let getTorrents = () => []

module.exports = {
  setTorrentsAccessor,
  assertDataPath
}

function setTorrentsAccessor (fn) {
  getTorrents = fn
}

// ponytail: containment under a known torrent root, not exact file-list match.
// This stops path escape to /etc, ~/.ssh, system binaries, etc. It still allows
// any file under a download dir the user already pointed a torrent at, which is
// the same scope the "delete torrent data" feature already has. Tighten to
// per-file matching only if that marginal case ever matters.
function assertDataPath (filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('Invalid data path')
  }
  const roots = getTorrents().map(t => t && t.path).filter(Boolean)
  const contained = roots.some(root => {
    const relative = path.relative(root, filePath)
    return relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  })
  if (!contained) {
    throw new TypeError('Path is not within a known torrent download directory')
  }
}
