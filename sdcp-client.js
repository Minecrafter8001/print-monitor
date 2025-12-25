const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

/**
 * SDCP (Smart Device Communication Protocol) client for Elegoo printers
 */
class SDCPClient {
  constructor(printerIP) {
    this.printerIP = printerIP;
    this.wsPort = 3030;
    this.wsPath = '/websocket';
    this.ws = null;
    this.mainboardID = null;
    this.connected = false;
    this.messageHandlers = new Map();
    this.statusCallback = null;
    this.reconnectInterval = null;
  }

  /**
   * Connect to the printer via WebSocket
   */
  connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://${this.printerIP}:${this.wsPort}${this.wsPath}`;
      console.log(`Connecting to printer at ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('WebSocket connected');
        this.connected = true;
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        if (!this.connected) {
          reject(err);
        }
      });

      this.ws.on('close', () => {
        console.log('WebSocket disconnected');
        this.connected = false;
        this.scheduleReconnect();
      });

      this.ws.on('ping', () => {
        this.ws.pong();
      });
    });
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectInterval) return;
    
    this.reconnectInterval = setInterval(async () => {
      console.log('Attempting to reconnect...');
      try {
        await this.connect();
        clearInterval(this.reconnectInterval);
        this.reconnectInterval = null;
        // Re-request status after reconnection
        this.requestStatus();
      } catch (err) {
        console.error('Reconnection failed:', err.message);
      }
    }, 5000);
  }

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      
      // Extract mainboard ID from first response
      if (!this.mainboardID && message.Data && message.Data.MainboardID) {
        this.mainboardID = message.Data.MainboardID;
        console.log('Mainboard ID:', this.mainboardID);
      }

      // Handle different message topics
      if (message.Topic) {
        if (message.Topic.includes('status') && this.statusCallback) {
          this.statusCallback(message.Data);
        } else if (message.Topic.includes('attributes') && this.statusCallback) {
          this.statusCallback(message.Data);
        }
      }

      // Handle request responses
      if (message.Data && message.Data.RequestID) {
        const handler = this.messageHandlers.get(message.Data.RequestID);
        if (handler) {
          handler(message);
          this.messageHandlers.delete(message.Data.RequestID);
        }
      }
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  }

  /**
   * Send a command to the printer
   */
  sendCommand(cmd, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Not connected to printer'));
        return;
      }

      const requestID = uuidv4();
      const timestamp = Math.floor(Date.now() / 1000);

      const message = {
        Id: uuidv4(),
        Data: {
          Cmd: cmd,
          Data: data,
          RequestID: requestID,
          MainboardID: this.mainboardID || '',
          TimeStamp: timestamp,
          From: 0
        },
        Topic: `sdcp/request/${this.mainboardID || ''}`
      };

      // Register handler for response
      this.messageHandlers.set(requestID, (response) => {
        resolve(response);
      });

      // Send message
      this.ws.send(JSON.stringify(message), (err) => {
        if (err) {
          this.messageHandlers.delete(requestID);
          reject(err);
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.messageHandlers.has(requestID)) {
          this.messageHandlers.delete(requestID);
          reject(new Error('Command timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Request current printer status (Cmd: 0)
   */
  async requestStatus() {
    try {
      const response = await this.sendCommand(0);
      if (this.statusCallback && response.Data) {
        this.statusCallback(response.Data);
      }
      return response;
    } catch (err) {
      console.error('Failed to request status:', err.message);
      return null;
    }
  }

  /**
   * Request printer attributes (Cmd: 1)
   */
  async requestAttributes() {
    try {
      const response = await this.sendCommand(1);
      if (this.statusCallback && response.Data) {
        this.statusCallback(response.Data);
      }
      return response;
    } catch (err) {
      console.error('Failed to request attributes:', err.message);
      return null;
    }
  }

  /**
   * Request camera stream URL (Cmd: 386)
   */
  async requestCameraURL() {
    try {
      return await this.sendCommand(386);
    } catch (err) {
      console.error('Failed to request camera URL:', err.message);
      return null;
    }
  }

  /**
   * Set callback for status updates
   */
  onStatus(callback) {
    this.statusCallback = callback;
  }

  /**
   * Start periodic status polling
   */
  startStatusPolling(interval = 2000) {
    this.stopStatusPolling();
    this.pollingInterval = setInterval(() => {
      this.requestStatus();
    }, interval);
    
    // Get initial status
    this.requestStatus();
    this.requestAttributes();
  }

  /**
   * Stop periodic status polling
   */
  stopStatusPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Disconnect from printer
   */
  disconnect() {
    this.stopStatusPolling();
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

module.exports = SDCPClient;
