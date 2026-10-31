## Release Process

Release files are built by the `package` workflow on GitHub Actions and published as a GitHub release. The builds are not signed, and the Mac build is Apple Silicon only (M1 and later).

### 1. Create a new version

- Make sure CI is green on `master`.

- Update the version. This creates a commit and a `v<version>` tag:

  ```
  npm version [major|minor|patch] -m "Version %s"
  ```

- Push the commit and the tag:

  ```
  git push origin master v<version>
  ```

### 2. Build the release files

- Run the `package` workflow on the tag and wait for it to finish:

  ```
  gh workflow run package.yml --ref v<version>
  gh run list --workflow package.yml --limit 1
  gh run watch <run-id>
  ```

- Download its artifacts into an empty folder outside the repo. Each platform is extracted into its own subfolder (`linux`, `macos`, `windows`):

  ```
  gh run download <run-id> -D <folder>
  ```

- Move the files to upload into one folder: the `.dmg`, the Mac, Windows and Linux `.zip` files, `WebTorrentSetup-v<version>.exe`, and the `.deb` and `.rpm` files. Leave out the `.nupkg`. Compare with the previous release: it should be the same set of files, no more, no less.

- In that folder, write the checksums file:

  ```
  shasum -a 256 * > SHA256SUMS.txt
  ```

### 3. Create a draft release

```
gh release create v<version> --verify-tag --draft --title v<version> --notes-file <notes.md> <folder>/*
```

The title is just the tag. Start the notes with the "Unofficial build" paragraph, and reuse the "Before you install" and "Install" sections of the previous release with the version numbers updated.

### 4. Test it

**This is the most important part.**

- Download the files for each platform from the draft release.

  **Do not use your locally built files.** Operating systems treat downloaded apps differently, even when the files are byte for byte identical.

- Smoke test WebTorrent Desktop on each platform:

  1. Click "Play" to stream a built-in torrent (e.g. Sintel).
     - Seeking to a part that hasn't downloaded yet should play right away.
     - The file should be saved to the download folder (`~/Downloads` by default).

  2. Add a .torrent file by drag and drop.
     - It should be added to the list and start downloading.

  3. Remove a torrent and its data.
     - The files should be removed from the download folder.

  4. Create and seed a new torrent by drag and drop.
     - The torrent should be created and start seeding.

### 5. Publish it

```
gh release edit v<version> --draft=false --latest
```
