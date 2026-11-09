// Builds are unsigned, so there is no auto-update. This is the app's only
// update traffic: one request per launch to GitHub's releases API, turned off
// by the "Check for new versions" preference. Nothing is downloaded.
const semver = require('semver')

const LATEST_RELEASE = 'https://api.github.com/repos/tommyent/webtorrent-desktop/releases/latest'

// Resolves to the newer version's number, or null
module.exports = async function newerVersion (fetch, current) {
  const response = await fetch(LATEST_RELEASE, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000)
  })
  if (!response.ok) return null
  const version = semver.clean(String((await response.json()).tag_name))
  return version && semver.gt(version, current) ? version : null
}
