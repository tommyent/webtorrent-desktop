// Preferences use MB/s, decimal like the app's speed display (1 MB = 1,000,000
// bytes); WebTorrent uses bytes/s and -1 for unlimited.
const MAX_MB = 100000

function toBytes (value = 0) {
  if (typeof value !== 'number' || !(value >= 0 && value <= MAX_MB)) {
    throw new RangeError('Bandwidth limits must be numbers from 0 to 100,000 MB/s')
  }
  return value === 0 ? -1 : Math.max(1, Math.round(value * 1e6))
}

// Development builds saved whole KiB/s. Keep those exact rates, up to the maximum.
function migrate (prefs) {
  for (const direction of ['download', 'upload']) {
    const kib = prefs[direction + 'LimitKiB']
    delete prefs[direction + 'LimitKiB']
    if (prefs[direction + 'LimitMB'] === undefined && Number.isSafeInteger(kib) && kib > 0) {
      prefs[direction + 'LimitMB'] = Math.min(MAX_MB, kib * 1024 / 1e6)
    }
  }
}

exports.MAX_MB = MAX_MB
exports.toBytes = toBytes
exports.migrate = migrate
exports.options = prefs => ({
  downloadLimit: toBytes(prefs.downloadLimitMB),
  uploadLimit: toBytes(prefs.uploadLimitMB)
})
