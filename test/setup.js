const { copyFileSync } = require('fs')
const fs = require('fs')
const parseTorrent = require('parse-torrent')
const path = require('path')
const { _electron: electron } = require('playwright')
const PNG = require('pngjs').PNG

const config = require('./config')

module.exports = {
  createApp,
  endTest,
  screenshotCreateOrCompare,
  compareDownloadFolder,
  compareFiles,
  compareTorrentFile,
  compareTorrentFiles,
  waitForLoad,
  wait,
  resetTestDataDir,
  deleteTestDataDir,
  copy
}

// Runs WebTorrent Desktop.
// Returns a small compatibility wrapper around Playwright's Electron driver.
// Keeping the test-facing API stable makes the migration from Spectron easy to review.
function createApp () {
  const userDataDir = process.platform === 'win32'
    ? path.join('C:\\Windows\\Temp', 'WebTorrentTest')
    : path.join('/tmp', 'WebTorrentTest')
  const rootPath = path.join(__dirname, '..')
  const app = {}
  const reportedRendererErrors = new Set()

  function reportRendererError (err) {
    const signature = err.stack || err.message || String(err)
    if (reportedRendererErrors.has(signature)) return
    reportedRendererErrors.add(signature)
    console.error('Renderer error:', err)
  }

  async function waitForPageTitle (expectedTitle) {
    const deadline = Date.now() + 10e3
    while (Date.now() < deadline) {
      for (const page of app.electronApp.windows()) {
        if (await page.title() === expectedTitle) return page
      }
      await wait(100)
    }
    throw new Error(`Timed out waiting for Electron window "${expectedTitle}"`)
  }

  app.start = async function () {
    app.electronApp = await electron.launch({
      args: [
        '-r',
        path.join(__dirname, 'mocks.js'),
        rootPath,
        '--test',
        // Must come after the app path: sliceArgv() in src/main/index.js drops the
        // first 4 args in test mode, and later '--' flags are ignored by processArgv().
        `--user-data-dir=${userDataDir}`
      ],
      cwd: rootPath
    })
    await app.electronApp.firstWindow()
    app.page = await waitForPageTitle('WebTorrent Hidden Window')
    app.page.on('pageerror', reportRendererError)
  }

  app.stop = async function () {
    if (app.electronApp) await app.electronApp.close()
  }

  app.client = {
    click: (selector) => app.page.locator(`${selector}:visible`).first().click(),
    moveToObject: (selector) => app.page.locator(`${selector}:visible`).first().hover(),
    // Wait on the text element, not the container: containers like .modal have
    // only position:fixed children, so their own bounding box is empty and
    // Playwright considers them invisible.
    waitUntilTextExists: (selector, expected, timeout) => app.page
      .locator(selector)
      .getByText(expected)
      .first()
      .waitFor({ state: 'visible', timeout: timeout || 10e3 }),
    waitUntilWindowLoaded: () => app.page.waitForLoadState('load'),
    windowByIndex: async (index) => {
      if (index !== 1) throw new Error(`Unsupported legacy window index: ${index}`)
      app.page = await waitForPageTitle('Main Window')
      app.page.on('pageerror', reportRendererError)
    }
  }

  app.webContents = {
    executeJavaScript: (source) => app.page.evaluate(source),
    getTitle: () => app.page.title()
  }

  app.browserWindow = {
    capturePage: () => app.page.screenshot(),
    focus: async () => {
      const windowHandle = await app.electronApp.browserWindow(app.page)
      await windowHandle.evaluate((window) => window.focus())
    },
    getTitle: async () => {
      const windowHandle = await app.electronApp.browserWindow(app.page)
      return windowHandle.evaluate((window) => window.getTitle())
    }
  }

  app.electron = {
    ipcRenderer: {
      send: (channel, ...args) => app.page.evaluate(
        ({ channel, args }) => require('electron').ipcRenderer.send(channel, ...args),
        { channel, args }
      )
    }
  }

  app.openAboutWindow = async function () {
    const aboutPath = path.join(rootPath, 'build', 'main', 'windows', 'about.js')
    await app.electronApp.evaluate((_, modulePath) => {
      process.mainModule.require(modulePath).init()
    }, aboutPath)
    const page = await waitForPageTitle('About WebTorrent')
    page.on('pageerror', reportRendererError)
    await page.waitForLoadState('load')
    return page
  }

  return app
}

