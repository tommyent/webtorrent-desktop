const assert = require('node:assert/strict')
const path = require('node:path')
process.env.NODE_ENV = 'test'

const { cleanTorrentName } = require('../src/renderer/lib/torrent-alias')

const cases = [
  // TV episodes and season packs
  ['Some.Show.S02E05.1080p.WEB.x264-GROUP', 'Some Show S2 E5'],
  ['Some.Show.S02E05.1080p.WEB-DL.DDP5.1.H.264-GROUP.mkv', 'Some Show S2 E5'],
  ['Some_Show_S01E01-E02_720p_HDTV_AAC2.0_x264-GROUP', 'Some Show S1 E1-E2'],
  ['Some.Show.S02.1080p.WEB-DL.DDP5.1.HEVC-GROUP', 'Some Show S2'],
  ['Another.Show.S10E12.2160p.AMZN.WEB-DL.DDP5.1.HDR.x265-GROUP', 'Another Show S10 E12'],

  // Films with a year
  ['Movie.Name.2019.2160p.UHD.BluRay.x265.HDR.Atmos-GROUP', 'Movie Name (2019)'],
  ['Movie Name (2019) [1080p] [WEBRip] [5.1] [YTS.MX]', 'Movie Name (2019)'],
  ['2001.A.Space.Odyssey.1968.1080p.BluRay.x264-GROUP', '2001 A Space Odyssey (1968)'],
  ['Blade.Runner.2049.2017.2160p.UHD.BluRay.x265-GROUP', 'Blade Runner 2049 (2017)'],

  // Software with a version & Linux ISOs / archives
  ['App.Name.v2.1.3.macOS', 'App Name v2.1.3 macOS'],
  ['Tool.Suite.2.10.4.x64', 'Tool Suite 2.10.4 x64'],
  ['Editor_v1.4.0_Linux_arm64', 'Editor v1.4.0 Linux arm64'],
  ['ubuntu-24.04.1-desktop-amd64.iso', 'ubuntu-24.04.1-desktop-amd64.iso'],
  ['debian-12.7.0-amd64-netinst.iso', 'debian-12.7.0-amd64-netinst.iso'],
  ['archlinux-2024.11.01-x86_64.iso', 'archlinux-2024.11.01-x86_64.iso'],
  ['fedora-41-aarch64.iso', 'fedora-41-aarch64.iso'],
  ['linux-6.12.tar.xz', 'linux-6.12.tar.xz'],

  // Documents and non-video files keep their extensions
  ['my.document.pdf', 'my document.pdf'],
  ['Final Report v2.docx', 'Final Report v2.docx'],
  ['Wikipedia_en_all_maxi_2024-01.zim', 'Wikipedia en all maxi 2024-01.zim'],
  ['Tears.of.Steel.2012.4K.mkv', 'Tears of Steel (2012)'],

  // Music albums
  ['Artist - Album Name (2020) [FLAC]', 'Artist - Album Name (2020)'],
  ['Artist.Name.-.Album.Name.2020.FLAC-GROUP', 'Artist Name - Album Name (2020)'],
  ['Band_Name_-_Live_Album_2018_[MP3 320]', 'Band Name - Live Album (2018)'],
  ['Album - Artist - 2020 - MP3 320kbps', 'Album - Artist - 2020'],

  // Names that must come out identical (samples, test fixtures, plain titles)
  ['m3.jpg', 'm3.jpg'],
  ['tmp.jpg', 'tmp.jpg'],
  ['sintel.mp4', 'sintel.mp4'],
  ['The WIRED CD - Rip. Sample. Mash. Share', 'The WIRED CD - Rip. Sample. Mash. Share'],
  ['Big Buck Bunny', 'Big Buck Bunny'],
  ['Cosmos Laundromat (Preview)', 'Cosmos Laundromat (Preview)'],
  ['Sintel', 'Sintel'],
  ['Tears of Steel', 'Tears of Steel'],
  ['Half-Life', 'Half-Life'],
  ['Half-Life 2', 'Half-Life 2'],

  // Fansub groups, multi-part audio tags, streaming sources, and hard names
  ['[SubsPlease] Sousou no Frieren - 12 (1080p) [ABCD1234].mkv', 'Sousou no Frieren - 12'],
  ['[Erai-raws] Spy x Family - 05 [1080p][Multiple Subtitle].mkv', 'Spy x Family - 05'],
  ['[Group] Show Title - 01 [ABCD1234].mkv', 'Show Title - 01'],
  ['[Artist] Ordinary Title', '[Artist] Ordinary Title'],
  ['Frieren.Beyond.Journeys.End.S01E12.Its.Been.a.While.1080p.CR.WEB-DL.AAC2.0.H.264-VARYG', 'Frieren Beyond Journeys End S1 E12 Its Been a While'],
  ["VA - Now That's What I Call Music! 115 (2023) Mp3 320kbps [PMEDIA]", "VA - Now That's What I Call Music! 115 (2023)"],
  ['The.Office.US.S05.COMPLETE.720p.AMZN.WEBRip.x264-GalaxyTV', 'The Office US S5'],
  ['Planet.Earth.II.2016.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWTYBLZ', 'Planet Earth II (2016)'],
  ['Oppenheimer (2023) [2160p] [4K] [WEB] [5.1] [YTS.MX]', 'Oppenheimer (2023)'],
  ['Avatar.The.Way.of.Water.2022.IMAX.2160p.DSNP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX', 'Avatar The Way of Water (2022)'],
  ['Die.Discounter.S03E01.GERMAN.1080p.WEB.H264-WAYNE', 'Die Discounter S3 E1 GERMAN'],
  ['Disc 1', 'Disc 1'],
  ['S01', 'S1'],
  ['Kurzgesagt.-.In.a.Nutshell.-.Collection', 'Kurzgesagt - In a Nutshell - Collection'],
  ['The.Last.of.Us.S01E03.Long.Long.Time.2160p.HMAX.WEB-DL.DDP5.1.Atmos.DV.H.265-FLUX', 'The Last of Us S1 E3 Long Long Time'],
  ['Severance.S02.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb', 'Severance S2'],
  ['MP3 Player Manual.pdf', 'MP3 Player Manual.pdf'],
  ['The.CR.Show.S01E01.1080p.WEB.x264-GRP', 'The CR Show S1 E1'],
  ['Honda CR-V Owners Manual 2019.pdf', 'Honda CR-V Owners Manual 2019.pdf']
]

