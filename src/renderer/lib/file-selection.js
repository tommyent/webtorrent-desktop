// Which files of each torrent the user ticked. WebTorrent 3 calls a torrent
// done only when every file is complete, so the app tracks the ticked ones.
const ticked = new WeakMap()

// Download only the ticked files (all files when nothing was chosen)
function selectFiles (torrent, selections) {
  if (!selections) selections = torrent.files.map(() => true)
  if (selections.length !== torrent.files.length) {
    throw new Error('got ' + selections.length + ' file selections, ' +
      'but the torrent contains ' + torrent.files.length + ' files')
  }
  ticked.set(torrent, selections)

  // Clear every file range, then select the ticked files. WebTorrent 3
  // deselects by range, so deselecting an unticked file would also drop a
  // piece it shares with a ticked neighbour, which could then never finish.
  // Streaming selections are kept apart and survive this.
  torrent.deselect(0, torrent.pieces.length - 1)
  selections.forEach((selected, i) => {
    if (selected) torrent.files[i].select()
  })
}

// Every ticked file is complete but some unticked file isn't. (A complete
// torrent gets WebTorrent's own 'done'.)
function selectedFilesDone (torrent) {
  const selections = ticked.get(torrent)
  if (!selections || !selections.includes(true)) return false
  return torrent.files.some(file => !file.done) &&
    torrent.files.every((file, i) => file.done || !selections[i])
}

module.exports = { selectFiles, selectedFilesDone }
