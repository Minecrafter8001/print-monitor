const UserStats = require('utils/user-stats');

describe('UserStats', () => {
  test('tracks web client counts and unique IPs', () => {
    const stats = new UserStats();
    stats.addWebClient('1.1.1.1', 'UA1');
    stats.addWebClient('1.1.1.1', 'UA1');
    stats.addWebClient('2.2.2.2', 'UA2');

    expect(stats.webClients).toBe(3);
    expect(stats.getSnapshot().activeUniqueWebIPs).toBe(2);

    stats.removeWebClient('1.1.1.1');
    expect(stats.webClients).toBe(2);
    expect(stats.getSnapshot().activeUniqueWebIPs).toBe(2);
  });

  test('tracks camera client counts and unique IPs', () => {
    const stats = new UserStats();
    stats.addCameraClient('3.3.3.3', 'UA3');
    stats.addCameraClient('4.4.4.4', 'UA4');

    expect(stats.cameraClients).toBe(2);
    expect(stats.getSnapshot().activeUniqueCameraIPs).toBe(2);

    stats.removeCameraClient('3.3.3.3');
    expect(stats.cameraClients).toBe(1);
    expect(stats.getSnapshot().activeUniqueCameraIPs).toBe(1);
  });
});
