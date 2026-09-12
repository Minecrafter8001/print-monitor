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
        expect(formatted).toMatch(/:00:00/);
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
                name: 'Test Printer',
                klipper: { state: 'ready', message: '' },
                print: {
                    state: 'printing',
                    filename: 'test.gcode',
                    progressPercent: 50.5,
                    elapsedSeconds: 100,
                    estimatedRemainingSeconds: 200,
                    layers: { current: 10, total: 100 }
                },
                temperatures: {
                    activeTool: {
                        name: 'extruder3',
                        friendlyName: 'Toolhead 4',
                        current: 200,
                        target: 210
                    },
                    bed: { current: 60, target: 60 },
                    enclosure: { name: 'temperature_sensor cavity', current: 30, target: 0 },
                    tools: []
                }
            }
        };
        updateUI(payload);

        expect(document.getElementById('printerName').textContent).toBe('Test Printer');
        expect(document.getElementById('klipperState').textContent).toBe('READY');
        expect(document.getElementById('printState').textContent).toBe('PRINTING');
        expect(document.getElementById('currentFile').textContent).toBe('test.gcode');
        expect(document.getElementById('progressText').textContent).toBe('51%');
        expect(document.getElementById('activeToolLabel').textContent).toBe('Toolhead 4');
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

    test('ETA is calculated from Moonraker metadata estimate', () => {
        const payload = {
            printer: {
                print: {
                    state: 'printing',
                    progressPercent: 50,
                    estimatedRemainingSeconds: 60
                },
                updatedAt: new Date().toISOString()
            }
        };
        
        updateUI(payload);
        expect(document.getElementById('ReportedETA').textContent).not.toBe('-');
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
                klipper: { state: 'ready' },
                print: { state: 'printing' },
                camera: { available: true, error: null }
            }
        };
        
        updateUI(payload);
        const cameraFeed = document.getElementById('cameraFeed');
        expect(cameraFeed.style.display).toBe('block');
        expect(cameraFeed.src).toContain('/api/camera');
        
        // If it becomes IDLE and pauseOnIdle is true
        settings.pauseOnIdle = true;
        payload.printer.print.state = 'standby';
        updateUI(payload);
        expect(document.getElementById('cameraOverlay').style.display).toBe('flex');
    });
});
