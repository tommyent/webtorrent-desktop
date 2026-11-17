// Turns release-style torrent names into readable display aliases.
// Plain names and titles without scene markers are returned unchanged.

const CONTAINER_EXT = /\.(mkv|mp4|avi|mov|m4v|wmv|flv|webm|ts|m2ts)$/i
const KEEP_EXT = /(\.tar\.(?:gz|bz2|xz|zst)|\.[a-z][a-z0-9]{1,4})$/i
const PRESERVED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
  '.iso', '.img', '.dmg', '.pkg', '.exe', '.msi', '.deb', '.rpm', '.apk', '.appimage', '.zim',
  '.zip', '.rar', '.7z', '.gz', '.bz2', '.xz', '.zst', '.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav',
  '.srt', '.vtt', '.ass', '.nfo'
])
const PLAIN_FILENAME = /^[A-Za-z0-9-]+\.[A-Za-z0-9]{2,5}$/

const UNAMBIGUOUS_TAG = /\b(?:480p|576p|720p|1080[pi]|2160p|4320p|WEB-DL|WEBRip|WEB-Rip|HDRip|BDRip|BRRip|BluRay|Blu-Ray|BDRemux|DVDRip|HDTV|PDTV|SDTV|DVDSCR|x264|x265|H\.?264|H\.?265|HEVC|XviD|DivX|10bit|8bit|HDR10\+?|DoVi|DDP?(?:\s*[257]\.[01])?|EAC3|AC3|DTS-HD(?:\s*MA)?|TrueHD|Atmos|AAC(?:\s*[257]\.[01])?|320kbps)(?:-[A-Za-z0-9]+)?\b/gi
const CONTEXT_TAG = /\b(?:WEB|UHD|4K|8K|HDR|SDR|DV|REMUX|AVC|AV1|VP9|AMZN|NF|DSNP|ATVP|HMAX|HULU|PCOK|FLAC|MP3|DTS|V0|Opus|LPCM|PROPER|REPACK|INTERNAL)(?:-[A-Za-z0-9]+)?\b/g
const BRACKET_TAG_CONTENT = /(?:480p|576p|720p|1080[pi]|2160p|4320p|4K|UHD|WEB|BluRay|Blu-Ray|HDRip|BDRip|BRRip|DVDRip|HDTV|x264|x265|H\.?264|H\.?265|HEVC|AV1|XviD|AAC|AC3|DTS|DDP?|Atmos|FLAC|MP3|320kbps|V0|YTS|RARBG|10bit|HDR|[257]\.1|2\.0)/i

function cleanTorrentName (raw) {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed || PLAIN_FILENAME.test(trimmed)) return trimmed

  let name = trimmed.replace(CONTAINER_EXT, '')
  let changed = name !== trimmed

  // Keep non-video file extensions intact while cleaning the stem.
  let keptExt = ''
  if (!changed) {
    const extMatch = name.match(KEEP_EXT)
    if (extMatch && PRESERVED_EXT.has(extMatch[1].toLowerCase())) {
      keptExt = extMatch[1]
      name = name.slice(0, -keptExt.length)
    }
  }

  // Normalize bracketed years like [2019] -> (2019), then drop release/group brackets.
  name = name.replace(/\[((?:19|20)\d{2})\]/g, '($1)')
  name = name.replace(/\[([^\]]+)\]/g, (match, inner) => {
    if (BRACKET_TAG_CONTENT.test(inner)) {
      changed = true
      return ''
    }
    return match
  })
  // Trailing single-token bracketed release group, e.g. [GROUP]
  name = name.replace(/\s*\[[^\]\s]+\]\s*$/, () => {
    changed = true
    return ''
  })

  // Collapse H.264 / H.265 dots before dot-to-space conversion.
  name = name.replace(/\b([hx])\.(26[45])\b/gi, '$1$2')

  // Convert underscores (except x86_64 / x86_32) and dots between words to spaces.
  const spaced = name
    .replace(/(?<!\bx86)_/gi, ' ')
    .replace(/(?<=\bS\d+(?:E\d+)?)\.(?=\d)/gi, ' ')
    .replace(/\.(?=(?:\d{3,4}[pi]|[48]K|(?:19|20)\d{2})\b)/gi, ' ')
    .replace(/(?<=[A-Za-z0-9-])\.(?=[A-Za-z])|(?<=[A-Za-z])\.(?=[A-Za-z0-9-])/g, ' ')
  if (spaced !== name) {
    changed = true
    name = spaced
  }

  // Drop trailing -GROUP only when a release tag or episode marker is present.
  const hasReleaseContext = /\bS0*\d+(?:\s*E0*\d+)?\b/i.test(name) ||
    UNAMBIGUOUS_TAG.test(name) || CONTEXT_TAG.test(name)
  UNAMBIGUOUS_TAG.lastIndex = 0
  CONTEXT_TAG.lastIndex = 0
  if (hasReleaseContext) {
    name = name.replace(/(?<!\s)-(?!E\d+\s*$)[A-Za-z0-9]+(?=\s*$)/i, '')
  }

  // Format TV episodes (S02E05 -> S2 E5) and zero-padded season packs (S02 -> S2).
  let hasEpisode = false
  name = name.replace(/\bS0*(\d+)\s*E0*(\d+)(?:\s*-\s*E0*(\d+))?\b/gi, (_, s, e1, e2) => {
    hasEpisode = true
    changed = true
    return `S${Number(s)} E${Number(e1)}` + (e2 ? `-E${Number(e2)}` : '')
  })
  name = name.replace(/\bS0+(\d+)\b/gi, (_, s) => {
    hasEpisode = true
    changed = true
    return `S${Number(s)}`
  })

  // Strip unambiguous release tags first; strip context-sensitive tags when
  // uppercase or accompanied by other release markers.
  let hasTag = false
  name = name.replace(UNAMBIGUOUS_TAG, () => {
    hasTag = true
    changed = true
    return ' '
  })
  if (hasTag || hasEpisode || changed) {
    name = name.replace(CONTEXT_TAG, () => {
      hasTag = true
      changed = true
      return ' '
    })
  }

  name = name.replace(/\(\s*\)/g, '').replace(/\s+-\s*$/, '').replace(/\s{2,}/g, ' ').trim()

  // Wrap trailing film year (19xx/20xx) when not at start and not after a dash.
  if (changed) {
    name = name.replace(/(?<=[^\s-])\s+((?:19|20)\d{2})$/, ' ($1)')
  }

  const result = (name || trimmed) + keptExt
  return result || trimmed
}

module.exports = { cleanTorrentName }
