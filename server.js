const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const PrinterDiscovery = require('./printer-discovery');
const SDCPClient = require('./sdcp-client');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Store printer data
let printerClient = null;
let printerStatus = {
  connected: false,
  printerName: 'Unknown',
  state: 'Disconnected',
  progress: 0,
  temperatures: {
    bed: { current: 0, target: 0 },
    nozzle: { current: 0, target: 0 }
  },
  currentFile: '',
  printTime: 0,
  remainingTime: 0,
  cameraURL: null,
  lastUpdate: null
};

// WebSocket clients connected to the web interface
const webClients = new Set();

// Serve static files
app.use(express.static('public'));

// API endpoint to get current printer status
app.get('/api/status', (req, res) => {
  res.json(printerStatus);
});

// API endpoint to discover printers
app.get('/api/discover', async (req, res) => {
  try {
    const discovery = new PrinterDiscovery();
    const printers = await discovery.discover(3000);
    res.json({ success: true, printers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API endpoint to connect to a specific printer
app.post('/api/connect/:ip', express.json(), async (req, res) => {
  const printerIP = req.params.ip;
  
  try {
    // Disconnect existing connection
    if (printerClient) {
      printerClient.disconnect();
    }

    // Create new connection
    printerClient = new SDCPClient(printerIP);
    
    // Set up status callback
    printerClient.onStatus((data) => {
      updatePrinterStatus(data);
    });

    // Connect
    await printerClient.connect();
    
    // Start polling
    printerClient.startStatusPolling(2000);
    
    // Request camera URL
    const cameraResponse = await printerClient.requestCameraURL();
    if (cameraResponse && cameraResponse.Data && cameraResponse.Data.Data) {
      printerStatus.cameraURL = cameraResponse.Data.Data.Url || null;
    }

    printerStatus.connected = true;
    broadcastToClients({ type: 'status', data: printerStatus });

    res.json({ success: true, message: 'Connected to printer' });
  } catch (err) {
    printerStatus.connected = false;
    res.status(500).json({ success: false, error: err.message });
  }
});

// WebSocket connection handler for web clients
wss.on('connection', (ws) => {
  console.log('Web client connected');
  webClients.add(ws);

  // Send current status
  ws.send(JSON.stringify({ type: 'status', data: printerStatus }));

  const cleanup = () => {
    console.log('Web client disconnected');
    webClients.delete(ws);
  };

  ws.on('close', cleanup);
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    cleanup();
  });
});

/**
 * Update printer status from SDCP data
 */
function updatePrinterStatus(data) {
  if (!data) return;

  printerStatus.lastUpdate = new Date().toISOString();

  // Update based on available data
  if (data.Attributes) {
    printerStatus.printerName = data.Attributes.Name || printerStatus.printerName;
  }

  if (data.Data) {
    const d = data.Data;
    
    // Print state
    if (d.Status !== undefined) {
      const stateMap = {
        0: 'Idle',
        1: 'Printing',
        2: 'Paused',
        3: 'Completed',
        4: 'Error'
      };
      printerStatus.state = stateMap[d.Status] || 'Unknown';
    }

    // Print progress
    if (d.PrintInfo) {
      printerStatus.progress = d.PrintInfo.Progress || 0;
      printerStatus.currentFile = d.PrintInfo.Filename || '';
      printerStatus.printTime = d.PrintInfo.PrintTime || 0;
      printerStatus.remainingTime = d.PrintInfo.RemainTime || 0;
    }

    // Temperatures
    if (d.TempInfo) {
      if (d.TempInfo.BedTemp !== undefined) {
        printerStatus.temperatures.bed.current = d.TempInfo.BedTemp;
      }
      if (d.TempInfo.BedTargetTemp !== undefined) {
        printerStatus.temperatures.bed.target = d.TempInfo.BedTargetTemp;
      }
      if (d.TempInfo.NozzleTemp !== undefined) {
        printerStatus.temperatures.nozzle.current = d.TempInfo.NozzleTemp;
      }
      if (d.TempInfo.NozzleTargetTemp !== undefined) {
        printerStatus.temperatures.nozzle.target = d.TempInfo.NozzleTargetTemp;
      }
    }
  }

  // Broadcast update to all web clients
  broadcastToClients({ type: 'status', data: printerStatus });
}

/**
 * Broadcast message to all connected web clients
 */
function broadcastToClients(message) {
  const data = JSON.stringify(message);
  webClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

/**
 * Auto-discover and connect to first printer
 */
async function autoConnect() {
  try {
    console.log('Auto-discovering printers...');
    const discovery = new PrinterDiscovery();
    const printers = await discovery.discover(5000);
    
    if (printers.length > 0) {
      const printer = printers[0];
      console.log('Found printer at:', printer.address);
      
      printerClient = new SDCPClient(printer.address);
      printerClient.onStatus((data) => {
        updatePrinterStatus(data);
      });

      await printerClient.connect();
      printerClient.startStatusPolling(2000);
      
      // Request camera URL
      const cameraResponse = await printerClient.requestCameraURL();
      if (cameraResponse && cameraResponse.Data && cameraResponse.Data.Data) {
        printerStatus.cameraURL = cameraResponse.Data.Data.Url || null;
      }

      printerStatus.connected = true;
      printerStatus.printerName = printer.Name || printer.Id || 'Elegoo Printer';
      console.log('Connected to printer:', printerStatus.printerName);
    } else {
      console.log('No printers found on network');
    }
  } catch (err) {
    console.error('Auto-connect failed:', err.message);
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`Elegoo Print Monitor server running on http://localhost:${PORT}`);
  
  // Auto-connect to printer on startup
  autoConnect();
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (printerClient) {
    printerClient.disconnect();
  }
  server.close();
  process.exit(0);
});
