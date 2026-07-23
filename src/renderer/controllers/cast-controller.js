const { ipcRenderer } = require('electron')

const { CastingError } = require('../lib/errors')

module.exports = class CastController {
  constructor (state, update) {
    this.state = state
    this.update = update
    this.revision = -1
    this.requestCounter = 0
    this.sessionId = null
    this.deviceId = null
  }

  scan (enabled) {
    this.send('scan', { enabled })
  }

  toggleMenu (protocol) {
    const devices = this.getDevices(protocol)
    const castMenu = this.state.devices.castMenu

    if (castMenu && castMenu.location === protocol) {
      this.state.devices.castMenu = null
      return
    }
    if (this.state.playing.location !== 'local') {
      throw new CastingError(
        `You can't connect to ${protocol} when already connected to another device`
      )
    }
    if (devices.length === 0) {
      throw new CastingError(`No ${protocol} devices available`)
    }

    this.state.devices.castMenu = { location: protocol, devices }
  }

  selectDevice (index) {
    const castMenu = this.state.devices.castMenu
    const device = castMenu && castMenu.devices[index]
    if (!device) throw new CastingError('Casting device is no longer available')

    const torrent = this.state.getPlayingTorrentSummary()
    const subtitles = this.state.playing.subtitles
    const subtitle = subtitles.tracks[subtitles.selectedIndex]

    this.state.devices.castMenu = null
    this.send('start', {
      isPaused: this.state.playing.isPaused,
      deviceId: device.id,
      torrentKey: torrent.torrentKey,
      fileIndex: this.state.playing.fileIndex,
      currentTime: this.state.playing.currentTime,
      volume: this.state.playing.volume,
      playbackRate: this.state.playing.playbackRate,
      subtitle: subtitle ? { buffer: subtitle.buffer } : null
    })
  }

  stop () {
    if (!this.sessionId) return
    this.send('stop', { sessionId: this.sessionId })
  }

  play () {
    this.control('play')
  }

  pause () {
    this.control('pause')
  }

  seek (time) {
    this.control('seek', time)
  }

  setVolume (volume) {
    this.control('volume', volume)
  }

  setRate (rate) {
    const device = this.getDevice(this.deviceId)
    if (!device || device.protocol !== 'airplay') return false
    this.control('rate', rate)
    return true
  }

  onEvent (envelope) {
    if (!envelope || typeof envelope !== 'object') return

    if (envelope.type === 'devices') {
      this.onDevices(envelope.payload)
    } else if (envelope.type === 'session') {
      this.onSession(envelope.payload)
    } else if (envelope.type === 'error') {
      this.onError(envelope.payload)
    }
  }

  onDevices (payload) {
    if (!payload || !Number.isInteger(payload.revision) ||
        payload.revision <= this.revision || !Array.isArray(payload.devices)) return

    this.revision = payload.revision
    this.state.devices.revision = payload.revision
    this.state.devices.items = payload.devices
    this.update()
  }

  onSession (payload) {
    if (!payload || typeof payload.sessionId !== 'string' ||
        typeof payload.deviceId !== 'string') return

    const device = this.getDevice(payload.deviceId)
    if (!device) return

    this.sessionId = payload.state === 'stopped' ? null : payload.sessionId
    this.deviceId = payload.state === 'stopped' ? null : payload.deviceId
    this.state.devices.session = payload.state === 'stopped' ? null : payload
    this.state.playing.castName = device.name

    if (payload.state === 'connecting') {
      this.state.playing.location = device.protocol + '-pending'
    } else if (payload.state === 'playing' || payload.state === 'paused') {
      this.state.playing.location = device.protocol
      this.state.playing.isPaused = payload.state === 'paused'
    } else if (payload.state === 'stopped') {
      this.state.playing.location = 'local'
      this.state.playing.jumpToTime = Number.isFinite(payload.currentTime)
        ? payload.currentTime
        : 0
    } else {
      return
    }

    if (Number.isFinite(payload.currentTime)) {
      this.state.playing.currentTime = payload.currentTime
    }
    if (Number.isFinite(payload.volume)) {
      this.state.playing.volume = payload.volume
    }
    if (Number.isFinite(payload.playbackRate)) {
      this.state.playing.playbackRate = payload.playbackRate
    }
    this.update()
  }

  onError (payload) {
    if (!payload || typeof payload.message !== 'string') return
    this.state.errors.push({
      time: new Date().getTime(),
      message: payload.message
    })
    this.update()
  }

  control (command, value) {
    if (!this.sessionId) return
    const payload = { sessionId: this.sessionId, command }
    if (value !== undefined) payload.value = value
    this.send('control', payload)
  }

  send (action, payload) {
    ipcRenderer.send('wt-cast-command', {
      requestId: `cast-${Date.now()}-${++this.requestCounter}`,
      action,
      payload
    })
  }

  getDevices (protocol) {
    return (this.state.devices.items || []).filter(device => device.protocol === protocol)
  }

  getDevice (deviceId) {
    return (this.state.devices.items || []).find(device => device.id === deviceId)
  }
}
