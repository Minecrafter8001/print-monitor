require('module-alias/register');
const MoonrakerClient = require('utils/moonraker-client');

const TELEMETRY_OBJECT_PATTERN = /extruder|heater|temperature|sensor|chamber|enclosure|print_stats|virtual_sdcard|webhooks|display_status|toolhead|gcode_move/i;
const READ_ONLY_METHODS = {
  'server.info': {},
  'printer.info': {},
  'printer.objects.list': {},
  'printer.objects.query': { objects: { webhooks: null } },
  'server.webcams.list': {},
  'server.temperature_store': { include_monitors: false },
  'server.files.roots': {},
  'server.history.list': { limit: 1 },
  'server.job_queue.status': {},
  'machine.system_info': {},
  'machine.proc_stats': {}
};

async function optionalRequest(client, method, params = {}) {
  try {
    return await client.sendRequest(method, params);
  } catch (err) {
    return { unavailable: err.message };
  }
}

async function checkMethods(client) {
  const checks = await Promise.all(Object.entries(READ_ONLY_METHODS).map(async ([method, params]) => {
    try {
      const result = await client.sendRequest(method, params);
      const resultKeys = result && typeof result === 'object' ? Object.keys(result) : [];
      return [method, { available: true, resultKeys }];
    } catch (err) {
      return [method, { available: false, error: err.message }];
    }
  }));
  return Object.fromEntries(checks);
}

async function probeMoonraker(moonrakerURL) {
  const client = new MoonrakerClient(moonrakerURL);
  client.on('error', () => {});

  try {
    await client.connect();

    const [serverInfo, printerInfo, endpointResult, objectResult, webcams, methodChecks] = await Promise.all([
      optionalRequest(client, 'server.info'),
      optionalRequest(client, 'printer.info'),
      optionalRequest(client, 'server.list_endpoints'),
      optionalRequest(client, 'printer.objects.list'),
      optionalRequest(client, 'server.webcams.list'),
      checkMethods(client)
    ]);

    const endpoints = endpointResult.endpoints || [];
    const objects = objectResult.objects || [];
    const telemetryObjects = objects.filter((name) => TELEMETRY_OBJECT_PATTERN.test(name));
    const telemetryQuery = telemetryObjects.length
      ? await optionalRequest(client, 'printer.objects.query', {
          objects: Object.fromEntries(telemetryObjects.map((name) => [name, null]))
        })
      : { status: {} };

    return {
      target: client.baseURL.origin,
      serverInfo,
      printerInfo,
      endpoints: [...endpoints].sort(),
      methodChecks,
      objects: [...objects].sort(),
      telemetry: telemetryQuery.status || telemetryQuery,
      webcams: webcams.webcams || webcams
    };
  } finally {
    client.disconnect();
  }
}

async function main() {
  const moonrakerURL = process.argv[2] || process.env.MOONRAKER_URL;
  if (!moonrakerURL) {
    console.error('Usage: node utils/moonraker-probe.js http://printer:7125');
    process.exitCode = 1;
    return;
  }

  const report = await probeMoonraker(moonrakerURL);
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Moonraker probe failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { probeMoonraker };