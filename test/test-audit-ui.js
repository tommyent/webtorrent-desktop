const assert = require('node:assert/strict')
const path = require('node:path')
const { _electron: electron } = require('playwright')

async function main () {
  require('./setup').resetTestDataDir()
  const executablePath = process.argv[2]
  const app = await electron.launch({
    executablePath,
    args: executablePath ? ['--test'] : [path.join(__dirname, '..'), '--test'],
    env: { ...process.env, NODE_ENV: 'test' }
  })
  const errors = []
  app.on('window', page => page.on('pageerror', err => errors.push(err.message)))
  try {
    let page, engine
    for (let i = 0; i < 150 && (!page || !engine); i++) {
      for (const window of app.windows()) {
        if (await window.title() === 'Main Window') page = window
        if (await window.title() === 'WebTorrent Hidden Window') engine = window
      }
      if (!page || !engine) await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(page && engine)
    page.setDefaultTimeout(15000)
    engine.setDefaultTimeout(15000)
    console.log('Audit UI: windows ready')
    await page.locator('.header').waitFor()
    await engine.evaluate(() => window.testOfflineMode())
    await assert.rejects(page.evaluate(async () => {
      const saved = await window.webtorrent.state.load()
      saved.prefs.externalPlayerPath = '/bin/sh'
      await window.webtorrent.state.save(saved)
    }), /native dialog/)
    await assert.rejects(page.evaluate(() => window.webtorrent.torrent.copyFile('/tmp/arbitrary', '/tmp/arbitrary-export')), /destination/)
    await assert.rejects(page.evaluate(dir => window.webtorrent.torrent.inspectCreateInput([dir]), require('node:os').homedir()), /native dialog/)
    await assert.rejects(page.evaluate(() => window.webtorrent.torrent.trashData('0'.repeat(40))), /known torrent/)

    // Dialog selection is stubbed in the main process, just as a user's native
    // selection would be; the renderer must receive a real permission grant.
    console.log('Audit UI: permission checks passed')
    const file = path.join(__dirname, 'resources', 'monitor-test.mp4')
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialogSync = () => [file] }, file)
    // A pick for another purpose, here the download folder, doesn't allow seeding.
    await page.evaluate(() => window.webtorrent.dialogs.showOpen('downloadPath'))
    await assert.rejects(page.evaluate(file => window.webtorrent.torrent.inspectCreateInput([file]), file), /native dialog/)
    await page.evaluate(() => window.webtorrent.dialogs.openFiles())
    await page.waitForFunction(() => window.state.location.url() === 'create-torrent')
    await page.evaluate(() => window.dispatch('backToList'))
    await page.evaluate(file => window.webtorrent.torrent.create(991, {
      files: [{ path: file }], name: 'monitor-test.mp4', announce: []
    }), file)
    await engine.waitForFunction(() => window.client.torrents.some(t => t.key === 991 && t.ready))
    console.log('Audit UI: fixture seeded')
    const hash = await engine.evaluate(() => window.client.torrents.find(t => t.key === 991).infoHash)
    await page.waitForFunction(hash => window.state.saved.torrents.some(t => t.infoHash === hash && t.files), hash)
    await page.evaluate(hash => window.dispatch('playFile', hash, 0), hash)
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0)
    console.log('Audit UI: playback started')
    const pause = page.getByRole('button', { name: 'Pause', exact: true })
    await pause.focus()
    await pause.press('Space')
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Mute', exact: true }).press('Enter')
    assert.equal(await page.getByRole('slider', { name: 'Volume' }).inputValue(), '0')
    await page.evaluate(() => window.dispatch('backToList'))
    assert.equal(await page.evaluate(() => navigator.mediaSession.metadata), null)
    for (const name of ['Start streaming', 'Remove torrent']) {
      assert(await page.getByRole('button', { name, exact: true, includeHidden: true }).count() > 0, name + ' has a spoken name')
    }
    await page.evaluate(() => window.dispatch('openTorrentAddress'))
    console.log('Audit UI: keyboard playback passed')
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      assert(await page.evaluate(() => document.activeElement.closest('dialog') !== null), 'Tab stays within dialog')
    }
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await page.evaluate(() => window.webtorrent.state.saveImmediate(window.state.saved))
    assert.deepEqual(errors, [])
    console.log('Audit UI passed: IPC permissions, native selection, offline playback, keyboard buttons, dialog focus, media cleanup and state persistence')
  } finally { await app.close() }
}
main().catch(err => { console.error(err); process.exitCode = 1 })
