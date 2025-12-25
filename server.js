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
var CAMERA_CACHE_MS = 1000; // Poll camera every 1 second
const STATUS_POLL_INTERVAL = 2000;
const CAMERA_ACK_ERRORS = {
  1: 'Exceeded maximum simultaneous streaming limit',
  2: 'Camera does not exist',
  3: 'Unknown error'
};

// Store printer data
let printerClient = null;
let printerStatus = {
  connected: false,
  printerName: 'Unknown',
  state: 'Disconnected',
  progress: 0,
  layerProgress: 0,
  temperatures: {
    bed: { current: 0, target: 0 },
    nozzle: { current: 0, target: 0 },
    enclosure: { current: 0, target: 0 }
  },
  currentFile: '',
  printTime: 0,
  remainingTime: 0,
  calculatedTime: null,
  cameraAvailable: false,
  lastUpdate: null
};

// WebSocket clients
const webClients = new Set();

// Camera stream
let cameraStreamURL = null;
let printerStream = null;
const cameraSubscribers = new Set(); // Clients subscribed to camera stream

// User counters and tracking
const userStats = {
  webClients: 0,
  cameraClients: 0,
  totalWebConnections: 0,
  totalCameraConnections: 0
};
const webClientIPs = new Set();
const cameraClientIPs = new Set();

function normalizeIP(ip) {
  if (!ip) return 'unknown';
  // Remove IPv6 prefix for IPv4-mapped addresses
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  return ip;
}

function isLocal192(ip) {
  return /^192\.168\./.test(ip);
}

function pickForwardedIP(headerValue) {
  if (!headerValue) return null;
  const parts = headerValue.split(',').map(p => normalizeIP(p.trim())).filter(Boolean);
  for (const ip of parts) {
    if (!isLocal192(ip)) return ip;
  }
  return parts[0] || null;
}

function getClientIP(req, socket) {
  // Prefer x-forwarded-for chain
  const xfwd = pickForwardedIP(req?.headers?.['x-forwarded-for']);
  if (xfwd && !isLocal192(xfwd)) return xfwd;

  // Cloudflare headers
  const cfip = normalizeIP(req?.headers?.['cf-connecting-ip']);
  if (cfip && cfip !== 'unknown' && !isLocal192(cfip)) return cfip;

  const cfipv6 = normalizeIP(req?.headers?.['cf-connecting-ipv6']);
  if (cfipv6 && cfipv6 !== 'unknown' && !isLocal192(cfipv6)) return cfipv6;

  // Fallback to remote address if not local 192.168.x.x
  const remote = normalizeIP(socket?.remoteAddress || req?.socket?.remoteAddress);
  if (remote && remote !== 'unknown' && !isLocal192(remote)) return remote;

  return 'unknown';
}

