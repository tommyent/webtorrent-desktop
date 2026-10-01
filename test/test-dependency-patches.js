// The dependency fixes in bin/patch-deps.js, checked against the installed code.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const load = file => import(pathToFileURL(path.join(__dirname, '..', 'node_modules', file)).href)

async function main () {
  // A torrent destroyed while its metadata is being parsed stops there.
  const { default: Torrent } = await load('webtorrent/lib/torrent.js')
  const torrent = {
    metadata: null,
    destroyed: false,
    _debug () {},
    _destroy (err) { throw err },
    _processParsedTorrent () { throw new Error('processed metadata for a destroyed torrent') }
  }
  const parsing = Torrent.prototype._onMetadata.call(torrent, fs.readFileSync(path.join(__dirname, 'resources', '1.torrent')))
  torrent.destroyed = true
  await parsing

  // A NAT-PMP socket error with no request pending closes the socket instead of throwing.
  const { default: NatPMP } = await load('@silentbot1/nat-api/lib/pmp/index.js')
  const client = new NatPMP('127.0.0.1')
  client.onError(new Error('recvmsg EHOSTUNREACH'))
  assert.equal(client.socket, null, 'socket closed')

  // A Windows zip with no old zip to clear (a fresh build) reaches the zip command.
  const cp = require('node:child_process')
  const os = require('node:os')
  const zip = require('cross-zip')
  const real = { platform: process.platform, execFileSync: cp.execFileSync, execFile: cp.execFile }
  const zipped = []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webtorrent-zip-'))
  Object.defineProperty(process, 'platform', { value: 'win32' })
  cp.execFileSync = command => zipped.push(command)
  cp.execFile = (command, args, opts, cb) => { zipped.push(command); cb(null) }
  try {
    zip.zipSync(dir, path.join(dir, 'missing-sync.zip'))
    await new Promise((resolve, reject) => zip.zip(dir, path.join(dir, 'missing-async.zip'), err => err ? reject(err) : resolve()))
  } finally {
    Object.defineProperty(process, 'platform', { value: real.platform })
    Object.assign(cp, { execFileSync: real.execFileSync, execFile: real.execFile })
    fs.rmSync(dir, { recursive: true })
  }
  assert.deepEqual(zipped, ['powershell.exe', 'powershell.exe'], 'both Windows zip paths ran')

  // Cast messages without generated code: the same bytes as protobufjs, read
  // both ways, and working where code generation is blocked (as the engine
  // window's Content-Security-Policy does).
  const { CastMessage } = require('castv2/lib/proto')
  const protobuf = require('protobufjs')
  const schema = await protobuf.load(path.join(path.dirname(require.resolve('castv2/lib/proto')), 'cast_channel.proto'))
  const Reflected = schema.lookupType('extensions.api.cast_channel.CastMessage')
  const samples = [
    { protocolVersion: 0, sourceId: 'sender-0', destinationId: 'receiver-0', namespace: 'urn:x-cast:com.google.cast.tp.connection', payloadType: 0, payloadUtf8: '{"type":"CONNECT","é":"✓"}' },
    { protocolVersion: 0, sourceId: 's', destinationId: 'd', namespace: 'urn:x-cast:binary', payloadType: 1, payloadBinary: Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256)) }
  ]
  for (const sample of samples) {
    const ours = CastMessage.serialize(sample)
    assert.deepEqual(ours, Buffer.from(Reflected.encode(sample).finish()), 'same bytes as protobufjs')
    const theirs = Reflected.toObject(Reflected.decode(ours), { bytes: Buffer })
    const parsed = CastMessage.parse(ours)
    for (const key of Object.keys(sample)) {
      assert.deepEqual(parsed[key], sample[key], 'parse ' + key)
      assert.deepEqual(Buffer.isBuffer(theirs[key]) ? Buffer.from(theirs[key]) : theirs[key], sample[key], 'protobufjs reads ' + key)
    }
  }
  // Odd and malformed input is read exactly as protobufjs's generated decoder
  // reads it: the same fields, or the same error
  const baseline = '08 00 12 01 61 1a 01 62 22 01 63 28 00 32 01 64'
  const fields = ['protocolVersion', 'sourceId', 'destinationId', 'namespace', 'payloadType', 'payloadUtf8']
  const decoded = (decode, hex) => {
    try {
      const message = decode(Buffer.from(hex.replace(/ /g, ''), 'hex'))
      return fields.map(key => message[key])
    } catch (err) { return err.message }
  }
  for (const [name, hex, accepted] of [
    ['truncated unknown fixed32', baseline + ' 45', false],
    ['truncated unknown fixed64', baseline + ' 41', false],
    ['missing required namespace', '08 00 12 01 61 1a 01 62 28 00 32 01 64', false],
    ['overlong varint', baseline + ' 28 80 80 80 80 80 80 80 80 80 80 00', false],
    ['valid unknown group', baseline + ' 43 48 01 44', true],
    ['field number zero', baseline + ' 00 00', false],
    ['illegal wire type on a known field', baseline + ' 0e 00', false],
    ['mismatched group end', baseline + ' 43 48 01 4c', false],
    ['overlong tag', baseline + ' c0 80 80 80 80 00 00', false],
    ['namespace with the wrong wire type', '08 00 12 01 61 1a 01 62 20 03 61 62 63 28 00 32 01 64', false],
    ['unknown protocol version after a valid one', baseline + ' 08 01', true],
    ['unknown payload type after a valid one', baseline + ' 28 02', true],
    ['only an unknown protocol version', '08 01 12 01 61 1a 01 62 22 01 63 28 00 32 01 64', false]
  ]) {
    const ours = decoded(CastMessage.parse, hex)
    const theirs = decoded(buf => Reflected.decode(buf), hex)
    assert.equal(Array.isArray(theirs), accepted, name + ' (protobufjs)')
    assert.deepEqual(ours, theirs, name)
    if (accepted) assert.deepEqual(ours, [0, 'a', 'b', 'c', 0, 'd'], name)
  }
  const strict = code => require('node:child_process').spawnSync(process.execPath,
    ['--disallow-code-generation-from-strings', '-e', code], { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
  const castSend = "const { CastMessage } = require('castv2/lib/proto'); const m = { protocolVersion: 0, sourceId: 'a', destinationId: 'b', namespace: 'c', payloadType: 0, payloadUtf8: 'd' }; if (CastMessage.parse(CastMessage.serialize(m)).payloadUtf8 !== 'd') process.exit(2)"
  assert.equal(strict(castSend).status, 0, 'cast messages work without code generation')
  const reflectedSend = "require('protobufjs').load(require.resolve('castv2/lib/cast_channel.proto')).then(root => root.lookupType('extensions.api.cast_channel.CastMessage').encode({ protocolVersion: 0, sourceId: 'a', destinationId: 'b', namespace: 'c', payloadType: 0 }))"
  assert.match(strict(reflectedSend).stderr, /EvalError/, 'control: protobufjs itself needs code generation')

  // A Chromecast whose address arrives before its name is shown by its name.
  // mDNS and SSDP are faked, so no sockets open.
  const castDir = path.dirname(require.resolve('chromecasts'))
  const fake = (name, exports) => {
    const file = require.resolve(name, { paths: [castDir] })
    require.cache[file] = { id: file, filename: file, loaded: true, exports }
  }
  const EventEmitter = require('node:events')
  const mdns = Object.assign(new EventEmitter(), { query () {}, destroy () {} })
  fake('multicast-dns', () => mdns)
  fake('node-ssdp', {})
  const finder = require('chromecasts')()
  const updates = []
  finder.on('update', player => updates.push(player.name))
  const instance = 'Google-TV-Streamer-1234._googlecast._tcp.local'
  mdns.emit('response', {
    additionals: [],
    answers: [
      { type: 'PTR', name: '_googlecast._tcp.local', data: instance },
      { type: 'SRV', name: instance, data: { target: 'tv-1234.local', port: 8009 } },
      { type: 'TXT', name: instance, data: [Buffer.from('fn=Kitchen TV')] }
    ]
  })
  assert.deepEqual(finder.players.map(p => [p.name, p.host]), [['Kitchen TV', 'tv-1234.local']])
  assert.deepEqual(updates, ['Google-TV-Streamer-1234', 'Kitchen TV'], 'renamed and announced again')

  // The patcher touches exactly one target, and refuses a file it can't be sure of.
  const patchSource = require('../bin/patch-deps')
  const patch = { file: 'x.js', from: 'a\nb', to: 'a\nc\nb' }
  assert.equal(patchSource('1\na\nb\n2', patch), '1\na\nc\nb\n2')
  assert.equal(patchSource('1\r\na\r\nb', patch), '1\r\na\r\nc\r\nb', 'CRLF')
  assert.equal(patchSource('a\nc\nb', patch), 'a\nc\nb', 'already patched')
  for (const source of ['a\nb a\nb', 'a\nb a\nc\nb', 'a\nc\nb a\nc\nb', 'a\r\nb a\r\nc\r\nb', 'neither']) {
    assert.throws(() => patchSource(source, patch), /x\.js changed/, JSON.stringify(source))
  }

  console.log('Dependency patches passed: metadata after destroy, NAT-PMP error without a request, Windows zip without an old zip, Chromecast names after addresses, cast messages without code generation, ambiguous targets refused')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
