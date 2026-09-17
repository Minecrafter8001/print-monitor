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
const scripts = ['formatters.js', 'camera-player.js', 'dashboard-ui.js', 'timelapses.js', 'app.js']
    .map(file => fs.readFileSync(path.resolve(
        __dirname,
        `../public/${file === 'app.js' ? file : `modules/${file}`}`
    ), 'utf8'));

describe('UI and Client Tests', () => {
    let originalConsoleLog;
    
    beforeAll(() => {
        originalConsoleLog = console.log;
        console.log = jest.fn();
        HTMLMediaElement.prototype.load = jest.fn();
        HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve());
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
        scripts.forEach(script => {
            const scriptWithVar = script.replace(/^(let|const) /gm, 'var ');
            window.eval(scriptWithVar);
        });
    });

    test('formatDuration formats seconds correctly', () => {
        expect(PrintMonitorFormatters.formatDuration(3661)).toBe('01:01:01');
        expect(PrintMonitorFormatters.formatDuration(60)).toBe('00:01:00');
        expect(PrintMonitorFormatters.formatDuration(0)).toBe('-');
        expect(PrintMonitorFormatters.formatDuration(-1)).toBe('-');
        expect(PrintMonitorFormatters.formatDuration(NaN)).toBe('-');
    });

    test('formatClockTime formats Date correctly', () => {
        const date = new Date('2026-01-03T12:00:00');
        // The exact format might depend on locale, but we can check if it contains parts
        const formatted = PrintMonitorFormatters.formatClockTime(date);
        expect(formatted).toMatch(/:00:00/);
    });

    test('renders timelapse metadata and a download button', () => {
        timelapseController.render([{
            name: '<print>.mp4',
            modified: new Date('2026-01-03T12:00:00Z').getTime() / 1000,
            size: 1536,
            downloadUrl: '/api/timelapses/download?file=%3Cprint%3E.mp4'
        }]);

        expect(document.querySelector('.timelapse-name').textContent).toBe('<print>.mp4');
        expect(document.querySelector('.timelapse-metadata').textContent).toContain('1.50 KB');
        expect(document.querySelector('.download-button').tagName).toBe('BUTTON');
        expect(document.querySelector('.timelapse-name').children).toHaveLength(0);
    });

    test('downloads timelapses in bounded byte ranges', async () => {
        const chunkSize = PrintMonitorTimelapses.DOWNLOAD_CHUNK_SIZE;
        const timelapse = {
            name: 'large.mp4',
            size: chunkSize + 5,
            downloadUrl: '/api/timelapses/download?file=large.mp4'
        };
        const button = document.createElement('button');
        const firstChunk = new Blob([new Uint8Array(chunkSize)]);
        const secondChunk = new Blob([new Uint8Array(5)]);
        global.fetch = jest.fn()
            .mockResolvedValueOnce({ status: 206, blob: async () => firstChunk })
            .mockResolvedValueOnce({ status: 206, blob: async () => secondChunk });
        URL.createObjectURL = jest.fn(() => 'blob:timelapse');
        URL.revokeObjectURL = jest.fn();
        HTMLAnchorElement.prototype.click = jest.fn();

        await timelapseController.download(timelapse, button);

        expect(global.fetch).toHaveBeenNthCalledWith(1, timelapse.downloadUrl, {
            headers: { Range: `bytes=0-${chunkSize - 1}` }
        });
        expect(global.fetch).toHaveBeenNthCalledWith(2, timelapse.downloadUrl, {
            headers: { Range: `bytes=${chunkSize}-${chunkSize + 4}` }
        });
        expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
        expect(button.disabled).toBe(false);
        expect(button.textContent).toBe('Download');
    });

    test('shows an empty state when there are no timelapses', () => {
        timelapseController.render([]);

        expect(document.getElementById('timelapseState').textContent)
            .toBe('No completed timelapses found.');
        expect(document.getElementById('timelapseList').children).toHaveLength(0);
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
                    tools: [
                        { name: 'extruder', friendlyName: 'Toolhead 1', current: 31, target: 0, active: false, filament: { material: 'PETG', color: '#8C9099', source: 'gcode', loaded: true } },
                        { name: 'extruder1', friendlyName: 'Toolhead 2', current: 200, target: 210, active: false },
                        { name: 'extruder2', friendlyName: 'Toolhead 3', current: 33, target: 0, active: false },
                        { name: 'extruder3', friendlyName: 'Toolhead 4', current: 205, target: 215, active: true }
                    ]
                }
            }
        };
        updateUI(payload);

        expect(document.getElementById('printerName').textContent).toBe('Test Printer');
        expect(document.getElementById('klipperState').textContent).toBe('READY');
        expect(document.getElementById('printState').textContent).toBe('PRINTING');
        expect(document.getElementById('currentFile').textContent).toBe('test.gcode');
        expect(document.getElementById('progressText').textContent).toBe('51%');
        const toolhead4 = document.getElementById('toolhead3');
        expect(toolhead4.querySelector('.tool-current').textContent).toBe('205');
        expect(toolhead4.querySelector('.tool-target').textContent).toBe('215');
        expect(toolhead4.classList.contains('active')).toBe(true);
        expect(document.getElementById('toolhead0').classList.contains('active')).toBe(false);
        expect(document.querySelector('#toolhead0 .filament-material').textContent).toBe('PETG');
        expect(document.querySelector('#toolhead0 .filament-swatch').style.backgroundColor).toBe('rgb(140, 144, 153)');
        expect(document.getElementById('completedLayers').textContent).toBe('10');
        expect(document.getElementById('totalLayers').textContent).toBe('100');
        expect(document.getElementById('remainingLayers').textContent).toBe('90');
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

    test('ETA remains stable across minor status timing jitter', () => {
        PrintMonitorFormatters.resetEtaEstimate();
        const payload = {
            printer: {
                print: {
                    state: 'printing',
                    filename: 'part.gcode',
                    estimatedRemainingSeconds: 600
                },
                updatedAt: '2026-01-03T12:00:30.000Z'
            }
        };

        updateUI(payload);
        const initialEta = document.getElementById('ReportedETA').textContent;

        payload.printer.updatedAt = '2026-01-03T12:01:09.000Z';
        updateUI(payload);

        expect(document.getElementById('ReportedETA').textContent).toBe(initialEta);
    });

    test('ETA updates after a meaningful estimate change', () => {
        PrintMonitorFormatters.resetEtaEstimate();
        const payload = {
            printer: {
                print: {
                    state: 'printing',
                    filename: 'part.gcode',
                    estimatedRemainingSeconds: 600
                },
                updatedAt: '2026-01-03T12:00:00.000Z'
            }
        };

        const initialEta = PrintMonitorFormatters.getStableEtaTimestamp(payload.printer);

        payload.printer.print.estimatedRemainingSeconds = 720;
        const updatedEta = PrintMonitorFormatters.getStableEtaTimestamp(payload.printer);

        expect(updatedEta - initialEta).toBe(120000);
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
        const cameraVideo = document.getElementById('cameraVideo');
        expect(cameraVideo.style.display).toBe('block');
        expect(cameraVideo.src).toContain('/api/camera/video');
        expect(cameraVideo.hasAttribute('controls')).toBe(false);
        
        // Camera remains live while idle.
        payload.printer.print.state = 'standby';
        updateUI(payload);
        expect(cameraVideo.style.display).toBe('block');
        expect(cameraVideo.src).toContain('/api/camera/video');
    });

    test('reopens an MJPEG camera before the configured proxy limit', () => {
        const payload = {
            printer: {
                connected: true,
                print: { state: 'printing' },
                camera: {
                    available: true,
                    mode: 'mjpeg',
                    error: null,
                    restartIntervalSeconds: 2
                }
            }
        };
        lastPayload = payload;
        updateUI(payload);

        const cameraVideo = document.getElementById('cameraVideo');
        expect(cameraVideo.src).not.toContain('?restart=');
        jest.advanceTimersByTime(1000);
        expect(cameraVideo.src).toContain('/api/camera/video?restart=');
    });

    test('uses the video element for compressed camera streams', () => {
        updateUI({
            printer: {
                connected: true,
                print: { state: 'printing' },
                camera: { available: true, mode: 'video', error: null }
            }
        });

        expect(document.getElementById('cameraVideo').style.display).toBe('block');
        expect(document.getElementById('cameraVideo').src).toContain('/api/camera/video');
    });

    test('appends camera chunks through Media Source for low-latency playback', async () => {
        const originalMediaSource = window.MediaSource;
        const originalFetch = window.fetch;
        const originalCreateObjectURL = window.URL.createObjectURL;
        const originalRevokeObjectURL = window.URL.revokeObjectURL;
        const sourceBuffer = new EventTarget();
        let hasBufferedFrame = false;
        sourceBuffer.buffered = {
            get length() { return hasBufferedFrame ? 1 : 0; },
            start: () => 0,
            end: () => 1
        };
        sourceBuffer.appendBuffer = jest.fn(() => {
            hasBufferedFrame = true;
            queueMicrotask(() => sourceBuffer.dispatchEvent(new Event('updateend')));
        });
        sourceBuffer.remove = jest.fn(() => {
            queueMicrotask(() => sourceBuffer.dispatchEvent(new Event('updateend')));
        });

        class MockMediaSource extends EventTarget {
            static isTypeSupported = jest.fn(() => true);
            addSourceBuffer = jest.fn(() => sourceBuffer);

            constructor() {
                super();
                setTimeout(() => this.dispatchEvent(new Event('sourceopen')), 0);
            }
        }

        window.MediaSource = MockMediaSource;
        window.URL.createObjectURL = jest.fn(() => 'blob:camera-stream');
        window.URL.revokeObjectURL = jest.fn();
        window.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            body: {
                getReader: () => ({
                    read: jest.fn()
                        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
                        .mockReturnValue(new Promise(() => {}))
                })
            }
        }));

        const cameraVideo = document.getElementById('cameraVideo');
        cameraPlayer.start(cameraVideo);
        jest.advanceTimersByTime(0);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(cameraVideo.src).toBe('blob:camera-stream');
        expect(window.fetch).toHaveBeenCalledWith('/api/camera/video', expect.objectContaining({ cache: 'no-store' }));
        expect(sourceBuffer.appendBuffer).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));

        cameraPlayer.stop(cameraVideo);
        window.MediaSource = originalMediaSource;
        window.fetch = originalFetch;
        window.URL.createObjectURL = originalCreateObjectURL;
        window.URL.revokeObjectURL = originalRevokeObjectURL;
    });
});
