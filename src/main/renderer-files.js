const fs = require('fs/promises')
const path = require('path')

const config = require('../config')

module.exports = {
  checkDownloadPath,
  copyTorrentFile,
  deleteTorrentMetadata,
  inspectCreateInput,
  pathExists
}

async function checkDownloadPath (filePath) {
  assertPath(filePath)
  try {
    return (await fs.stat(filePath)).isDirectory()
  } catch (err) {
    return false
  }
}

async function pathExists (filePath) {
  assertPath(filePath)
  try {
    await fs.stat(filePath)
    return true
  } catch (err) {
    return false
  }
}

async function inspectCreateInput (inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.some(filePath => typeof filePath !== 'string')) {
    throw new TypeError('Invalid create-torrent paths')
  }

  const batches = await Promise.all(inputPaths.map(async filePath => {
    const stat = await fs.stat(filePath)
    if (!stat.isDirectory()) {
      return [{ name: path.basename(filePath), path: filePath, size: stat.size }]
    }

    const names = await fs.readdir(filePath)
    return inspectCreateInput(names.map(name => path.join(filePath, name)))
  }))

  return batches.flat().sort((a, b) => a.path < b.path ? -1 : Number(a.path > b.path))
}

function copyTorrentFile (source, destination) {
  assertPath(destination)
  assertMetadataPath(config.TORRENT_PATH, source)
  return fs.copyFile(source, destination)
}

function deleteTorrentMetadata (torrentFileName, posterFileName) {
  const paths = [
    metadataPath(config.TORRENT_PATH, torrentFileName),
    metadataPath(config.POSTER_PATH, posterFileName)
  ].filter(Boolean)
  return Promise.all(paths.map(filePath => fs.unlink(filePath)))
}

function metadataPath (directory, fileName) {
  if (!fileName) return null
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName) {
    throw new TypeError('Invalid metadata file name')
  }
  return path.join(directory, fileName)
}

function assertMetadataPath (directory, filePath) {
  assertPath(filePath)
  const relative = path.relative(directory, filePath)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)) {
    throw new TypeError('Invalid torrent metadata path')
  }
}

function assertPath (filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('Invalid file path')
  }
}
