# Casting engine interface

Status: the relocation interface is implemented. The protocol-adapter invariants remain design requirements for a future protocol rewrite.

## Decision

Casting protocol code belongs in the hidden WebTorrent engine window. The UI renderer owns presentation and user intent. The Electron main process only relays the existing `wt-*` IPC messages; it does not discover devices, parse LAN traffic, or control playback.

This keeps the protocol implementation beside the WebTorrent client and shared streaming server while allowing the UI renderer to eventually disable Node integration.

## Boundary

```text
UI renderer  -- serializable commands -->  hidden WebTorrent engine
UI renderer  <-- serializable snapshots -- hidden WebTorrent engine
                         |
                         +-- mDNS / SSDP / Cast / DLNA / AirPlay
                         +-- WebTorrent client and shared HTTP server
```

No sockets, protocol-client objects, timers, callbacks, or mutable application state cross the boundary. Device and session messages are immutable snapshots.

The UI must not supply arbitrary stream URLs. It identifies media with the existing ephemeral `torrentKey` and a file index; the engine resolves those identifiers and constructs the shared-server URL it owns.

## Commands

All commands use one `wt-cast-command` channel and this envelope:

```js
{
  requestId: 'renderer-generated unique string',
  action: 'scan' | 'start' | 'control' | 'stop',
  payload: {}
}
```

Payloads:

```js
// Start or stop discovery. Discovery remains lazy.
{ action: 'scan', payload: { enabled: true } }

// Start a new remote playback session.
{
  action: 'start',
  payload: {
    deviceId: 'protocol-stable identifier',
    torrentKey: 12,
    fileIndex: 0,
    isPaused: false,
    currentTime: 30,
    volume: 0.8,
    playbackRate: 1,
    subtitle: { buffer: 'data:text/vtt;base64,...' } // optional
}

// Control the active session.
{
  action: 'control',
  payload: {
    sessionId: 'engine-issued unique string',
    command: 'play' | 'pause' | 'seek' | 'volume' | 'rate',
    value: 30
  }
}

// Stop the active session and release its protocol client.
{
  action: 'stop',
  payload: { sessionId: 'engine-issued unique string' }
}
```

`value` is required only when the selected command needs it. The engine validates command-specific ranges before touching a protocol client.

## Events

The engine sends one `wt-cast-event` envelope:

```js
{
  type: 'devices' | 'session' | 'error',
  payload: {}
}
```

Device snapshots replace the previous snapshot rather than incrementally mutating UI state:

```js
{
  type: 'devices',
  payload: {
    revision: 4,
    devices: [{
      id: 'protocol-stable identifier',
      protocol: 'chromecast' | 'dlna' | 'airplay',
      name: 'Living Room TV'
    }]
  }
}
```

Protocol identity is mandatory: Chromecast TXT `id` where available, DLNA UDN/USN, and the best stable AirPlay identifier available. Display names are never keys. `revision` increases for every replacement snapshot so the UI can discard stale delivery.

Session snapshots contain only renderer-facing state:

```js
{
  type: 'session',
  payload: {
    sessionId: 'engine-issued unique string',
    deviceId: 'protocol-stable identifier',
    state: 'connecting' | 'playing' | 'paused' | 'stopped',
    currentTime: 30,
    duration: 120,
    volume: 0.8,
    playbackRate: 1
  }
}
```

Errors are data, not serialized `Error` objects:

```js
{
  type: 'error',
  payload: {
    requestId: 'matching command when available',
    sessionId: 'matching session when available',
    code: 'DEVICE_GONE',
    message: 'Living Room TV is no longer available',
    recoverable: true
  }
}
```

## Engine invariants

- At most one active cast session exists.
- Starting a session stops and releases the previous session first.
- Controls with a stale or unknown `sessionId` are rejected without affecting the active session.
- Discovery owns its sockets and timers and closes all of them when disabled or when the engine shuts down.
- Device membership follows protocol TTL and explicit departure messages; a discovered-device list never grows forever.
- A protocol error produces one normalized error event and leaves the engine in either a usable active state or the stopped state.
- Test mode uses an in-memory adapter behind this same interface; production protocol modules are not loaded by integration tests.

## Protocol adapters

Each protocol adapter implements the same engine-local interface:

```js
{
  startDiscovery(onSnapshot, onError),
  stopDiscovery(),
  connect(deviceId, media),
  control(session, command, value),
  stop(session),
  destroy()
}
```

The adapter interface is not IPC and is never imported by the UI or main process. Chromecast may retain `castv2-client` and the existing `multicast-dns` dependency. DLNA may use an owned SSDP implementation. AirPlay remains explicitly best-effort.

## Preconditions for replacing the protocol implementation

A future casting branch must provide all of the following before replacing the existing protocol implementation in `src/renderer/cast.js`:

1. Recorded mDNS and SSDP fixtures covering discovery, refresh, expiry, departure, malformed packets, and duplicate devices.
2. Fake-clock tests for TTL expiration and session polling.
3. Shutdown tests proving sockets, timers, and protocol clients are released.
4. Hardware smoke checks for one Chromecast and one DLNA renderer; AirPlay is best-effort.
5. A clean cutover of every casting caller, with no compatibility shim left in the UI renderer.

Until those preconditions are met, the current casting protocol implementation remains unchanged in the hidden engine.
