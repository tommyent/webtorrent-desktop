module.exports = {
  init
}

const { dialog, net } = require('electron')

const config = require('../config')
const log = require('./log')

const ANNOUNCEMENT_URL =
  `${config.ANNOUNCEMENT_URL}?version=${config.APP_VERSION}&platform=${process.platform}`

/**
 * In certain situations, the WebTorrent team may need to show an announcement to
 * all WebTorrent Desktop users. For example: a security notice, or an update
 * notification (if the auto-updater stops working).
 *
 * When there is an announcement, the `ANNOUNCEMENT_URL` endpoint should return an
 * HTTP 200 status code with a JSON object like this:
 *
 *   {
 *     "title": "WebTorrent Desktop Announcement",
 *     "message": "Security Issue in v0.xx",
 *     "detail": "Please update to v0.xx as soon as possible..."
 *   }
 */
async function init () {
  try {
    const res = await net.fetch(ANNOUNCEMENT_URL, {
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT)
    })
    if (res.status === 204) return log('No announcement available')
    if (res.status !== 200) {
      return log(`Failed to retrieve announcement: Unexpected status code: ${res.status}`)
    }
    onResponse(await res.text())
  } catch (err) {
    log(`Failed to retrieve announcement: ${err.message}`)
  }
}

function onResponse (data) {
  try {
    data = JSON.parse(data.toString())
  } catch (err) {
    // Support plaintext announcement messages, using a default title.
    data = {
      title: 'WebTorrent Desktop Announcement',
      message: data.toString(),
      detail: data.toString()
    }
  }

  dialog.showMessageBox({
    type: 'info',
    buttons: ['OK'],
    title: data.title,
    message: data.message,
    detail: data.detail
  })
}
