# Build from source

## Get the code

```sh
git clone https://github.com/tommyent/webtorrent-desktop.git
cd webtorrent-desktop
npm ci
```

Use Node.js ≥22.12.0 and npm ≥10.0.0 for development.

## Run the app

```sh
npm start
```

## Watch the code

Restart the app automatically every time code changes. Useful during development.

```sh
npm run watch
```

## Run linters

```sh
npm test
```

## Run tests

```sh
npm run build
npm run test-unit
CI=1 npm run test-integration
```

The unit tests cover controller and engine behavior. The integration tests use Playwright and
Tape to click through the app and compare screenshots with the checked-in baselines. `CI=1` skips
the live-video and fullscreen screenshots, which vary with graphics hardware and display settings.
CI runs the full integration suite on macOS and the audit UI test on Windows and Linux.

For intentional UI changes on macOS, regenerate the baselines and review the image diffs:

```sh
UPDATE_SCREENSHOTS=1 npm run test-integration
CI=1 npm run test-integration
```

Run one Electron test suite at a time; the suites share a temporary test profile.

## Package the app

Builds the app for the current platform.

```sh
npm run package
```

To choose the platform and options:

```sh
npm run package -- [platform] [options]
```

Where `[platform]` is `darwin`, `linux`, `win32`, or `all`. When omitted, the current platform is
built.

The following optional arguments are available:

- `--sign` - Sign the application (Mac, Windows)
- `--arch=[architecture]` - Override the target architecture. macOS supports only `arm64`;
  Linux supports `arm64`, `armv7l`, and `x64` (the build machine's by default);
  Windows supports only `x64`.
- `--package=[type]` - Package single output type.
  - `deb` - Debian package
  - `rpm` - RedHat package
  - `zip` - ZIP archive (Mac, Linux)
  - `dmg` - Mac disk image
  - `exe` - Windows installer
  - `portable` - Windows portable app
  - `all` - All types for the platform (default)

Note: Mac builds always produce a ZIP archive, even with `--package=dmg`.

### Windows build notes

Package the Windows app on **Windows**, as the release builds do. To build its installer on
macOS or Linux, install Wine and [Mono](https://www.mono-project.com/).

Windows code signing only works on **Windows**.

### Mac build notes

The Mac app can only be packaged from **macOS**.

macOS packages are Apple Silicon only (M1 and later), and the build fails if a native addon in
the app has no Apple Silicon code. For a quicker local build without the DMG, run:

```sh
npm run package -- darwin --package=zip
```

### Linux build notes

Package the Linux app on Linux, on the CPU it's for: npm installs some native addons for the
build machine only, and the build fails if an addon in the app doesn't match the target. The
release builds use x64 and arm64 runners. The Linux zip's `webtorrent-desktop` script starts the
app without Chromium's sandbox, as the `.deb`'s menu entry does, since a zip can't keep its
sandbox helper setuid root.

## Recommended readings

- [Electron documentation](https://www.electronjs.org/docs/latest) — the desktop framework.
- [React documentation](https://react.dev/learn) — the UI library.
