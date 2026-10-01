// The real Chromecast and AirPlay players (not the test devices), with the
// discovery libraries faked: this computer isn't offered as an AirPlay target,
// an AirPlay refusal (403) is explained, and a Chromecast failure names the
// device and logs one diagnosis per attempt.
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const os = require('node:os')
const util = require('node:util')

const stub = (name, exports) => {
  const file = require.resolve(name)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
const discovery = () => Object.assign(new EventEmitter(), { players: [] })
const airplay = discovery()
const chromecast = discovery()
stub('airplayer', () => airplay)
stub('chromecasts', () => chromecast)
stub('dlnacasts', () => discovery())

const Cast = require('../src/renderer/cast')

const logs = []
const log = console.log
console.log = (...args) => logs.push(util.format(...args))

// No real network: .invalid names don't resolve, others resolve to a
// documentation address whose TLS handshake is reset
const dns = require('node:dns')
const tls = require('node:tls')
dns.lookup = (host, opts, cb) => setImmediate(() => host.endsWith('.invalid')
  ? cb(Object.assign(new Error('getaddrinfo ENOTFOUND ' + host), { code: 'ENOTFOUND' }))
  : cb(null, [{ address: '192.0.2.7', family: 4 }]))
tls.connect = () => {
  const socket = Object.assign(new EventEmitter(), { destroy () {} })
  setImmediate(() => socket.emit('error', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })))
  return socket
}
async function until (what, test) {
  for (const end = Date.now() + 2000; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 5))) {
    if (test()) return
  }
  throw new Error('timed out waiting for ' + what)
}

async function main () {
  const state = {
    devices: {},
    errors: [],
    saved: { torrents: [{ infoHash: 'x', name: 'Movie' }] },
    server: { networkURL: 'http://192.168.1.2:9', filePaths: ['a.mp4'] }
  }
  const local = () => {
    state.playing = { location: 'local', infoHash: 'x', fileIndex: 0, currentTime: 0, subtitles: { tracks: [], selectedIndex: -1 } }
  }
  Cast.init(state, () => {})

  const device = (list, fields) => {
    const player = Object.assign(new EventEmitter(), { stop (cb) { if (cb) cb() } }, fields)
    list.players.push(player)
    list.emit('update', player)
    return player
  }
  const mini = device(airplay, {
    name: 'Mac mini',
    host: 'mini.local',
    play (url, cb) { cb(new Error('Unexpected response from Apple TV: 403')) }
  })
  device(airplay, { name: 'This Mac', host: os.hostname().toUpperCase() + '.' })
  assert.deepEqual(state.devices.airplay.getDevices(), [mini], 'this computer is not offered')

  local()
  state.devices.castMenu = { location: 'airplay', devices: [mini] }
  Cast.selectDevice(0)
  assert.equal(state.playing.location, 'local')
  assert.equal(state.errors.at(-1).message,
    "Mac mini refused AirPlay (403). Its AirPlay settings may allow only its own Apple Account or require a password, which WebTorrent can't provide.")

  // A failed connection reaches the player as an 'error' event and a play
  // callback error, in either order: one message naming the device, one diagnosis
  const tls = () => Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' })
  const errorFirst = device(chromecast, {
    name: 'Living Room TV',
    host: 'living-room.invalid',
    play (url, opts, cb) { const err = tls(); this.emit('error', err); cb(err) }
  })
  const callbackFirst = device(chromecast, {
    name: 'Bedroom TV',
    host: 'bedroom.local',
    play (url, opts, cb) { const err = tls(); cb(err); this.emit('error', err) }
  })
  const diagnoses = [
    [errorFirst, 'cast: living-room.invalid does not resolve: ENOTFOUND'],
    [callbackFirst, 'cast: TLS check 192.0.2.7:8009 failed: ECONNRESET socket hang up']
  ]
  for (const [tv, lastLog] of diagnoses) {
    const errors = state.errors.length
    const diagnosed = logs.filter(line => line.includes('failed after')).length
    local()
    state.devices.castMenu = { location: 'chromecast', devices: [tv] }
    Cast.selectDevice(0)
    await until('diagnosis of ' + tv.name, () => logs.includes(lastLog))
    assert.equal(state.playing.location, 'local')
    assert.deepEqual(state.errors.slice(errors).map(e => e.message),
      [`Could not connect to ${tv.name}. Client network socket disconnected before secure TLS connection was established`], tv.name)
    assert.equal(logs.filter(line => line.includes('failed after')).length, diagnosed + 1, 'diagnosed once per attempt: ' + tv.name)
    assert.ok(logs.some(line => line.startsWith(`cast: connecting to ${tv.name} at ${tv.host}`)))
  }

  console.log = log
  console.log('Cast device regressions passed: this computer hidden from AirPlay, AirPlay 403 explained, Chromecast errors name the device and diagnose once')
  process.exit(0)
}

main().catch(err => {
  console.log = log
  console.error(err)
  process.exit(1)
})
