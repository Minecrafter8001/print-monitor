require('modules/logger');
const EventEmitter = require('events');
const WebSocket = require('ws');

const CORE_OBJECTS = [
  'webhooks',
  'print_stats',
  'virtual_sdcard',
  'display_status',
  'toolhead',
  'heaters',
  'heater_bed',
  'filament_detect',
  'print_task_config'
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
    this.heartbeatTimer = null;
    this.awaitingPong = false;
    this.heartbeatInterval = options.heartbeatInterval || 15000;
  }

  connect() {
    this.manualDisconnect = false;
    return new Promise((resolve, reject) => {
      const protocol = this.baseURL.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsURL = new URL('/websocket', this.baseURL);
      wsURL.protocol = protocol;

      console.log(`Connecting to Moonraker at ${wsURL.origin}`);
      this.ws = new WebSocket(wsURL, { handshakeTimeout: 10000 });
      let opened = false;

      this.ws.on('open', async () => {
        opened = true;
        this.connected = true;
        this.startHeartbeat();
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
          await this.refreshPrinterState();
          resolve();
        } catch (err) {
          reject(err);
          this.ws.close();
        }
      });

      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('pong', () => {
        this.awaitingPong = false;
      });
      this.ws.on('error', (err) => {
        this.emit('error', err);
        if (!opened) reject(err);
      });
      this.ws.on('close', () => {
        this.stopHeartbeat();
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
      } else if (message.method === 'notify_klippy_ready') {
        this.refreshPrinterState()
          .then(() => this.emit('reconnected'))
          .catch((err) => console.error('Failed to refresh Klipper state:', err.message));
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

  async refreshPrinterState() {
    const objectResult = await this.sendRequest('printer.objects.list');
    this.availableObjects = objectResult.objects || [];
    const result = await this.sendRequest('printer.objects.subscribe', {
      objects: this.buildSubscription(this.availableObjects)
    });
    this.objectState = {};
    this.mergeStatus(result.status || {});
  }

  buildSubscription(availableObjects) {
    const selectedObjects = availableObjects.filter((name) =>
      CORE_OBJECTS.includes(name) ||
      /^extruder\d*$/.test(name) ||
      /^filament_(motion|switch)_sensor e\d+_filament$/.test(name) ||
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

  listFiles(root) {
    return this.sendRequest('server.files.list', { root });
  }

  getHistory(limit = 1000) {
    return this.sendRequest('server.history.list', { limit, order: 'desc' });
  }

  getWebcams() {
    return this.sendRequest('server.webcams.list');
  }

  resolveURL(pathOrURL) {
    return new URL(pathOrURL, this.baseURL).toString();
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.awaitingPong = false;
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.awaitingPong) {
        console.warn('Moonraker heartbeat timed out; reconnecting');
        this.ws.terminate();
        return;
      }
      this.awaitingPong = true;
      this.ws.ping();
    }, this.heartbeatInterval);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.awaitingPong = false;
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
    this.stopHeartbeat();
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