// Path helpers for code that runs on every redraw. api.path.* is a blocking
// call to the main process, which is too slow per file and per torrent.
const api = require('./api')

// sep is the platform's path separator; tests pass '\\' to check Windows rules
function create (sep) {
  const windows = sep === '\\'
  const separators = windows ? /[\\/]+/ : /\/+/

  // Same result as path.extname
  function extname (name) {
    if (windows) name = name.replace(/^[a-zA-Z]:/, '') // a drive letter is not part of the name
    const base = name.split(separators).filter(Boolean).pop() || ''
    const dot = base.lastIndexOf('.')
    return dot > 0 && base !== '..' ? base.slice(dot) : ''
  }

  // Joins a native folder path and one name inside it (no '..' or '.' handling)
  function join (dir, name) {
    return dir.endsWith(sep) ? dir + name : dir + sep + name
  }

  return { extname, join }
}

module.exports = { ...create(api.path.sep), create }
