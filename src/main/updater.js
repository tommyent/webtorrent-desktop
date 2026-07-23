module.exports = {
  init
}

const { autoUpdater, net } = require('electron')

const config = require('../config')
const log = require('./log')
const windows = require('./windows')

const AUTO_UPDATE_URL = config.AUTO_UPDATE_URL +
  '?version=' + config.APP_VERSION +
  '&platform=' + process.platform +
  '&sysarch=' + config.OS_SYSARCH

function init () {
  if (process.platform === 'linux') {
    initLinux()
  } else {
    initDarwinWin32()
  }
}

// The Electron auto-updater does not support Linux yet, so manually check for
// updates and show the user a modal notification.
async function initLinux () {
  try {
    const res = await net.fetch(AUTO_UPDATE_URL, {
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT)
    })
    await onResponse(res)
  } catch (err) {
    log(`Update error: ${err.message}`)
  }
}

async function onResponse (res) {
  if (res.status === 200) {
    // Update available
    let data
    try {
      data = JSON.parse(await res.text())
    } catch (err) {
      return log(`Update error: Invalid JSON response: ${err.message}`)
    }
    windows.main.dispatch('updateAvailable', data.version)
  } else if (res.status === 204) {
    // No update available
  } else {
    // Unexpected status code
    log(`Update error: Unexpected status code: ${res.status}`)
  }
}

function initDarwinWin32 () {
  autoUpdater.on(
    'error',
    (err) => log.error(`Update error: ${err.message}`)
  )

  autoUpdater.on(
    'checking-for-update',
    () => log('Checking for update')
  )

  autoUpdater.on(
    'update-available',
    () => log('Update available')
  )

  autoUpdater.on(
    'update-not-available',
    () => log('No update available')
  )

  autoUpdater.on(
    'update-downloaded',
    (e, notes, name, date, url) => log(`Update downloaded: ${name}: ${url}`)
  )

  autoUpdater.setFeedURL({ url: AUTO_UPDATE_URL })
  autoUpdater.checkForUpdates()
}
