module.exports = {
  load
}

const fs = require('fs/promises')
const path = require('path')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { Writable } = require('stream')
const LanguageDetect = require('languagedetect')
const srtToVtt = require('srt-to-vtt')

async function load (filePaths) {
  if (!Array.isArray(filePaths)) throw new TypeError('Invalid subtitle file paths')

  return Promise.all(filePaths.map(async filePath => {
    const extension = typeof filePath === 'string'
      ? path.extname(filePath).toLowerCase()
      : ''
    if (extension !== '.srt' && extension !== '.vtt') {
      throw new TypeError('Invalid subtitle file path')
    }
    const handle = await fs.open(filePath, 'r')
    let contents
    try {
      if ((await handle.stat()).size > 5 * 1024 * 1024) throw new Error('Subtitle exceeds 5 MiB')
      contents = await handle.readFile()
    } finally {
      await handle.close()
    }
    let buf = contents
    if (extension === '.srt') {
      const chunks = []
      await pipeline(Readable.from([contents]), srtToVtt(), new Writable({
        write (chunk, encoding, callback) { chunks.push(chunk); callback() }
      }))
      buf = Buffer.concat(chunks)
    }

    const vttContents = buf.toString().replace(/(.*-->.*)/g, '')
    let language = new LanguageDetect().detect(vttContents, 2)
    language = language.length ? language[0][0] : 'subtitle'
    language = language.slice(0, 1).toUpperCase() + language.slice(1)

    return {
      filePath,
      language,
      buffer: 'data:text/vtt;base64,' + buf.toString('base64')
    }
  }))
}
