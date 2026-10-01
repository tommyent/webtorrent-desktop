// Preferences use whole KiB/s; WebTorrent uses bytes/s and -1 for unlimited.
function toBytes (value = 0) {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value * 1024)) {
    throw new RangeError('Bandwidth limits must be non-negative whole numbers in KiB/s')
  }
  return value === 0 ? -1 : value * 1024
}

exports.toBytes = toBytes
exports.options = prefs => ({
  downloadLimit: toBytes(prefs.downloadLimitKiB),
  uploadLimit: toBytes(prefs.uploadLimitKiB)
})
