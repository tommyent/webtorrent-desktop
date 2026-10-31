// A packager afterPrune hook: fail the build if a native addon the app loads can't run on
// the target CPU. npm installs some addons (node-datachannel) for the build machine only.
const cp = require('child_process')
const fs = require('fs')
const path = require('path')

module.exports = function checkNativeArch ({ buildPath, platform, arch }) {
  // How `file` names each target's CPU
  const machine = { darwin: { arm64: 'arm64' }, linux: { x64: 'x86-64', arm64: 'aarch64', armv7l: 'ARM,' } }[platform][arch]
  // node-gyp-build skips prebuilds/<platform>-<arch> folders for other targets at runtime;
  // anything else (a build/Release addon, or this target's prebuild) is what the app loads.
  const addons = fs.readdirSync(buildPath, { recursive: true }).filter(file => {
    if (!file.endsWith('.node')) return false
    const dirs = file.split(path.sep)
    if (!dirs.includes('prebuilds')) return true
    const [prebuildPlatform, prebuildArches = ''] = dirs[dirs.indexOf('prebuilds') + 1].split('-')
    return prebuildPlatform === platform && prebuildArches.split('+').includes(arch)
  })
  for (const file of addons) {
    const type = cp.execFileSync('file', ['-b', path.join(buildPath, file)], { encoding: 'utf8' })
    if (!type.includes(machine)) {
      throw new Error(`${file} doesn't run on ${platform} ${arch}: ${type.trim()}`)
    }
  }
}
