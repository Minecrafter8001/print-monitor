// WebSocket connection to the server
let ws = null;
let reconnectInterval = null;
let cameraInitialized = false;
let cameraRestartTimer = null;
let cameraStreamAbortController = null;
let cameraObjectURL = null;
let cameraPlaybackGeneration = 0;
let lastPayload = null;
let toastIdCounter = 0;
let etaEstimate = { filename: null, state: null, timestamp: null };
const ETA_UPDATE_THRESHOLD_MS = 60000;
const CAMERA_MIME_TYPE = 'video/mp4; codecs="avc1.640028"';
const CAMERA_MAX_BUFFER_SECONDS = 6;
const CAMERA_LIVE_EDGE_DELAY_SECONDS = 0.5;

// ---------------- TIME HELPERS ----------------

// Format duration in seconds to HH:MM:SS
function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '-';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Format Date to clock time
function formatClockTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return '-';
    return date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

function getStableEtaTimestamp(printer) {
    const print = printer.print || {};
    const remainingSeconds = print.estimatedRemainingSeconds;
    const canEstimate = Number.isFinite(remainingSeconds) && remainingSeconds > 0;
    const isActive = print.state === 'printing' || print.state === 'paused';

    if (!canEstimate || !isActive) {
        etaEstimate = { filename: null, state: print.state || null, timestamp: null };
        return null;
    }

    const updatedAt = printer.updatedAt ? new Date(printer.updatedAt).getTime() : Date.now();
    const candidate = updatedAt + remainingSeconds * 1000;
    const printChanged = etaEstimate.filename !== (print.filename || null);
    const stateChanged = etaEstimate.state !== print.state;
    const estimateChanged = !Number.isFinite(etaEstimate.timestamp) ||
        Math.abs(candidate - etaEstimate.timestamp) >= ETA_UPDATE_THRESHOLD_MS;

    if (printChanged || stateChanged || estimateChanged) {
        etaEstimate = {
            filename: print.filename || null,
            state: print.state,
            timestamp: candidate
        };
    }

    return etaEstimate.timestamp;
}

function stopCameraPlayer(cameraVideo) {
    const hadSource = cameraVideo.hasAttribute('src');
    cameraPlaybackGeneration += 1;
    if (cameraRestartTimer) clearTimeout(cameraRestartTimer);
    cameraRestartTimer = null;
    cameraStreamAbortController?.abort();
    cameraStreamAbortController = null;
    cameraVideo.removeAttribute('src');
    if (hadSource) cameraVideo.load?.();
    if (cameraObjectURL) URL.revokeObjectURL(cameraObjectURL);
    cameraObjectURL = null;
}

function scheduleCameraRestart(cameraVideo, intervalSeconds) {
    if (!intervalSeconds) return;
    const delay = Math.max(1000, intervalSeconds * 1000 - 1000);
    cameraRestartTimer = setTimeout(() => {
        startCameraPlayer(cameraVideo, true);
        scheduleCameraRestart(cameraVideo, intervalSeconds);
    }, delay);
}

function waitForSourceBuffer(sourceBuffer, operation) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            sourceBuffer.removeEventListener('updateend', handleUpdateEnd);
            sourceBuffer.removeEventListener('error', handleError);
        };
        const handleUpdateEnd = () => {
            cleanup();
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(new Error('Camera media buffer failed'));
        };
        sourceBuffer.addEventListener('updateend', handleUpdateEnd, { once: true });
        sourceBuffer.addEventListener('error', handleError, { once: true });
        operation();
    });
}

async function startMediaSourcePlayer(cameraVideo, streamURL, generation) {
    const mediaSource = new MediaSource();
    cameraObjectURL = URL.createObjectURL(mediaSource);
    cameraVideo.src = cameraObjectURL;

    await new Promise((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', resolve, { once: true });
        mediaSource.addEventListener('error', reject, { once: true });
    });
    if (generation !== cameraPlaybackGeneration) return;

    const sourceBuffer = mediaSource.addSourceBuffer(CAMERA_MIME_TYPE);
    const abortController = new AbortController();
    cameraStreamAbortController = abortController;
    const response = await fetch(streamURL, { cache: 'no-store', signal: abortController.signal });
    if (!response.ok || !response.body) throw new Error(`Camera stream error ${response.status}`);

    const reader = response.body.getReader();
    while (generation === cameraPlaybackGeneration) {
        const { done, value } = await reader.read();
        if (done) break;
        await waitForSourceBuffer(sourceBuffer, () => sourceBuffer.appendBuffer(value));

        if (sourceBuffer.buffered.length) {
            const start = sourceBuffer.buffered.start(0);
            const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
            if (end - start > CAMERA_MAX_BUFFER_SECONDS) {
                await waitForSourceBuffer(sourceBuffer, () => {
                    sourceBuffer.remove(start, end - CAMERA_MAX_BUFFER_SECONDS);
                });
            }
            if (cameraVideo.currentTime < end - 2) {
                cameraVideo.currentTime = Math.max(start, end - CAMERA_LIVE_EDGE_DELAY_SECONDS);
            }
            cameraVideo.play?.().catch(() => {});
        }
    }

    if (generation === cameraPlaybackGeneration) {
        throw new Error('Camera stream ended');
    }
}

