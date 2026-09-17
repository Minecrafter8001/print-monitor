
require('module-alias/register');

const DEBUG_DISABLE_LOCAL_IP_FILTER =
  !('DEBUG_DISABLE_LOCAL_IP_FILTER' in process.env) ||
  process.env.DEBUG_DISABLE_LOCAL_IP_FILTER === '' ||
  process.env.DEBUG_DISABLE_LOCAL_IP_FILTER === 'true';
const ENABLE_DEBUG_ENDPOINTS = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
const express = require('express');
const http = require('http');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const WebSocket = require('ws');
const ffmpegPath = process.env.FFMPEG_PATH || require('ffmpeg-static');
require('modules/logger');
const { getClientIP, isLocalIP } = require('modules/ip-utils');
const { mapMoonrakerStatus } = require('modules/moonraker-status');
const { detectCameraMode } = require('modules/camera-stream-utils');
const {
  buildTimelapseList,
  encodeMoonrakerFilePath,
  isSafeTimelapsePath,
  parseMp4Duration
} = require('modules/timelapse-utils');
const UserStats = require('modules/user-stats');

const MoonrakerClient = require('modules/moonraker-client');

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
const CAMERA_MODE = (process.env.CAMERA_MODE || 'auto').toLowerCase();
const CAMERA_SNAPSHOT_URL = process.env.CAMERA_SNAPSHOT_URL || '';
const CAMERA_KEEPALIVE_TOKEN = process.env.CAMERA_KEEPALIVE_TOKEN || '';
const CAMERA_KEEPALIVE_INTERVAL = Math.max(5, Number.parseInt(process.env.CAMERA_KEEPALIVE_INTERVAL, 10) || 10) * 1000;
const CAMERA_SNAPSHOT_INTERVAL = Math.max(250, Number.parseInt(process.env.CAMERA_SNAPSHOT_INTERVAL, 10) || 1000);
const CAMERA_STREAM_RESTART_INTERVAL = (() => {
  const seconds = Number.parseInt(process.env.CAMERA_STREAM_RESTART_INTERVAL, 10);
  return (Number.isFinite(seconds) && seconds >= 0 ? seconds : 300) * 1000;
})();
const COMPRESSED_CAMERA_MODES = new Set(['video', 'hls', 'dash', 'h264', 'h265']);
const TIMELAPSE_METADATA_BYTES = 256 * 1024;

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
    error: null,
    mode: null
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
let cameraMode = null;
let printerStream = null;
let cameraAbortController = null;
let cameraPollTimer = null;
let cameraKeepaliveTimer = null;
let cameraStreamRestartTimer = null;
const cameraSubscribers = new Set(); // Clients subscribed to camera stream
let latestFrame = null;
let cameraStartFailure = { lastError: null, count: 0 };
const timelapseDurationCache = new Map();

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
    printer: {
      ...printerStatus,
      camera: {
        ...printerStatus.camera,
        outputCodec: 'h264',
        outputContentType: 'video/mp4',
        restartIntervalSeconds: CAMERA_STREAM_RESTART_INTERVAL / 1000
      }
    },
    users: userStats.getSnapshot()
  };
}

// Serve static files
app.use(express.static('public'));

// API endpoint to get current printer status
app.get('/api/status', (req, res) => {
  res.json(buildStatusPayload());
});

async function getTimelapseDuration(file) {
  const cacheKey = `${file.path}:${file.modified}`;
  if (timelapseDurationCache.has(cacheKey)) return timelapseDurationCache.get(cacheKey);

  try {
    const headers = { Range: `bytes=-${TIMELAPSE_METADATA_BYTES}` };
    if (printerClient.apiKey) headers['X-Api-Key'] = printerClient.apiKey;
    const response = await fetch(
      printerClient.resolveURL(`/server/files/camera/${encodeMoonrakerFilePath(file.path)}`),
      { headers }
    );
    if (!response.ok) return null;

    const duration = parseMp4Duration(Buffer.from(await response.arrayBuffer()));
    timelapseDurationCache.set(cacheKey, duration);
    return duration;
  } catch (error) {
    console.warn(`Failed to read timelapse duration for ${file.path}:`, error.message);
    return null;
  }
}

