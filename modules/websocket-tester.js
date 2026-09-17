require('module-alias/register');
const MoonrakerClient = require('modules/moonraker-client');
const { mapMoonrakerStatus } = require('modules/moonraker-status');

async function main() {
  const moonrakerURL = process.argv[2] || process.env.MOONRAKER_URL;
  if (!moonrakerURL) {
    console.error('Usage: node modules/websocket-tester.js http://printer:7125');
    process.exitCode = 1;
    return;
  }

  const client = new MoonrakerClient(moonrakerURL);
  client.onStatus((objects) => {
    console.log(JSON.stringify(mapMoonrakerStatus(objects), null, 2));
  });
  client.on('error', (err) => console.error('Moonraker error:', err.message));
  client.on('disconnect', () => console.warn('Moonraker disconnected; retrying'));

  await client.connect();
  const serverInfo = await client.getServerInfo();
  console.log(`Monitoring ${serverInfo.hostname || moonrakerURL}. Press Ctrl+C to exit.`);
}

main().catch((err) => {
  console.error('Unable to start Moonraker monitor:', err.message);
  process.exitCode = 1;
});