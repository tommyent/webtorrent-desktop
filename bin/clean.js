#!/usr/bin/env node

/**
 * Remove all traces of WebTorrent Desktop from the system (config and temp files).
 * Useful for developers.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const config = require('../src/config')
const handlers = require('../src/main/handlers')

// First, remove generated files
fs.rmSync('build/', { recursive: true, force: true })
fs.rmSync('dist/', { recursive: true, force: true })

// Remove any saved configuration
fs.rmSync(config.CONFIG_PATH, {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 100
})

// Remove any temporary files
let tmpPath
try {
  tmpPath = path.join(fs.statSync('/tmp') && '/tmp', 'webtorrent')
} catch (err) {
  tmpPath = path.join(os.tmpdir(), 'webtorrent')
}
fs.rmSync(tmpPath, { recursive: true, force: true })

// Uninstall .torrent file and magnet link handlers
handlers.uninstall()
