const fs = require('fs')
const path = require('path')

let getTorrents = () => []
module.exports = { setTorrentsAccessor, assertDataPath }

function setTorrentsAccessor (fn) { getTorrents = fn }

function assertDataPath (filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new TypeError('Invalid data path')
  const target = path.resolve(filePath)
  const allowed = getTorrents().some(torrent => {
    if (!torrent || !torrent.path || !torrent.files || !torrent.files.length) return false
    const root = path.resolve(torrent.path)
    const files = torrent.files.map(file => path.resolve(root, file.path))
    const folder = path.resolve(root, torrent.files[0].path.split(/[\\/]/)[0])
    if (target === root || (!files.includes(target) && target !== folder)) return false
    const relative = path.relative(root, target)
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false
    // Reject symlinks anywhere below the download root, including the target.
    let current = root
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part)
      try { if (fs.lstatSync(current).isSymbolicLink()) return false } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }
    return true
  })
  if (!allowed) throw new TypeError('Path is not known torrent data')
}
