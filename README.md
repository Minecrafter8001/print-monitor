# Snapmaker Moonraker Print Monitor

A Node.js dashboard for a Snapmaker or other Klipper printer with Moonraker. It subscribes to Moonraker printer objects, relays status to browsers over WebSocket, and supports MJPEG, snapshot, and browser-playable compressed camera streams.

## Requirements

- Node.js 18 or newer
- A printer running Klipper with Moonraker available over the network
- A Moonraker webcam or configured camera URL, if camera support is desired

Stock Snapmaker firmware does not necessarily expose Moonraker. Confirm that `http://PRINTER:7125/server/info` responds before configuring this monitor.

## Setup

```powershell
npm install
$env:MOONRAKER_URL = 'http://192.168.1.100:7125'
npm start
```

Open `http://localhost:3000`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOONRAKER_URL` | none | Required Moonraker base URL |
| `MOONRAKER_API_KEY` | none | API key used by `server.connection.identify` |
| `CAMERA_MODE` | `auto` | `auto`, `mjpeg`, `snapshot`, `video`, `hls`, `dash`, `h264`, or `h265` |
| `CAMERA_STREAM_URL` | Moonraker webcam entry | Optional absolute or Moonraker-relative MJPEG/video URL override |
| `CAMERA_RESOURCE_ORIGINS` | none | Comma-separated additional origins allowed for HLS/DASH resources |
| `FFMPEG_PATH` | bundled binary | Optional FFmpeg executable override for raw H.264/H.265 |
| `CAMERA_SNAPSHOT_URL` | none | Snapshot image URL; selecting it enables snapshot mode |
| `CAMERA_SNAPSHOT_INTERVAL` | `1000` | Snapshot polling interval in milliseconds, minimum 250 |
| `CAMERA_KEEPALIVE_URL` | printer WebSocket | Optional Snapmaker camera-control WebSocket URL |
| `CAMERA_KEEPALIVE_TOKEN` | none | Stock Snapmaker camera token; kept on the server |
| `CAMERA_KEEPALIVE_INTERVAL` | `10` | Keepalive interval in seconds, minimum 5 |
| `PORT` | `3000` | Dashboard HTTP port |
| `WS_UPDATE_INTERVAL` | `1000` | Minimum browser status broadcast interval in milliseconds |
| `DEBUG_DISABLE_LOCAL_IP_FILTER` | `true` | Disables local-IP filtering when true |
| `ENABLE_DEBUG_ENDPOINTS` | `false` | Enables the local-only restart endpoint |

For PM2, set the values directly in [ecosystem.config.js](ecosystem.config.js).

## Moonraker Data

The dashboard name uses Fluidd's `uiSettings.general.instanceName` database setting. If it is unavailable or blank, the monitor falls back to the hostname returned by `printer.info`.

The client first calls `printer.objects.list`, then subscribes to core status objects, every available `extruder*`, and all temperature sensors. This supports Snapmaker multi-tool systems and custom names such as `temperature_sensor cavity` without hardcoded tool numbers.

Partial `notify_status_update` messages are merged into a cached object state. File metadata is loaded through `server.files.metadata` when the active filename changes. Remaining time is therefore a slicer metadata estimate, not a value reported directly by Klipper.

Toolhead filament labels prefer Snapmaker RFID material and color data. For untagged spools, the dashboard falls back to per-tool material and color stored in the active G-code metadata; the physical filament sensors still determine whether filament is loaded.

Webcams are loaded through `server.webcams.list`. Relative URLs are resolved against `MOONRAKER_URL`; configured camera URLs take precedence.

For a stock Snapmaker snapshot camera, configure:

```powershell
$env:CAMERA_MODE = 'snapshot'
$env:CAMERA_SNAPSHOT_URL = 'http://PRINTER/server/files/camera/monitor.jpg'
$env:CAMERA_KEEPALIVE_URL = 'ws://PRINTER/websocket?token=TOKEN'
$env:CAMERA_KEEPALIVE_TOKEN = 'TOKEN'
```

The server calls `camera.start_monitor` every ten seconds and polls the snapshot without exposing the token to browsers. `CAMERA_KEEPALIVE_URL` may omit the query token; the token variable remains required to enable keepalive.

Set `CAMERA_MODE=video` for directly browser-playable MP4 or WebM, `hls` for an M3U8 manifest, `dash` for an MPD manifest, and `h264` or `h265` for a raw elementary stream. HLS.js and dash.js handle adaptive playback; the server proxies manifest resources. Same-origin resources are allowed automatically, while CDN origins must be listed in `CAMERA_RESOURCE_ORIGINS`. Raw H.264 is remuxed into fragmented MP4 and raw H.265 is transcoded to H.264 by the bundled FFmpeg binary.

## API

- `GET /api/status`: current `{ printer, users }` snapshot
- `GET /api/camera`: relayed MJPEG or polled snapshot stream
- `GET /api/camera/video`: proxied adaptive/direct video or FFmpeg-converted raw stream
- `GET /api/admin`: local-only connection statistics
- WebSocket `/`: `type: "status"` notifications

The printer object contains `connected`, `name`, `klipper`, `print`, `temperatures`, `camera`, and `updatedAt`.

## Development

```powershell
npm test
node utils/websocket-tester.js http://192.168.1.100:7125
node utils/moonraker-probe.js http://192.168.1.100:7125
```