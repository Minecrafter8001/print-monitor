# Snapmaker Moonraker Print Monitor

A Node.js dashboard for a Snapmaker or other Klipper printer with Moonraker. It subscribes to Moonraker printer objects, relays status to browsers over WebSocket, and proxies an MJPEG webcam stream.

## Requirements

- Node.js 18 or newer
- A printer running Klipper with Moonraker available over the network
- An MJPEG webcam configured in Moonraker, if camera support is desired

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
| `CAMERA_STREAM_URL` | Moonraker webcam entry | Optional absolute or Moonraker-relative MJPEG URL override |
| `PORT` | `3000` | Dashboard HTTP port |
| `WS_UPDATE_INTERVAL` | `1000` | Minimum browser status broadcast interval in milliseconds |
| `DEBUG_DISABLE_LOCAL_IP_FILTER` | `true` | Disables local-IP filtering when true |
| `ENABLE_DEBUG_ENDPOINTS` | `false` | Enables the local-only restart endpoint |

For PM2, provide the variables in the shell before loading [ecosystem.config.js](ecosystem.config.js).

## Moonraker Data

The dashboard name uses Fluidd's `uiSettings.general.instanceName` database setting. If it is unavailable or blank, the monitor falls back to the hostname returned by `printer.info`.

The client first calls `printer.objects.list`, then subscribes to core status objects, every available `extruder*`, and all temperature sensors. This supports Snapmaker multi-tool systems and custom names such as `temperature_sensor cavity` without hardcoded tool numbers.

Partial `notify_status_update` messages are merged into a cached object state. File metadata is loaded through `server.files.metadata` when the active filename changes. Remaining time is therefore a slicer metadata estimate, not a value reported directly by Klipper.

Webcams are loaded through `server.webcams.list`. Relative stream URLs are resolved against `MOONRAKER_URL`; use `CAMERA_STREAM_URL` when the camera is exposed through a different reverse-proxy host or port.

## API

- `GET /api/status`: current `{ printer, users }` snapshot
- `GET /api/camera`: relayed MJPEG stream
- `GET /api/admin`: local-only connection statistics
- WebSocket `/`: `type: "status"` notifications

The printer object contains `connected`, `name`, `klipper`, `print`, `temperatures`, `camera`, and `updatedAt`.

## Development

```powershell
npm test
node utils/websocket-tester.js http://192.168.1.100:7125
node utils/moonraker-probe.js http://192.168.1.100:7125
```