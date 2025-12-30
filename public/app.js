// WebSocket connection to the server
let ws = null;
let reconnectInterval = null;
let cameraInitialized = false;
let snapshotTaken = false;
let lastPrinterState = null;
let frozenETA = null;
let frozenETAState = null;

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
                updateUI(message.data);
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
    document.getElementById('printerName').textContent = printer.printerName || '-';



    // --- Status background color map ---
    const STATUS_BG = {
        IDLE: '#444',
        PRINTING: '#3498db',
        FILE_TRANSFERRING: '#888',
        LEVELING: '#20b2aa',
        STOPPING: '#e67e22',
        STOPPED: '#e74c3c',
        HOMING: '#3498db',
        RECOVERY: '#f39c12',
        PREHEATING: '#ff9800',
        PAUSED: '#e67e22',
        PAUSING: '#e67e22',
        COMPLETE: '#27ae60',
        ERROR: '#e74c3c',
        DROPPING: '#888',
        LIFTING: '#888',
        LOADING: '#888',
        FILE_CHECKING: '#888',
        UNKNOWN: '#888',
    };
    function getStatusBg(status) {
        return STATUS_BG[status] || STATUS_BG.UNKNOWN;
    }

    // --- Display single status with white text and colored background ---
    const status = printer.status || 'UNKNOWN';
    const stateElement = document.getElementById('printerState');
    stateElement.textContent = status;
    stateElement.className = 'value state';
    stateElement.style.background = getStatusBg(status);
    stateElement.style.color = '#fff';



    document.getElementById('currentFile').textContent = printer.currentFile || '-';

    // Last update (absolute clock time)
    document.getElementById('lastUpdate').textContent =
        printer.lastUpdate ? formatClockTime(new Date(printer.lastUpdate)) : '-';

    // Progress

    // Use new progress field if available, fallback to old
    const progress = Number((printer.progress || printer.Progress || 0).toFixed(6));
    document.getElementById('progressFill').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = `${progress.toFixed(2)}%`;

    // Durations
    document.getElementById('printTime').textContent =
        formatDuration(printer.printTime);

    document.getElementById('remainingTime').textContent =
        formatDuration(printer.remainingTime);

    // ETA freeze logic
    // Freeze ETA when progress is 100 and state is NOT PRINTING; unfreeze when state is PRINTING
    const etaElem = document.getElementById('ReportedETA');
    const statusUpper = (printer.status || '').toUpperCase();
    if (statusUpper === 'PRINTING') {
        // Unfreeze ETA when printing
        if (printer.remainingTime && Number.isFinite(printer.remainingTime)) {
            etaElem.textContent = formatClockTime(new Date(Date.now() + printer.remainingTime * 1000));
        } else {
            etaElem.textContent = '-';
        }
        frozenETA = null;
        frozenETAState = null;
    } else if (progress >= 100) {
        if (!frozenETA) {
            // Only freeze if not already frozen
            if (printer.remainingTime && Number.isFinite(printer.remainingTime)) {
                frozenETA = formatClockTime(new Date(Date.now() + printer.remainingTime * 1000));
            } else {
                frozenETA = '-';
            }
            frozenETAState = statusUpper;
        }
        etaElem.textContent = frozenETA;
    } else if (frozenETA) {
        // Stay frozen while not printing and after 100%
        etaElem.textContent = frozenETA;
    } else {
        // Default ETA logic
        if (printer.remainingTime && Number.isFinite(printer.remainingTime)) {
            etaElem.textContent = formatClockTime(new Date(Date.now() + printer.remainingTime * 1000));
        } else {
            etaElem.textContent = '-';
        }
        frozenETA = null;
        frozenETAState = null;
    }

    // Layer info
    const layers = printer.layers || { current: 0, total: 0 };
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
    const temps = printer.temperatures || { bed: {}, nozzle: {}, enclosure: {} };
    document.getElementById('nozzleTemp').textContent = Math.round(temps.nozzle.current || 0);
    document.getElementById('nozzleTarget').textContent = Math.round(temps.nozzle.target || 0);
    document.getElementById('bedTemp').textContent = Math.round(temps.bed.current || 0);
    document.getElementById('bedTarget').textContent = Math.round(temps.bed.target || 0);
    document.getElementById('enclosureTemp').textContent = Math.round(temps.enclosure.current || 0);
    document.getElementById('enclosureTarget').textContent = Math.round(temps.enclosure.target || 0);

    // ---------------- CAMERA LOGIC (UNCHANGED) ----------------

    const cameraFeed = document.getElementById('cameraFeed');
    const cameraPlaceholder = document.getElementById('cameraPlaceholder');
    const cameraOverlay = document.getElementById('cameraOverlay');

    // Use mapped state value for all logic
    lastPrinterState = status;

    if (printer.cameraAvailable) {
        if (status === "IDLE") {
            if (settings.pauseOnIdle) {
                if (!cameraInitialized) {
                    cameraFeed.src = '/api/camera';
                    cameraInitialized = true;

                    cameraFeed.onload = function () {
                        // Use mapped state for comparison
                        const mappedState = (typeof printer.state === 'number' || (typeof printer.state === 'string' && /^\d+$/.test(printer.state))) ? stateMap[printer.state] || 'Unknown' : (stateMap[printer.state] || printer.state || 'Unknown');
                        if (!snapshotTaken && mappedState === "IDLE") {
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

                cameraFeed.style.display = 'block';
                cameraPlaceholder.style.display = 'none';
                cameraOverlay.style.display = 'flex';
                return;
            } else {
                cameraInitialized = true;
                snapshotTaken = false;
                cameraFeed.src = '/api/camera';
                cameraFeed.style.display = 'block';
                cameraPlaceholder.style.display = 'none';
                cameraOverlay.style.display = 'none';
                return;
            }
        }

        cameraFeed.src = '/api/camera';
        cameraInitialized = true;
        snapshotTaken = false;
        cameraFeed.style.display = 'block';
        cameraPlaceholder.style.display = 'none';
        cameraOverlay.style.display = 'none';
    } else {
        cameraFeed.style.display = 'none';
        cameraPlaceholder.style.display = 'flex';
    }
}

// ---------------- CAMERA TOGGLE ----------------

function toggleCameraStream() {
    const cameraFeed = document.getElementById('cameraFeed');
    const cameraOverlay = document.getElementById('cameraOverlay');

    if (lastPrinterState === 'idle' && cameraFeed.style.display === 'block') {
        if (settings.pauseOnIdle) {
            if (!snapshotTaken) {
                const canvas = document.createElement('canvas');
                canvas.width = cameraFeed.naturalWidth;
                canvas.height = cameraFeed.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(cameraFeed, 0, 0);
                cameraFeed.src = canvas.toDataURL('image/jpeg');
                snapshotTaken = true;
            }
            cameraOverlay.style.display = 'flex';
        } else {
            snapshotTaken = false;
            cameraFeed.src = '/api/camera';
            cameraOverlay.style.display = 'none';
        }
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

document.addEventListener('DOMContentLoaded', () => {
    console.log('Elegoo Print Monitor starting...');
    initPauseOnIdleButton();
    connectWebSocket();
});
