const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')

const app = new EventEmitter()
const ipcMain = new EventEmitter()
const sender = {}
let request
let exits = 0
let save
const pending = []
ipcMain.handle = (name, handler) => { if (name === 'stateSaveImmediate') save = handler }
app.quit = () => { exits++ }

function stub (name, exports) {
  const id = require.resolve(name)
  require.cache[id] = { id, filename: id, loaded: true, exports }
}

stub('electron', { app, ipcMain })
stub('../src/main/windows', { main: { win: { webContents: sender }, dispatch: (_, id) => { request = id }, show () {}, send () {} } })
for (const name of ['log', 'menu', 'renderer-files', 'file-permissions']) stub('../src/main/' + name, {})

const ipc = require('../src/main/ipc')
ipc.setModule('stateStore', { save: () => new Promise(resolve => pending.push(resolve)) })
ipc.init()

function requestQuit () {
  let prevented = false
  app.emit('before-quit', { preventDefault: () => { prevented = true } })
  return prevented
}

async function main () {
  const preferenceSave = save({ sender }, {})
  assert.ok(requestQuit())
  const staleRequest = request
  const firstQuit = save({ sender }, {}, request)
  assert.ok(requestQuit(), 'a repeated quit still waits')
  assert.equal(request, staleRequest)
  pending.shift()()
  await preferenceSave
  assert.equal(exits, 0, 'an earlier preference save cannot finish quit')
  await once(app, 'quitCancelled')
  assert.ok(requestQuit())
  assert.notEqual(request, staleRequest)
  const retry = save({ sender }, {}, request)
  pending.shift()()
  await firstQuit
  assert.equal(exits, 0, 'an expired attempt cannot finish its successor')
  pending.shift()()
  await retry
  assert.equal(exits, 1)
  assert.equal(requestQuit(), false, 'the acknowledged snapshot allows exit')
}

main().catch(err => { console.error(err); process.exitCode = 1 })