for (const [input, expected] of cases) {
  assert.equal(cleanTorrentName(input), expected, `${JSON.stringify(input)} -> ${JSON.stringify(expected)}`)
}

// Controller, permissions, sorting, tooltip, and player title integration
global.window = {
  webtorrent: {
    path,
    config: { STATIC_PATH: __dirname, TORRENT_PATH: '/torrents', POSTER_PATH: '/posters' },
    player: { open () {}, close () {}, update () {} },
    torrent: {
      start () {},
      stop () {},
      saveFile () {},
      generatePoster () {},
      startServer () {},
      stopServer () {},
      onceReady () {},
      getAudioMetadata () {}
    },
    window: { setAspectRatio () {} }
  }
}

const { setDispatch } = require('../src/renderer/lib/dispatcher')
const dispatched = []
setDispatch(action => dispatched.push(action))

const TorrentController = require('../src/renderer/controllers/torrent-controller')
const TorrentListController = require('../src/renderer/controllers/torrent-list-controller')
const PlaybackController = require('../src/renderer/controllers/playback-controller')
const TorrentSummary = require('../src/renderer/lib/torrent-summary')
const permissions = require('../src/main/file-permissions')

const sample = {
  torrentKey: 1,
  infoHash: 'a'.repeat(40),
  name: 'Big Buck Bunny',
  displayName: 'Big Buck Bunny',
  status: 'paused',
  files: [{ name: 'bbb_sunflower_1080p_30fps_normal.mp4', path: 'bbb_sunflower_1080p_30fps_normal.mp4', length: 100 }]
}
const legacy = {
  torrentKey: 2,
  infoHash: 'b'.repeat(40),
  name: 'Legacy.Show.S01E01.720p.x264-OLD',
  status: 'paused',
  files: [{ name: 'Legacy.Show.S01E01.720p.x264-OLD.mkv', path: 'Legacy.Show.S01E01.720p.x264-OLD.mkv', length: 100 }]
}
const incoming = {
  torrentKey: 3,
  infoHash: 'c'.repeat(40),
  status: 'new'
}

const state = {
  saved: { prefs: { downloadPath: '/downloads', sortBy: 'name' }, torrents: [sample, legacy, incoming] },
  playing: require('../src/renderer/lib/state').getDefaultPlayState(),
  window: { title: 'WebTorrent' },
  removalSelection: [],
  location: { url: () => 'home', go: ({ setup }) => setup(() => {}) }
}

