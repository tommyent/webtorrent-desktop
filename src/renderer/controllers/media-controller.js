const api = require('../lib/api')
const telemetry = require('../lib/telemetry')
const Playlist = require('../lib/playlist')

// Controls local play back: the <video>/<audio> tag and VLC
// Does not control remote casting (Chromecast etc)
module.exports = class MediaController {
  constructor (state) {
    this.state = state
  }

  mediaSuccess () {
    telemetry.logPlayAttempt('success')
  }

  mediaStalled () {
    this.state.playing.isStalled = true
  }

  mediaError (error) {
    const state = this.state
    if (state.location.url() === 'player') {
      telemetry.logPlayAttempt('error')
      state.playing.location = 'error'
      api.externalPlayer.check(state.saved.prefs.externalPlayerPath)
        .then(isInstalled => {
          state.modal = {
            id: 'unsupported-media-modal',
            error,
            externalPlayerInstalled: isInstalled
          }
        })
    }
  }

  mediaTimeUpdate () {
    this.state.playing.lastTimeUpdate = new Date().getTime()
    this.state.playing.isStalled = false
  }

  mediaMouseMoved () {
    this.state.playing.mouseStationarySince = new Date().getTime()
  }

  controlsMouseEnter () {
    this.state.playing.mouseInControls = true
    this.state.playing.mouseStationarySince = new Date().getTime()
  }

  controlsMouseLeave () {
    this.state.playing.mouseInControls = false
    this.state.playing.mouseStationarySince = new Date().getTime()
  }

  openExternalPlayer () {
    const state = this.state
    state.playing.location = 'external'

    const onServerRunning = () => {
      state.playing.isReady = true
      telemetry.logPlayAttempt('external')

      const mediaURL = Playlist.getCurrentLocalURL(state)
      api.externalPlayer.open(
        state.saved.prefs.externalPlayerPath,
        mediaURL,
        state.window.title)
    }

    if (state.server != null) onServerRunning()
    else api.torrent.onceServerRunning(onServerRunning)
  }

  externalPlayerNotFound () {
    const modal = this.state.modal
    if (modal && modal.id === 'unsupported-media-modal') {
      modal.externalPlayerNotFound = true
    }
  }
}
