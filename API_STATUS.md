# Print Monitor API

## `GET /api/status`

Returns the current Moonraker-derived status and browser/camera usage counters.

```json
{
  "printer": {
    "connected": true,
    "name": "snapmaker",
    "klipper": { "state": "ready", "message": "Printer is ready" },
    "print": {
      "state": "printing",
      "filename": "part.gcode",
      "progressPercent": 42.5,
      "elapsedSeconds": 1234,
      "estimatedRemainingSeconds": 4321,
      "layers": { "current": 106, "total": 250 }
    },
    "temperatures": {
      "bed": { "current": 60, "target": 60 },
      "activeTool": {
        "name": "extruder3",
        "friendlyName": "Toolhead 4",
        "current": 210,
        "target": 210
      },
      "enclosure": {
        "name": "temperature_sensor cavity",
        "current": 30,
        "target": 0
      },
      "tools": [
        {
          "name": "extruder",
          "friendlyName": "Toolhead 1",
          "current": 32,
          "target": 0,
          "active": false,
          "filament": { "material": "PLA", "color": "#8C9099", "source": "gcode", "loaded": true }
        },
        {
          "name": "extruder3",
          "friendlyName": "Toolhead 4",
          "current": 210,
          "target": 210,
          "active": true,
          "filament": { "material": "PLA", "color": "#000000", "source": "gcode", "loaded": true }
        }
      ]
    },
    "camera": { "available": true, "error": null },
    "updatedAt": "2026-09-12T12:34:56.789Z"
  },
  "users": {
    "webClients": 2,
    "cameraClients": 1,
    "totalWebConnections": 5,
    "totalCameraConnections": 3,
    "activeUniqueWebIPs": 2,
    "activeUniqueCameraIPs": 1
  }
}
```

`print.state` is the raw Moonraker `print_stats.state`. `klipper.state` is the raw `webhooks.state`. `estimatedRemainingSeconds` is `null` when slicer metadata has no estimated duration.

Each tool's `filament` prefers Snapmaker RFID data from `filament_detect`. When RFID data is unavailable, `material` and `color` fall back to the current G-code's slicer metadata and `source` is `"gcode"`. `loaded` comes from the tool's physical filament sensor and may be `null` when that sensor is unavailable.

## `GET /api/camera`

Returns a `multipart/x-mixed-replace` MJPEG stream relayed from the first enabled Moonraker webcam, or from `CAMERA_STREAM_URL` when configured.

## `GET /api/admin`

Returns active and cumulative browser/camera connection information. Access is limited by the server's local-IP policy.

## WebSocket `/`

Status events use `{ "type": "status", "data": { "printer": {}, "users": {} } }`. The `data` value has the same shape as `GET /api/status`.