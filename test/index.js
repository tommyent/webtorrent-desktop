const test = require('tape')
const setup = require('./setup')
const pkg = require('../package.json')
const webtorrentPkg = require('webtorrent/package.json')

test.onFinish(setup.deleteTestDataDir)

test('app runs', function (t) {
  t.timeoutAfter(15e3)
  setup.resetTestDataDir()
  const app = setup.createApp()
  setup.waitForLoad(app, t)
    .then(() => setup.screenshotCreateOrCompare(app, t, 'app-basic', '.header'))
    .then(async () => {
      const about = await app.openAboutWindow()
      const actual = await about.evaluate(() => ({
        version: document.querySelector('#version-info').textContent.replace(/\s+/g, ' ').trim(),
        copyright: document.querySelector('#copyright').textContent,
        globals: [typeof require, typeof process, typeof Buffer]
      }))
      t.deepEqual(actual, {
        version: `Version ${pkg.version} (${webtorrentPkg.version}) (${process.arch})`,
        copyright: `Copyright © 2014-${new Date().getFullYear()} WebTorrent, LLC`,
        globals: ['undefined', 'undefined', 'undefined']
      }, 'About window renders metadata without Node globals')
    })
    .then(() => setup.endTest(app, t),
      (err) => setup.endTest(app, t, err || 'error'))
})

require('./test-torrent-list')
require('./test-add-torrent')
require('./test-video')
require('./test-audio')
