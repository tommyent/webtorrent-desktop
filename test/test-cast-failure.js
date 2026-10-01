// A cast that fails while connecting (seen on a Google TV Streamer) returns to
// local playback: the player's own video resumes where it was, and the hidden
// seek-bar preview video doesn't start playing with sound.
const test = require('tape')
const setup = require('./setup')

test('cast-failure', function (t) {
  setup.resetTestDataDir()
  t.timeoutAfter(120e3)
  const app = setup.createApp()
  setup.waitForLoad(app, t, { online: true })
    .then(() => run(app, t))
    .then(() => setup.endTest(app, t),
      (err) => setup.endTest(app, t, err || 'error'))
})

async function run (app, t) {
  const page = app.page
  await app.client.waitUntilTextExists('.torrent-list', 'Big Buck Bunny')
  await app.client.moveToObject('.torrent')
  await app.client.click('.icon.play')
  await page.waitForFunction(() => {
    const video = document.querySelector('.letterbox > video')
    return window.state.playing.isReady && video && video.readyState >= 2
  }, null, { timeout: 45e3 })
  await page.evaluate(() => window.dispatch('skipTo', 20))
  await page.waitForFunction(() => document.querySelector('.letterbox > video').currentTime >= 20, null, { timeout: 30e3 })

  // Hold the cast start, so the test device never answers, and keep its request id
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    const engine = BrowserWindow.getAllWindows()
      .find(win => win.webContents.getTitle() === 'WebTorrent Hidden Window').webContents
    const send = engine.send.bind(engine)
    global.heldCastStarts = []
    engine.send = (channel, ...args) => {
      if (channel === 'wt-cast-command' && args[0] && args[0].action === 'start') {
        global.heldCastStarts.push(args[0])
      } else send(channel, ...args)
    }
  })
  await page.waitForFunction(() => (window.state.devices.items || []).some(d => d.protocol === 'chromecast'))
  await page.evaluate(() => {
    window.dispatch('toggleCastMenu', 'chromecast')
    window.dispatch('selectCastDevice', 0)
  })
  const start = await app.electronApp.evaluate(() => global.heldCastStarts[0])
  const device = await page.evaluate(() => window.state.devices.items.find(d => d.protocol === 'chromecast'))

  // What the engine reports for a device that drops the connection while connecting
  const castEvent = envelope => app.electronApp.evaluate(({ BrowserWindow }, env) => {
    BrowserWindow.getAllWindows()
      .find(win => win.webContents.getTitle() === 'Main Window').webContents
      .send('wt-cast-event', env)
  }, envelope)
  const session = {
    sessionId: 'cast-session-1',
    requestId: start.requestId,
    deviceId: device.id,
    currentTime: start.payload.currentTime,
    volume: 1,
    playbackRate: 1
  }
  await castEvent({ type: 'session', payload: { ...session, state: 'connecting' } })
  await page.waitForFunction(() => window.state.playing.location === 'chromecast-pending')
  await castEvent({
    type: 'error',
    payload: {
      requestId: start.requestId,
      sessionId: session.sessionId,
      code: 'CAST_ERROR',
      message: 'Could not connect to Chromecast. Client network socket disconnected before secure TLS connection was established',
      recoverable: true
    }
  })
  await castEvent({ type: 'session', payload: { ...session, state: 'stopped' } })
  await page.waitForFunction(() => {
    const video = document.querySelector('.letterbox > video')
    return window.state.playing.location === 'local' && video && !video.paused && video.readyState >= 2
  }, null, { timeout: 30e3 })
  await setup.wait(2000)

  const after = await page.evaluate(() => {
    const main = document.querySelector('.letterbox > video')
    const preview = document.querySelector('video#preview')
    return {
      mainTime: main.currentTime,
      mainPlaying: !main.paused,
      previewPlaying: preview ? !preview.paused : false,
      previewMuted: preview ? preview.muted : true
    }
  })
  t.ok(after.mainPlaying, 'the player video plays again')
  t.ok(after.mainTime >= start.payload.currentTime - 1, `resumed where it was (${after.mainTime.toFixed(1)}s, cast started at ${start.payload.currentTime.toFixed(1)}s)`)
  t.notOk(after.previewPlaying, 'the hidden preview video is not playing')
  t.ok(after.previewMuted, 'the preview video is muted')
}
