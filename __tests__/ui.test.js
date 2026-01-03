/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

// Mock WebSocket
global.WebSocket = jest.fn().mockImplementation(() => ({
    send: jest.fn(),
    close: jest.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    readyState: 1
}));

// Mock localStorage
const localStorageMock = (function() {
    let store = {};
    return {
        getItem: jest.fn(key => store[key] || null),
        setItem: jest.fn((key, value) => { store[key] = value.toString(); }),
        clear: jest.fn(() => { store = {}; }),
        removeItem: jest.fn(key => { delete store[key]; })
    };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock window.location
delete window.location;
window.location = {
    protocol: 'http:',
    host: 'localhost:3000'
};

// Load the HTML and JS
const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
const script = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');

describe('UI and Client Tests', () => {
    let originalConsoleLog;
    
    beforeAll(() => {
        originalConsoleLog = console.log;
        console.log = jest.fn();
        jest.useFakeTimers();
    });

    afterAll(() => {
        console.log = originalConsoleLog;
        jest.useRealTimers();
    });

    beforeEach(() => {
        document.documentElement.innerHTML = html;
        localStorage.clear();
        // Reset mocks
        jest.clearAllMocks();
        
        // Execute the script in the window context using eval
        // Convert let/const to var so they attach to window for testing
        const scriptWithVar = script.replace(/^(let|const) /gm, 'var ');
        window.eval(scriptWithVar);
    });

    test('formatDuration formats seconds correctly', () => {
        expect(formatDuration(3661)).toBe('01:01:01');
        expect(formatDuration(60)).toBe('00:01:00');
        expect(formatDuration(0)).toBe('-');
        expect(formatDuration(-1)).toBe('-');
        expect(formatDuration(NaN)).toBe('-');
    });

    test('formatClockTime formats Date correctly', () => {
        const date = new Date('2026-01-03T12:00:00');
        // The exact format might depend on locale, but we can check if it contains parts
        const formatted = formatClockTime(date);
        expect(formatted).toMatch(/12:00:00/);
    });

    test('updateUI updates connection status', () => {
        const payload = {
            printer: { connected: true },
            users: { activeUniqueWebIPs: 5 }
        };
        updateUI(payload);
        
        expect(document.getElementById('connectionText').textContent).toBe('Connected');
        expect(document.getElementById('connectionStatus').classList.contains('connected')).toBe(true);
        expect(document.getElementById('userCount').textContent).toBe('5 users online');
    });

    test('updateUI updates printer info', () => {
        const payload = {
            printer: {
                connected: true,
                printerName: 'Test Printer',
                status: 'PRINTING',
                currentFile: 'test.gcode',
                progress: 50.5,
                printTime: 100,
                remainingTime: 200,
                temperatures: {
                    nozzle: { current: 200, target: 210 },
                    bed: { current: 60, target: 60 },
                    enclosure: { current: 30, target: 0 }
                },
                layers: { current: 10, total: 100 }
            }
        };
        updateUI(payload);

        expect(document.getElementById('printerName').textContent).toBe('Test Printer');
        expect(document.getElementById('printerState').textContent).toBe('PRINTING');
        expect(document.getElementById('currentFile').textContent).toBe('test.gcode');
        expect(document.getElementById('progressText').textContent).toBe('50.50%');
        expect(document.getElementById('nozzleTemp').textContent).toBe('200');
        expect(document.getElementById('nozzleTarget').textContent).toBe('210');
        expect(document.getElementById('completedLayers').textContent).toBe('10');
        expect(document.getElementById('totalLayers').textContent).toBe('100');
        expect(document.getElementById('remainingLayers').textContent).toBe('90');
    });

    test('settings are loaded and saved', () => {
        // Test default settings
        expect(settings.pauseOnIdle).toBe(true);

        // Test saving
        settings.pauseOnIdle = false;
        saveSettings();
        expect(localStorage.setItem).toHaveBeenCalledWith('Settings', JSON.stringify({ pauseOnIdle: false }));

        // Test loading
        localStorage.getItem.mockReturnValue(JSON.stringify({ pauseOnIdle: true }));
        const loaded = loadSettings();
        expect(loaded.pauseOnIdle).toBe(true);
    });

    test('ETA freeze logic works', () => {
        const payload = {
            printer: {
                status: 'COMPLETE',
                progress: 100,
                remainingTime: 0,
                lastUpdate: new Date().toISOString()
            }
        };
        
        updateUI(payload);
        const eta1 = document.getElementById('ReportedETA').textContent;
        
        // Update again with different time, should stay frozen
        payload.printer.lastUpdate = new Date(Date.now() + 10000).toISOString();
        updateUI(payload);
        const eta2 = document.getElementById('ReportedETA').textContent;
        
        expect(eta1).toBe(eta2);
    });

    test('UI updates periodically', () => {
        // Trigger DOMContentLoaded
        document.dispatchEvent(new Event('DOMContentLoaded'));
        
        // Mock updateUI to see if it's called
        const originalUpdateUI = updateUI;
        window.updateUI = jest.fn();
        
        jest.advanceTimersByTime(1000);
        expect(window.updateUI).toHaveBeenCalled();
        
        window.updateUI = originalUpdateUI;
    });

    test('camera stream logic', () => {
        const payload = {
            printer: {
                connected: true,
                cameraAvailable: true,
                status: 'PRINTING'
            }
        };
        
        updateUI(payload);
        const cameraFeed = document.getElementById('cameraFeed');
        expect(cameraFeed.style.display).toBe('block');
        expect(cameraFeed.src).toContain('/api/camera');
        
        // If it becomes IDLE and pauseOnIdle is true
        settings.pauseOnIdle = true;
        payload.printer.status = 'IDLE';
        updateUI(payload);
        expect(document.getElementById('cameraOverlay').style.display).toBe('flex');
    });
});
