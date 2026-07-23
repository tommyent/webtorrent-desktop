module.exports = {
  send
}

const electron = require('electron')
const os = require('os')

const config = require('../config')

async function send (data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Invalid telemetry payload')
  }

  data.screens = electron.screen.getAllDisplays().map(screen => ({
    width: screen.size.width,
    height: screen.size.height,
    scaleFactor: screen.scaleFactor
  }))
  data.system = {
    osPlatform: process.platform,
    osRelease: os.type() + ' ' + os.release(),
    architecture: os.arch(),
    systemArchitecture: process.arch,
    totalMemoryMB: roundPow2(os.totalmem() / (1 << 20)),
    numCores: os.cpus().length
  }

  const res = await electron.net.fetch(config.TELEMETRY_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(config.REQUEST_TIMEOUT)
  })
  return res.status
}

function roundPow2 (n) {
  if (n <= 0) return 0
  return 2 ** Math.round(Math.log(n) / Math.log(2))
}