const torrents = new TorrentController(state)
const list = new TorrentListController(state)
const playback = new PlaybackController(state, {}, () => {}, { cancel () {} })

// 1. Metadata sets alias for a new torrent and preserves originalName
const rawRelease = 'Some.Show.S02E05.1080p.WEB.x264-GROUP'
const releaseInfo = {
  infoHash: incoming.infoHash,
  name: rawRelease,
  path: '/downloads',
  files: [{ name: rawRelease + '.mkv', path: rawRelease + '.mkv', length: 200 }]
}
permissions.initialize(state.saved)
permissions.recordTorrent(releaseInfo)
torrents.torrentMetadata(3, releaseInfo)
assert.equal(incoming.name, 'Some Show S2 E5')
assert.equal(incoming.originalName, rawRelease)
assert.equal(incoming.displayName, undefined)

// 2. Sample torrent (with displayName) and already-listed torrent (with files) keep their names
torrents.torrentMetadata(1, { ...sample, name: 'bbb_sunflower_1080p_30fps_normal.mp4' })
assert.equal(sample.name, 'Big Buck Bunny')
assert.equal(sample.originalName, 'bbb_sunflower_1080p_30fps_normal.mp4')
torrents.torrentMetadata(2, { ...legacy })
assert.equal(legacy.name, 'Legacy.Show.S01E01.720p.x264-OLD')

// 3. Rename sets custom alias; blank or reset restores originalName; validateSaved accepts the shape
list.confirmRenameTorrent(incoming.infoHash)
assert.deepEqual(state.modal, { id: 'rename-torrent-modal', infoHash: incoming.infoHash })
list.renameTorrent(incoming.infoHash, '  My Custom Show  ')
assert.equal(incoming.name, 'My Custom Show')
assert.equal(incoming.displayName, 'My Custom Show')
assert.equal(incoming.originalName, rawRelease)
permissions.validateSaved(state.saved)

// Name sort orders by alias ("Big Buck Bunny", "Legacy...", "My Custom Show")
assert.deepEqual(TorrentSummary.getDisplayOrder(state).map(t => t.torrentKey), [1, 2, 3])

// Tooltip shows originalName on list row when different; modal renders alias and original
const { renderToStaticMarkup } = require('react-dom/server')
const TorrentList = require('../build/renderer/pages/torrent-list-page')
const RenameTorrentModal = require('../build/renderer/components/rename-torrent-modal')
const rowMarkup = renderToStaticMarkup(new TorrentList({ state }).renderTorrentMetadata(incoming))
assert.ok(rowMarkup.includes('>My Custom Show</button>'))
assert.ok(rowMarkup.includes(`title="${rawRelease}"`))
const modalMarkup = renderToStaticMarkup(new RenameTorrentModal({ state }).render())
assert.ok(modalMarkup.includes('value="My Custom Show"'))
assert.ok(modalMarkup.includes(rawRelease))
assert.ok(modalMarkup.includes('Use original'))

// Single-file playback uses the alias for player and window title; multi-file uses file name
playback.openPlayer(incoming.infoHash, 0, () => {})
assert.equal(state.window.title, 'My Custom Show')
assert.equal(state.playing.fileName, 'My Custom Show')

const multi = {
  torrentKey: 4,
  infoHash: 'd'.repeat(40),
  name: 'Album Alias',
  originalName: 'Album.2020.FLAC',
  status: 'seeding',
  files: [{ name: '01 - Track.mp3', path: 'Album/01 - Track.mp3', length: 50 }, { name: '02 - Track.mp3', path: 'Album/02 - Track.mp3', length: 50 }]
}
permissions.recordTorrent(multi)
state.saved.torrents.push(multi)
playback.openPlayer(multi.infoHash, 0, () => {})
assert.equal(state.window.title, '01 - Track.mp3')
assert.equal(state.playing.fileName, '01 - Track.mp3')

// Blank rename restores torrent's own name and clears displayName
list.renameTorrent(incoming.infoHash, '   ')
assert.equal(incoming.name, rawRelease)
assert.equal(incoming.displayName, undefined)
const resetRowMarkup = renderToStaticMarkup(new TorrentList({ state }).renderTorrentMetadata(incoming))
assert.equal(resetRowMarkup.includes(`title="${rawRelease}"`), false, 'no tooltip when shown name matches original')
permissions.validateSaved(state.saved)

delete global.window
console.log('Torrent alias regressions passed: cleanup rules, metadata, rename/reset, tooltip, sort, player title, modal, validateSaved')
