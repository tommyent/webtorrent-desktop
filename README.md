<h1 align="center">
  <br>
  <a href="https://webtorrent.io">
    <img src="https://webtorrent.io/img/WebTorrent.png" alt="WebTorrent" width="200">
  </a>
  <br>
  WebTorrent Desktop
  <br>
  <br>
</h1>

<h4 align="center">The streaming torrent app. For Mac, Windows, and Linux.</h4>

An unofficial, maintained fork of
[WebTorrent Desktop](https://github.com/webtorrent/webtorrent-desktop), which has had only
automated dependency updates since August 2024. This fork updates the app to Electron 44,
WebTorrent 3, and React 19, with:

- Native Apple Silicon and Intel Mac builds.
- Faster startup and resume of unfinished downloads.
- A start/pause switch and checkboxes for removing multiple torrents.
- IINA support on macOS, alongside VLC and other external players.
- No telemetry, crash reports, announcements, or update checks (see [Privacy](#privacy)).

<p align="center">
  <a href="https://github.com/tommyent/webtorrent-desktop/actions/workflows/ci.yml"><img src="https://github.com/tommyent/webtorrent-desktop/actions/workflows/ci.yml/badge.svg" alt="GitHub CI action"></a>
  <a href="https://standardjs.com"><img src="https://img.shields.io/badge/code_style-standard-brightgreen.svg" alt="Standard - JavaScript Style Guide"></a>
</p>

## Install

Download a build for macOS, Windows or Linux from the
[releases page](https://github.com/tommyent/webtorrent-desktop/releases). The builds are not
signed, so each release's notes explain how to open them the first time. You can also
[build it from source](#how-to-contribute) and package it for your platform (see
[Package the app](#package-the-app)).

The [upstream website](https://webtorrent.io/desktop/) and `brew install --cask webtorrent`
distribute the upstream app and do not include this fork's changes.

## Screenshots

These screenshots show the upstream app; this fork has updated list controls.

<p align="center">
  <img src="https://webtorrent.io/img/screenshot-player3.png" alt="screenshot" align="center">
  <img src="https://webtorrent.io/img/screenshot-main.png" width="612" height="749" alt="screenshot" align="center">
</p>

## How to Contribute

### Get the code

```
$ git clone https://github.com/tommyent/webtorrent-desktop.git
$ cd webtorrent-desktop
$ npm ci
```

Development requires Node.js 22.12 or newer and npm 10 or newer.

### Run the app

```
$ npm start
```

### Watch the code

Restart the app automatically every time code changes. Useful during development.

```
$ npm run watch
```

### Run linters

```
$ npm test
```

### Run tests

```
$ npm run build
$ npm run test-unit
$ CI=1 npm run test-integration
```

The unit tests cover controller and engine behavior. The integration tests use Playwright and
Tape to click through the app and compare screenshots with the checked-in baselines. `CI=1` skips
the live-video and fullscreen screenshots, which vary with graphics hardware and display settings.
CI runs the full integration suite on macOS and the audit UI test on Windows and Linux.

For intentional UI changes on macOS, regenerate the baselines and review the image diffs:

```
$ UPDATE_SCREENSHOTS=1 npm run test-integration
$ CI=1 npm run test-integration
```

Run one Electron test suite at a time; the suites share a temporary test profile.

### Package the app

Builds app binaries for Mac, Linux, and Windows.

```
$ npm run package
```

To build for one platform:

```
$ npm run package -- [platform] [options]
```

Where `[platform]` is `darwin`, `linux`, `win32`, or `all`. When omitted, the current platform is
built.

The following optional arguments are available:

- `--sign` - Sign the application (Mac, Windows)
- `--arch=[architecture]` - Override the target architecture. macOS supports `arm64`, `x64`, and
  `universal` (the default); Linux supports `arm64`, `armv7l`, and `x64`.
- `--package=[type]` - Package single output type.
   - `deb` - Debian package
   - `rpm` - RedHat package
   - `zip` - Linux zip file
   - `dmg` - Mac disk image
   - `exe` - Windows installer
   - `portable` - Windows portable app
   - `all` - All platforms (default)

Note: Mac builds always produce a ZIP archive, even with `--package=dmg`.

#### Windows build notes

The Windows app can be packaged from **any** platform.

Note: Windows code signing only works from **Windows**, for now.

Note: To package the Windows app from non-Windows platforms,
[Wine](https://www.winehq.org/) and [Mono](https://www.mono-project.com/) need
to be installed. For example on Mac, first install
[XQuartz](http://www.xquartz.org/), then run:

```
$ brew install wine mono
```

(Requires the [Homebrew](http://brew.sh/) package manager.)

#### Mac build notes

The Mac app can only be packaged from **macOS**.

macOS packages are universal by default, so the resulting app runs natively on Apple Silicon and
Intel Macs. For a faster local Apple Silicon-only build, run:

```
$ npm run package -- darwin --arch=arm64 --package=zip
```

#### Linux build notes

The Linux app can be packaged from **any** platform.

If packaging from Mac, install system dependencies with Homebrew by running:

```
npm run install-system-deps
```

#### Recommended readings to start working in the app

Electron (framework for desktop apps for Windows, macOS, and Linux in JavaScript):
https://www.electronjs.org/docs/latest

React (the UI library):
https://react.dev/learn

### Privacy

This fork does not send telemetry or crash reports, fetch announcements, or check
for upstream updates. Install updates manually. Torrent networking (peers,
trackers, DHT, and web seeds) still operates normally.

## License

MIT. Copyright (c) [WebTorrent, LLC](https://webtorrent.io).
