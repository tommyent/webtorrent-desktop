const config = require('../config')
const Cast = require('./cast')

module.exports = class CastEngine {
  constructor ({ getTorrent, getServerInfo, send }) {
    this.getTorrent = getTorrent
    this.getServerInfo = getServerInfo
    this.send = send
    this.initialized = false
    this.revision = 0
    this.previousDevices = ''
    this.deviceRefs = new Map()
    this.sessionCounter = 0
    this.activeSession = null
    this.errorCount = 0
    this.state = {
      devices: {},
      errors: [],
      playing: defaultPlayingState(),
      saved: { torrents: [] },
      server: null
    }
  }

  handle (envelope) {
    if (!envelope || typeof envelope !== 'object' ||
        typeof envelope.requestId !== 'string' ||
        typeof envelope.action !== 'string' ||
        !envelope.payload || typeof envelope.payload !== 'object') return

    Promise.resolve()
      .then(() => this.run(envelope.action, envelope.payload, envelope.requestId))
      .catch(err => this.emitError(envelope.requestId, err))
  }

  async run (action, payload, requestId) {
    if (action === 'scan') {
      this.scan(payload)
    } else if (action === 'start') {
      await this.start(payload, requestId)
    } else if (action === 'control') {
      this.control(payload)
    } else if (action === 'stop') {
      this.stop(payload)
    } else {
      throw new TypeError(`Unknown cast action: ${action}`)
    }
  }

  scan (payload) {
    if (typeof payload.enabled !== 'boolean') {
      throw new TypeError('Invalid cast scan command')
    }
    if (!payload.enabled || this.initialized) return

    this.initialized = true
    Cast.init(this.state, () => this.onCastUpdate())
    this.emitDevices()
  }

  async start (payload, requestId) {
    if (!this.initialized) throw new Error('Casting discovery is not running')
    if (this.activeSession) throw new Error('A cast session is already active')
    const invalidSubtitle = payload.subtitle != null &&
      (!payload.subtitle || typeof payload.subtitle.buffer !== 'string' ||
       !payload.subtitle.buffer.startsWith('data:text/vtt;base64,'))
    if (typeof payload.deviceId !== 'string' ||
        !Number.isInteger(payload.torrentKey) ||
        !Number.isInteger(payload.fileIndex) || payload.fileIndex < 0 ||
        (payload.isPaused !== undefined && typeof payload.isPaused !== 'boolean') ||
        (payload.currentTime !== undefined &&
         (!Number.isFinite(payload.currentTime) || payload.currentTime < 0)) ||
        (payload.volume !== undefined &&
         (!Number.isFinite(payload.volume) || payload.volume < 0 || payload.volume > 1)) ||
        (payload.playbackRate !== undefined &&
         (!Number.isFinite(payload.playbackRate) ||
          payload.playbackRate < 0.25 || payload.playbackRate > 16)) ||
        invalidSubtitle) {
      throw new TypeError('Invalid cast start command')
    }

    const deviceRef = this.deviceRefs.get(payload.deviceId)
    if (!deviceRef) throw new Error('Casting device is no longer available')

    const torrent = this.getTorrent(payload.torrentKey)
    if (!torrent.files[payload.fileIndex]) throw new RangeError('Invalid cast file index')
    const server = await this.getServerInfo(torrent)

    const sessionId = `cast-session-${++this.sessionCounter}`
    this.activeSession = { sessionId, deviceId: payload.deviceId, requestId }
    this.state.saved.torrents = [{ infoHash: torrent.infoHash, name: torrent.name }]
    this.state.server = server
    this.state.playing = Object.assign(defaultPlayingState(), {
      infoHash: torrent.infoHash,
      fileIndex: payload.fileIndex,
      isPaused: typeof payload.isPaused === 'boolean' ? payload.isPaused : true,
      currentTime: Number.isFinite(payload.currentTime) ? payload.currentTime : 0,
      volume: Number.isFinite(payload.volume) ? payload.volume : 1,
      playbackRate: Number.isFinite(payload.playbackRate) ? payload.playbackRate : 1,
      subtitles: {
        tracks: payload.subtitle ? [{ buffer: payload.subtitle.buffer }] : [],
        selectedIndex: payload.subtitle ? 0 : -1
      }
    })
    this.state.devices.castMenu = {
      location: deviceRef.protocol,
      devices: [deviceRef.device]
    }

    Cast.selectDevice(0)
  }

  control (payload) {
    this.validateSession(payload.sessionId)
    const command = payload.command

    if (command === 'play' || command === 'pause') {
      if (payload.value !== undefined) throw new TypeError('Unexpected cast control value')
      Cast[command]()
    } else if (command === 'seek') {
      if (!Number.isFinite(payload.value) || payload.value < 0) {
        throw new RangeError('Invalid cast seek value')
      }
      Cast.seek(payload.value)
    } else if (command === 'volume') {
      if (!Number.isFinite(payload.value) || payload.value < 0 || payload.value > 1) {
        throw new RangeError('Invalid cast volume value')
      }
      Cast.setVolume(payload.value)
    } else if (command === 'rate') {
      if (!Number.isFinite(payload.value) || payload.value < 0.25 || payload.value > 16) {
        throw new RangeError('Invalid cast rate value')
      }
      Cast.setRate(payload.value)
    } else {
      throw new TypeError(`Unknown cast control: ${command}`)
    }
  }

  stop (payload) {
    this.validateSession(payload.sessionId)
    Cast.stop()
  }

  validateSession (sessionId) {
    if (!this.activeSession || sessionId !== this.activeSession.sessionId) {
      throw new Error('Unknown or stale cast session')
    }
  }

  onCastUpdate () {
    this.emitDevices()
    this.emitErrors()
    this.emitSession()
  }

  emitDevices () {
    const refs = new Map()
    const devices = []

    for (const protocol of ['chromecast', 'airplay', 'dlna']) {
      const player = this.state.devices[protocol]
      if (!player) continue
      player.getDevices().forEach(device => {
        const identity = device.host || (config.IS_TEST && device.name)
        if (!identity) return
        const id = `${protocol}:${identity}`
        refs.set(id, { protocol, device })
        devices.push({ id, protocol, name: device.name })
      })
    }

    const serialized = JSON.stringify(devices)
    this.deviceRefs = refs
    if (serialized === this.previousDevices) return
    this.previousDevices = serialized
    this.send({
      type: 'devices',
      payload: { revision: ++this.revision, devices }
    })
  }

  emitErrors () {
    while (this.errorCount < this.state.errors.length) {
      const error = this.state.errors[this.errorCount++]
      this.send({
        type: 'error',
        payload: {
          requestId: this.activeSession && this.activeSession.requestId,
          sessionId: this.activeSession && this.activeSession.sessionId,
          code: 'CAST_ERROR',
          message: error.message,
          recoverable: true
        }
      })
    }
  }

  emitSession () {
    if (!this.activeSession) return

    const location = this.state.playing.location
    const state = location.endsWith('-pending')
      ? 'connecting'
      : location === 'local'
        ? 'stopped'
        : this.state.playing.isPaused
          ? 'paused'
          : 'playing'
    const payload = {
      sessionId: this.activeSession.sessionId,
      deviceId: this.activeSession.deviceId,
      state,
      currentTime: this.state.playing.currentTime,
      volume: this.state.playing.volume,
      playbackRate: this.state.playing.playbackRate
    }
    this.send({ type: 'session', payload })
    if (state === 'stopped') this.activeSession = null
  }

  emitError (requestId, err) {
    this.send({
      type: 'error',
      payload: {
        requestId,
        sessionId: this.activeSession && this.activeSession.sessionId,
        code: err instanceof TypeError || err instanceof RangeError
          ? 'INVALID_COMMAND'
          : 'CAST_ERROR',
        message: err.message,
        recoverable: true
      }
    })
  }
}

function defaultPlayingState () {
  return {
    castName: null,
    currentTime: 0,
    fileIndex: null,
    infoHash: null,
    isPaused: true,
    location: 'local',
    playbackRate: 1,
    subtitles: { tracks: [], selectedIndex: -1 },
    volume: 1
  }
}