app.get('/api/timelapses', async (req, res) => {
  if (!printerClient?.connected) {
    return res.status(503).json({ error: 'Printer is not connected' });
  }

  try {
    const files = await printerClient.listFiles('camera');
    const history = await printerClient.getHistory().catch(error => {
      console.warn('Failed to retrieve print history:', error.message);
      return { jobs: [] };
    });
    const historyJobs = Array.isArray(history) ? history : history.jobs || [];
    const timelapses = buildTimelapseList(files, historyJobs);
    await Promise.all(timelapses.map(async timelapse => {
      timelapse.timelapseDurationSeconds = await getTimelapseDuration(timelapse);
    }));
    res.json({ timelapses });
  } catch (error) {
    console.error('Failed to list timelapses:', error.message);
    res.status(502).json({ error: 'Unable to retrieve timelapses' });
  }
});

app.get('/api/timelapses/download', async (req, res) => {
  const filePath = req.query.file;
  if (!isSafeTimelapsePath(filePath)) {
    return res.status(400).json({ error: 'Invalid timelapse path' });
  }
  if (!printerClient?.connected) {
    return res.status(503).json({ error: 'Printer is not connected' });
  }

  try {
    const files = await printerClient.listFiles('camera');
    if (!files.some(file => file.path === filePath && isSafeTimelapsePath(file.path))) {
      return res.status(404).json({ error: 'Timelapse not found' });
    }

    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;
    if (printerClient.apiKey) headers['X-Api-Key'] = printerClient.apiKey;

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abortController.abort();
    });

    const response = await fetch(
      printerClient.resolveURL(`/server/files/camera/${encodeMoonrakerFilePath(filePath)}`),
      { headers, signal: abortController.signal }
    );
    if (!response.ok || !response.body) {
      return res.status(response.status).json({ error: 'Unable to download timelapse' });
    }

    const forwardedHeaders = [
      'accept-ranges',
      'content-disposition',
      'content-length',
      'content-range',
      'content-type',
      'last-modified'
    ];
    res.status(response.status);
    forwardedHeaders.forEach(header => {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    });
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Failed to download timelapse:', error.message);
    if (!res.headersSent) res.status(502).json({ error: 'Unable to download timelapse' });
    else res.destroy(error);
  }
});

app.get('/api/camera', (req, res) => res.redirect(307, '/api/camera/video'));

app.get(['/api/camera/video', '/api/camera/video/:entry'], (req, res) => {
  if (!cameraStreamURL || !printerStatus.camera.available) {
    return res.status(404).send('Camera stream is not available');
  }

  streamNormalizedCamera(req, res);
});

function scheduleResponseRestart(res, abortController = null) {
  if (!CAMERA_STREAM_RESTART_INTERVAL) return null;
  const timer = setTimeout(() => {
    abortController?.abort();
    res.end();
  }, CAMERA_STREAM_RESTART_INTERVAL);
  timer.unref?.();
  return timer;
}

