const { ipcRenderer } = require('electron')
const path = require('path')

const { dispatch } = require('../lib/dispatcher')

module.exports = class SubtitlesController {
  constructor (state) {
    this.state = state
  }

  openSubtitles () {
    const filenames = ipcRenderer.sendSync('showOpenDialogSync', {
      title: 'Select a subtitles file.',
      filters: [{ name: 'Subtitles', extensions: ['vtt', 'srt'] }],
      properties: ['openFile']
    })
    if (!Array.isArray(filenames)) return
    this.addSubtitles(filenames, true)
  }

  selectSubtitle (ix) {
    this.state.playing.subtitles.selectedIndex = ix
  }

  toggleSubtitlesMenu () {
    const subtitles = this.state.playing.subtitles
    subtitles.showMenu = !subtitles.showMenu
  }

  addSubtitles (files, autoSelect) {
    // Subtitles are only supported when playing video files
    if (this.state.playing.type !== 'video') return
    if (files.length === 0) return
    const subtitles = this.state.playing.subtitles
    const filePaths = files.map(file => file.path || file)

    ipcRenderer.invoke('readSubtitleFiles', filePaths)
      .then(subtitleFiles => Promise.all(subtitleFiles.map(
        ({ filePath, contents }) => loadSubtitle(filePath, contents)
      )))
      .then(tracks => {
        // No dupes allowed
        tracks.forEach((track, i) => {
          let trackIndex = subtitles.tracks.findIndex((t) =>
            track.filePath === t.filePath)

          // Add the track
          if (trackIndex === -1) {
            trackIndex = subtitles.tracks.push(track) - 1
          }

          // If we're auto-selecting a track, try to find one in the user's language
          if (autoSelect && (i === 0 || isSystemLanguage(track.language))) {
            subtitles.selectedIndex = trackIndex
          }
        })

        // Finally, make sure no two tracks have the same label
        relabelSubtitles(subtitles)
      })
      .catch(() => dispatch('error', 'Can\'t parse subtitles file.'))
  }

  checkForSubtitles () {
    if (this.state.playing.type !== 'video') return
    const torrentSummary = this.state.getPlayingTorrentSummary()
    if (!torrentSummary || !torrentSummary.progress) return

    torrentSummary.progress.files.forEach((fp, ix) => {
      if (fp.numPieces !== fp.numPiecesPresent) return // ignore incomplete files
      const file = torrentSummary.files[ix]
      if (!this.isSubtitle(file.name)) return
      const filePath = path.join(torrentSummary.path, file.path)
      this.addSubtitles([filePath], false)
    })
  }

  isSubtitle (file) {
    const name = typeof file === 'string' ? file : file.name
    const ext = path.extname(name).toLowerCase()
    return ext === '.srt' || ext === '.vtt'
  }
}

async function loadSubtitle (filePath, contents) {
  // Lazy load to keep startup fast
  const { buffer } = require('node:stream/consumers')
  const { Readable } = require('stream')
  const LanguageDetect = require('languagedetect')
  const srtToVtt = require('srt-to-vtt')

  // Parse the .SRT or .VTT contents and add a subtitle track.
  // A parse failure rejects; the caller reports it to the user.
  const buf = await buffer(Readable.from(contents).pipe(srtToVtt()))

  // Detect what language the subtitles are in
  const vttContents = buf.toString().replace(/(.*-->.*)/g, '')
  let langDetected = (new LanguageDetect()).detect(vttContents, 2)
  langDetected = langDetected.length ? langDetected[0][0] : 'subtitle'
  langDetected = langDetected.slice(0, 1).toUpperCase() + langDetected.slice(1)

  return {
    buffer: 'data:text/vtt;base64,' + buf.toString('base64'),
    language: langDetected,
    label: langDetected,
    filePath
  }
}

// Checks whether a language name like 'English' or 'German' matches the system
// language, aka the current locale
function isSystemLanguage (language) {
  const iso639 = require('iso-639-1')
  const osLangISO = window.navigator.language.split('-')[0] // eg 'en'
  const langIso = iso639.getCode(language) // eg 'de' if language is 'German'
  return langIso === osLangISO
}

// Make sure we don't have two subtitle tracks with the same label
// Labels each track by language, eg 'German', 'English', 'English 2', ...
function relabelSubtitles (subtitles) {
  const counts = {}
  subtitles.tracks.forEach(track => {
    const lang = track.language
    counts[lang] = (counts[lang] || 0) + 1
    track.label = counts[lang] > 1 ? (lang + ' ' + counts[lang]) : lang
  })
}