function startCameraPlayer(cameraVideo, restarting = false) {
    stopCameraPlayer(cameraVideo);
    const streamURL = restarting
        ? `/api/camera/video?restart=${Date.now()}`
        : '/api/camera/video';
    const generation = cameraPlaybackGeneration;
    const supportsMediaSource = typeof MediaSource !== 'undefined' &&
        typeof fetch === 'function' && MediaSource.isTypeSupported?.(CAMERA_MIME_TYPE);

    if (!supportsMediaSource) {
        cameraVideo.src = streamURL;
        return;
    }

    startMediaSourcePlayer(cameraVideo, streamURL, generation).catch((err) => {
        if (err.name !== 'AbortError' && generation === cameraPlaybackGeneration) {
            console.error('Camera stream playback failed:', err);
            setTimeout(() => {
                if (generation === cameraPlaybackGeneration && cameraInitialized) {
                    startCameraPlayer(cameraVideo, true);
                }
            }, 1000);
        }
    });
}

// ---------------- WEBSOCKET ----------------

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to server');
        clearReconnectInterval();
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'status') {
                lastPayload = message.data;
                updateUI(message.data);
            } else if (message.type === 'server_restarting') {
                showToast({
                    title: 'Server restarting…',
                    body: message.data?.reason || 'Server restarting',
                    hint: 'The page will reconnect automatically.',
                    duration: 5000
                });
            }
        } catch (err) {
            console.error('Failed to parse message:', err);
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from server');
        scheduleReconnect();
    };
}

function scheduleReconnect() {
    if (reconnectInterval) return;
    reconnectInterval = setInterval(connectWebSocket, 5000);
}

function clearReconnectInterval() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
}

function getToolheadIndex(tool) {
    const suffix = tool?.name?.match(/^extruder(\d*)$/)?.[1];
    if (suffix !== undefined) return suffix === '' ? 0 : Number.parseInt(suffix, 10);

    const friendlyNumber = tool?.friendlyName?.match(/(\d+)$/)?.[1];
    return friendlyNumber ? Number.parseInt(friendlyNumber, 10) - 1 : -1;
}

function updateToolheadTiles(tools = []) {
    const toolsByIndex = new Map(tools.map(tool => [getToolheadIndex(tool), tool]));

    for (let index = 0; index < 4; index += 1) {
        const tile = document.getElementById(`toolhead${index}`);
        const tool = toolsByIndex.get(index);
        const isActive = tool?.active === true;
        const filament = tool?.filament || {};
        const swatch = tile.querySelector('.filament-swatch');

        tile.querySelector('.tool-current').textContent = Math.round(tool?.current || 0);
        tile.querySelector('.tool-target').textContent = Math.round(tool?.target || 0);
        tile.querySelector('.filament-material').textContent = filament.material || 'Unknown';
        swatch.style.backgroundColor = filament.color || 'transparent';
        swatch.classList.toggle('unknown', !filament.color);
        tile.classList.toggle('filament-empty', filament.loaded === false);
        tile.classList.toggle('active', isActive);
        tile.setAttribute('aria-current', isActive ? 'true' : 'false');
    }
}

// ---------------- UI UPDATE ----------------

