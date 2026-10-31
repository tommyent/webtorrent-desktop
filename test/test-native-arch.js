// bin/check-native-arch.js, on folders built from real addons the npm packages ship.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const checkNativeArch = require('../bin/check-native-arch')

const nodeModules = path.join(__dirname, '..', 'node_modules')
const macArm64 = path.join(nodeModules, 'bufferutil/prebuilds/darwin-arm64/bufferutil.node')
const macX64 = path.join(nodeModules, 'bufferutil/prebuilds/darwin-x64/bufferutil.node')
const linuxX64 = path.join(nodeModules, 'bufferutil/prebuilds/linux-x64/bufferutil.node')
const linuxArm64 = path.join(nodeModules, 'fs-native-extensions/prebuilds/linux-arm64/fs-native-extensions.node')

function app (files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-arch-'))
  for (const [dest, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, dest)), { recursive: true })
    fs.copyFileSync(src, path.join(root, dest))
  }
  return root
}

function main () {
  if (process.platform === 'win32') return console.log('Native addon arch check skipped: no `file` command on Windows')

  // Prebuilds for other targets are skipped, as node-gyp-build skips them at runtime
  checkNativeArch({
    buildPath: app({
      'n/a/build/Release/a.node': macArm64,
      'n/b/prebuilds/darwin-x64/b.node': macX64,
      'n/b/prebuilds/linux-x64/b.node': linuxX64
    }),
    platform: 'darwin',
    arch: 'arm64'
  })
  checkNativeArch({
    buildPath: app({ 'n/a/build/Release/a.node': linuxX64, 'n/b/prebuilds/linux-arm64/b.node': linuxArm64 }),
    platform: 'linux',
    arch: 'x64'
  })

  // A host-only addon built for another CPU fails the build
  assert.throws(() => checkNativeArch({
    buildPath: app({ 'n/node-datachannel/build/Release/node_datachannel.node': linuxX64 }),
    platform: 'linux',
    arch: 'arm64'
  }), /node_datachannel\.node doesn't run on linux arm64/)
  assert.throws(() => checkNativeArch({
    buildPath: app({ 'n/a/build/Release/a.node': macX64 }),
    platform: 'darwin',
    arch: 'arm64'
  }), /doesn't run on darwin arm64/)
  // A Mac addon in a Linux build, and a wrong file in the target's own prebuild folder
  assert.throws(() => checkNativeArch({ buildPath: app({ 'n/a/build/Release/a.node': macArm64 }), platform: 'linux', arch: 'arm64' }))
  assert.throws(() => checkNativeArch({ buildPath: app({ 'n/b/prebuilds/linux-arm64/b.node': linuxX64 }), platform: 'linux', arch: 'arm64' }))

  console.log('Native addon arch check passed: other targets\' prebuilds skipped, wrong-CPU addons fail the build on Mac and Linux')
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exitCode = 1
}
