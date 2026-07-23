const test = require('tape')
const setup = require('./setup')

test('video-streaming', function (t) {
  setup.resetTestDataDir()

  t.timeoutAfter(90e3)
  const app = setup.createApp()
  setup.waitForLoad(app, t, { online: true })
    .then(() => app.client.waitUntilTextExists('.torrent-list', 'Big Buck Bunny'))
    // Play Big Buck Bunny. Wait for it to start streaming.
    .then(() => app.client.moveToObject('.torrent'))
    .then(() => setup.wait())
    .then(() => app.client.click('.icon.play'))
    .then(() => waitForVideoReady(app))
    // Pause, seek to two seconds, and wait for that frame to load.
    .then(() => pause(app))
    .then(() => app.webContents.executeJavaScript('dispatch("skipTo", 2)'))
    .then(() => waitForVideoFrame(app, 2))
    // Decoder output varies by CI hardware. Assert playback semantically there
    // and keep the local screenshot as a visual regression check.
    .then(() => t.pass('loads video frame'))
    .then(() => process.env.CI
      ? null
      : setup.screenshotCreateOrCompare(app, t, 'play-torrent-bbb'))
    // Hit escape
    .then(() => app.webContents.executeJavaScript('dispatch("escapeBack")'))
    .then(() => setup.wait())
    // Delete Big Buck Bunny
    .then(() => app.client.moveToObject('.torrent'))
    .then(() => setup.wait())
    .then(() => app.client.click('.icon.delete'))
    .then(() => setup.wait())
    .then(() => app.client.click('.control.ok'))
    // Take another screenshot to verify that the window resized correctly
    .then(() => setup.screenshotCreateOrCompare(
      app, t, 'play-torrent-return', '.header'))
    .then(() => setup.endTest(app, t),
      (err) => setup.endTest(app, t, err || 'error'))
})

function pause (app) {
  // playPause only toggles, so force the source state before dispatching it.
  return app.webContents.executeJavaScript(
    'window.state.playing.isPaused = false; dispatch("playPause")')
}

function waitForVideoReady (app) {
  return app.page.waitForFunction(() => {
    const video = document.querySelector('video')
    return window.state.playing.isReady && video && video.readyState >= 2
  }, null, { timeout: 45e3 })
}

function waitForVideoFrame (app, time) {
  return app.page.waitForFunction(expectedTime => {
    const video = document.querySelector('video')
    return video && video.readyState >= 2 &&
      Math.abs(video.currentTime - expectedTime) < 0.25
  }, time, { timeout: 30e3 })
}
