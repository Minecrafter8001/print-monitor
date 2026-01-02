
const DEBUG_DISABLE_LOCAL_IP_FILTER =
  !('DEBUG_DISABLE_LOCAL_IP_FILTER' in process.env) ||
  process.env.DEBUG_DISABLE_LOCAL_IP_FILTER === '' ||
  process.env.DEBUG_DISABLE_LOCAL_IP_FILTER === 'true';
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { getClientIP, isLocalIP } = require('./src/ip-utils');
const { parseStatusPayload } = require('./src/status-utils');
const { startH264Transcode } = require('./src/camera-transcoder');
const UserStats = require('./src/user-stats');

const PrinterDiscovery = require('./utils/printer-discovery');
const SDCPClient = require('./utils/sdcp-client');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAX_FPS = 15;
const PORT = process.env.PORT || 3000;
const STATUS_POLL_INTERVAL = 2000;
const CAMERA_ACK_ERRORS = {
  1: 'Exceeded maximum simultaneous streaming limit',
  2: 'Camera does not exist',
  3: 'Unknown error'
};

// Store printer data
let printerClient = null;
let defaultPrinterStatus = {
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
  lastUpdate: null,
  customState: 0,
  layers: {
    total: 0,
    finished: 0
  },
  // Single consolidated status
  status: null, // e.g. 'HOMING' or 'PRINTING'
  status_code: null,
  prev_status: null
};
let printerStatus = { ...defaultPrinterStatus };
let reconnectSetupInProgress = false;
let reconnectSetupNeeded = false;
/**
 * Set custom status codes based on printer info
 * @param {object} info - Raw printer info/status
 */
function setCustomState(info) {
  if (!info || !info.Status) {
    return;
  }
  const s = info.Status;
  let code = 0;
  // Example: Custom state 1: Printing but no file
  if (s.CurrentStatus && s.CurrentStatus[0] === 1) {
    if (!s.PrintInfo || !s.PrintInfo.Filename) {
      code = 1;
    }
  }
  // Add more custom state code logic here as needed
  printerStatus.customState = code;
}

// WebSocket clients
const webClients = new Set();

// Camera stream
let cameraStreamURL = null;
let printerStream = null;
const cameraSubscribers = new Set(); // Clients subscribed to camera stream
let latestFrame = null;
const cameraContentType = 'image/jpeg';

const userStats = new UserStats();

const resolveClientIP = (req, socket) =>
  getClientIP(req, socket, DEBUG_DISABLE_LOCAL_IP_FILTER);

function updateUserStatsAndBroadcast() {
  printerStatus.users = userStats.getSnapshot();
  // Notify connected web clients of updated stats
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}



