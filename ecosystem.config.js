module.exports = {
  apps: [
    {
      name: 'print-monitor',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        DEBUG_DISABLE_LOCAL_IP_FILTER: 'false',
        ENABLE_DEBUG_ENDPOINTS: 'false',
        WS_UPDATE_INTERVAL: 250,
        MOONRAKER_URL: process.env.MOONRAKER_URL || '',
        MOONRAKER_API_KEY: process.env.MOONRAKER_API_KEY || '',
        CAMERA_STREAM_URL: process.env.CAMERA_STREAM_URL || ''
      }
    }
  ]
};
