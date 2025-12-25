const dgram = require('dgram');

/**
 * Discover Elegoo printers on the local network using UDP broadcast
 */
class PrinterDiscovery {
  constructor() {
    this.discoveryPort = 3000;
    this.discoveryMessage = 'M99999';
  }

  /**
   * Discover printers on the network
   * @param {number} timeout - Discovery timeout in milliseconds (default: 3000)
   * @returns {Promise<Array>} Array of discovered printers
   */
  discover(timeout = 3000) {
    return new Promise((resolve, reject) => {
      const printers = [];
      const socket = dgram.createSocket('udp4');
      let closed = false;

      socket.on('error', (err) => {
        if (!closed) {
          closed = true;
          socket.close();
        }
        reject(err);
      });

      socket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString());
          printers.push({
            ...data,
            address: rinfo.address,
            port: rinfo.port
          });
          console.log(`Discovered printer at ${rinfo.address}:`, data);
        } catch (err) {
          console.error('Failed to parse discovery response:', err);
        }
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        
        // Send discovery broadcast
        const message = Buffer.from(this.discoveryMessage);
        socket.send(message, 0, message.length, this.discoveryPort, '255.255.255.255', (err) => {
          if (err) {
            if (!closed) {
              closed = true;
              socket.close();
            }
            reject(err);
            return;
          }
          console.log('Discovery broadcast sent');
        });

        // Wait for responses
        setTimeout(() => {
          if (!closed) {
            closed = true;
            socket.close();
          }
          resolve(printers);
        }, timeout);
      });
    });
  }
}

module.exports = PrinterDiscovery;
