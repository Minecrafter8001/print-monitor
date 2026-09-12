
require('module-alias/register');

const DEBUG_DISABLE_LOCAL_IP_FILTER =
  !('DEBUG_DISABLE_LOCAL_IP_FILTER' in process.env) ||
  process.env.DEBUG_DISABLE_LOCAL_IP_FILTER === '' ||
  process.env.DEBUG_DISABLE_LOCAL_IP_FILTER === 'true';
const ENABLE_DEBUG_ENDPOINTS = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
require('utils/logger');
const { getClientIP, isLocalIP } = require('utils/ip-utils');
const { mapMoonrakerStatus } = require('utils/moonraker-status');
const UserStats = require('utils/user-stats');

const MoonrakerClient = require('utils/moonraker-client');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MAX_FPS = 15;
const PORT = process.env.PORT || 3000;
const MOONRAKER_URL = process.env.MOONRAKER_URL || '';
const WS_UPDATE_INTERVAL = (() => {
  const value = Number.parseInt(process.env.WS_UPDATE_INTERVAL, 10);
  return Number.isFinite(value) && value > 0 ? value : 1000;
})();
const CAMERA_MAX_START_FAILURES = 3;

// Store printer data
let printerClient = null;
const defaultPrinterStatus = {
  connected: false,
  name: 'Unknown',
  klipper: {
    state: 'disconnected',
    message: ''
  },
  print: {
    state: 'standby',
    filename: '',
    progressPercent: 0,
    elapsedSeconds: 0,
    estimatedRemainingSeconds: null,
    layers: { current: 0, total: 0 }
  },
  temperatures: {
    bed: { current: 0, target: 0 },
    activeTool: { name: null, friendlyName: null, current: 0, target: 0 },
    enclosure: { name: null, current: 0, target: 0 },
    tools: []
  },
  camera: {
    available: false,
    error: null
  },
  updatedAt: null
};
let printerStatus = structuredClone(defaultPrinterStatus);
let reconnectSetupInProgress = false;
let currentMetadataFilename = null;
let currentFileMetadata = {};

// WebSocket clients
const webClients = new Set();

// Camera stream
let cameraStreamURL = null;
let printerStream = null;
const cameraSubscribers = new Set(); // Clients subscribed to camera stream
let latestFrame = null;
const cameraContentType = 'image/jpeg';
let cameraStartFailure = { lastError: null, count: 0 };

const userStats = new UserStats();

const resolveClientIP = (req, socket) =>
  getClientIP(req, socket, DEBUG_DISABLE_LOCAL_IP_FILTER);

