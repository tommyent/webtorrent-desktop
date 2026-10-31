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
    // Its audio track is labeled "GPAC ISO Audio Handler" in the file
    .then(() => app.page.evaluate(() => window.state.playing.audioTracks.tracks.map(track => track.label)))
    .then(labels => t.deepEqual(labels.map(label => /^Audio 1( \(.+\))?$/.test(label)), [true], 'audio track named ' + labels))
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
    .then(async () => {
      const duration = await app.page.evaluate(() => {
        const video = document.querySelector('.letterbox > video')
        Object.defineProperty(video, 'duration', { configurable: true, get: () => NaN })
        return window.state.playing.duration
      })
      await app.client.moveToObject('.scrub-bar')
      const result = await app.page.evaluate(() => ({
        duration: window.state.playing.duration,
        previewXCoord: window.state.playing.previewXCoord,
        playerVisible: !!document.querySelector('.player')
      }))
      t.equal(result.duration, duration, 'unknown media duration keeps the last known duration')
      t.ok(result.previewXCoord !== null, 'seek preview was activated')
      t.ok(result.playerVisible, 'seek preview keeps the player visible')
    })
    // Hit escape
    .then(() => app.webContents.executeJavaScript('dispatch("escapeBack")'))
    .then(() => setup.wait())
    // Delete Big Buck Bunny
    .then(() => app.client.moveToObject('.torrent'))
    .then(() => app.client.click('.torrent .remove-select'))
    .then(() => app.client.click('.header .remove-selected'))
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
