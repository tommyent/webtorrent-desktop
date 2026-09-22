const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const torrentPoster = require('../src/renderer/lib/torrent-poster')

async function main () {
  const image = await fs.readFile(path.join(__dirname, 'resources', 'm3.jpg'))
  const file = { name: 'poster.jpg', length: image.length, arrayBuffer: async () => image }
  const result = await new Promise((resolve, reject) => torrentPoster({ files: [file] }, '',
    (err, buffer, extension) => err ? reject(err) : resolve({ buffer, extension })))
  assert.equal(result.extension, '.jpg')
  assert.deepEqual(result.buffer, image)
  await assert.rejects(new Promise((resolve, reject) => torrentPoster({ files: [{ ...file, length: 21 * 1024 * 1024 }] }, '',
    err => err ? reject(err) : resolve())), /20 MiB/)
  console.log('Poster selection and size limits passed')
}
main().catch(err => { console.error(err); process.exitCode = 1 })