// Starts the app, waits for it to load, returns a promise
function waitForLoad (app, t, opts) {
  if (!opts) opts = {}
  return app.start().then(function () {
    return app.client.waitUntilWindowLoaded()
  }).then(function () {
    // Offline mode. testOfflineMode is async (it awaits the webtorrent
    // import and destroys the online client), so wait for it to finish.
    if (!opts.online) return app.webContents.executeJavaScript('testOfflineMode()')
  }).then(function () {
    // Switch to the main window. Index 0 is apparently the hidden webtorrent window...
    return app.client.windowByIndex(1)
  }).then(function () {
    return app.client.waitUntilWindowLoaded()
  }).then(function () {
    return app.webContents.getTitle()
  }).then(function (title) {
    // Note the window title is WebTorrent, this is the HTML <title>
    t.equal(title, 'Main Window', 'html title')
  })
}

// Returns a promise that resolves after 'ms' milliseconds. Default: 1 second
function wait (ms) {
  if (ms === undefined) ms = 1000 // Default: wait long enough for the UI to update
  return new Promise(function (resolve, reject) {
    setTimeout(resolve, ms)
  })
}

// Quit the app, end the test, either in success (!err) or failure (err)
function endTest (app, t, err) {
  return app.stop().then(function () {
    // Guard: tape's timeoutAfter may have already ended the test; calling
    // t.end() again throws and cascades into every remaining test.
    if (!t.calledEnd) t.end(err)
  })
}

// Takes a screenshot of the app
// If we already have a reference under test/screenshots, assert that they're the same
// Otherwise, create the reference screenshot: test/screenshots/<platform>/<name>.png
function screenshotCreateOrCompare (app, t, name, hoverSelector) {
  const ssDir = path.join(__dirname, 'screenshots', process.platform)

  // check that path exists otherwise create it
  if (!fs.existsSync(ssDir)) {
    fs.mkdirSync(ssDir)
  }

  const ssPath = path.join(ssDir, name + '.png')
  let ssBuf

  try {
    ssBuf = fs.readFileSync(ssPath)
  } catch (err) {
    ssBuf = Buffer.alloc(0)
  }

  return app.browserWindow.focus()
    .then(() => wait())
    // Native focus can restore the OS pointer after Playwright hover events.
    // Reapply intentional hover or pointer parking immediately before capture.
    .then(() => hoverSelector && app.client.moveToObject(hoverSelector))
    .then(() => app.browserWindow.capturePage())
    .then(function (buffer) {
      if (ssBuf.length === 0) {
        console.log('Saving screenshot ' + ssPath)
        fs.writeFileSync(ssPath, buffer)
      } else {
        const match = compareIgnoringTransparency(buffer, ssBuf)
        t.ok(match, 'screenshot comparison ' + name)
        if (!match) {
          const ssFailedPath = path.join(ssDir, name + '-failed.png')
          console.log('Saving screenshot, failed comparison: ' + ssFailedPath)
          fs.writeFileSync(ssFailedPath, buffer)
        }
      }
    })
}

// Compares two PNGs, ignoring any transparent regions in bufExpected.
// Returns true if they match.
function compareIgnoringTransparency (bufActual, bufExpected) {
  // Common case: exact byte-for-byte match
  if (Buffer.compare(bufActual, bufExpected) === 0) return true

  // Otherwise, compare pixel by pixel
  let sumSquareDiff = 0
  let numDiff = 0
  const pngA = PNG.sync.read(bufActual)
  const pngE = PNG.sync.read(bufExpected)
  if (pngA.width !== pngE.width || pngA.height !== pngE.height) return false
  const w = pngA.width
  const h = pngE.height
  const da = pngA.data
  const de = pngE.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y * w) + x) * 4
      if (de[i + 3] === 0) continue // Skip transparent pixels
      const ca = (da[i] << 16) | (da[i + 1] << 8) | da[i + 2]
      const ce = (de[i] << 16) | (de[i + 1] << 8) | de[i + 2]
      if (ca === ce) continue

      // Add pixel diff to running sum
      // This is necessary on Windows, where rendering apparently isn't quite deterministic
      // and a few pixels in the screenshot will sometimes be off by 1. (Visually identical.)
      numDiff++
      sumSquareDiff += (da[i] - de[i]) * (da[i] - de[i])
      sumSquareDiff += (da[i + 1] - de[i + 1]) * (da[i + 1] - de[i + 1])
      sumSquareDiff += (da[i + 2] - de[i + 2]) * (da[i + 2] - de[i + 2])
    }
  }
  const rms = Math.sqrt(sumSquareDiff / (numDiff + 1))
  const l2Distance = Math.round(Math.sqrt(sumSquareDiff))
  console.log('screenshot diff l2 distance: ' + l2Distance + ', rms: ' + rms)
  return l2Distance < 5000 && rms < 100
}

