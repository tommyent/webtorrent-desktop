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

function spawn (playerPath, url, title, saved) {
  const token = new URL(url).searchParams.get('token')
  const filePath = completedFilePath(saved, url)
  url = filePath || url
  if (playerPath) return spawnExternal(playerPath, [url], token, !!filePath)

  // Try to find and use VLC if external player is not specified
  vlcCommand((err, vlcPath) => {
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

function completedFilePath (saved, mediaURL) {
  if (!saved?.torrents) return null
  const match = /^\/webtorrent\/([0-9a-f]{40})\/(.+)$/.exec(new URL(mediaURL).pathname)
  if (!match) return null
  const torrent = saved.torrents.find(t => t.completed && t.infoHash === match[1])
  const file = torrent?.files?.find(f => typeof f.path === 'string' &&
    f.path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/') === match[2])
  if (!file) return null

  try {
    const root = fs.realpathSync(torrent.path)
    const target = fs.realpathSync(path.resolve(root, file.path))
    const relative = path.relative(root, target)
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null
    const stat = fs.statSync(target)
    return stat.isFile() && stat.size === file.length ? target : null
  } catch { return null }
}

function kill () {
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