function streamNormalizedCamera(req, res) {
  const usesFrameInput = cameraMode === 'snapshot' || cameraMode === 'mjpeg';
  const inputFPS = cameraMode === 'snapshot'
    ? Math.max(1, Math.min(MAX_FPS, Math.round(1000 / CAMERA_SNAPSHOT_INTERVAL)))
    : MAX_FPS;
  const inputArgs = usesFrameInput
    ? ['-probesize', '32', '-analyzeduration', '0', '-use_wallclock_as_timestamps', '1', '-f', 'image2pipe', '-framerate', String(inputFPS), '-vcodec', 'mjpeg', '-i', 'pipe:0']
    : [...(cameraMode === 'h264' ? ['-f', 'h264'] : cameraMode === 'h265' ? ['-f', 'hevc'] : []), '-i', cameraStreamURL];
  const args = [
    '-hide_banner', '-loglevel', 'error', ...inputArgs, '-an',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-g', String(inputFPS * 2), '-keyint_min', String(inputFPS * 2), '-sc_threshold', '0',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration', '1000000',
    '-flush_packets', '1', '-f', 'mp4', 'pipe:1'
  ];
  const ffmpeg = spawn(ffmpegPath, args, { windowsHide: true });
  let stderr = '';
  const restartTimer = scheduleResponseRestart(res);
  let frameSubscriber = null;
  let cleanedUp = false;

  if (usesFrameInput) {
    ffmpeg.stdin.on('error', () => {});
    frameSubscriber = (frame) => {
      if (!ffmpeg.stdin.destroyed && !ffmpeg.stdin.writableNeedDrain) {
        ffmpeg.stdin.write(frame);
      }
    };
    cameraSubscribers.add(frameSubscriber);
    if (latestFrame) frameSubscriber(latestFrame);
  }

  let cameraClientIP = 'unknown';
  try {
    cameraClientIP = resolveClientIP(req, req.socket);
    userStats.addCameraClient(cameraClientIP, req.headers['user-agent'] || 'Unknown');
  } catch (_) {}
  updateUserStatsAndBroadcast();

  res.setHeader('Content-Type', 'video/mp4; codecs="avc1.640028"');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Content-Encoding', 'identity');
  res.flushHeaders();
  ffmpeg.stdout.pipe(res);
  ffmpeg.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  ffmpeg.once('error', (err) => {
    if (!res.headersSent) res.status(502).send(`FFmpeg camera error: ${err.message}`);
    else res.destroy(err);
  });
  ffmpeg.once('close', (code) => {
    if (code && !res.destroyed) {
      console.warn(`FFmpeg camera process exited with code ${code}: ${stderr.trim()}`);
      res.end();
    }
  });

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (frameSubscriber) cameraSubscribers.delete(frameSubscriber);
    if (!ffmpeg.killed) ffmpeg.kill();
    userStats.removeCameraClient(cameraClientIP);
    updateUserStatsAndBroadcast();
  };
  res.once('close', cleanup);
  res.once('error', cleanup);
}

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
    const configuredURL = process.env.CAMERA_STREAM_URL;
    let webcam = null;
    if (!CAMERA_SNAPSHOT_URL && !configuredURL) {
      const webcamResponse = await printerClient.getWebcams();
      webcam = webcamResponse.webcams?.find((entry) => entry.enabled && (entry.stream_url || entry.snapshot_url));
    }
    const streamURL = CAMERA_SNAPSHOT_URL || configuredURL || webcam?.stream_url || webcam?.snapshot_url;
    if (!streamURL) throw new Error('No enabled Moonraker webcam found');

    cameraStreamURL = printerClient.resolveURL(streamURL);
    cameraMode = CAMERA_MODE === 'snapshot' || CAMERA_SNAPSHOT_URL ? 'snapshot' : CAMERA_MODE;
    printerStatus.camera = { available: true, error: null, mode: cameraMode };
    console.log(`Camera stream enabled: ${cameraStreamURL}`);
  } catch (err) {
    console.warn('Failed to setup camera:', err.message);
    printerStatus.camera = { available: false, error: err.message, mode: null };
    cameraStreamURL = null;
    cameraMode = null;
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
  stopCameraStreaming();
  if (!cameraStreamURL) {
    printerStatus.camera = {
      available: false,
      error: printerStatus.camera.error || 'Camera not available',
      mode: null
    };
    broadcastToClients({ type: 'status', data: buildStatusPayload() });
    resetCameraFailureTracker();
    return;
  }

  if (cameraMode === 'snapshot') {
    startCameraKeepalive();
    await pollCameraSnapshot();
    cameraPollTimer = setInterval(pollCameraSnapshot, CAMERA_SNAPSHOT_INTERVAL);
    cameraPollTimer.unref?.();
    return;
  }

  try {
    cameraAbortController = new AbortController();
    const response = await fetch(cameraStreamURL, { signal: cameraAbortController.signal });
    
    if (!response.ok) {
      throw new Error(`Camera error ${response.status}, ${response.statusText}`);
    }

    resetCameraFailureTracker();
    const contentType = response.headers.get('content-type') || '';
    cameraMode = detectCameraMode(cameraMode, contentType, cameraStreamURL);
    if (COMPRESSED_CAMERA_MODES.has(cameraMode)) {
      printerStatus.camera = { available: true, error: null, mode: cameraMode, contentType };
      await response.body?.cancel();
      broadcastToClients({ type: 'status', data: buildStatusPayload() });
      return;
    }
    if (cameraMode === 'auto' && contentType.startsWith('image/')) {
      cameraMode = 'snapshot';
      await response.body?.cancel();
      startCameraKeepalive();
      await pollCameraSnapshot();
      cameraPollTimer = setInterval(pollCameraSnapshot, CAMERA_SNAPSHOT_INTERVAL);
      cameraPollTimer.unref?.();
      return;
    }
    cameraMode = 'mjpeg';
    printerStatus.camera = { available: true, error: null, mode: 'mjpeg', contentType };
    if (CAMERA_STREAM_RESTART_INTERVAL) {
      cameraStreamRestartTimer = setTimeout(startCameraStreaming, CAMERA_STREAM_RESTART_INTERVAL);
      cameraStreamRestartTimer.unref?.();
    }

    // Extract boundary from multipart content-type header
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
        if (err.name === 'AbortError') return;
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
    if (err.name === 'AbortError') return;
    console.error('Failed to start camera stream:', err.message);
    printerStatus.camera = { available: false, error: err.message, mode: cameraMode };
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
  cameraAbortController?.abort();
  cameraAbortController = null;
  printerStream = null;
  if (cameraPollTimer) clearInterval(cameraPollTimer);
  if (cameraKeepaliveTimer) clearInterval(cameraKeepaliveTimer);
  if (cameraStreamRestartTimer) clearTimeout(cameraStreamRestartTimer);
  cameraPollTimer = null;
  cameraKeepaliveTimer = null;
  cameraStreamRestartTimer = null;
}

function broadcastCameraFrame(frame) {
  latestFrame = frame;
  cameraSubscribers.forEach((subscriber) => subscriber(latestFrame));
}

async function pollCameraSnapshot() {
  try {
    const response = await fetch(cameraStreamURL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Camera snapshot error ${response.status}`);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) throw new Error(`Expected camera image, received ${contentType}`);
    broadcastCameraFrame(Buffer.from(await response.arrayBuffer()));
    printerStatus.camera = { available: true, error: null, mode: 'snapshot', contentType };
    resetCameraFailureTracker();
  } catch (err) {
    console.warn('Camera snapshot poll failed:', err.message);
    printerStatus.camera = {
      available: Boolean(latestFrame),
      error: err.message,
      mode: 'snapshot',
      contentType: printerStatus.camera.contentType || 'image/jpeg'
    };
  }
}

function startCameraKeepalive() {
  if (!CAMERA_KEEPALIVE_TOKEN || cameraKeepaliveTimer) return;
  const protocol = printerClient.baseURL.protocol === 'https:' ? 'wss:' : 'ws:';
  const keepaliveURL = new URL(
    process.env.CAMERA_KEEPALIVE_URL || `${protocol}//${printerClient.baseURL.host}/websocket`
  );
  if (!keepaliveURL.searchParams.has('token')) {
    keepaliveURL.searchParams.set('token', CAMERA_KEEPALIVE_TOKEN);
  }
  const wake = () => {
    const socket = new WebSocket(keepaliveURL.toString(), { handshakeTimeout: 5000 });
    socket.once('open', () => {
      socket.send(JSON.stringify({
        id: Date.now(),
        jsonrpc: '2.0',
        method: 'camera.start_monitor',
        params: { domain: 'lan', interval: 0 }
      }), () => socket.close());
    });
    socket.once('error', (err) => console.warn('Camera keepalive failed:', err.message));
  };
  wake();
  cameraKeepaliveTimer = setInterval(wake, CAMERA_KEEPALIVE_INTERVAL);
  cameraKeepaliveTimer.unref?.();
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
