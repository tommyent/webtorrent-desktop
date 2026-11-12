# Privacy

This fork does not send telemetry or crash reports or fetch announcements.

When it opens, it asks GitHub's releases API once whether a newer version of
this fork exists, and shows a line in the torrent list if so. The request
carries no identifier, but GitHub sees your IP address, as any website does.
Turn it off in Preferences → General → "Check for new versions when WebTorrent
opens". Nothing is downloaded or installed for you: install updates manually.

Torrent networking (peers, trackers, DHT, and web seeds) still operates normally.
