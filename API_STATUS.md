
# API Documentation: Print Monitor Server

## 1. REST API: `/api/status`

### Endpoint
```
GET /api/status
```

### Description
Returns the current status of the connected Elegoo printer, including print progress, temperatures, state, camera availability, and user statistics. This endpoint is used by the web client for real-time monitoring.

### Response
#### Success: `200 OK`
```json
{
  "printer": {
    "connected": true,
    "printerName": "Centauri Carbon",
    "state": "Printing",
    "progress": 42.5,
    "layerProgress": 12.345678,
    "temperatures": {
      "bed": { "current": 60, "target": 60 },
      "nozzle": { "current": 210, "target": 210 },
      "enclosure": { "current": 30, "target": 30 }
    },
    "currentFile": "test.gcode",
    "printTime": 1234,
    "remainingTime": 4321,
    "calculatedTime": 4100,
    "cameraAvailable": true,
    "lastUpdate": "2025-12-27T12:34:56.789Z",
    "users": { ... }
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

#### Field Details
- **printer.connected**: `true` if the printer is connected.
- **printer.printerName**: Printer name (from SDCP attributes).
- **printer.state**: Printer state (`Idle`, `Printing`, `Paused`, etc.).
- **printer.progress**: Print progress percentage (float).
- **printer.layerProgress**: Layer progress percentage (float, 6 decimals).
- **printer.temperatures**: Current and target temperatures for bed, nozzle, and enclosure.
- **printer.currentFile**: Name of the file currently printing.
- **printer.printTime**: Elapsed print time in seconds.
- **printer.remainingTime**: Remaining print time in seconds (from printer).
- **printer.calculatedTime**: Estimated remaining time (calculated from progress).
- **printer.cameraAvailable**: `true` if camera stream is available.
- **printer.lastUpdate**: ISO timestamp of last status update.
- **printer.users**: User stats (same as top-level `users`).

- **users.webClients**: Number of connected web clients.
- **users.cameraClients**: Number of connected camera clients.
- **users.totalWebConnections**: Total web connections since server start.
- **users.totalCameraConnections**: Total camera connections since server start.
- **users.activeUniqueWebIPs**: Number of unique active web client IPs.
- **users.activeUniqueCameraIPs**: Number of unique active camera client IPs.

#### Errors
- `500 Internal Server Error`: On unexpected failure.

#### Example
```bash
curl http://localhost:3000/api/status
```

---

## 2. WebSocket Broadcast

### Endpoint
```
ws://<server>:<port>/
```

### Description
The server broadcasts real-time printer status updates to all connected WebSocket clients. This is used for live UI updates in the browser.

### Message Format
```json
{
  "type": "status",
  "data": {
    "connected": true,
    "printerName": "Centauri Carbon",
    "state": "Printing",
    "progress": 42.5,
    "layerProgress": 12.345678,
    "temperatures": { ... },
    "currentFile": "test.gcode",
    "printTime": 1234,
    "remainingTime": 4321,
    "calculatedTime": 4100,
    "cameraAvailable": true,
    "lastUpdate": "2025-12-27T12:34:56.789Z"
  }
}
```

### Usage
- Connect via WebSocket to the server port (default: 3000).
- Listen for messages with `type: "status"` for printer updates.

---

## 3. Camera Stream Relay

### Endpoint
```
GET /api/camera
```

### Description
Proxies the printer's MJPEG camera stream (`multipart/x-mixed-replace`) to web clients. Used for live video preview in the browser.

### Response
- Content-Type: `multipart/x-mixed-replace; boundary=--frame`
- Each part contains a JPEG image frame.

#### Example (HTML)
```html
<img src="/api/camera" alt="Printer Camera" />
```

### Notes
- The server maintains a buffer of the latest frame for instant replay to new clients.
- If the camera is not available, the endpoint returns an error JPEG frame or closes the connection.

---

**Update Rates:**
- Printer state (REST API and WebSocket): 1 update per second
- MJPEG camera stream: up to 15 frames per second (15 fps)

All endpoints and streams reflect the latest printer state and camera feed at these rates.
