const isValidIP = (ip) => ip && ip !== 'unknown';

class UserStats {
  constructor() {
    this.webClients = 0;
    this.cameraClients = 0;
    this.totalWebConnections = 0;
    this.totalCameraConnections = 0;
    this.webIPCounts = new Map();
    this.cameraIPCounts = new Map();
    this.webClientAgents = new Map();
    this.cameraClientAgents = new Map();
  }

  addWebClient(ip, userAgent = 'Unknown') {
    this.webClients += 1;
    this.totalWebConnections += 1;
    if (isValidIP(ip)) {
      const count = this.webIPCounts.get(ip) || 0;
      this.webIPCounts.set(ip, count + 1);
      this.webClientAgents.set(ip, userAgent);
    }
  }

  removeWebClient(ip) {
    this.webClients = Math.max(0, this.webClients - 1);
    if (!isValidIP(ip)) return;
    const count = this.webIPCounts.get(ip) || 0;
    if (count <= 1) {
      this.webIPCounts.delete(ip);
      this.webClientAgents.delete(ip);
    } else {
      this.webIPCounts.set(ip, count - 1);
    }
  }

  addCameraClient(ip, userAgent = 'Unknown') {
    this.cameraClients += 1;
    this.totalCameraConnections += 1;
    if (isValidIP(ip)) {
      const count = this.cameraIPCounts.get(ip) || 0;
      this.cameraIPCounts.set(ip, count + 1);
      this.cameraClientAgents.set(ip, userAgent);
    }
  }

  removeCameraClient(ip) {
    this.cameraClients = Math.max(0, this.cameraClients - 1);
    if (!isValidIP(ip)) return;
    const count = this.cameraIPCounts.get(ip) || 0;
    if (count <= 1) {
      this.cameraIPCounts.delete(ip);
      this.cameraClientAgents.delete(ip);
    } else {
      this.cameraIPCounts.set(ip, count - 1);
    }
  }

  getSnapshot() {
    return {
      webClients: this.webClients,
      cameraClients: this.cameraClients,
      totalWebConnections: this.totalWebConnections,
      totalCameraConnections: this.totalCameraConnections,
      activeUniqueWebIPs: this.webIPCounts.size,
      activeUniqueCameraIPs: this.cameraIPCounts.size
    };
  }

  getClientLists() {
    const webClients = Array.from(this.webIPCounts.keys()).map((ip) => ({
      ip,
      userAgent: this.webClientAgents.get(ip) || 'Unknown'
    }));

    const cameraClients = Array.from(this.cameraIPCounts.keys()).map((ip) => ({
      ip,
      userAgent: this.cameraClientAgents.get(ip) || 'Unknown'
    }));

    return { webClients, cameraClients };
  }
}

module.exports = UserStats;
