const fs = require('fs')
const path = require('path')

// Paths the user picked, kept per purpose so a pick for one job (the download
// folder, say) never authorizes another (seeding, the external player).
// 'open' is content the user opened into the app: seed and open dialogs,
// drag and drop, and files passed on the command line.
const selected = new Map()
const destinations = new Set()
const torrents = new Map()
let initialPrefs = {}

exports.initialize = saved => {
  initialPrefs = { ...saved.prefs }
  for (const torrent of saved.torrents || []) exports.recordTorrent(torrent)
}
exports.recordTorrent = torrent => {
  if (torrent && torrent.infoHash) torrents.set(torrent.infoHash, structuredClone(torrent))
}
exports.getTorrents = () => [...torrents.values()]
exports.select = (paths, purpose) => {
  if (typeof purpose !== 'string') throw new TypeError('Invalid selection purpose')
  if (!selected.has(purpose)) selected.set(purpose, new Set())
  for (const filePath of paths || []) selected.get(purpose).add(path.resolve(filePath))
  return paths
}
exports.destination = filePath => {
  if (filePath) destinations.add(path.resolve(filePath))
  return filePath
}
exports.consumeDestination = filePath => {
  if (typeof filePath !== 'string' || !destinations.delete(path.resolve(filePath))) {
    throw new Error('Choose an export destination in the Save dialog first')
  }
}
exports.assertSelected = (filePath, ...purposes) => {
  if (typeof filePath !== 'string') throw new TypeError('Invalid selected path')
  const target = fs.realpathSync(filePath)
  const roots = purposes.flatMap(purpose => [...(selected.get(purpose) || [])])
  const allowed = roots.some(root => {
    let realRoot
    try { realRoot = fs.realpathSync(root) } catch { return false }
    const relative = path.relative(realRoot, target)
    return relative === '' || (fs.statSync(realRoot).isDirectory() && relative !== '..' &&
      !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  })
  if (!allowed) throw new Error('Choose the file or folder in a native dialog first')
}
exports.validateSaved = saved => {
  if (!saved || !saved.prefs || !Array.isArray(saved.torrents)) throw new TypeError('Invalid saved state')
  for (const key of ['externalPlayerPath', 'downloadPath', 'torrentsFolderPath']) {
    const value = saved.prefs[key]
    if (value && value !== initialPrefs[key] && !selected.get(key)?.has(path.resolve(value))) {
      throw new Error('Choose ' + key + ' in a native dialog first')
    }
  }
  for (const torrent of saved.torrents) {
    const known = torrents.get(torrent.infoHash)
    if (!known) {
      if (torrent.path || torrent.files) throw new Error('Unknown torrent data')
      continue
    }
    if (torrent.path !== known.path || JSON.stringify((torrent.files || []).map(f => f.path)) !==
        JSON.stringify((known.files || []).map(f => f.path))) throw new Error('Torrent data paths cannot be changed')
  }
}

exports.seedOptions = options => {
  if (!options || !Array.isArray(options.files) || !options.files.length) throw new TypeError('No files selected')
  const files = options.files.map(file => {
    exports.assertSelected(file.path, 'open')
    const stat = fs.lstatSync(file.path)
    if (!stat.isFile()) throw new Error('Only regular files can be seeded')
    return { path: path.resolve(file.path), name: path.basename(file.path), size: stat.size }
  })
  let root = path.dirname(files[0].path)
  for (const file of files) {
    while (path.relative(root, file.path).startsWith('..' + path.sep) || path.isAbsolute(path.relative(root, file.path))) {
      const parent = path.dirname(root)
      if (parent === root) throw new Error('Files must share a filesystem root')
      root = parent
    }
  }
  if (!Array.isArray(options.announce) || options.announce.some(url => typeof url !== 'string')) throw new TypeError('Invalid trackers')
  return {
    files,
    name: files.length === 1 ? files[0].name : path.basename(root),
    path: files.length === 1 ? root : path.dirname(root),
    announce: options.announce,
    comment: typeof options.comment === 'string' ? options.comment : undefined,
    private: options.private === true ? true : undefined
  }
}
