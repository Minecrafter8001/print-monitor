const WebSocket = require('ws');
const MoonrakerClient = require('utils/moonraker-client');

describe('MoonrakerClient', () => {
  test('sendRequest rejects when not connected', async () => {
    const client = new MoonrakerClient('127.0.0.1');
    await expect(client.sendRequest('printer.info')).rejects.toThrow(
      'Not connected to Moonraker'
    );
  });

  test('merges partial status notifications before invoking callback', () => {
    const client = new MoonrakerClient('127.0.0.1');
    const callback = jest.fn();
    client.onStatus(callback);

    client.mergeStatus({ extruder: { temperature: 205, target: 210 } });
    client.handleMessage(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notify_status_update',
      params: [{ extruder: { temperature: 207 } }, 1234]
    })));

    expect(callback).toHaveBeenLastCalledWith({
      extruder: { temperature: 207, target: 210 }
    });
  });

  test('sends JSON-RPC requests with incrementing IDs', async () => {
    const client = new MoonrakerClient('127.0.0.1');
    client.connected = true;
    client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };

    const request = client.sendRequest('printer.info');

    expect(JSON.parse(client.ws.send.mock.calls[0][0])).toEqual({
      jsonrpc: '2.0',
      method: 'printer.info',
      params: {},
      id: 1
    });
    client.rejectPendingRequests(new Error('test cleanup'));
    await expect(request).rejects.toThrow('test cleanup');
  });

  test('builds subscriptions from available multi-tool and sensor objects', () => {
    const client = new MoonrakerClient('127.0.0.1');
    const subscription = client.buildSubscription([
      'webhooks',
      'print_stats',
      'toolhead',
      'extruder',
      'extruder1',
      'temperature_sensor cavity',
      'fan_generic cavity_fan',
      'unrelated_object'
    ]);

    expect(subscription).toEqual({
      webhooks: null,
      print_stats: null,
      toolhead: null,
      extruder: null,
      extruder1: null,
      'temperature_sensor cavity': null
    });
  });

  test('uses the Fluidd instance name as the printer name', async () => {
    const client = new MoonrakerClient('127.0.0.1');
    client.getDatabaseItem = jest.fn().mockResolvedValue({ value: ' U1 ' });
    client.getPrinterInfo = jest.fn();

    await expect(client.getPrinterName()).resolves.toBe('U1');
    expect(client.getDatabaseItem).toHaveBeenCalledWith(
      'fluidd',
      'uiSettings.general.instanceName'
    );
    expect(client.getPrinterInfo).not.toHaveBeenCalled();
  });

  test('falls back to the Klipper hostname when Fluidd settings are unavailable', async () => {
    const client = new MoonrakerClient('127.0.0.1');
    client.getDatabaseItem = jest.fn().mockRejectedValue(new Error('not found'));
    client.getPrinterInfo = jest.fn().mockResolvedValue({ hostname: 'lava' });

    await expect(client.getPrinterName()).resolves.toBe('lava');
  });

  test('terminates an unresponsive Moonraker socket so it can reconnect', () => {
    jest.useFakeTimers();
    const client = new MoonrakerClient('127.0.0.1', { heartbeatInterval: 1000 });
    client.ws = {
      readyState: WebSocket.OPEN,
      ping: jest.fn(),
      terminate: jest.fn()
    };

    client.startHeartbeat();
    jest.advanceTimersByTime(1000);
    expect(client.ws.ping).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    expect(client.ws.terminate).toHaveBeenCalledTimes(1);
    client.stopHeartbeat();
    jest.useRealTimers();
  });

  test('refreshes subscriptions when Klipper becomes ready again', async () => {
    const client = new MoonrakerClient('127.0.0.1');
    client.refreshPrinterState = jest.fn().mockResolvedValue();
    const reconnected = jest.fn();
    client.on('reconnected', reconnected);

    client.handleMessage(Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notify_klippy_ready'
    })));
    await Promise.resolve();

    expect(client.refreshPrinterState).toHaveBeenCalledTimes(1);
    expect(reconnected).toHaveBeenCalledTimes(1);
  });
});