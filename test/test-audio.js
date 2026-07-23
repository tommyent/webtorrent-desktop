const test = require('tape')
const setup = require('./setup')

test('audio-streaming', function (t) {
  setup.resetTestDataDir()

  t.timeoutAfter(60e3)
  const app = setup.createApp()
  setup.waitForLoad(app, t, { online: true })
    .then(() => app.client.waitUntilTextExists('.torrent-list', 'Big Buck Bunny'))
    // Play Wired CD. Wait for it to start streaming.
    .then(() => app.client.moveToObject('#torrent-wired .name'))
    .then(() => app.client.click('#torrent-wired .icon.play'))
    .then(() => app.client.waitUntilTextExists('.player', 'Beastie Boys'))
    // Pause. Skip to two seconds in. Wait another two seconds for it to load.
    .then(() => pause(app))
    .then(() => app.webContents.executeJavaScript('dispatch("skipTo", 2)'))
    .then(() => app.client.waitUntilTextExists('.player', 'Beastie Boys', 10e3))
    .then(() => setup.wait(5e3))
    .then(() => setup.screenshotCreateOrCompare(app, t, 'play-torrent-wired'))
    // Click next
    .then(() => app.client.click('.skip-next'))
    .then(() => app.client.waitUntilTextExists('.player', 'David Byrne'))
    .then(() => setup.wait(5e3))
    .then(() => app.client.moveToObject('.letterbox'))
    .then(() => pause(app))
    .then(() => app.webContents.executeJavaScript('dispatch("skipTo", 2)'))
    .then(() => setup.screenshotCreateOrCompare(app, t, 'play-torrent-wired-2'))
    // Play from end of song, let it advance on its own
    .then(() => app.webContents.executeJavaScript('dispatch("skipTo", 206)'))
    .then(() => play(app))
    // Play past the end of the song, then pause after the start of the next song by Zap Mama
    .then(() => app.client.waitUntilTextExists('.player', 'Zap Mama', 15e3))
    .then(() => setup.wait(5e3))
    .then(() => pause(app))
    .then(() => app.webContents.executeJavaScript('dispatch("skipTo", 2)'))
    .then(() => setup.screenshotCreateOrCompare(app, t, 'play-torrent-wired-3'))
    // Fullscreen dimensions depend on the CI host's display. Assert the
    // transition everywhere and keep the local visual baseline.
    .then(() => app.client.click('.fullscreen'))
    .then(() => app.page.waitForFunction(
      () => window.state.window.isFullScreen, null, { timeout: 10e3 }))
    .then(() => t.pass('enters fullscreen'))
    .then(() => process.env.CI
      ? null
      : setup.screenshotCreateOrCompare(app, t, 'play-torrent-wired-fullscreen'))
    // Back to normal audio view. Give the player controls have had time to disappear.
    .then(() => app.webContents.executeJavaScript('dispatch("escapeBack")'))
    .then(() => setup.screenshotCreateOrCompare(app, t, 'play-torrent-wired-4'))
    // Back. Return to torrent list
    .then(() => app.client.click('.back'))
    .then(() => app.client.waitUntilTextExists('.torrent-list', 'Big Buck Bunny'))
    .then(() => app.client.waitUntilTextExists('.torrent-list', 'Seeding', 60e3))
    .then(() => setup.screenshotCreateOrCompare(
      app, t, 'play-torrent-wired-list', '.header'))
    // Forward. Should play again where we left off (should not stay paused)
    .then(() => app.client.click('.forward'))
    .then(() => setup.wait())
    .then(() => pause(app))
    .then(() => app.webContents.executeJavaScript('dispatch("skipTo", 2)'))
    .then(() => setup.screenshotCreateOrCompare(app, t, 'play-torrent-wired-5'))
    .then(() => setup.endTest(app, t),
      (err) => setup.endTest(app, t, err || 'error'))
})

// playPause only toggles, so force the source state before dispatching it.
function pause (app) {
  return app.webContents.executeJavaScript(
    'window.state.playing.isPaused = false; dispatch("playPause")')
}

function play (app) {
  return app.webContents.executeJavaScript(
    'window.state.playing.isPaused = true; dispatch("playPause")')
}
