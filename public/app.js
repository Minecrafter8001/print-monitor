// WebSocket connection to the server
let ws = null;
let reconnectInterval = null;
let cameraInitialized = false;
let snapshotTaken = false;
let lastPrinterState = null;

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

    // Printer state
    const stateElement = document.getElementById('printerState');
    stateElement.textContent = printer.state || '-';
    stateElement.className = 'value state';
    if (printer.state) {
        stateElement.classList.add(printer.state.toLowerCase());
    }

    document.getElementById('currentFile').textContent = printer.currentFile || '-';

    // Last update (absolute clock time)
    document.getElementById('lastUpdate').textContent =
        printer.lastUpdate ? formatClockTime(new Date(printer.lastUpdate)) : '-';

    // Progress
    const progress = Number((printer.layerProgress || 0).toFixed(6));
    document.getElementById('progressFill').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = `${progress.toFixed(2)}%`;

    // Durations
    document.getElementById('printTime').textContent =
        formatDuration(printer.printTime);

    document.getElementById('remainingTime').textContent =
        formatDuration(printer.remainingTime);

    document.getElementById('calculatedTime').textContent =
        formatDuration(printer.calculatedTime);


    if (printer.remainingTime > 0 && printer.state !== 'idle') {
        document.getElementById('ReportedETA').textContent =
            formatClockTime(new Date(now.getTime() + printer.remainingTime * 1000));
    } else {
        document.getElementById('ReportedETA').textContent = '-';
    }

    if (printer.calculatedTime > 0 && printer.state !== 'idle') {
        document.getElementById('CalculatedETA').textContent =
            formatClockTime(new Date(now.getTime() + printer.calculatedTime * 1000));
    } else {
        document.getElementById('CalculatedETA').textContent = '-';
    }

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

    lastPrinterState = printer.state?.toLowerCase();

    if (printer.cameraAvailable) {
        if (printer.state?.toLowerCase() === "idle") {
            if (settings.pauseOnIdle) {
                if (!cameraInitialized) {
                    cameraFeed.src = '/api/camera';
                    cameraInitialized = true;

                    cameraFeed.onload = function () {
                        if (!snapshotTaken && printer.state?.toLowerCase() === "idle") {
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
