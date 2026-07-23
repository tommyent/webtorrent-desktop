module.exports = {
  load
}

const fs = require('fs/promises')
const path = require('path')
const { Readable } = require('stream')
const { buffer } = require('stream/consumers')
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
    const contents = await fs.readFile(filePath, 'utf8')
    const buf = await buffer(Readable.from(contents).pipe(srtToVtt()))

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
