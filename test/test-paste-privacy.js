// Run after npm run build; optionally pass a packaged app executable.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { _electron: electron } = require('playwright')

async function main () {
  const executablePath = process.argv[2]
  const app = await electron.launch({
    executablePath,
    args: executablePath ? ['--test'] : [path.join(__dirname, '..'), '--test'],
    env: { ...process.env, NODE_ENV: 'test' }
  })
  const errors = []
  const watch = page => page.on('pageerror', error => errors.push(error.message))
  app.windows().forEach(watch)
  app.on('window', watch)
  let clipboardSaved = false
  try {
    await app.evaluate(async ({ clipboard, net, autoUpdater, session }) => {
      // Electron 44: snapshot each item's data; read() items can't be written back.
      global.pasteTestClipboard = await Promise.all((await clipboard.read()).map(async item =>
        Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))))
      global.phoneHomeCalls = []
      net.fetch = async url => {
        global.phoneHomeCalls.push(String(url))
        throw new Error('Unexpected background fetch')
      }
      autoUpdater.checkForUpdates = () => global.phoneHomeCalls.push('autoUpdater')
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['https://webtorrent.io/*'] },
        (details, respond) => {
          global.phoneHomeCalls.push(details.url)
          respond({ cancel: true })
        })
    })
    clipboardSaved = true
    let page, engine
    const deadline = Date.now() + 15000
    while ((!page || !engine) && Date.now() < deadline) {
      for (const window of app.windows()) {
        if (await window.title() === 'Main Window') page = window
        if (await window.title() === 'WebTorrent Hidden Window') engine = window
      }
      if (!page || !engine) await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(page && engine, 'Both app windows open')
    await page.locator('.header').waitFor()
    await engine.evaluate(() => window.testOfflineMode())

    for (const method of ['paste', 'OK', 'Enter']) {
      const hash = crypto.randomBytes(20).toString('hex')
      const magnet = `magnet:?xt=urn:btih:${hash}&dn=PasteRegression`
      await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), magnet)
      if (method === 'paste') {
        await page.locator('body').click({ position: { x: 5, y: 5 } })
        const window = await app.browserWindow(page)
        await window.evaluate(win => win.webContents.paste())
      } else {
        await page.evaluate(() => window.dispatch('openTorrentAddress'))
        const field = page.getByRole('textbox', { name: 'Enter torrent address or magnet link' })
        await field.waitFor()
        await page.waitForFunction(magnet =>
          document.querySelector('input[type=text]')?.value === magnet, magnet, { timeout: 5000 })
        assert.equal(await field.inputValue(), magnet, 'Clipboard prefills the dialog')
        if (method === 'OK') await page.getByRole('button', { name: 'OK', exact: true }).click()
        else await field.press('Enter')
      }
      await page.waitForFunction(hash =>
        window.state.saved.torrents.some(torrent => torrent.infoHash === hash), hash)
      console.log(`PASS: ${method} adds the magnet link`)
      await engine.evaluate(hash => window.client.torrents.find(torrent => torrent.infoHash === hash).destroy(), hash)
      await page.evaluate(hash => {
        window.state.saved.torrents = window.state.saved.torrents.filter(torrent => torrent.infoHash !== hash)
      }, hash)
    }
    await page.waitForTimeout(3500)
    assert.deepEqual(await app.evaluate(() => global.phoneHomeCalls), [])
    assert.equal(await app.evaluate(({ crashReporter }) => crashReporter.getUploadToServer()), false)
    assert.equal(await page.evaluate(() => typeof window.webtorrent.telemetry), 'undefined')
    assert.equal(await page.evaluate(() => typeof window.state.saved.telemetry), 'undefined')
    assert.deepEqual(errors, [])
    console.log('PASS: no background service requests, crash uploads, telemetry bridge, or renderer errors')
  } finally {
    try {
      if (clipboardSaved) {
        await app.evaluate(async ({ clipboard, ClipboardItem }) => {
          clipboard.clear()
          // An empty clipboard (as on CI) reads back as an item with no types,
          // which ClipboardItem rejects.
          const items = global.pasteTestClipboard.filter(data => Object.keys(data).length)
          if (items.length) await clipboard.write(items.map(data => new ClipboardItem(data)))
        })
      }
    } finally {
      await app.close()
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
