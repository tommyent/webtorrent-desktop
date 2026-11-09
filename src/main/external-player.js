module.exports = {
  spawn,
  kill,
  checkInstall
}

const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const vlcCommand = require('vlc-command')

const log = require('./log')
const windows = require('./windows')

const processes = new Map()

function checkInstall (playerPath, cb) {
  // check for VLC if external player has not been specified by the user
  // otherwise assume the player is installed
  if (!playerPath) return vlcCommand(cb)
  process.nextTick(() => cb(null))
}

// Bumped by kill(), so a launch still waiting (for the disk, or for VLC to be
// found) when playback was abandoned doesn't open a player afterwards
let kills = 0

function spawn (playerPath, url, title, saved) {
  const token = new URL(url).searchParams.get('token')
  const generation = kills
  const completed = completedFile(saved, url)
  // Only a finished file needs a look at the disk; a stream launches right away
  if (!completed) return launch(null)
  return fileOnDisk(completed).then(launch)

  function launch (filePath) {
    if (generation !== kills) return windows.webtorrent.send('wt-release-external-server', token)
    url = filePath || url
    if (playerPath) return spawnExternal(playerPath, [url], token, !!filePath)

    // Try to find and use VLC if external player is not specified
    vlcCommand((err, vlcPath) => {
      if (generation !== kills) return windows.webtorrent.send('wt-release-external-server', token)
      if (err) {
        windows.webtorrent.send('wt-release-external-server', token)
        return windows.main.dispatch('externalPlayerExited', token, 1)
      }
      const args = [
        '--play-and-exit',
        '--quiet',
        `--meta-title=${JSON.stringify(title)}`,
        url
      ]
      spawnExternal(vlcPath, args, token, !!filePath)
    })
  }
}

// The finished torrent and file a stream URL points at, if any
function completedFile (saved, mediaURL) {
  if (!saved?.torrents) return null
  const match = /^\/webtorrent\/([0-9a-f]{40})\/(.+)$/.exec(new URL(mediaURL).pathname)
  if (!match) return null
  const torrent = saved.torrents.find(t => t.completed && t.infoHash === match[1])
  const file = torrent?.files?.find(f => typeof f.path === 'string' &&
    f.path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/') === match[2])
  return file ? { torrent, file } : null
}

// Its path on disk, or null (the player then gets the stream) when the file
// isn't there in full, lies outside the download folder, or the drive doesn't
// answer within 3 seconds. Async, so a slow drive can't freeze the app.
// A check that timed out is still waiting on the drive and holds one of the
// process's few file threads, so a download folder gets one check at a time:
// until it really ends, further launches from that folder get the stream.
const checking = new Set()

function fileOnDisk ({ torrent, file }) {
  if (checking.has(torrent.path)) return Promise.resolve(null)
  checking.add(torrent.path)
  const check = (async () => {
    const root = await fs.promises.realpath(torrent.path)
    const target = await fs.promises.realpath(path.resolve(root, file.path))
    const relative = path.relative(root, target)
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null
    const stat = await fs.promises.stat(target)
    return stat.isFile() && stat.size === file.length ? target : null
  })().catch(() => null).finally(() => checking.delete(torrent.path))
  let timer
  const late = new Promise(resolve => { timer = setTimeout(resolve, 3000, null) })
  return Promise.race([check, late]).finally(() => clearTimeout(timer))
}

function kill () {
  kills++
  for (const [child, token] of processes) {
    log(`Killing external player, pid ${child.pid}`)
    processes.delete(child)
    child.kill('SIGKILL')
    windows.webtorrent.send('wt-release-external-server', token)
  }
}

function spawnExternal (playerPath, args, token, filePath) {
  if (process.platform === 'darwin' && path.extname(playerPath) === '.app') {
    // Mac: hand the URL to the app through Launch Services. Most players (IINA,
    // QuickTime) take URLs from open events rather than argv, and this reuses a
    // copy that is already running. -W waits until the app quits.
    args = ['-W', '-a', playerPath, ...args]
    playerPath = '/usr/bin/open'
  }
  log('Running external media player:', `${playerPath} ${args.join(' ')}`)

  const child = cp.spawn(playerPath, args, { stdio: 'ignore' })
  processes.set(child, token)
  if (filePath) windows.webtorrent.send('wt-release-external-server', token)

  // If it works, close the modal after a second
  const closeModalTimeout = setTimeout(() =>
    windows.main.dispatch('externalPlayerModalClosed', token), 1000)

  child.on('close', code => {
    clearTimeout(closeModalTimeout)
    if (!processes.delete(child)) return // Killed
    windows.webtorrent.send('wt-release-external-server', token)
    log('External player exited with code ', code)
    windows.main.dispatch('externalPlayerExited', token, code)
  })

  child.on('error', err => {
    log('External player error', err)
  })
}
