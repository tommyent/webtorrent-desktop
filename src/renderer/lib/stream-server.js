const http = require('http')
const { randomBytes } = require('crypto')

// A single WebTorrent server stays on loopback. Opaque, revocable grants allow
// only file URLs; directory listings and unauthorised origins never reach it.
module.exports = class StreamServer {
  constructor (client) {
    this.grants = new Map()
    this.server = client.createServer({ origin: 'null' }, 'node')
    const handle = this.server.wrapRequest.bind(this.server)
    this.server.wrapRequest = (req, res) => {
      const host = '127.0.0.1:' + this.server.address().port
      const url = new URL(req.url, 'http://' + host)
      const grant = this.grants.get(url.searchParams.get('token'))
      if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== 'null') ||
          !grant || !grant.paths.has(url.pathname) || !['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(403).end()
        return
      }
      grant.responses.add(res)
      res.once('close', () => grant.responses.delete(res))
      handle(req, res)
    }
    this.ready = new Promise((resolve, reject) => {
      this.server.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => resolve(this.server.address().port))
    })
  }

  async grant (torrent, fileIndex) {
    const port = await this.ready
    const token = randomBytes(32).toString('hex')
    const files = torrent.files.map(file => file.path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/'))
    const paths = new Set(files.filter((file, index) => fileIndex === undefined || index === fileIndex)
      .map(file => '/webtorrent/' + torrent.infoHash + '/' + file))
    const responses = new Set()
    this.grants.set(token, { paths, responses })
    return {
      torrentKey: torrent.key,
      localURL: 'http://127.0.0.1:' + port + '/webtorrent/' + torrent.infoHash,
      filePaths: files.map(file => file + '?token=' + token),
      token,
      release: () => {
        this.grants.delete(token)
        for (const response of responses) response.destroy()
      },
      baseURL: 'http://127.0.0.1:' + port
    }
  }

  async cast (torrent, fileIndex, address) {
    const grant = await this.grant(torrent, fileIndex)
    const proxy = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      if (req.headers.host !== address + ':' + proxy.address().port ||
          url.searchParams.get('token') !== grant.token ||
          !this.grants.get(grant.token)?.paths.has(url.pathname) ||
          !['GET', 'HEAD'].includes(req.method)) return res.writeHead(403).end()
      const upstream = http.request(grant.baseURL + req.url, {
        method: req.method, headers: { range: req.headers.range || '' }
      }, response => {
        res.writeHead(response.statusCode, { ...response.headers, 'access-control-allow-origin': '*' })
        response.pipe(res)
      })
      upstream.on('error', () => res.destroy())
      res.on('close', () => upstream.destroy())
      upstream.end()
    })
    await new Promise((resolve, reject) => {
      proxy.once('error', reject)
      proxy.listen(0, address, resolve)
    })
    return {
      ...grant,
      networkAddress: address,
      networkURL: 'http://' + address + ':' + proxy.address().port + '/webtorrent/' + torrent.infoHash,
      release: () => { grant.release(); proxy.close(); proxy.closeAllConnections() }
    }
  }
}
