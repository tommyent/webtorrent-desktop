// Checks a torrent ID from the UI before it reaches WebTorrent.
//
// WebTorrent copies a parsed torrent onto its torrent object with
// Object.assign, so the ID must be a string (a parsed object could carry its
// own path and files), and a magnet link may only keep the parameters the
// magnet parser understands: it copies every other query key onto the object
// too, so `&path=` would replace the download folder and `&on=` would break
// the torrent's events.
//
// so= (select only) is left out on purpose: the app selects files itself once
// a torrent is ready, and the parser expands its ranges into an array up
// front, so a short so=0-4000000000 could exhaust the engine's memory.
const MAGNET_KEYS = new Set(['xt', 'dn', 'tr', 'ws', 'as', 'xs', 'kt', 'x.pe'])

module.exports = function checkTorrentId (torrentId) {
  if (typeof torrentId !== 'string') throw new TypeError('Invalid torrent ID')
  // WebTorrent parses stream-magnet: links as magnets too.
  if (!/^(stream-)?magnet:/i.test(torrentId)) return torrentId
  const query = torrentId.slice(torrentId.indexOf('?') + 1)
  const params = query.split('&').filter(param => MAGNET_KEYS.has(param.split('=')[0]))
  // The parser takes any 40 characters after urn:btih: as the info hash, which
  // later names a file, so accept only a real v1 hash (40 hex or 32 base32).
  // Check everything after the prefix, so a stray character such as a line
  // break fails the check instead of skipping it.
  for (const param of params) {
    if (/^xt=urn:btih:/i.test(param) && !/^([0-9a-f]{40}|[a-z2-7]{32})$/i.test(param.slice('xt=urn:btih:'.length))) {
      throw new TypeError('Invalid magnet link')
    }
  }
  return 'magnet:?' + params.join('&')
}
