// External player launch: a chosen Mac app gets the URL through `open -W -a`
// (IINA, QuickTime and others read URLs from open events, not argv); a plain
// binary still runs directly. Exit 0 returns to the list, anything else means
// the player couldn't open it.
const assert = require('node:assert/strict')
const cp = require('node:child_process')
const EventEmitter = require('node:events')
const path = require('node:path')

const dispatched = []
const stub = (name, exports) => {
  const file = require.resolve(path.join(__dirname, '..', 'src', 'main', name))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
stub('log', () => {})
stub('windows', { main: { dispatch: (...args) => dispatched.push(args[0]) } })
const spawned = []
cp.spawn = (command, args) => {
  const proc = new EventEmitter()
  proc.kill = () => {}
  spawned.push({ command, args, proc })
  return proc
}
const externalPlayer = require('../src/main/external-player')

const url = 'http://127.0.0.1:9/webtorrent/abc/a.mp4'
externalPlayer.spawn('/Applications/IINA.app', url, 'A')
const app = spawned.at(-1)
if (process.platform === 'darwin') {
  assert.equal(app.command, '/usr/bin/open')
  assert.deepEqual(app.args, ['-W', '-a', '/Applications/IINA.app', url])
} else {
  assert.equal(app.command, '/Applications/IINA.app')
}
app.proc.emit('close', 0)
assert.deepEqual(dispatched, ['backToList'], 'player quit: back to the list')

externalPlayer.spawn('/usr/local/bin/mpv', url, 'A')
assert.deepEqual(spawned.at(-1), { command: '/usr/local/bin/mpv', args: [url], proc: spawned.at(-1).proc })
spawned.at(-1).proc.emit('close', 1)
assert.deepEqual(dispatched, ['backToList', 'externalPlayerNotFound'])

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

console.log('External player regressions passed: Mac apps through open -W -a, binaries direct, exit codes, IINA default')