function updateUserStatsAndBroadcast() {
  printerStatus.users = getUserStats();
  // Notify connected web clients of updated stats
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

function getUserStats() {
  return {
    webClients: userStats.webClients,
    cameraClients: userStats.cameraClients,
    totalWebConnections: userStats.totalWebConnections,
    totalCameraConnections: userStats.totalCameraConnections,
    uniqueWebIPs: webClientIPs.size,
    uniqueCameraIPs: cameraClientIPs.size
  };
}

function buildStatusPayload() {
  // Keep printerStatus.users for backward compatibility
  printerStatus.users = printerStatus.users || getUserStats();
  return {
    printer: printerStatus,
    users: getUserStats()
  };
}

// Serve static files
app.use(express.static('public'));

// API endpoint to get current printer status
app.get('/api/status', (req, res) => {
  // Ensure latest user stats are present
  printerStatus.users = getUserStats();
  res.json(buildStatusPayload());
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

app.get('/api/camera', async (req, res) => {
  const boundary = 'foo';
  res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${boundary}`);

  // Subscribe this client to the stream
  const subscriber = (chunk) => {
    try {
      res.write(chunk);
    } catch (err) {
      cameraSubscribers.delete(subscriber);
    }
  };

  cameraSubscribers.add(subscriber);
  // Track IP and counters
  try {
    const ip = getClientIP(req, req.socket);
    if (ip !== 'unknown') {
      cameraClientIPs.add(ip);
    }
  } catch (_) {}
  userStats.cameraClients += 1;
  userStats.totalCameraConnections += 1;
  updateUserStatsAndBroadcast();

  // Handle client disconnect
  req.on('close', () => {
    cameraSubscribers.delete(subscriber);
    userStats.cameraClients = Math.max(0, userStats.cameraClients - 1);
    updateUserStatsAndBroadcast();
  });
});

// API endpoint to connect to a specific printer
app.post('/api/connect/:ip', express.json(), async (req, res) => {
  try {
    await connectToPrinter(req.params.ip);
    res.json({ success: true, message: 'Connected to printer' });
  } catch (err) {
    printerStatus.connected = false;
    res.status(500).json({ success: false, error: err.message });
  }
});

// WebSocket connection handler for web clients
wss.on('connection', (ws, req) => {
  console.log('Web client connected');
  webClients.add(ws);
  // Track IP and counters
  try {
    const ip = getClientIP(req, ws._socket);
    if (ip !== 'unknown') {
      webClientIPs.add(ip);
    }
  } catch (_) {}
  userStats.webClients += 1;
  userStats.totalWebConnections += 1;
  updateUserStatsAndBroadcast();

  // Send current status
  ws.send(JSON.stringify({ type: 'status', data: buildStatusPayload() }));

  const cleanup = () => {
    console.log('Web client disconnected');
    webClients.delete(ws);
    userStats.webClients = Math.max(0, userStats.webClients - 1);
    updateUserStatsAndBroadcast();
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
let isFirstUpdate = true;
function updatePrinterStatus(data) {
  if (!data) return;

  // Log first status update for debugging
  if (isFirstUpdate) {
    console.log('\n=== First Status Update from Printer ===');
    console.log(JSON.stringify(data, null, 2));
    console.log('========================================\n');
    isFirstUpdate = false;
  }

  printerStatus.lastUpdate = new Date().toISOString();

  // Update based on available data
  if (data.Attributes) {
    printerStatus.printerName = data.Attributes.Name || printerStatus.printerName;
  }

  // Handle actual printer status structure
  if (data.Status) {
    const s = data.Status;
    
    // Print state from CurrentStatus array
    if (s.CurrentStatus && s.CurrentStatus.length > 0) {
      const status = s.CurrentStatus[0];
      const stateMap = {
        0: 'Idle',
        1: 'Printing',
        2: 'Paused',
        3: 'Completed',
        4: 'Error'
      };
      printerStatus.state = stateMap[status] || 'Unknown';
    }

    // Print progress
    if (s.PrintInfo) {
      // Use printer-reported progress directly
      printerStatus.progress = s.PrintInfo.Progress || 0;
      printerStatus.currentFile = s.PrintInfo.Filename || '';
      
      // Convert ticks to seconds for time display
      printerStatus.printTime = Math.floor(s.PrintInfo.CurrentTicks || 0);
      const totalTicks = s.PrintInfo.TotalTicks || 0;
      printerStatus.remainingTime = Math.floor(totalTicks - printerStatus.printTime);
      
      // Calculate precise progress from current/total layers (6 decimal places)
      const currentLayer = s.PrintInfo.CurrentLayer || 0;
      const totalLayer = s.PrintInfo.TotalLayer || 0;
      if (totalLayer > 0) {
        printerStatus.layerProgress = Number(((currentLayer / totalLayer) * 100).toFixed(6));
      } else {
        printerStatus.layerProgress = 0;
      }
      
      // Calculate ETA based on progress
      if (printerStatus.progress > 0 && printerStatus.printTime > 0) {
        const estimatedTotalTime = printerStatus.printTime / (printerStatus.progress / 100);
        const calculatedRemaining = Math.max(0, Math.floor(estimatedTotalTime - printerStatus.printTime));
        printerStatus.calculatedTime = calculatedRemaining;
      }
    }

    // Temperatures - using actual field names from printer
    if (s.TempOfHotbed !== undefined) {
      printerStatus.temperatures.bed.current = Math.round(s.TempOfHotbed);
    }
    if (s.TempTargetHotbed !== undefined) {
      printerStatus.temperatures.bed.target = Math.round(s.TempTargetHotbed);
    }
    if (s.TempOfNozzle !== undefined) {
      printerStatus.temperatures.nozzle.current = Math.round(s.TempOfNozzle);
    }
    if (s.TempTargetNozzle !== undefined) {
      printerStatus.temperatures.nozzle.target = Math.round(s.TempTargetNozzle);
    }
    if (s.TempOfBox !== undefined) {
      printerStatus.temperatures.enclosure.current = Math.round(s.TempOfBox);
    }
    if (s.TempTargetBox !== undefined) {
      printerStatus.temperatures.enclosure.target = Math.round(s.TempTargetBox);
    }
  }

  // Broadcast update to all web clients
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
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
 * Setup camera URL from printer response
 */
async function setupCameraURL() {
  if (!printerClient) return;

  try {
    const cameraResponse = await printerClient.requestCameraURL();
    const cameraData = cameraResponse?.Data?.Data;
    
    if (!cameraData) return;

    const { Ack: ack, VideoUrl: videoUrl } = cameraData;
    
    if (ack === 0 && videoUrl) {
      printerStatus.cameraAvailable = true;
      // Store the URL locally for polling, but don't send to clients
      cameraStreamURL = `http://${videoUrl}`;
      console.log('Camera stream enabled');
    } else {
      console.warn('Camera not available:', CAMERA_ACK_ERRORS[ack] || `Unknown error code ${ack}`);
      printerStatus.cameraAvailable = false;
    }
  } catch (err) {
    console.warn('Failed to setup camera:', err.message);
    printerStatus.cameraAvailable = false;
  }
}

/**
 * Connect to a printer at the given IP address
 */
async function connectToPrinter(printerIP, printerName = null) {
  // Disconnect existing connection
  if (printerClient) {
    printerClient.disconnect();
  }

  // Create new connection
  printerClient = new SDCPClient(printerIP);
  printerClient.onStatus(updatePrinterStatus);

  // Connect and start polling
  await printerClient.connect();
  printerClient.startStatusPolling(STATUS_POLL_INTERVAL);
  
  // Setup camera
  await setupCameraURL();

  // Update status
  printerStatus.connected = true;
  if (printerName) {
    printerStatus.printerName = printerName;
  }
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

/**
 * Start persistent camera stream from printer and relay to clients
 */
async function startCameraStreaming() {
  if (!cameraStreamURL) return;

  try {
    const response = await fetch(cameraStreamURL);
    
    if (!response.ok) {
      throw new Error(`Camera error ${response.status}, ${response.statusText}`);
    }

    const reader = response.body.getReader();

    const processStream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = Buffer.from(value);
          
          // Broadcast chunk to all subscribers
          cameraSubscribers.forEach(subscriber => {
            subscriber(chunk);
          });
        }
      } catch (err) {
        console.error('Camera stream error:', err.message);
        // Retry after a delay
        setTimeout(() => {
          if (cameraStreamURL) {
            startCameraStreaming();
          }
        }, 5000);
      }
    };

    printerStream = processStream();
  } catch (err) {
    console.error('Failed to start camera stream:', err.message);
    // Retry after a delay
    setTimeout(() => {
      if (cameraStreamURL) {
        startCameraStreaming();
      }
    }, 5000);
  }
}

/**
 * Stop camera streaming
 */
function stopCameraStreaming() {
  if (printerStream) {
    printerStream = null;
  }
}

/**
 * Auto-discover and connect to first printer
 */
async function autoConnect() {
  try {
    console.log('Auto-discovering printers...');
    const discovery = new PrinterDiscovery();
    const printers = await discovery.discover(5000);
    
    if (printers.length === 0) {
      console.log('No printers found on network');
      return;
    }

    const printer = printers[0];
    console.log('Found printer at:', printer.address);
    
    await connectToPrinter(
      printer.address,
      printer.Name || printer.Id || 'Elegoo Printer'
    );
    
    console.log('Connected to printer:', printerStatus.printerName);
    
    // Start camera streaming
    await startCameraStreaming();
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
  stopCameraStreaming();
  if (printerClient) {
    printerClient.disconnect();
  }
  server.close();
  process.exit(0);
});
