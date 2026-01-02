# Elegoo Print Monitor

A Node.js web server that provides real-time monitoring of Elegoo 3D printers, specifically the Elegoo Centauri Carbon, with live status updates and camera feed streaming.

## Features

- 🔍 **Auto-Discovery**: Automatically discovers Elegoo printers on the local network using UDP broadcast
- 📊 **Real-Time Status**: Live monitoring of printer state, print progress, and temperatures
- 📹 **Camera Feed**: Live video streaming from the printer's camera (if available)
- 🌐 **Web Interface**: Clean, responsive web interface accessible from any browser
- 🔄 **Auto-Reconnect**: Automatically reconnects to the printer if connection is lost
- 📡 **WebSocket Updates**: Real-time updates pushed to the browser via WebSocket

## Supported Printers

- Elegoo Centauri Carbon (via SDCP protocol)
- Other Elegoo printers using the SDCP protocol

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Minecrafter8001/elegoo-print-monitor.git
   cd elegoo-print-monitor
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

## Usage

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Access the web interface**:
   Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

3. **Monitor your printer**:
   - The server will automatically discover and connect to Elegoo printers on your local network
   - View real-time status, temperatures, print progress, and camera feed
   - The interface updates automatically as the printer status changes

## Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
  ```bash
  PORT=8080 npm start
  ```

### Custom Printer IP

If auto-discovery doesn't work, you can manually connect to a printer using the API:

```bash
curl -X POST http://localhost:3000/api/connect/192.168.1.100
```

## API Endpoints

### GET /api/status
Returns current printer status as JSON.

**Response**:
```json
{
  "connected": true,
  "printerName": "Elegoo Printer",
  "state": "Printing",
  "progress": 45,
  "temperatures": {
    "bed": { "current": 60, "target": 60 },
    "nozzle": { "current": 210, "target": 210 }
  },
  "currentFile": "model.gcode",
  "printTime": 1234,
  "remainingTime": 5678,
  "cameraURL": "http://192.168.1.100:8080/stream",
  "lastUpdate": "2025-12-25T17:27:35.270Z"
}
```

### GET /api/discover
Discovers printers on the network.

**Response**:
```json
{
  "success": true,
  "printers": [
    {
      "address": "192.168.1.100",
      "Name": "Elegoo Printer",
      "Id": "ABC123"
    }
  ]
}
```

### POST /api/connect/:ip
Connects to a specific printer by IP address.

**Example**:
```bash
curl -X POST http://localhost:3000/api/connect/192.168.1.100
```

## Technical Details

### SDCP Protocol

The Elegoo Centauri Carbon uses the SDCP (Smart Device Communication Protocol) for network communication:

- **Discovery**: UDP broadcast on port 3000 with message "M99999"
- **Connection**: WebSocket connection to `ws://PRINTER_IP:3030/websocket`
- **Communication**: JSON-formatted messages with command IDs

### Key Commands

- `Cmd: 0` - Request printer status
- `Cmd: 1` - Request printer attributes
- `Cmd: 386` - Request camera stream URL

### Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │◄───────►│  Web Server  │◄───────►│   Printer   │
│             │ WebSocket│  (Node.js)   │ WebSocket│  (SDCP)     │
│   (UI)      │         │              │         │             │
└─────────────┘         └──────────────┘         └─────────────┘
                              │
                              │ UDP Broadcast
                              ▼
                        Discovery (Port 3000)
```

## Network Requirements

- Printer and server must be on the same local network
- UDP port 3000 must be accessible for discovery
- TCP port 3030 on the printer for WebSocket connection
- No authentication required (local network communication)

## Troubleshooting

### Printer not discovered
- Ensure the printer is powered on and connected to the same network
- Check that UDP port 3000 is not blocked by firewall
- Try manually connecting using the IP address via `/api/connect/:ip`

### Camera feed not showing
- Some printers may not have camera support enabled
- Check printer settings to ensure camera is enabled
- Camera URL is requested via SDCP command 386

### Connection lost
- The server automatically attempts to reconnect every 5 seconds
- Check network connectivity between server and printer
- Restart the server if issues persist

## Development

### Project Structure

```
elegoo-print-monitor/
├── server.js              # Main server and WebSocket handler
├── printer-discovery.js   # UDP discovery module
├── sdcp-client.js        # SDCP WebSocket client
├── package.json          # Dependencies and scripts
└── public/               # Web interface files
    ├── index.html        # Main HTML page
    ├── style.css         # Styling
    └── app.js            # Client-side JavaScript
```

### Testing

Run unit tests with:

```bash
npm test
```

### Dependencies

- **express**: Web server framework
- **ws**: WebSocket library
- **uuid**: UUID generation for SDCP messages

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Elegoo for the SDCP protocol documentation
- Community projects like OpenCentauri for protocol insights

## Support

For issues and questions, please open an issue on GitHub.
