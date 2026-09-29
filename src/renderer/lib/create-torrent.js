const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')
const { promisify } = require('util')
const pieceLength = require('piece-length')

// Hash only the validated files, preserving their paths in the existing store.
// Open streams lazily so large selections don't exhaust file descriptors.
module.exports = async function createTorrent (options) {
  const { default: create } = await import('create-torrent')
  const input = options.files.map(file => {
    const stream = Readable.from((async function * () { yield * fs.createReadStream(file.path) })())
    stream.name = path.relative(options.path, file.path).split(path.sep).join('/')
    return stream
  })
  return promisify(create)(input, {
    ...options,
    filterJunkFiles: false,
    pieceLength: Math.min(pieceLength(options.files.reduce((sum, file) => sum + file.size, 0)), 4 * 1024 * 1024)
  })
}
