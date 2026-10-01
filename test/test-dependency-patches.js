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

  // The patcher touches exactly one target, and refuses a file it can't be sure of.
  const patchSource = require('../bin/patch-deps')
  const patch = { file: 'x.js', from: 'a\nb', to: 'a\nc\nb' }
  assert.equal(patchSource('1\na\nb\n2', patch), '1\na\nc\nb\n2')
  assert.equal(patchSource('1\r\na\r\nb', patch), '1\r\na\r\nc\r\nb', 'CRLF')
  assert.equal(patchSource('a\nc\nb', patch), 'a\nc\nb', 'already patched')
  for (const source of ['a\nb a\nb', 'a\nb a\nc\nb', 'a\nc\nb a\nc\nb', 'a\r\nb a\r\nc\r\nb', 'neither']) {
    assert.throws(() => patchSource(source, patch), /x\.js changed/, JSON.stringify(source))
  }

  console.log('Dependency patches passed: metadata after destroy, NAT-PMP error without a request, ambiguous targets refused')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
