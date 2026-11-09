// External player launch: a chosen Mac app gets the media source through
// `open -W -a`; a plain binary runs directly. Each process releases its own
// stream when it exits, including after WebTorrent returns to the list.
const assert = require('node:assert/strict')
const cp = require('node:child_process')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const dispatched = []
const released = []
const stub = (name, exports) => {
  const file = require.resolve(path.join(__dirname, '..', 'src', 'main', name))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
stub('log', () => {})
stub('windows', {
  main: { dispatch: (...args) => dispatched.push(args) },
  webtorrent: { send: (...args) => released.push(args) }
})
const spawned = []
cp.spawn = (command, args) => {
  const proc = new EventEmitter()
  proc.kill = () => {}
  spawned.push({ command, args, proc })
  return proc
}
const externalPlayer = require('../src/main/external-player')

const url = 'http://127.0.0.1:9/webtorrent/abc/a.mp4?token=first'
externalPlayer.spawn('/Applications/IINA.app', url, 'A')
const app = spawned.at(-1)
if (process.platform === 'darwin') {
  assert.equal(app.command, '/usr/bin/open')
  assert.deepEqual(app.args, ['-W', '-a', '/Applications/IINA.app', url])
} else {
  assert.equal(app.command, '/Applications/IINA.app')
}
app.proc.emit('close', 0)
assert.deepEqual(dispatched, [['externalPlayerExited', 'first', 0]], 'player exit identifies its stream')
assert.deepEqual(released, [['wt-release-external-server', 'first']])

externalPlayer.spawn('/usr/local/bin/mpv', url, 'A')
assert.deepEqual(spawned.at(-1), { command: '/usr/local/bin/mpv', args: [url], proc: spawned.at(-1).proc })
spawned.at(-1).proc.emit('close', 1)
assert.deepEqual(dispatched.at(-1), ['externalPlayerExited', 'first', 1])

const secondURL = 'http://127.0.0.1:9/webtorrent/abc/b.mp4?token=second'
externalPlayer.spawn('/Applications/IINA.app', url, 'A')
const first = spawned.at(-1).proc
externalPlayer.spawn('/Applications/IINA.app', secondURL, 'B')
const second = spawned.at(-1).proc
first.emit('close', 0)
second.emit('close', 0)
assert.deepEqual(dispatched.slice(-2), [
  ['externalPlayerExited', 'first', 0],
  ['externalPlayerExited', 'second', 0]
], 'older window exiting does not replace the newer playback')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webtorrent-player-'))
async function diskChecks () {
  try {
    const downloads = path.join(dir, 'downloads')
    fs.mkdirSync(downloads)
    const file = path.join(downloads, 'a file.mp4')
    fs.writeFileSync(file, 'video')
    const hash = 'a'.repeat(40)
    const stream = `http://127.0.0.1:9/webtorrent/${hash}/a%20file.mp4?token=example`
    const torrent = { infoHash: hash, completed: true, path: downloads, files: [{ path: 'a file.mp4', length: 5 }] }
    await externalPlayer.spawn('/Applications/IINA.app', stream, 'A', { torrents: [torrent] })
    assert.equal(spawned.at(-1).args.at(-1), fs.realpathSync.native(file), 'completed file opens from disk')
    assert.deepEqual(released.at(-1), ['wt-release-external-server', 'example'], 'disk handoff releases stream')
    spawned.at(-1).proc.emit('close', 0)

    externalPlayer.spawn('/Applications/IINA.app', stream, 'A', { torrents: [{ ...torrent, completed: false }] })
    assert.equal(spawned.at(-1).args.at(-1), stream, 'incomplete file keeps the stream')
    spawned.at(-1).proc.emit('close', 0)

    if (process.platform !== 'win32') {
      const outside = path.join(dir, 'outside.mp4')
      fs.writeFileSync(outside, 'video')
      fs.symlinkSync(outside, path.join(downloads, 'escape.mp4'))
      const escaped = { ...torrent, files: [{ path: 'escape.mp4', length: 5 }] }
      const escapeURL = `http://127.0.0.1:9/webtorrent/${hash}/escape.mp4?token=example`
      await externalPlayer.spawn('/Applications/IINA.app', escapeURL, 'A', { torrents: [escaped] })
      assert.equal(spawned.at(-1).args.at(-1), escapeURL, 'symlink outside the download folder keeps the stream')
      spawned.at(-1).proc.emit('close', 0)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// No player chosen: IINA becomes the default only on a Mac with IINA and without VLC.
const { defaultExternalPlayer } = require('../src/main/state')
const installed = apps => file => apps.includes(file)
const chosen = (prefs, apps, platform = 'darwin') => {
  defaultExternalPlayer(prefs, installed(apps), platform)
  return prefs.externalPlayerPath
}
assert.equal(chosen({ externalPlayerPath: '' }, ['/Applications/IINA.app']), '/Applications/IINA.app')
assert.equal(chosen({ externalPlayerPath: '' }, ['/Applications/IINA.app', '/Applications/VLC.app']), '')
assert.equal(chosen({ externalPlayerPath: '/Applications/mpv.app' }, ['/Applications/IINA.app']), '/Applications/mpv.app')
assert.equal(chosen({ externalPlayerPath: '' }, ['/Applications/IINA.app'], 'linux'), '')

diskChecks().then(() => console.log('External player regressions passed: completed files, stream release, concurrent players, path containment, Mac apps, exit codes, IINA default'))
  .catch(err => { console.error(err); process.exitCode = 1 })