// Resets the test directory, containing config.json, torrents, downloads, etc
function resetTestDataDir () {
  fs.rmSync(config.TEST_DIR, { recursive: true, force: true })
  // Create TEST_DIR as well as /Downloads and /Desktop
  fs.mkdirSync(config.TEST_DIR_DOWNLOAD, { recursive: true })
  fs.mkdirSync(config.TEST_DIR_DESKTOP, { recursive: true })
}

function deleteTestDataDir () {
  fs.rmSync(config.TEST_DIR, { recursive: true, force: true })
}

// Checks a given folder under Downloads.
// Makes sure that the filenames match exactly.
// If `filenames` is null, asserts that the folder doesn't exist.
function compareDownloadFolder (t, dirname, filenames) {
  const dirpath = path.join(config.TEST_DIR_DOWNLOAD, dirname)
  try {
    const actualFilenames = fs.readdirSync(dirpath)
    if (filenames === null) {
      return t.fail('expected download folder to be absent, but it\'s here: ' + dirpath)
    }
    const expectedSorted = filenames.slice().sort()
    const actualSorted = actualFilenames.slice().sort()
    console.log(actualSorted)
    t.deepEqual(actualSorted, expectedSorted, 'download folder contents: ' + dirname)
  } catch (err) {
    if (err.code === 'ENOENT') {
      t.equal(filenames, null, 'download folder missing: ' + dirname)
    } else {
      console.error(err)
      t.fail('unexpected error getting download folder: ' + dirname)
    }
  }
}

// Makes sure two files have identical contents
function compareFiles (t, pathActual, pathExpected) {
  const bufActual = fs.readFileSync(pathActual)
  const bufExpected = fs.readFileSync(pathExpected)
  const match = Buffer.compare(bufActual, bufExpected) === 0
  t.ok(match, 'correct contents: ' + pathActual)
}

// Makes sure two torrents have the same infohash and flags
function compareTorrentFiles (t, pathActual, pathExpected) {
  const bufActual = fs.readFileSync(pathActual)
  const bufExpected = fs.readFileSync(pathExpected)
  const fieldsActual = extractImportantFields(parseTorrent(bufActual))
  const fieldsExpected = extractImportantFields(parseTorrent(bufExpected))
  t.deepEqual(fieldsActual, fieldsExpected, 'torrent contents: ' + pathActual)
}

// Makes sure two torrents have the same infohash and flags
function compareTorrentFile (t, pathActual, fieldsExpected) {
  const bufActual = fs.readFileSync(pathActual)
  const fieldsActual = extractImportantFields(parseTorrent(bufActual))
  if (Array.isArray(fieldsExpected.announce)) fieldsExpected.announce.sort()
  t.deepEqual(fieldsActual, fieldsExpected, 'torrent contents: ' + pathActual)
}

function extractImportantFields (parsedTorrent) {
  let { infoHash, name, announce, urlList, comment } = parsedTorrent
  const priv = parsedTorrent.private // private is a reserved word in JS
  announce = announce.slice().sort()
  return { infoHash, name, announce, urlList, comment, private: priv }
}

function copy (pathFrom, pathTo) {
  try {
    copyFileSync(pathFrom, pathTo)
  } catch (err) {
    // Windows lets us create files and folders under C:\Windows\Temp,
    // but when you try to `copySync` into one of those folders, you get EPERM
    // Ignore for now...
    if (process.platform !== 'win32' || err.code !== 'EPERM') throw err
    console.log('ignoring windows copy EPERM error', err)
  }
}
