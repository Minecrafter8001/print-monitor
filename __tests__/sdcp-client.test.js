const SDCPClient = require('utils/sdcp-client');

describe('SDCPClient', () => {
  test('sendCommand rejects when not connected', async () => {
    const client = new SDCPClient('127.0.0.1');
    await expect(client.sendCommand(0)).rejects.toThrow('Not connected to printer');
  });

  test('requestStatus triggers reconnect after repeated failures', async () => {
    const client = new SDCPClient('127.0.0.1');
    client.scheduleReconnect = jest.fn();
    client.disconnect = jest.fn();

    await client.requestStatus();
    await client.requestStatus();
    await client.requestStatus();

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.scheduleReconnect).toHaveBeenCalledTimes(1);
    expect(client.statusFailureCount).toBe(0);
  });
});
