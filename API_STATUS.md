
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
    "state": 0,
    "progress": 42.5,
    "temperatures": {
      "bed": { "current": 60, "target": 60 },
      "nozzle": { "current": 210, "target": 210 },
      "enclosure": { "current": 30, "target": 30 }
    },
    "currentFile": "test.gcode",
    "printTime": 1234,
    "remainingTime": 4321,
    "layers": {
      "total": 250,
      "current": 106
    },
    "status": {
      "consolidated": "PRINTING",
      "machine": { "state": "PRINTING", "code": 0 },
      "job": { "state": "PRINTING", "code": 1 }
    },
    "status_code": 0,
    "prev_status": "IDLE",
    "customState": 0,
    "cameraAvailable": true,
    "lastUpdate": "2026-01-03T12:34:56.789Z",
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
- **printer.state**: Numeric status code (for backward compatibility, same as `status_code`).
- **printer.progress**: Print progress percentage (0-100, float).
- **printer.temperatures**: Current and target temperatures for bed, nozzle, and enclosure.
- **printer.currentFile**: Name of the file currently printing.
- **printer.printTime**: Elapsed print time in seconds.
- **printer.remainingTime**: Remaining print time in seconds (from printer).
- **printer.layers**: Layer information with `total` and `current` layer numbers.
- **printer.status**: Detailed status object with:
  - **consolidated**: Overall printer state (`IDLE`, `PRINTING`, `PAUSED`, `UNKNOWN`, etc.)
  - **machine**: Machine state with `state` label and `code` number
  - **job**: Job state with `state` label and `code` number
- **printer.status_code**: Primary machine status code (number).
- **printer.prev_status**: Previous consolidated status (for tracking transitions).
- **printer.customState**: Custom state code (0 = normal, non-zero for special conditions).
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

## 2. REST API: `/api/discover`

### Endpoint
```
GET /api/discover
```

### Description
Discovers Elegoo printers on the local network using UDP broadcast. Returns a list of all discovered printers with their IP addresses and attributes.

### Response
#### Success: `200 OK`
```json
{
  "success": true,
  "printers": [
    {
      "address": "192.168.1.100",
      "Name": "Centauri Carbon",
      "Id": "ABC123DEF456",
      "Attributes": { ... }
    }
  ]
}
```

#### Errors
- `500 Internal Server Error`: On discovery failure.

```json
{
  "success": false,
  "error": "Discovery failed: ..."
}
```

#### Example
```bash
curl http://localhost:3000/api/discover
```

---

## 3. REST API: `/api/connect/:ip`

### Endpoint
```
POST /api/connect/:ip
```

### Description
Connects to a specific Elegoo printer at the given IP address. Disconnects any existing connection first.

### Parameters
- **ip** (path parameter): IP address of the printer to connect to (e.g., `192.168.1.100`).

### Response
#### Success: `200 OK`
```json
{
  "success": true,
  "message": "Connected to printer"
}
```

#### Errors
- `500 Internal Server Error`: On connection failure.

```json
{
  "success": false,
  "error": "Connection failed: ..."
}
```

#### Example
```bash
curl -X POST http://localhost:3000/api/connect/192.168.1.100
```

---

## 4. REST API: `/api/admin`

### Endpoint
```
GET /api/admin
```

### Description
Returns detailed administrative information about the server, including all connected clients, their IP addresses, user agents, and printer status. **This endpoint is only accessible from local IP addresses** (127.0.0.1, 192.168.x.x, 10.x.x.x, etc.).

### Response
#### Success: `200 OK`
```json
{
  "success": true,
  "admin": {
    "accessIP": "192.168.1.50",
    "timestamp": "2026-01-03T12:34:56.789Z",
    "webClients": {
      "active": 2,
      "total": 5,
      "uniqueIPCount": 2,
      "clients": [
        {
          "ip": "192.168.1.50",
          "userAgent": "Mozilla/5.0 ..."
        }
      ]
    },
    "cameraClients": {
      "active": 1,
      "total": 3,
      "uniqueIPCount": 1,
      "clients": [
        {
          "ip": "192.168.1.51",
          "userAgent": "Mozilla/5.0 ..."
        }
      ]
    },
    "printer": {
      "connected": true,
      "name": "Centauri Carbon",
      "state": "PRINTING",
      "cameraAvailable": true,
      "lastUpdate": "2026-01-03T12:34:56.789Z"
    }
  }
}
```

#### Errors
- `404 Not Found`: When accessed from a non-local IP address (access denied).

#### Example
```bash
curl http://localhost:3000/api/admin
```

---

## 5. WebSocket Broadcast

### Endpoint
```
ws://<server>:<port>/
```

### Description
The server broadcasts real-time printer status updates to all connected WebSocket clients. Updates are throttled to a maximum of once per second. This is used for live UI updates in the browser.

### Message Format
```json
{
  "type": "status",
  "data": {
    "printer": {
      "connected": true,
      "printerName": "Centauri Carbon",
      "state": 0,
      "progress": 42.5,
      "temperatures": { ... },
      "currentFile": "test.gcode",
      "printTime": 1234,
      "remainingTime": 4321,
      "layers": {
        "total": 250,
        "current": 106
      },
      "status": {
        "consolidated": "PRINTING",
        "machine": { "state": "PRINTING", "code": 0 },
        "job": { "state": "PRINTING", "code": 1 }
      },
      "status_code": 0,
      "prev_status": "IDLE",
      "customState": 0,
      "cameraAvailable": true,
      "lastUpdate": "2026-01-03T12:34:56.789Z",
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
}
```

### Usage
- Connect via WebSocket to the server port (default: 3000).
- Listen for messages with `type: "status"` for printer updates.
- Updates are broadcast whenever printer status changes or when user stats change.
- Updates are throttled to once per second maximum.

---

## 6. Camera Stream Relay

### Endpoint
```
GET /api/camera
```

### Description
Proxies the printer's MJPEG camera stream (`multipart/x-mixed-replace`) to web clients. Used for live video preview in the browser. The stream is rate-limited to a maximum of 15 FPS.

### Response
- Content-Type: `multipart/x-mixed-replace; boundary=frame`
- Each part contains a JPEG image frame.

#### Example (HTML)
```html
<img src="/api/camera" alt="Printer Camera" />
```

### Notes
- The server maintains a buffer of the latest frame for instant replay to new clients.
- Stream is rate-limited to 15 FPS (frames per second) maximum.
- If the camera is not available, the connection will fail or close.
- Client connections are tracked for user statistics.

---

**Update Rates:**
- Printer state polling (from printer): every 2 seconds
- WebSocket broadcast (to clients): throttled to once per second
- MJPEG camera stream: up to 15 frames per second (15 FPS)

All endpoints and streams reflect the latest printer state and camera feed at these rates.
