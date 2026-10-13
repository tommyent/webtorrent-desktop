const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const parent = {}
const dialogs = []
let respond = async () => ({ response: 0 })
const stub = (name, exports) => {
  const file = require.resolve(name)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
stub('electron', {
  dialog: {
    showMessageBox: async (window, options) => {
      assert.equal(window, parent)
      dialogs.push(options)
      return respond()
    }
  }
})
stub('../src/main/windows', { main: { win: parent } })
const dataPath = require('../src/main/data-path')

async function main () {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webtorrent-trash-'))
  const folder = path.join(root, 'Show')
  const files = ['Show/one.mkv', 'Show/extras/two.mkv']
  const torrent = { infoHash: 'a'.repeat(40), name: 'Show', path: root, files: files.map(path => ({ path })) }
  const write = async () => {
    await fs.mkdir(path.join(folder, 'extras'), { recursive: true })
    for (const file of files) await fs.writeFile(path.join(root, file), 'torrent data')
  }
  dataPath.setTorrentsAccessor(() => [torrent])
  const trashError = new Error('The volume PlexFiles1 does not have a Trash')
  const failTrash = async () => { throw trashError }
  try {
    await write()
    assert.equal(await dataPath.trashTorrentData(torrent.infoHash, failTrash), false, 'Cancel keeps the torrent')
    for (const file of files) assert.equal(await fs.readFile(path.join(root, file), 'utf8'), 'torrent data')
    assert.equal(dialogs.length, 1, 'one prompt per torrent')
    assert.deepEqual(dialogs[0].buttons, ['Cancel', 'Delete Permanently'])
    assert.equal(dialogs[0].defaultId, 0)
    assert.equal(dialogs[0].cancelId, 0)
    assert.match(dialogs[0].message, /Show/)
    assert.match(dialogs[0].detail, /PlexFiles1/)
    assert.match(dialogs[0].detail, /cannot be undone/)
    assert(dialogs[0].detail.includes(root), 'confirmation identifies the download folder')

    // The folder was empty of unrelated files when Trash was attempted, but
    // another file can appear while the user decides. Never delete it recursively.
    respond = async () => {
      await fs.writeFile(path.join(folder, 'notes.txt'), 'keep me')
      return { response: 1 }
    }
    assert.equal(await dataPath.trashTorrentData(torrent.infoHash, failTrash), true)
    for (const file of files) await assert.rejects(fs.stat(path.join(root, file)), { code: 'ENOENT' })
    assert.equal(await fs.readFile(path.join(folder, 'notes.txt'), 'utf8'), 'keep me')
    await assert.rejects(fs.stat(path.join(folder, 'extras')), { code: 'ENOENT' })

    // A successful Trash operation never asks for permanent deletion.
    await write()
    const before = dialogs.length
    const trashed = []
    assert.equal(await dataPath.trashTorrentData(torrent.infoHash, async file => {
      trashed.push(file)
      await fs.unlink(file)
    }), true)
    assert.deepEqual(trashed, files.map(file => path.join(root, file)))
    assert.equal(dialogs.length, before)

    // Some files may have reached the Trash before another fails.
    await write()
    let attempts = 0
    respond = async () => ({ response: 1 })
    assert.equal(await dataPath.trashTorrentData(torrent.infoHash, async file => {
      if (++attempts === 2) throw trashError
      await fs.unlink(file)
    }), true)
    assert.equal(dialogs.length, before + 1)
    assert.equal(await fs.readFile(path.join(folder, 'notes.txt'), 'utf8'), 'keep me')

    // Recheck the path guard after the dialog, and refuse a directory where a
    // file was expected rather than recursively removing its contents.
    await write()
    respond = async () => {
      await fs.unlink(path.join(root, files[0]))
      await fs.symlink(path.join(folder, 'notes.txt'), path.join(root, files[0]))
      return { response: 1 }
    }
    await assert.rejects(dataPath.trashTorrentData(torrent.infoHash, failTrash), /known torrent data/)
    assert.equal(await fs.readFile(path.join(folder, 'notes.txt'), 'utf8'), 'keep me')
    await fs.unlink(path.join(root, files[0]))
    await fs.mkdir(path.join(root, files[0]))
    await fs.writeFile(path.join(root, files[0], 'unrelated.txt'), 'keep this too')
    respond = async () => ({ response: 1 })
    await assert.rejects(dataPath.trashTorrentData(torrent.infoHash, failTrash))
    assert.equal(await fs.readFile(path.join(root, files[0], 'unrelated.txt'), 'utf8'), 'keep this too')
    assert.equal(await fs.readFile(path.join(root, files[1]), 'utf8'), 'torrent data', 'deletion stops on failure')

    // Unknown torrents and inspection failures must not offer permanent deletion.
    const prompts = dialogs.length
    await assert.rejects(dataPath.trashTorrentData('b'.repeat(40), failTrash), /known torrent/)
    const lstat = fs.lstat
    fs.lstat = async () => { throw new Error('volume disconnected') }
    try {
      await assert.rejects(dataPath.trashTorrentData(torrent.infoHash, failTrash), /volume disconnected/)
    } finally {
      fs.lstat = lstat
    }
    assert.equal(dialogs.length, prompts)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
  console.log('Trash fallback passed: native confirmation, Cancel, permanent deletion, partial Trash success, unrelated files, symlinks and deletion failures')
}

main().catch(err => { console.error(err); process.exitCode = 1 })
