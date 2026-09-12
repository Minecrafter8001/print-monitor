require('utils/logger');
const EventEmitter = require('events');
const WebSocket = require('ws');

const CORE_OBJECTS = [
  'webhooks',
  'print_stats',
  'virtual_sdcard',
  'display_status',
  'toolhead',
  'heaters',
  'heater_bed'
];

class MoonrakerClient extends EventEmitter {
  constructor(host, options = {}) {
    super();
    const normalizedHost = host.includes('://') ? host : `http://${host}`;
    this.baseURL = new URL(normalizedHost);
    if (!this.baseURL.port) this.baseURL.port = '7125';
    this.apiKey = options.apiKey || process.env.MOONRAKER_API_KEY || '';
    this.ws = null;
    this.connected = false;
    this.statusCallback = null;
    this.objectState = {};
    this.availableObjects = [];
    this.requestID = 0;
    this.messageHandlers = new Map();
    this.reconnectTimer = null;
    this.manualDisconnect = false;
  }

  connect() {
    this.manualDisconnect = false;
    return new Promise((resolve, reject) => {
      const protocol = this.baseURL.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsURL = new URL('/websocket', this.baseURL);
      wsURL.protocol = protocol;

      console.log(`Connecting to Moonraker at ${wsURL.origin}`);
      this.ws = new WebSocket(wsURL);
      let opened = false;

      this.ws.on('open', async () => {
        opened = true;
        this.connected = true;
        try {
          if (this.apiKey) {
            await this.sendRequest('server.connection.identify', {
              client_name: 'snapmaker-print-monitor',
              version: '1.0.0',
              type: 'other',
              url: '',
              api_key: this.apiKey
            });
          }
          const objectResult = await this.sendRequest('printer.objects.list');
          this.availableObjects = objectResult.objects || [];
          const result = await this.sendRequest('printer.objects.subscribe', {
            objects: this.buildSubscription(this.availableObjects)
          });
          this.mergeStatus(result.status || {});
          resolve();
        } catch (err) {
          reject(err);
          this.ws.close();
        }
      });

      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('error', (err) => {
        this.emit('error', err);
        if (!opened) reject(err);
      });
      this.ws.on('close', () => {
        this.connected = false;
        this.rejectPendingRequests(new Error('Moonraker connection closed'));
        this.emit('disconnect');
        if (!this.manualDisconnect) this.scheduleReconnect();
      });
    });
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      if (message.id !== undefined) {
        const handler = this.messageHandlers.get(message.id);
        if (!handler) return;
        this.messageHandlers.delete(message.id);
        clearTimeout(handler.timeout);
        if (message.error) {
          handler.reject(new Error(message.error.message || 'Moonraker request failed'));
        } else {
          handler.resolve(message.result);
        }
        return;
      }

      if (message.method === 'notify_status_update') {
        this.mergeStatus(message.params?.[0] || {});
      } else if (message.method === 'notify_klippy_disconnected') {
        this.emit('klippy-disconnected');
      }
    } catch (err) {
      console.error('Failed to parse Moonraker message:', err.message);
    }
  }

  mergeStatus(update) {
    for (const [objectName, values] of Object.entries(update)) {
      this.objectState[objectName] = {
        ...(this.objectState[objectName] || {}),
        ...(values || {})
      };
    }
    if (this.statusCallback) this.statusCallback(this.objectState);
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Moonraker'));
        return;
      }

      const id = ++this.requestID;
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(id);
        reject(new Error(`Moonraker request timed out: ${method}`));
      }, 10000);
      this.messageHandlers.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }), (err) => {
        if (!err) return;
        clearTimeout(timeout);
        this.messageHandlers.delete(id);
        reject(err);
      });
    });
  }

  onStatus(callback) {
    this.statusCallback = callback;
  }

  buildSubscription(availableObjects) {
    const selectedObjects = availableObjects.filter((name) =>
      CORE_OBJECTS.includes(name) ||
      /^extruder\d*$/.test(name) ||
      /^temperature_(sensor|fan) /.test(name) ||
      /^heater_generic /.test(name)
    );
    return Object.fromEntries(selectedObjects.map((name) => [name, null]));
  }

  getServerInfo() {
    return this.sendRequest('server.info');
  }

  getPrinterInfo() {
    return this.sendRequest('printer.info');
  }

  getDatabaseItem(namespace, key) {
    return this.sendRequest('server.database.get_item', { namespace, key });
  }

  async getPrinterName() {
    try {
      const item = await this.getDatabaseItem('fluidd', 'uiSettings.general.instanceName');
      if (typeof item.value === 'string' && item.value.trim()) {
        return item.value.trim();
      }
    } catch {
      // Fluidd settings are optional; fall back to Klipper's hostname.
    }

    const printerInfo = await this.getPrinterInfo();
    return printerInfo.hostname || 'Klipper Printer';
  }

  getFileMetadata(filename) {
    return this.sendRequest('server.files.metadata', { filename });
  }

  getWebcams() {
    return this.sendRequest('server.webcams.list');
  }

  resolveURL(pathOrURL) {
    return new URL(pathOrURL, this.baseURL).toString();
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        this.emit('reconnected');
      } catch (err) {
        console.error('Moonraker reconnection failed:', err.message);
        this.scheduleReconnect();
      }
    }, 5000);
  }

  rejectPendingRequests(error) {
    for (const handler of this.messageHandlers.values()) {
      clearTimeout(handler.timeout);
      handler.reject(error);
    }
    this.messageHandlers.clear();
  }

  disconnect() {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectPendingRequests(new Error('Moonraker client disconnected'));
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

module.exports = MoonrakerClient;