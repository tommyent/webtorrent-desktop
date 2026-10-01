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