function updateUserStatsAndBroadcast() {
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

function resetCameraFailureTracker() {
  cameraStartFailure = { lastError: null, count: 0 };
}

function handleCameraStartFailure(errMessage) {
  const message = errMessage || 'Unknown camera error';
  if (cameraStartFailure.lastError === message) {
    cameraStartFailure.count += 1;
  } else {
    cameraStartFailure = { lastError: message, count: 1 };
  }

  if (cameraStartFailure.count >= CAMERA_MAX_START_FAILURES) {
    console.error(`Camera failed to start ${cameraStartFailure.count} times with the same error; exiting to restart. Error: ${message}`);
    broadcastToClients({ type: 'server_restarting', data: { reason: message } });
    // Give the broadcast a moment to flush before exiting so PM2 can restart us
    setTimeout(() => process.exit(1), 1000);
  }
}



// Set printer status to disconnected and broadcast
function setDisconnectedStatus() {
  if (!printerStatus.connected && printerStatus.klipper.state === 'disconnected') return;
  printerStatus = structuredClone(defaultPrinterStatus);
  printerStatus.updatedAt = new Date().toISOString();
  broadcastToClients({ type: 'status', data: buildStatusPayload() });
}

function buildStatusPayload() {
  return {
    printer: printerStatus,
    users: userStats.getSnapshot()
  };
}

// Serve static files
app.use(express.static('public'));

// API endpoint to get current printer status
app.get('/api/status', (req, res) => {
  res.json(buildStatusPayload());
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

// Debug endpoint to trigger a controlled restart (local-only, flag-gated)
if (ENABLE_DEBUG_ENDPOINTS) {
  app.get('/api/debug/restart', (req, res) => {
    const clientIP = resolveClientIP(req, req.socket);
    if (!isLocalIP(clientIP)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const reason = 'Manual restart trigger via /api/debug/restart';
    broadcastToClients({ type: 'server_restarting', data: { reason } });
    res.json({ success: true, message: 'Restarting server now' });
    setTimeout(() => process.exit(1), 5000);
  });
}

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
        name: printerStatus.name,
        klipperState: printerStatus.klipper.state,
        printState: printerStatus.print.state,
        cameraAvailable: printerStatus.camera.available,
        updatedAt: printerStatus.updatedAt
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
  const minInterval = WS_UPDATE_INTERVAL; // milliseconds between broadcasts

  // High-priority messages bypass throttling
  if (message?.type === 'server_restarting') {
    webClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
    lastBroadcastTime = now;
    return;
  }

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
 * Update printer status from Moonraker's cached printer objects.
 */
function updatePrinterStatus(objects) {
  if (!objects) {
    setDisconnectedStatus();
    return;
  }

  const nextStatus = mapMoonrakerStatus(objects, currentFileMetadata);
  const previousState = printerStatus.print.state;
  if (previousState !== nextStatus.print.state) {
    console.log(`[Status] Print state changed: ${previousState} -> ${nextStatus.print.state}`);
  }
  printerStatus = { ...printerStatus, ...nextStatus };

  broadcastToClients({ type: 'status', data: buildStatusPayload() });

  const filename = nextStatus.print.filename;
  if (!filename) {
    currentMetadataFilename = null;
    currentFileMetadata = {};
  } else if (filename !== currentMetadataFilename && printerClient) {
    currentMetadataFilename = filename;
    currentFileMetadata = {};
    printerClient.getFileMetadata(filename).then((metadata) => {
      if (currentMetadataFilename !== filename) return;
      currentFileMetadata = metadata || {};
      updatePrinterStatus(printerClient.objectState);
    }).catch((err) => {
      console.warn(`Unable to load metadata for ${filename}:`, err.message);
    });
  }
}

/**
 * Setup camera URL from printer response
 */
async function setupCameraURL() {
  if (!printerClient) return;

  try {
    const webcamResponse = await printerClient.getWebcams();
    const webcam = webcamResponse.webcams?.find((entry) => entry.enabled && entry.stream_url);
    const configuredURL = process.env.CAMERA_STREAM_URL;
    const streamURL = configuredURL || webcam?.stream_url;
    if (!streamURL) throw new Error('No enabled Moonraker webcam found');

    cameraStreamURL = printerClient.resolveURL(streamURL);
    printerStatus.camera = { available: true, error: null };
    console.log(`Camera stream enabled: ${cameraStreamURL}`);
  } catch (err) {
    console.warn('Failed to setup camera:', err.message);
    printerStatus.camera = { available: false, error: err.message };
    cameraStreamURL = null;
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
    printerStatus.name = printerName;
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
  } catch (err) {
    throw err;
  } finally {
    reconnectSetupInProgress = false;
  }
}

/**
 * Connect to a printer at the given IP address
 */
async function connectToPrinter(moonrakerURL, printerName = null) {
  // Disconnect existing connection
  if (printerClient) {
    printerClient.disconnect();
  }

  // Create new connection
  printerClient = new MoonrakerClient(moonrakerURL);
  printerClient.onStatus(updatePrinterStatus);

  const handlePrinterLost = () => {
    setDisconnectedStatus();
  };
  printerClient.on('disconnect', handlePrinterLost);
  printerClient.on('error', handlePrinterLost);
  printerClient.on('klippy-disconnected', handlePrinterLost);
  printerClient.on('reconnected', async () => {
    try {
      const resolvedPrinterName = printerName || await printerClient.getPrinterName();
      await ensureReconnectSetup(resolvedPrinterName);
    } catch (err) {
      console.error('Failed to refresh printer state after reconnection:', err.message);
    }
  });

  // Try to connect and handle errors
  try {
    await printerClient.connect();
    const resolvedPrinterName = printerName || await printerClient.getPrinterName();
    await ensureReconnectSetup(resolvedPrinterName);
  } catch (err) {
    // Printer is offline or unreachable: fully reset status and broadcast
    printerStatus = structuredClone(defaultPrinterStatus);
    printerStatus.updatedAt = new Date().toISOString();
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    console.error('Failed to connect to printer:', err.message);
    throw err;
  }
}

/**
 * Start persistent camera stream from printer and relay to clients
 */
async function startCameraStreaming() {
  if (!cameraStreamURL) {
    printerStatus.camera = {
      available: false,
      error: printerStatus.camera.error || 'Camera not available'
    };
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    resetCameraFailureTracker();
    return;
  }

  try {
    const response = await fetch(cameraStreamURL);
    
    if (!response.ok) {
      throw new Error(`Camera error ${response.status}, ${response.statusText}`);
    }

    resetCameraFailureTracker();
    printerStatus.camera = { available: true, error: null };

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
        handleCameraStartFailure(err.message);
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
    printerStatus.camera = { available: false, error: err.message };
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    handleCameraStartFailure(err.message);
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
 * Connect to the configured Moonraker instance and retry startup failures.
 */
async function autoConnect() {
  if (!MOONRAKER_URL) {
    console.warn('MOONRAKER_URL is not set; configure it before starting the monitor');
    return;
  }

  try {
    console.log(`Connecting to configured Moonraker instance at ${MOONRAKER_URL}`);
    await connectToPrinter(MOONRAKER_URL);
    console.log('Connected to printer:', printerStatus.name);
  } catch (err) {
    console.error('Auto-connect error:', err.message);
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`Snapmaker Print Monitor server running on http://localhost:${PORT}`);
  
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
