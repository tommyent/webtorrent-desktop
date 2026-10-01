// A name for an audio track's menu entry. Tools that make video files fill an
// unnamed track's label with their own handler name ("GPAC ISO Audio Handler",
// "SoundHandler", "Core Media Audio"); show "Audio 2 (English)" instead.
const TOOL_LABEL = /handler|^core media audio$/i

module.exports = function audioTrackLabel (track, index) {
  const label = (track.label || '').trim()
  if (label && !TOOL_LABEL.test(label)) return label
  const language = languageName(track.language)
  return `Audio ${index + 1}` + (language ? ` (${language})` : '')
}

function languageName (code) {
  if (!code || code === 'und') return '' // undetermined
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code)
  } catch (err) {
    return code
  }
}