// Set printer status to disconnected and broadcast
function setDisconnectedStatus() {
  if (
    printerStatus.connected === false &&
    printerStatus.printerName === 'Unknown' &&
    printerStatus.state === 'Disconnected'
  ) return;
  reconnectSetupNeeded = true;
  printerStatus = {
    ...defaultPrinterStatus,
    lastUpdate: new Date().toISOString()
  };
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

function buildStatusPayload() {
  printerStatus.users = printerStatus.users || userStats.getSnapshot();
  return {
    printer: printerStatus,
    users: userStats.getSnapshot()
  };
}

// Serve static files
app.use(express.static('public'));

// API endpoint to get current printer status
app.get('/api/status', (req, res) => {
  // Ensure latest user stats are present
  printerStatus.users = userStats.getSnapshot();
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
  const boundary = 'frame';
  res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${boundary}`);
  res.write(`--${boundary}\r\n`);

  // Subscriber writes full frames
  const subscriber = (frameBuffer) => {
    try {
      res.write(`Content-Type: ${cameraContentType}\r\n`);
      res.write(`Content-Length: ${frameBuffer.length}\r\n\r\n`);
      res.write(frameBuffer);
      res.write(`\r\n--${boundary}\r\n`);
    } catch (err) {
      cameraSubscribers.delete(subscriber);
    }
  };

  cameraSubscribers.add(subscriber);

  // Send latest frame immediately if we have one
  if (latestFrame) {
    subscriber(latestFrame);
  }

  // Track IP and counters
  let cameraClientIP = 'unknown';
  try {
    cameraClientIP = resolveClientIP(req, req.socket);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    userStats.addCameraClient(cameraClientIP, userAgent);
  } catch (_) {}
  updateUserStatsAndBroadcast();

  // Handle client disconnect
  const cleanup = () => {
    cameraSubscribers.delete(subscriber);
    userStats.removeCameraClient(cameraClientIP);
    updateUserStatsAndBroadcast();
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

// API endpoint to serve H.264 transcoded camera stream
app.get('/api/camera/h264', (req, res) => {
  if (!cameraStreamURL) {
    return res.status(503).json({ success: false, error: 'Camera stream not available' });
  }
  let transcoder;
  try {
    transcoder = startH264Transcode(cameraStreamURL);
  } catch (err) {
    console.error('Failed to start h264 transcoder:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');

  transcoder.stdout.pipe(res);

  const abort = () => {
    if (transcoder) {
      transcoder.kill('SIGINT');
      transcoder = null;
    }
  };

  transcoder.on('error', (err) => {
    console.error('Transcoder error:', err.message);
    abort();
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.end();
    }
  });

  req.on('close', abort);
  req.on('error', abort);
  res.on('close', abort);
  res.on('error', abort);
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

// Admin endpoint - only accessible from local addresses
app.get('/api/admin', (req, res) => {
  const clientIP = resolveClientIP(req, req.socket);
  
  // Verify client is local
  if (!isLocalIP(clientIP) && clientIP !== '212.229.84.209') {
    console.warn(`Unauthorized admin access attempt from ${clientIP}`);
    return res.status(404).type('text/html').send('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET /api/admin</pre>\n</body>\n</html>\n');
  }

  const statsSnapshot = userStats.getSnapshot();
  const { webClients: webClientsList, cameraClients: cameraClientsList } = userStats.getClientLists();

  res.json({
    success: true,
    admin: {
      accessIP: clientIP,
      timestamp: new Date().toISOString(),
      webClients: {
        active: statsSnapshot.webClients,
        total: statsSnapshot.totalWebConnections,
        uniqueIPCount: webClientsList.length,
        clients: webClientsList
      },
      cameraClients: {
        active: statsSnapshot.cameraClients,
        total: statsSnapshot.totalCameraConnections,
        uniqueIPCount: cameraClientsList.length,
        clients: cameraClientsList
      },
      printer: {
        connected: printerStatus.connected,
        name: printerStatus.printerName,
        state: printerStatus.state,
        cameraAvailable: printerStatus.cameraAvailable,
        lastUpdate: printerStatus.lastUpdate
      }
    }
  });
});

// WebSocket connection handler for web clients
wss.on('connection', (ws, req) => {
  const ip = resolveClientIP(req, ws._socket);
  const userAgent = req.headers['user-agent'] || 'Unknown';
  console.log(`[WebSocket] Client connected: IP=${ip}`);
  webClients.add(ws);
  // Track IP and counters
  try {
    ws._clientIP = ip; // Store IP on WebSocket instance
    userStats.addWebClient(ip, userAgent);
  } catch (_) {}
  updateUserStatsAndBroadcast();

  // Send current status
  ws.send(JSON.stringify({ type: 'status', data: buildStatusPayload() }));

  const cleanup = () => {
    console.log('Web client disconnected');
    webClients.delete(ws);
    userStats.removeWebClient(ip);
    updateUserStatsAndBroadcast();
  };

  ws.on('close', cleanup);
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    cleanup();
  });
});


// --- Broadcast message to all connected web clients, throttled to once per second ---
let lastBroadcastTime = 0;
let pendingBroadcast = null;
function broadcastToClients(message) {
  const now = Date.now();
  const data = JSON.stringify(message);
  const minInterval = 1000; // 1 second

  if (now - lastBroadcastTime >= minInterval) {
    // Send immediately
    webClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
    lastBroadcastTime = now;
    pendingBroadcast = null;
  } else {
    // Schedule a broadcast if not already scheduled
    if (!pendingBroadcast) {
      const delay = minInterval - (now - lastBroadcastTime);
      pendingBroadcast = setTimeout(() => {
        webClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data);
          }
        });
        lastBroadcastTime = Date.now();
        pendingBroadcast = null;
      }, delay);
    }
  }
}

/**
 * Update printer status from SDCP data
 */
let isFirstUpdate = true;

function updatePrinterStatus(data) {
  if (!data) {
    // Printer is unreachable or offline
    reconnectSetupNeeded = true;
    printerStatus.connected = false;
    printerStatus.state = 'Disconnected';
    printerStatus.cameraAvailable = false;
    printerStatus.lastUpdate = new Date().toISOString();
    printerStatus.customState = 0;
    printerStatus.machine_status = 'UNKNOWN';
    printerStatus.job_status = null;
    printerStatus.machine_status_code = null;
    printerStatus.job_status_code = null;
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    return;
  }

  // If we receive data after a disconnect, treat this as a reconnection
  if (!printerStatus.connected) {
    const reconnectName = data.Attributes?.Name || printerStatus.printerName;
    ensureReconnectSetup(reconnectName).catch((err) => {
      console.error('Failed to refresh printer state after reconnection:', err.message);
    });
  }

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

  // Only update status fields if this is a real status payload (not a response/ack)
  if (data.Status) {
    // Parse and map consolidated status
    const { status, status_code } = parseStatusPayload(data);

    // Only update if new value is valid (not null/undefined/UNKNOWN)
    let new_status = status;
    let new_status_code = status_code;
    if (!new_status || new_status === 'UNKNOWN') {
      new_status = printerStatus.status;
      new_status_code = printerStatus.status_code;
    }

    // Track transitions for logging/notifications
    if (printerStatus.status !== new_status) {
      console.log(`[Status] Status changed: ${printerStatus.status} -> ${new_status}`);
      printerStatus.prev_status = printerStatus.status;
    }
    printerStatus.status = new_status;
    printerStatus.status_code = new_status_code;

    // For backward compatibility, keep .state as before
    printerStatus.state = new_status_code;
  }

  // Handle actual printer status structure
  if (data.Status) {
    const s = data.Status;
    // Print progress
    if (s.PrintInfo) {
      // Use printer-reported progress directly
      printerStatus.progress = s.PrintInfo.Progress || 0;
      printerStatus.currentFile = s.PrintInfo.Filename || '';
      // Convert ticks to seconds for time display
      printerStatus.printTime = Math.floor(s.PrintInfo.CurrentTicks || 0);
      const totalTicks = s.PrintInfo.TotalTicks || 0;
      printerStatus.remainingTime = Math.floor(totalTicks - printerStatus.printTime);
      // Use printer-reported layer info only
      printerStatus.layers = {
        total: s.PrintInfo.TotalLayer || 0,
        current: s.PrintInfo.CurrentLayer || 0
      };
      // Manual progress calculations removed; only using printer-reported progress and remainingTime
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

  // Set custom state code
  setCustomState(data);

  // Broadcast update to all web clients
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
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
 * Handle tasks that should run after a successful connection/reconnection:
 * - mark the printer as connected and update its name (if provided)
 * - refresh camera availability and restart streaming
 * - broadcast the latest status to all web clients
 */
async function onPrinterConnected(printerName = null) {
  printerStatus.connected = true;
  if (printerName) {
    printerStatus.printerName = printerName;
  }
  // Refresh camera availability on each (re)connect
  await setupCameraURL();
  await startCameraStreaming();
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

async function ensureReconnectSetup(printerName = null) {
  if (reconnectSetupInProgress) return;
  reconnectSetupInProgress = true;
  try {
    await onPrinterConnected(printerName);
    reconnectSetupNeeded = false;
  } catch (err) {
    reconnectSetupNeeded = true;
    throw err;
  } finally {
    reconnectSetupInProgress = false;
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
  // Always re-attach status handler
  printerClient.onStatus(updatePrinterStatus);

  // Listen for disconnect/error events from SDCP client
  const handlePrinterLost = () => {
    setDisconnectedStatus();
  };
  printerClient.on('disconnect', handlePrinterLost);
  printerClient.on('error', handlePrinterLost);
  printerClient.on('reconnected', () => {
    if (!reconnectSetupNeeded) return;
    ensureReconnectSetup(printerName).catch((err) => {
      console.error('Failed to refresh printer state after reconnection:', err.message);
    });
  });

  // Try to connect and handle errors
  try {
    await printerClient.connect();
    printerClient.startStatusPolling(STATUS_POLL_INTERVAL);
    await ensureReconnectSetup(printerName);
  } catch (err) {
    // Printer is offline or unreachable: fully reset status and broadcast
    printerStatus = {
      ...defaultPrinterStatus,
      lastUpdate: new Date().toISOString()
    };
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    console.error('Failed to connect to printer:', err.message);
  }
}

/**
 * Start persistent camera stream from printer and relay to clients
 */
async function startCameraStreaming() {
  if (!cameraStreamURL) {
    printerStatus.cameraAvailable = false;
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    return;
  }

  try {
    const response = await fetch(cameraStreamURL);
    
    if (!response.ok) {
      throw new Error(`Camera error ${response.status}, ${response.statusText}`);
    }

    // Extract boundary from multipart content-type header
    const contentType = response.headers.get('content-type');
    const boundaryMatch = contentType?.match(/boundary=([^\s;]+)/);
    const boundary = boundaryMatch ? boundaryMatch[1].replace(/^-+/, '') : 'frame';
    const boundaryBuffer = Buffer.from('--' + boundary);

    const reader = response.body.getReader();
    let buffer = Buffer.alloc(0);

    // Throttle frame delivery to respect MAX_FPS
    let lastFrameTime = 0;
    const minFrameInterval = 1000 / MAX_FPS;

    const processStream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer = Buffer.concat([buffer, Buffer.from(value)]);

          // Look for boundary
          let boundaryIndex = buffer.indexOf(boundaryBuffer);
          while (boundaryIndex !== -1) {
            // Find the end of headers (double CRLF) after boundary
            const headersStart = boundaryIndex + boundaryBuffer.length;
            const headersEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headersStart);
            if (headersEnd === -1) break;

            const frameDataStart = headersEnd + 4; // Skip the \r\n\r\n

            // Find next boundary after this frame
            const nextBoundaryIndex = buffer.indexOf(boundaryBuffer, frameDataStart);
            if (nextBoundaryIndex === -1) break;

            // Extract frame data (trim trailing CRLF)
            let frameEnd = nextBoundaryIndex;
            if (buffer[frameEnd - 2] === 0x0D && buffer[frameEnd - 1] === 0x0A) {
              frameEnd -= 2;
            } else if (buffer[frameEnd - 1] === 0x0A) {
              frameEnd -= 1;
            }

            const frameBuffer = buffer.subarray(frameDataStart, frameEnd);

            if (frameBuffer.length > 0) {
              const now = Date.now();
              if (now - lastFrameTime >= minFrameInterval) {
                latestFrame = Buffer.from(frameBuffer);
                // Broadcast frame to all subscribers
                cameraSubscribers.forEach(subscriber => {
                  try {
                    subscriber(latestFrame);
                  } catch (err) {
                    // Subscriber cleanup handled in endpoint
                  }
                });
                lastFrameTime = now;
              }
            }

            // Remove processed part
            buffer = buffer.subarray(nextBoundaryIndex);
            boundaryIndex = buffer.indexOf(boundaryBuffer);
          }
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
  printerStream = null;
}


/**
 * Auto-discover and connect to printers, retrying each up to 3 times before moving to the next
 */
let autoConnectState = {
  printers: [],
  currentIdx: 0,
  failCount: 0
};

async function autoConnect() {
  try {
    // If no printers list or exhausted, rediscover
    if (!autoConnectState.printers.length || autoConnectState.currentIdx >= autoConnectState.printers.length) {
      console.log('Auto-discovering printers...');
      const discovery = new PrinterDiscovery();
      let printers = await discovery.discover(5000);
      // Filter out proxy servers
      printers = printers.filter(p => {
        // Proxy flag may be in Data.Attributes.Proxy or Attributes.Proxy
        const proxy = (p.Data && p.Data.Attributes && p.Data.Attributes.Proxy) || (p.Attributes && p.Attributes.Proxy);
        return !proxy;
      });
      if (printers.length === 0) {
        console.log('No eligible printers found on network. Retrying in 5 seconds...');
        autoConnectState = { printers: [], currentIdx: 0, failCount: 0 };
        setTimeout(autoConnect, 5000);
        return;
      }
      autoConnectState.printers = printers;
      autoConnectState.currentIdx = 0;
      autoConnectState.failCount = 0;
    }

    const printer = autoConnectState.printers[autoConnectState.currentIdx];
    console.log(`Trying to connect to printer ${autoConnectState.currentIdx + 1}/${autoConnectState.printers.length} at:`, printer.address);

    try {
      await connectToPrinter(
        printer.address,
        printer.Name || printer.Id || 'Elegoo Printer'
      );
      console.log('Connected to printer:', printerStatus.printerName);
      // Start camera streaming
      await startCameraStreaming();
      // Reset fail count on success
      autoConnectState.failCount = 0;
    } catch (err) {
      autoConnectState.failCount++;
      console.error(`Auto-connect failed (${autoConnectState.failCount}/3) for ${printer.address}:`, err.message);
      if (autoConnectState.failCount >= 3) {
        // Move to next printer
        autoConnectState.currentIdx++;
        autoConnectState.failCount = 0;
        if (autoConnectState.currentIdx >= autoConnectState.printers.length) {
          // All tried, rediscover after delay
          console.log('All printers failed, rediscovering in 5 seconds...');
          autoConnectState = { printers: [], currentIdx: 0, failCount: 0 };
          setTimeout(autoConnect, 5000);
          return;
        }
      }
      // Try again after delay (either retry or next printer)
      setTimeout(autoConnect, 5000);
      return;
    }
  } catch (err) {
    console.error('Auto-connect error:', err.message);
    setTimeout(autoConnect, 5000);
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