function updateUI(payload) {
    const printer = payload?.printer || {};
    const users = payload?.users || {};
    const now = new Date();

    // Connection status
    const statusIndicator = document.getElementById('connectionStatus');
    const connectionText = document.getElementById('connectionText');
    const userCountText = document.getElementById('userCount');

    // Current time
    document.getElementById('currentTime').textContent = formatClockTime(now);

    if (printer.connected) {
        statusIndicator.classList.add('connected');
        connectionText.textContent = 'Connected';
    } else {
        statusIndicator.classList.remove('connected');
        connectionText.textContent = 'Disconnected';
    }

    const uniqueUsers = users.activeUniqueWebIPs || 0;
    userCountText.textContent = `${uniqueUsers} user${uniqueUsers === 1 ? '' : 's'} online`;

    // Printer info
    document.getElementById('printerName').textContent = printer.name || '-';



    // --- Status background color map ---
    const STATUS_BG = {
        ready: '#27ae60',
        startup: '#f39c12',
        shutdown: '#e74c3c',
        error: '#e74c3c',
        disconnected: '#888',
        standby: '#444',
        printing: '#3498db',
        paused: '#e67e22',
        complete: '#27ae60',
        cancelled: '#e74c3c'
    };
    function getStatusBg(status) {
        return STATUS_BG[status] || '#888';
    }

    const klipperState = printer.klipper?.state || 'disconnected';
    const klipperStateElement = document.getElementById('klipperState');
    klipperStateElement.textContent = klipperState.toUpperCase();
    klipperStateElement.className = 'value state';
    klipperStateElement.style.background = getStatusBg(klipperState);
    klipperStateElement.style.color = '#fff';

    const printState = printer.print?.state || 'standby';
    const printStateElement = document.getElementById('printState');
    printStateElement.textContent = printState.toUpperCase();
    printStateElement.className = 'value state';
    printStateElement.style.background = getStatusBg(printState);
    printStateElement.style.color = '#fff';

    document.getElementById('currentFile').textContent = printer.print?.filename || '-';

    // Last update (absolute clock time)
    document.getElementById('lastUpdate').textContent =
        printer.updatedAt ? formatClockTime(new Date(printer.updatedAt)) : '-';

    // Progress

    const progress = printer.print?.progressPercent || 0;
    
    document.getElementById('progressFill').style.width = `${progress.toFixed(0)}%`;
    document.getElementById('progressText').textContent = `${progress.toFixed(0)}%`;

    // Durations
    document.getElementById('printTime').textContent =
        formatDuration(printer.print?.elapsedSeconds);

    document.getElementById('remainingTime').textContent =
        formatDuration(printer.print?.estimatedRemainingSeconds);

    const etaElem = document.getElementById('ReportedETA');
    const etaTimestamp = getStableEtaTimestamp(printer);
    etaElem.textContent = Number.isFinite(etaTimestamp)
        ? formatClockTime(new Date(etaTimestamp))
        : '-';

    // Layer info
    const layers = printer.print?.layers || { current: 0, total: 0 };
    const completedLayers = layers.current || 0;
    const totalLayers = layers.total || 0;
    const remainingLayers = totalLayers > 0 ? Math.max(0, totalLayers - completedLayers) : 0;

    const completedLayersElem = document.getElementById('completedLayers');
    if (completedLayersElem) completedLayersElem.textContent = completedLayers;

    const totalLayersElem = document.getElementById('totalLayers');
    if (totalLayersElem) totalLayersElem.textContent = totalLayers;

    const remainingLayersElem = document.getElementById('remainingLayers');
    if (remainingLayersElem) remainingLayersElem.textContent = remainingLayers;

    // Temperatures
    const temps = printer.temperatures || { bed: {}, activeTool: {}, enclosure: {} };
    updateToolheadTiles(temps.tools || []);
    document.getElementById('bedTemp').textContent = Math.round(temps.bed.current || 0);
    document.getElementById('bedTarget').textContent = Math.round(temps.bed.target || 0);
    document.getElementById('enclosureTemp').textContent = Math.round(temps.enclosure.current || 0);
    document.getElementById('enclosureTarget').textContent = Math.round(temps.enclosure.target || 0);

    // ---------------- CAMERA LOGIC ----------------

    const cameraVideo = document.getElementById('cameraVideo');
    const cameraPlaceholder = document.getElementById('cameraPlaceholder');
    const cameraPlaceholderLabel = cameraPlaceholder.querySelector('span') || cameraPlaceholder;

    if (printer.camera?.available) {
        if (!cameraInitialized) {
            startCameraPlayer(cameraVideo);
            scheduleCameraRestart(cameraVideo, printer.camera.restartIntervalSeconds);
            cameraInitialized = true;
        }
        cameraVideo.style.display = 'block';
        cameraPlaceholder.style.display = 'none';
    } else {
        cameraVideo.style.display = 'none';
        stopCameraPlayer(cameraVideo);
        cameraPlaceholder.style.display = 'flex';
        cameraInitialized = false;
        const message = printer.camera?.error || 'No camera feed available';
        if (cameraPlaceholderLabel) {
            cameraPlaceholderLabel.textContent = message;
        }
    }
}

// ---------------- INIT ----------------

function showToast({ title, body, hint, duration = 15000 }) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toastId = `toast-${++toastIdCounter}`;
    const card = document.createElement('div');
    card.className = 'toast-card';
    card.id = toastId;

    const close = document.createElement('div');
    close.className = 'toast-close';
    close.textContent = '×';
    close.onclick = () => dismissToast(card, container);

    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title || 'Notice';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'toast-body';
    bodyEl.textContent = body || '';

    const hintEl = document.createElement('div');
    hintEl.className = 'toast-hint';
    hintEl.textContent = hint || '';

    card.appendChild(close);
    card.appendChild(titleEl);
    if (body) card.appendChild(bodyEl);
    if (hint) card.appendChild(hintEl);

    container.appendChild(card);

    if (duration > 0) {
        setTimeout(() => dismissToast(card, container), duration);
    }
}

function dismissToast(card, container) {
    if (!card || !container || card.parentNode !== container) return;
    card.style.animation = 'toast-out 220ms ease-in forwards';
    setTimeout(() => {
        if (card.parentNode === container) {
            container.removeChild(card);
        }
    }, 220);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Snapmaker Moonraker Print Monitor starting...');
    connectWebSocket();

    // Update UI every second to keep clock and other elements fresh
    setInterval(() => {
        updateUI(lastPayload);
    }, 1000);
});
