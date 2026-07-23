class AppError extends Error {
  constructor (message) {
    super(message)
    this.name = this.constructor.name
  }
}

/* Generic errors */

class CastingError extends AppError {}
class PlaybackError extends AppError {}
class SoundError extends AppError {}
class TorrentError extends AppError {}

/* Playback */

class UnplayableTorrentError extends PlaybackError {
  constructor () { super('Can\'t play any files in torrent') }
}

class UnplayableFileError extends PlaybackError {
  constructor () { super('Can\'t play that file') }
}

/* Sound */

class InvalidSoundNameError extends SoundError {
  constructor (name) { super(`Invalid sound name: ${name}`) }
}

/* Torrent */

class TorrentKeyNotFoundError extends TorrentError {
  constructor (torrentKey) { super(`Can't resolve torrent key ${torrentKey}`) }
}

module.exports = {
  CastingError,
  PlaybackError,
  SoundError,
  TorrentError,
  UnplayableTorrentError,
  UnplayableFileError,
  InvalidSoundNameError,
  TorrentKeyNotFoundError
}
