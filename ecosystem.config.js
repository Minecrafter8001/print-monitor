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
        MOONRAKER_URL: '',
        MOONRAKER_API_KEY: '',
        CAMERA_STREAM_URL: '',
        CAMERA_MODE: 'auto',
        CAMERA_RESOURCE_ORIGINS: '',
        FFMPEG_PATH: '',
        CAMERA_SNAPSHOT_URL: '',
        CAMERA_SNAPSHOT_INTERVAL: '1000',
        CAMERA_KEEPALIVE_URL: '',
        CAMERA_KEEPALIVE_TOKEN: '',
        CAMERA_KEEPALIVE_INTERVAL: '10'
      }
    }
  ]
};
