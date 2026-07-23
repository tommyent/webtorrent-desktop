#!/usr/bin/env node

const fs = require('fs/promises')
const path = require('path')
const esbuild = require('esbuild')

const rootPath = path.join(__dirname, '..')
const srcPath = path.join(rootPath, 'src')
const buildPath = path.join(rootPath, 'build')
const rendererEntry = path.join(srcPath, 'renderer', 'main.js')
const engineEntry = path.join(srcPath, 'renderer', 'webtorrent.js')
const configPath = path.join(srcPath, 'config.js')

const externalConfigPlugin = {
  name: 'external-config',
  setup (build) {
    build.onResolve({ filter: /config$/ }, args => {
      if (`${path.resolve(args.resolveDir, args.path)}.js` !== configPath) return
      return { path: '../config', external: true }
    })
  }
}

async function getJavaScriptFiles (directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(entry => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory()
      ? getJavaScriptFiles(entryPath)
      : entryPath.endsWith('.js') ? [entryPath] : []
  }))
  return files.flat()
}

async function build () {
  const files = await getJavaScriptFiles(srcPath)
  const sharedOptions = {
    loader: { '.js': 'jsx' },
    platform: 'node',
    target: 'node22'
  }

  await fs.rm(buildPath, { recursive: true, force: true, maxRetries: 3 })

  await esbuild.build({
    ...sharedOptions,
    entryPoints: files.filter(file => file !== rendererEntry && file !== engineEntry),
    outbase: srcPath,
    outdir: buildPath
  })

  await esbuild.build({
    ...sharedOptions,
    bundle: true,
    entryPoints: [rendererEntry],
    packages: 'external',
    plugins: [externalConfigPlugin],
    sourcemap: true,
    outfile: path.join(buildPath, 'renderer', 'main.js')
  })

  // Keep the ESM-only WebTorrent import dynamic. A bundled CommonJS output
  // rewrites an external dynamic import to require(), which cannot load it.
  await esbuild.build({
    ...sharedOptions,
    entryPoints: [engineEntry],
    outfile: path.join(buildPath, 'renderer', 'webtorrent.js')
  })
}

build().catch(err => {
  console.error(err)
  process.exitCode = 1
})
