// WebSocket connection to the server
let ws = null;
let reconnectInterval = null;

// Connect to WebSocket server
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
            console.log('Message from server:', event.data);
            const message = JSON.parse(event.data);
            
            // Handle different message types
            switch (message.type) {
                case 'status':
                    updateUI(message.data);
                    break;
                default:
                    console.log('Unknown message type:', message.type);
            }
        } catch (err) {
            console.error('Failed to parse message:', err);
        }
    };
    
    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
    
    ws.onclose = () => {
        console.log('Disconnected from server');
        scheduleReconnect();
    };
}

// Schedule reconnection
function scheduleReconnect() {
    if (reconnectInterval) return;
    
    reconnectInterval = setInterval(() => {
        console.log('Attempting to reconnect...');
        connectWebSocket();
    }, 5000);
}

// Clear reconnection interval
function clearReconnectInterval() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
}

// Update UI with combined payload { printer, users }
function updateUI(payload) {
    const printer = payload?.printer || {};
    const users = payload?.users || {};

    // Connection status
    const statusIndicator = document.getElementById('connectionStatus');
    const connectionText = document.getElementById('connectionText');
    const userCountText = document.getElementById('userCount');

    if (printer.connected) {
        statusIndicator.classList.add('connected');
        connectionText.textContent = 'Connected';
    } else {
        statusIndicator.classList.remove('connected');
        connectionText.textContent = 'Disconnected';
    }

    const uniqueUsers = users.uniqueWebIPs || 0;
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
    
    // Current file
    document.getElementById('currentFile').textContent = printer.currentFile || '-';
    
    // Last update
    if (printer.lastUpdate) {
        const updateTime = new Date(printer.lastUpdate);
        document.getElementById('lastUpdate').textContent = updateTime.toLocaleTimeString();
    } else {
        document.getElementById('lastUpdate').textContent = '-';
    }
    
    // Progress (6 decimal precision for calculations, 2 for display)
    const progress = Number((printer.layerProgress || 0).toFixed(6));
    document.getElementById('progressFill').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = `${progress.toFixed(2)}%`;
    
    // Print time
    document.getElementById('printTime').textContent = formatTime(printer.printTime || 0);
    document.getElementById('remainingTime').textContent = formatTime(printer.remainingTime || 0);
    document.getElementById('calculatedTime').textContent = formatTime(printer.calculatedTime || 0);
    
    // Calculate and display ETAs
    const currentTime = Date.now();
    const reportedETA = new Date(currentTime + (printer.remainingTime || 0) * 1000);
    document.getElementById('ReportedETA').textContent = reportedETA.toLocaleTimeString();
    
    const calculatedETA = new Date(currentTime + (printer.calculatedTime || 0) * 1000);
    document.getElementById('CalculatedETA').textContent = calculatedETA.toLocaleTimeString();
    
    if (progress >= 100 || printer.state === 'idle') {
        document.getElementById('ReportedETA').textContent = '-';
        document.getElementById('CalculatedETA').textContent = '-';
        document.getElementById('remainingTime').textContent = '-';
        document.getElementById('calculatedTime').textContent = '-';
    }

    
    // Temperatures
    const temps = printer.temperatures || { bed: { current: 0, target: 0 }, nozzle: { current: 0, target: 0 }, enclosure: { current: 0, target: 0 } };
    document.getElementById('nozzleTemp').textContent = Math.round(temps.nozzle.current || 0);
    document.getElementById('nozzleTarget').textContent = Math.round(temps.nozzle.target || 0);
    document.getElementById('bedTemp').textContent = Math.round(temps.bed.current || 0);
    document.getElementById('bedTarget').textContent = Math.round(temps.bed.target || 0);
    document.getElementById('enclosureTemp').textContent = Math.round(temps.enclosure.current || 0);
    document.getElementById('enclosureTarget').textContent = Math.round(temps.enclosure.target || 0);
    
    // Camera feed
    const cameraFeed = document.getElementById('cameraFeed');
    const cameraPlaceholder = document.getElementById('cameraPlaceholder');
    
    if (printer.cameraAvailable) {
        // Fetch camera from server endpoint
        cameraFeed.src = '/api/camera';
        cameraFeed.style.display = 'block';
        cameraPlaceholder.style.display = 'none';
    } else {
        cameraFeed.style.display = 'none';
        cameraPlaceholder.style.display = 'flex';
    }
}

// Format time in seconds to HH:MM:SS
function formatTime(seconds) {
    if (!seconds || seconds < 0) return '00:00:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('Elegoo Print Monitor starting...');
    connectWebSocket();
});
