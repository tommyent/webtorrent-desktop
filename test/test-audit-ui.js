const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
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
    // The header drags the window; OS clicks on its buttons only work if they are exempt (Playwright clicks skip this).
    const regions = await page.$$eval('.header button', els => els.map(el => window.getComputedStyle(el).getPropertyValue('-webkit-app-region')))
    assert(regions.length >= 3 && regions.every(r => r === 'no-drag'), 'header buttons must be no-drag: ' + regions)
    // The engine's config.js asks main for a path synchronously; an unanswered sendSync froze it for 30+ s.
    const downloads = await app.evaluate(({ app }) => app.getPath('downloads'))
    assert.equal(await engine.evaluate(() => require('electron').ipcRenderer.sendSync('getPath', 'downloads')), downloads)
    assert.equal(await engine.evaluate(() => require('electron').ipcRenderer.sendSync('getWindowInfo')), null)
    // Casting runs here, under a Content-Security-Policy that blocks code built from
    // strings. protobufjs's own encoders need that, so the CSP once broke casting.
    // (Code passed to evaluate() is exempt from that rule; protobufjs is not, so it
    // shows the policy is in force.)
    const cast = await engine.evaluate(async () => {
      let protobufEncoder = 'allowed'
      try {
        const schema = await require('protobufjs').load(require.resolve('castv2/lib/cast_channel.proto'))
        schema.lookupType('extensions.api.cast_channel.CastMessage')
          .encode({ protocolVersion: 0, sourceId: 'a', destinationId: 'b', namespace: 'c', payloadType: 0 })
      } catch (err) { protobufEncoder = err.name }
      const { CastMessage } = require('castv2/lib/proto')
      const connect = CastMessage.serialize({
        protocolVersion: 0,
        sourceId: 'sender-0',
        destinationId: 'receiver-0',
        namespace: 'urn:x-cast:com.google.cast.tp.connection',
        payloadType: 0,
        payloadUtf8: '{"type":"CONNECT"}'
      })
      return { protobufEncoder, payload: CastMessage.parse(connect).payloadUtf8 }
    })
    assert.deepEqual(cast, { protobufEncoder: 'EvalError', payload: '{"type":"CONNECT"}' }, 'Cast messages encode under the engine CSP')
    console.log('Audit UI: Cast messages encode under the engine CSP')
    await engine.evaluate(() => window.testOfflineMode())

    // Browser links must show a row before a cold/busy engine acknowledges them.
    const browserHash = crypto.randomBytes(20).toString('hex')
    const browserMagnet = `magnet:?xt=urn:btih:${browserHash}&dn=First%20browser%20torrent`
    await app.evaluate(({ app, BrowserWindow }, magnet) => {
      const contents = BrowserWindow.getAllWindows()
        .find(win => win.webContents.getTitle() === 'WebTorrent Hidden Window').webContents
      const send = contents.send.bind(contents)
      contents.send = (channel, ...args) => {
        if (channel === 'wt-start-torrenting' && args[1] === magnet) {
          global.releaseBrowserMagnet = () => {
            contents.send = send
            send(channel, ...args)
          }
        } else send(channel, ...args)
      }
      app.emit('open-url', { preventDefault () {} }, magnet)
    }, browserMagnet)
    await page.getByRole('button', { name: 'First browser torrent', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.state.saved.torrents[0].infoHash), undefined,
      'browser addition is visible before the engine replies')
    await app.evaluate(() => global.releaseBrowserMagnet())
    await page.waitForFunction(hash => window.state.saved.torrents.some(t => t.infoHash === hash), browserHash)
    assert.equal(await page.getByRole('button', { name: 'First browser torrent', exact: true }).count(), 1)
    await page.evaluate(hash => window.dispatch('deleteTorrent', hash, false), browserHash)
    await page.waitForFunction(hash => !window.state.saved.torrents.some(t => t.infoHash === hash), browserHash)
    console.log('Audit UI: browser magnet appears before engine reply')

    // Private metadata reached from a magnet link or a hash-only .torrent file
    // stops the torrent and removes its row; a public magnet and the real
    // private .torrent file still work. Metadata is delivered offline through
    // WebTorrent's own _onMetadata, as a peer would deliver it.
    const fixtureDir = path.join(require('./config').TEST_DIR, 'private-fixtures') // reset with the test data
    await fs.mkdir(fixtureDir, { recursive: true })
    const { default: createTorrentFile } = await import('create-torrent')
    const makeTorrent = (name, isPrivate) => new Promise((resolve, reject) => {
      const data = Buffer.from('fixture ' + name)
      data.name = name
      createTorrentFile(data, { name, private: isPrivate, announce: [] },
        (err, torrent) => err ? reject(err) : resolve(Buffer.from(torrent)))
    })
    const privateTorrent = await makeTorrent('private.txt', true)
    const publicTorrent = await makeTorrent('public.txt', false)
    const [privateHash, publicHash] = [privateTorrent, publicTorrent].map(t => require('parse-torrent')(t).infoHash)
    const deliverMetadata = (hash, torrent) => engine.evaluate(([hash, bytes]) =>
      window.client.torrents.find(t => t.infoHash === hash)._onMetadata(Buffer.from(bytes)), [hash, [...torrent]])
    const waitForRow = (hash, present) => page.waitForFunction(([hash, present]) =>
      window.state.saved.torrents.some(t => t.infoHash === hash) === present, [hash, present])
    // A working torrent is ready in the engine and has its .torrent cached.
    const waitForWorking = async hash => {
      await engine.waitForFunction(hash => window.client.torrents.find(t => t.infoHash === hash)?.ready, hash)
      await page.waitForFunction(hash => window.state.saved.torrents.some(t => t.infoHash === hash && t.torrentFileName), hash)
    }
    const hashOnlyFile = path.join(fixtureDir, 'hash-only.torrent')
    await fs.writeFile(hashOnlyFile, Buffer.from(privateHash, 'hex'))
    for (const torrentId of [`magnet:?xt=urn:btih:${privateHash}&dn=Private`, hashOnlyFile]) {
      await page.evaluate(id => window.dispatch('addTorrent', id), torrentId)
      await waitForRow(privateHash, true)
      await deliverMetadata(privateHash, privateTorrent)
      await waitForRow(privateHash, false)
      await page.getByText('This is a private torrent').first().waitFor()
      assert.equal(await engine.evaluate(hash => window.client.torrents.some(t => t.infoHash === hash), privateHash), false)
      await page.evaluate(() => { window.state.errors = []; window.dispatch('update') })
    }
    await page.evaluate(hash => window.dispatch('addTorrent', `magnet:?xt=urn:btih:${hash}&dn=Public`), publicHash)
    await waitForRow(publicHash, true)
    await deliverMetadata(publicHash, publicTorrent)
    await waitForWorking(publicHash)
    const privateTorrentFile = path.join(fixtureDir, 'private.torrent')
    await fs.writeFile(privateTorrentFile, privateTorrent)
    await page.evaluate(file => window.dispatch('addTorrent', file), privateTorrentFile)
    await waitForWorking(privateHash)
    for (const hash of [publicHash, privateHash]) {
      await page.evaluate(hash => window.dispatch('deleteTorrent', hash, false), hash)
      await waitForRow(hash, false)
    }
    assert.deepEqual(await page.evaluate(() => window.state.errors), [])
    console.log('Audit UI: private magnet and hash-only file stopped; public magnet and private .torrent work')
    await assert.rejects(page.evaluate(async () => {
      const saved = await window.webtorrent.state.load()
      saved.prefs.externalPlayerPath = '/bin/sh'
      await window.webtorrent.state.save(saved)
    }), /native dialog/)
    await assert.rejects(page.evaluate(() => window.webtorrent.torrent.copyFile('/tmp/arbitrary', '/tmp/arbitrary-export')), /destination/)
    await assert.rejects(page.evaluate(dir => window.webtorrent.torrent.inspectCreateInput([dir]), require('node:os').homedir()), /native dialog/)
    await assert.rejects(page.evaluate(() => window.webtorrent.torrent.trashData('0'.repeat(40))), /known torrent/)
    // Main relays only string torrent IDs and strips magnet parameters that
    // WebTorrent would copy onto the torrent (a parsed object, or &path=, could
    // replace the download folder). These test starts are held back from the engine.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()
        .find(win => win.webContents.getTitle() === 'WebTorrent Hidden Window').webContents
      const send = contents.send.bind(contents)
      global.heldStarts = []
      contents.send = (channel, ...args) => {
        if (channel === 'wt-start-torrenting' && [992, 993, 994].includes(args[0])) global.heldStarts.push(args)
        else send(channel, ...args)
      }
      global.restoreEngineSend = () => { contents.send = send }
    })
    const downloadPath = await page.evaluate(() => window.state.saved.prefs.downloadPath)
    const escapeHash = 'f'.repeat(40)
    await page.evaluate(([downloadPath, hash]) => window.webtorrent.torrent.start(992,
      { infoHash: hash, name: 'escape', path: '/tmp', files: [{ path: '../escape', length: 1 }] }, downloadPath),
    [downloadPath, escapeHash])
    for (const [key, scheme] of [[993, 'magnet:'], [994, 'stream-magnet:']]) {
      await page.evaluate(([key, uri, downloadPath]) => window.webtorrent.torrent.start(key, uri, downloadPath),
        [key, `${scheme}?xt=urn:btih:${escapeHash}&dn=escape&path=/tmp&on=x`, downloadPath])
    }
    let held = []
    for (let i = 0; i < 50 && !held.some(args => args[0] === 994); i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      held = await app.evaluate(() => global.heldStarts)
    }
    await app.evaluate(() => global.restoreEngineSend())
    assert.deepEqual(held.map(args => args[0]), [993, 994], 'the object torrent ID never reaches the engine')
    for (const args of held) assert.equal(args[1], `magnet:?xt=urn:btih:${escapeHash}&dn=escape`)
    // The UI can't set what startup migrations act on: the saved version stays
    // the running app's and legacy path fields are dropped.
    const resaved = await page.evaluate(async () => {
      const saved = await window.webtorrent.state.load()
      saved.version = '0.6.0'
      saved.torrents.push({ infoHash: 'e'.repeat(40), torrentPath: '/etc/hosts', posterURL: '/etc/hosts.png' })
      await window.webtorrent.state.save(saved)
      return window.webtorrent.state.load()
    })
    assert.equal(resaved.version, require('../package.json').version)
    assert.deepEqual(resaved.torrents.filter(t => t.torrentPath || t.posterURL), [])
    await page.evaluate(() => window.webtorrent.state.save(window.state.saved))

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
    for (const [role, name] of [['button', 'Start streaming'], ['checkbox', 'Select monitor-test.mp4 for removal'], ['switch', 'Torrent activity for monitor-test.mp4']]) {
      assert(await page.getByRole(role, { name, exact: true, includeHidden: true }).count() > 0, name + ' has a spoken name')
    }

    // Completed torrents sort ahead of newer additions, even while paused.
    await page.waitForFunction(hash => window.state.saved.torrents.find(t => t.infoHash === hash)?.completed, hash)
    await page.evaluate(hash => window.dispatch('toggleTorrent', hash), hash)
    await page.evaluate(magnet => window.dispatch('addTorrent', magnet), browserMagnet)
    await page.waitForFunction(hash => window.state.saved.torrents[0].infoHash === hash, browserHash)
    const firstName = page.locator('.torrent .name').first()
    assert.equal(await firstName.textContent(), 'First browser torrent')
    const sort = page.getByRole('navigation').getByRole('combobox', { name: 'Sort torrents', exact: true })
    await sort.selectOption('completed')
    assert.equal(await firstName.textContent(), 'monitor-test.mp4')
    await page.evaluate(() => window.webtorrent.state.saveImmediate(window.state.saved))
    const saved = JSON.parse(await fs.readFile(path.join(require('./config').TEST_DIR, 'config.json'), 'utf8'))
    assert.equal(saved.prefs.sortCompletedFirst, true)
    const completed = saved.torrents.find(t => t.infoHash === hash)
    assert.equal(completed.status, 'paused')
    assert.equal(completed.completed, true)
    assert.equal(completed.progress, undefined, 'completion survives without transient progress')
    await sort.selectOption('added')
    assert.equal(await firstName.textContent(), 'First browser torrent')
    await sort.selectOption('completed')
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'webtorrent-sort.png'), animations: 'disabled' })
    await page.evaluate(hash => window.dispatch('deleteTorrent', hash, false), browserHash)
    await page.waitForFunction(hash => !window.state.saved.torrents.some(t => t.infoHash === hash), browserHash)
    console.log('Audit UI: completed-first sorting and persistence passed')

    // Playing right after a (re)start: the engine must wait for the async .torrent parse,
    // and a server that becomes ready after its player closed must not be published.
    const summary = await page.evaluate(hash => window.state.saved.torrents.find(t => t.infoHash === hash), hash)
    const torrentFile = path.join(require('./config').TEST_DIR, 'Torrents', summary.torrentFileName)
    const restart = (stopFirst) => engine.evaluate(([key, file, dir, stopFirst]) => new Promise(resolve => {
      const { ipcRenderer } = require('electron')
      const send = ipcRenderer.send
      const timer = setTimeout(() => { ipcRenderer.send = send; resolve(null) }, 3000)
      ipcRenderer.send = (channel, ...args) => {
        if (channel === 'wt-server-running') { clearTimeout(timer); ipcRenderer.send = send; resolve(args[0].localURL) }
        return send.call(ipcRenderer, channel, ...args)
      }
      ipcRenderer.emit('wt-start-torrenting', {}, key, file, dir)
      ipcRenderer.emit('wt-start-server', {}, key)
      if (stopFirst) ipcRenderer.emit('wt-stop-server', {})
    }), [summary.torrentKey, torrentFile, summary.path, stopFirst])
    const stopEngineTorrent = () => engine.evaluate(key => {
      require('electron').ipcRenderer.emit('wt-stop-torrenting', {}, key)
      return window.client.torrents.some(t => t.key === key)
    }, summary.torrentKey)
    assert.equal(await restart(true), null, 'a closed player gets no server')
    assert.equal(await stopEngineTorrent(), false)
    assert.match(await restart(false), new RegExp('/webtorrent/' + hash + '$'))
    await engine.evaluate(() => require('electron').ipcRenderer.emit('wt-stop-server', {}))
    assert.equal(await stopEngineTorrent(), false)
    console.log('Audit UI: play before the torrent is parsed passed')

    // The player picker starts in /Applications on a Mac when no player is set, and any file can be picked.
    await app.evaluate(({ dialog }) => { dialog.showOpenDialogSync = (win, opts) => { global.playerDialog = opts } })
    await page.evaluate(() => window.dispatch('preferences'))
    await page.getByRole('button', { name: 'Change External player', exact: true }).click()
    const playerDialog = await app.evaluate(() => global.playerDialog)
    assert.equal(playerDialog.defaultPath, process.platform === 'darwin' ? '/Applications' : undefined)
    assert.equal(playerDialog.filters, undefined)
    await page.evaluate(() => window.dispatch('backToList'))

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

    // Kill the real hidden renderer, including the case where the UI has not
    // announced readiness yet. Nothing may keep sending to its disposed frame.
    const beforeCrash = await page.evaluate(() => window.state.saved.torrents.length)
    await app.evaluate(async ({ app, BrowserWindow, ipcMain }) => {
      const contents = BrowserWindow.getAllWindows()
        .find(win => win.webContents.getTitle() === 'WebTorrent Hidden Window').webContents
      global.restartTest = { quit: app.quit, relaunch: app.relaunch, quits: 0, relaunches: 0, sends: 0 }
      app.quit = () => { global.restartTest.quits++; app.isQuitting = true }
      app.relaunch = () => { global.restartTest.relaunches++ }
      app.ipcReady = false
      await new Promise(resolve => {
        contents.once('render-process-gone', resolve)
        contents.forcefullyCrashRenderer()
      })
      contents.send = () => { global.restartTest.sends++; throw new Error('Sent to dead engine') }
      // A late ready notification cannot revive a failed engine.
      ipcMain.emit('ipcReadyWebTorrent', { sender: contents })
    })
    try {
      assert.equal(await app.evaluate(({ app }) => app.ipcReadyWebTorrent), false)
      await app.evaluate(({ app }) => { app.ipcReady = true; app.emit('ipcReady') })
      const stopped = page.getByRole('alert')
      await stopped.getByRole('heading', { name: 'The torrent engine stopped' }).waitFor()
      assert.equal(await page.evaluate(() => window.state.dock.progress), -1, 'Dock progress is hidden')
      assert.equal(await stopped.evaluate(el => window.getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'drag', 'stopped window can be moved')
      await page.evaluate(() => {
        window.webtorrent.torrent.stopServer()
        window.dispatch('addTorrent', 'magnet:?xt=urn:btih:' + 'c'.repeat(40))
      })
      assert.equal(await page.evaluate(() => window.state.saved.torrents.length), beforeCrash, 'failed engine cannot accept new torrents')
      assert.equal(await app.evaluate(() => global.restartTest.sends), 0, 'no stale IPC sends')
      await page.evaluate(() => window.dispatch('stateSaveImmediate'))
      const restart = stopped.getByRole('button', { name: 'Restart WebTorrent' })
      assert.equal(await restart.evaluate(el => window.getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'no-drag', 'restart remains clickable')
      await restart.press('Enter')
      await restart.press('Enter')
      assert.deepEqual(await app.evaluate(() => [global.restartTest.quits, global.restartTest.relaunches]), [1, 0], 'one normal shutdown, no relaunch before saving')
      // A cancelled quit (e.g. failed state save) can be retried, without
      // scheduling a second instance when shutdown eventually succeeds.
      await app.evaluate(({ app }) => {
        app.isQuitting = false
        app.emit('quitCancelled')
        app.emit('will-quit')
      })
      assert.equal(await app.evaluate(() => global.restartTest.relaunches), 0, 'cancelled restart cannot relaunch on a later normal quit')
      await restart.press('Enter')
      await app.evaluate(({ app }) => app.emit('will-quit'))
      assert.deepEqual(await app.evaluate(() => [global.restartTest.quits, global.restartTest.relaunches]), [2, 1])
      assert.deepEqual(errors, [])
      console.log('Audit UI: real engine crash, late UI readiness, stale IPC and restart passed')
    } finally {
      await app.evaluate(({ app }) => {
        app.quit = global.restartTest.quit
        app.relaunch = global.restartTest.relaunch
        app.isQuitting = false
      })
    }
  } finally { await app.close() }
}
main().catch(err => { console.error(err); process.exitCode = 1 })
