// WebSocket connection to the server
let ws = null;
let reconnectInterval = null;
let cameraInitialized = false;
let snapshotTaken = false;
let lastPrinterState = null;
let lastPayload = null;
let toastIdCounter = 0;

// Settings object
const defaultSettings = {
    pauseOnIdle: true
};

let settings = loadSettings();

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

// ---------------- SETTINGS ----------------

function loadSettings() {
    try {
        const stored = localStorage.getItem('Settings');
        if (stored) {
            return { ...defaultSettings, ...JSON.parse(stored) };
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
    return { ...defaultSettings };
}

function saveSettings() {
    try {
        localStorage.setItem('Settings', JSON.stringify(settings));
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
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
    const remainingSeconds = printer.print?.estimatedRemainingSeconds;
    const updatedAt = printer.updatedAt ? new Date(printer.updatedAt).getTime() : Date.now();
    etaElem.textContent = Number.isFinite(remainingSeconds) && remainingSeconds > 0
        ? formatClockTime(new Date(updatedAt + remainingSeconds * 1000))
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
    const activeToolName = temps.activeTool?.friendlyName || 'Nozzle';
    document.getElementById('activeToolLabel').textContent = activeToolName;
    document.getElementById('nozzleTemp').textContent = Math.round(temps.activeTool?.current || 0);
    document.getElementById('nozzleTarget').textContent = Math.round(temps.activeTool?.target || 0);
    document.getElementById('bedTemp').textContent = Math.round(temps.bed.current || 0);
    document.getElementById('bedTarget').textContent = Math.round(temps.bed.target || 0);
    document.getElementById('enclosureTemp').textContent = Math.round(temps.enclosure.current || 0);
    document.getElementById('enclosureTarget').textContent = Math.round(temps.enclosure.target || 0);

    // ---------------- CAMERA LOGIC (UNCHANGED) ----------------

    const cameraFeed = document.getElementById('cameraFeed');
    const cameraPlaceholder = document.getElementById('cameraPlaceholder');
    const cameraOverlay = document.getElementById('cameraOverlay');
    const cameraPlaceholderLabel = cameraPlaceholder.querySelector('span') || cameraPlaceholder;

    lastPrinterState = printState;

    if (printer.camera?.available) {
        const isIdle = printState === 'standby';
        if (!cameraInitialized) {
            cameraFeed.src = '/api/camera';
            cameraInitialized = true;

            cameraFeed.onload = function () {
                if (!snapshotTaken && isIdle && settings.pauseOnIdle) {
                    const canvas = document.createElement('canvas');
                    canvas.width = cameraFeed.naturalWidth;
                    canvas.height = cameraFeed.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(cameraFeed, 0, 0);
                    cameraFeed.src = canvas.toDataURL('image/jpeg');
                    snapshotTaken = true;
                    cameraFeed.onload = null;
                }
            };
        }
        if (isIdle && settings.pauseOnIdle) {
            cameraOverlay.style.display = 'flex';
        } else {
            // Only reset src if we have a snapshot taken or if it's not set to the stream
            if (snapshotTaken || !cameraFeed.src.includes('/api/camera')) {
                snapshotTaken = false;
                cameraFeed.src = '/api/camera';
            }
            cameraOverlay.style.display = 'none';
        }
        cameraFeed.style.display = 'block';
        cameraPlaceholder.style.display = 'none';
    } else {
        cameraFeed.style.display = 'none';
        cameraPlaceholder.style.display = 'flex';
        cameraOverlay.style.display = 'none';
        cameraInitialized = false;
        const message = printer.camera?.error || 'No camera feed available';
        if (cameraPlaceholderLabel) {
            cameraPlaceholderLabel.textContent = message;
        }
    }
}

// ---------------- CAMERA TOGGLE ----------------

function toggleCameraStream() {
    const cameraFeed = document.getElementById('cameraFeed');
    const cameraOverlay = document.getElementById('cameraOverlay');
    const isIdle = lastPrinterState === 'standby';

    if (!isIdle) return;

    if (settings.pauseOnIdle) {
        if (cameraFeed.style.display === 'block') {
            if (!snapshotTaken) {
                const canvas = document.createElement('canvas');
                canvas.width = cameraFeed.naturalWidth;
                canvas.height = cameraFeed.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(cameraFeed, 0, 0);
                cameraFeed.src = canvas.toDataURL('image/jpeg');
                snapshotTaken = true;
            }
        }
        cameraOverlay.style.display = 'flex';
    } else {
        snapshotTaken = false;
        if (cameraFeed.style.display === 'block') {
            cameraFeed.src = '/api/camera';
        }
        cameraOverlay.style.display = 'none';
    }
}

// ---------------- INIT ----------------

function initPauseOnIdleButton() {
    const btn = document.getElementById('pauseOnIdleBtn');

    if (settings.pauseOnIdle) {
        btn.classList.add('active');
    }

    btn.addEventListener('click', () => {
        settings.pauseOnIdle = !settings.pauseOnIdle;
        saveSettings();

        btn.classList.toggle('active', settings.pauseOnIdle);
        toggleCameraStream();
    });
}

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
    initPauseOnIdleButton();
    connectWebSocket();

    // Update UI every second to keep clock and other elements fresh
    setInterval(() => {
        updateUI(lastPayload);
    }, 1000);
});
