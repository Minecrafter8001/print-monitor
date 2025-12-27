module.exports = {
  apps: [
    {
      name: 'print-monitor',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        DEBUG_DISABLE_LOCAL_IP_FILTER: 'false'
      }
    }
  ]
};
