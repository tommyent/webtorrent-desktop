module.exports = {
  open
}

const { clipboard, Menu } = require('electron')

const windows = require('./windows')

function open (info) {
  if (!info || typeof info.infoHash !== 'string') return

  const main = windows.main
  const template = [
    {
      label: 'Remove From List',
      click: () => main.dispatch('confirmDeleteTorrent', info.infoHash, false)
    },
    {
      label: 'Remove Data File',
      click: () => main.dispatch('confirmDeleteTorrent', info.infoHash, true)
    },
    { type: 'separator' }
  ]
  if (info.fileOrFolder) {
    template.push(
      {
        label: process.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder',
        click: () => require('./shell').showItemInFolder(info.fileOrFolder)
      },
      { type: 'separator' }
    )
  }
  template.push(
    {
      label: 'Copy Magnet Link to Clipboard',
      click: () => clipboard.writeText(info.magnetURI)
    },
    {
      label: 'Copy Instant.io Link to Clipboard',
      click: () => clipboard.writeText(`https://instant.io/#${info.infoHash}`)
    },
    {
      label: 'Save Torrent File As...',
      click: () => main.dispatch('saveTorrentFileAs', info.torrentKey),
      enabled: info.torrentFileName != null
    },
    { type: 'separator' },
    {
      label: `${info.sortedByName ? '✓ ' : ''}Sort by Name`,
      click: () => main.dispatch('updatePreferences', 'sortByName', !info.sortedByName)
    }
  )
  Menu.buildFromTemplate(template).popup({ window: main.win })
}
