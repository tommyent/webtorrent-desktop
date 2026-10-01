#!/usr/bin/env node

// Fixes for dependency bugs that have no upstream release yet. Runs on npm
// install/ci (postinstall), so packaged builds ship them. A patch whose target
// text has changed fails the install, so a dependency upgrade gets rechecked.

const fs = require('fs')
const path = require('path')

const patches = [
  {
    // Two peers can deliver metadata at once, or the torrent can be destroyed
    // while it is parsed: recheck after the await (webtorrent-desktop-78v).
    file: 'webtorrent/lib/torrent.js',
    from: `        return this._destroy(err)
      }
    }

    this._processParsedTorrent(parsedTorrent)`,
    to: `        return this._destroy(err)
      }
    }
    if (this.metadata || this.destroyed) return

    this._processParsedTorrent(parsedTorrent)`
  },
  {
    // A socket error with no request pending was emitted with no listener, and
    // the throw skipped closing the socket (webtorrent-desktop-ah7).
    file: '@silentbot1/nat-api/lib/pmp/index.js',
    from: `    } else {
      this.emit('error', err)
    }`,
    to: `    } else if (this.listenerCount('error')) {
      this.emit('error', err)
    }`
  },
  {
    // Windows zips clear the output with rmdir, which throws for a missing path
    // on current Node, so a fresh Windows build never got its zip (webtorrent-desktop-c05).
    file: 'cross-zip/index.js',
    from: '    fs.rmdirSync(outPath, { recursive: true, maxRetries: 3 })',
    to: '    fs.rmSync(outPath, { recursive: true, force: true, maxRetries: 3 })'
  },
  {
    file: 'cross-zip/index.js',
    from: '      fs.rmdir(outPath, { recursive: true, maxRetries: 3 }, doZip2)',
    to: '      fs.rm(outPath, { recursive: true, force: true, maxRetries: 3 }, doZip2)'
  },
  {
    // Casting failed since the engine window got a Content-Security-Policy:
    // protobufjs builds its encoders with new Function, which script-src 'self'
    // blocks, so the first CONNECT was never sent and the device hung up
    // (webtorrent-desktop-8kw). CastMessage, the only message castv2's client
    // uses, is encoded with protobufjs's Reader/Writer (no generated code):
    // the same bytes and the same validation as the generated codec.
    file: 'castv2/lib/proto.js',
    from: `messages.forEach(function(message) {
  module.exports[message] = {`,
    to: `var wire = require('protobufjs/minimal');
var REQUIRED = ['protocolVersion', 'sourceId', 'destinationId', 'namespace', 'payloadType'];
var castMessage = {
  serialize: function(m) {
    var w = wire.Writer.create();
    w.uint32(8).int32(m.protocolVersion);
    w.uint32(18).string(m.sourceId);
    w.uint32(26).string(m.destinationId);
    w.uint32(34).string(m.namespace);
    w.uint32(40).int32(m.payloadType);
    if (m.payloadUtf8 != null) w.uint32(50).string(m.payloadUtf8);
    if (m.payloadBinary != null) w.uint32(58).bytes(m.payloadBinary);
    return Buffer.from(w.finish());
  },
  // Mirrors protobufjs's generated decoder for this schema: wire types are
  // checked, proto2 ignores unknown enum values, and required fields must appear
  parse: function(buf) {
    var r = wire.Reader.create(buf);
    var m = { payloadUtf8: '', payloadBinary: Buffer.alloc(0) };
    while (r.pos < r.len) {
      var tag = r.tag(), type = tag & 7, field = tag >>> 3, value;
      switch (field) {
        case 1: // protocol_version: CASTV2_1_0 = 0
          if (type !== 0) break;
          value = r.int32();
          if (value === 0) m.protocolVersion = value;
          continue;
        case 2: if (type !== 2) break; m.sourceId = r.string(); continue;
        case 3: if (type !== 2) break; m.destinationId = r.string(); continue;
        case 4: if (type !== 2) break; m.namespace = r.string(); continue;
        case 5: // payload_type: STRING = 0, BINARY = 1
          if (type !== 0) break;
          value = r.int32();
          if (value === 0 || value === 1) m.payloadType = value;
          continue;
        case 6: if (type !== 2) break; m.payloadUtf8 = r.string(); continue;
        case 7: if (type !== 2) break; m.payloadBinary = Buffer.from(r.bytes()); continue;
      }
      r.skipType(type, 0, field);
    }
    REQUIRED.forEach(function(name) {
      if (!Object.prototype.hasOwnProperty.call(m, name)) {
        throw wire.util.ProtocolError("missing required '" + name + "'", { instance: m });
      }
    });
    return m;
  }
};

messages.forEach(function(message) {
  if (message === 'CastMessage') {
    module.exports.CastMessage = castMessage;
    return;
  }
  module.exports[message] = {`
  },
  {
    // Cast devices showed their mDNS instance ID ("Google-TV-Streamer-1234...")
    // instead of their name (webtorrent-desktop-9xz). dns-packet gives each TXT
    // string without its length byte, and dns-txt expects one, so "fn=Kitchen"
    // was read as "n=Kitchen" and the name never applied.
    file: 'chromecasts/index.js',
    from: `        a.data.forEach((item) => {
          const decodedItem = txt.decode(item)
          Object.keys(decodedItem).forEach((key) => {
            text[key] = decodedItem[key]
          })
        })`,
    to: `        a.data.forEach((item) => {
          const entry = item.toString()
          const eq = entry.indexOf('=')
          if (eq > 0) text[entry.slice(0, eq)] = entry.slice(eq + 1)
        })`
  },
  {
    // The address (SRV) usually arrives before the name (TXT), so the player
    // already exists by then: keep a handle to rename it.
    file: 'chromecasts/index.js',
    from: `    player.host = cst.host

    player.client = function (cb) {`,
    to: `    player.host = cst.host
    cst.player = player

    player.client = function (cb) {`
  },
  {
    file: 'chromecasts/index.js',
    from: `        if (text.fn) {
          casts[name].name = text.fn
          emit(casts[name])`,
    to: `        if (text.fn) {
          casts[name].name = text.fn
          var known = casts[name].player
          if (known && known.name !== text.fn) {
            known.name = text.fn
            that.emit('update', known)
          }
          emit(casts[name])`
  }
]

// Returns source with `from` replaced by `to`, or unchanged if already patched.
// Anything but exactly one unpatched or one patched target means the file changed.
function patchSource (source, { file, from, to }) {
  // Some packages ship CRLF line endings
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  ;[from, to] = [from, to].map(text => text.replace(/\n/g, eol))
  const count = text => source.split(text).length - 1
  const [unpatched, patched] = [count(from), count(to)]
  if (unpatched === 0 && patched === 1) return source
  if (unpatched !== 1 || patched !== 0) {
    throw new Error(`patch-deps: ${file} changed; recheck its patch in bin/patch-deps.js`)
  }
  return source.replace(from, () => to)
}

if (require.main === module) {
  for (const patch of patches) {
    const target = path.join(__dirname, '..', 'node_modules', patch.file)
    const source = fs.readFileSync(target, 'utf8')
    const result = patchSource(source, patch)
    if (result === source) continue
    fs.writeFileSync(target, result)
    console.log('patch-deps: patched ' + patch.file)
  }
}

module.exports = patchSource
