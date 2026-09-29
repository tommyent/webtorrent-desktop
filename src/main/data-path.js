const fs = require('fs')
const path = require('path')

let getTorrents = () => []
module.exports = { setTorrentsAccessor, assertDataPath, trashTorrentData }

function setTorrentsAccessor (fn) { getTorrents = fn }

// "Remove torrent and data". The torrent's folder goes to the Trash as one item
// only if it holds nothing but this torrent's files. Otherwise only the
// torrent's own files go, then any of its folders left empty are removed, so
// other files in a folder with the same name stay where they are.
async function trashTorrentData (infoHash, trashItem) {
  const torrent = getTorrents().find(t => t && t.infoHash === infoHash)
  if (!torrent || !torrent.path || !torrent.files || !torrent.files.length) throw new TypeError('Not a known torrent')
  const root = path.resolve(torrent.path)
  const files = torrent.files.map(file => path.resolve(root, file.path))
  const folder = path.resolve(root, torrent.files[0].path.split(/[\\/]/)[0])
  files.forEach(assertDataPath)

  if (!files.includes(folder) && await exists(folder)) {
    assertDataPath(folder)
    if (await holdsOnly(folder, new Set(files))) return trashItem(folder)
  }
  for (const file of files) if (await exists(file)) await trashItem(file)

  const folders = new Set()
  for (const file of files) {
    for (let dir = path.dirname(file); dir.startsWith(root + path.sep); dir = path.dirname(dir)) folders.add(dir)
  }
  for (const dir of [...folders].sort((a, b) => b.length - a.length)) {
    await fs.promises.rmdir(dir).catch(() => {}) // not empty, or already gone
  }
}

async function holdsOnly (dir, files) {
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory() ? !(await holdsOnly(entryPath, files)) : !files.has(entryPath)) return false
  }
  return true
}

function exists (filePath) {
  return fs.promises.lstat(filePath).then(() => true, err => {
    if (err.code === 'ENOENT') return false
    throw err
  })
}

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
