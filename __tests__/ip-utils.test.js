const { normalizeIP, isLocalIP, pickForwardedIP, getClientIP } = require('utils/ip-utils');

describe('ip-utils', () => {
  test('normalizes IPv4-mapped IPv6', () => {
    expect(normalizeIP('::ffff:192.168.1.10')).toBe('192.168.1.10');
  });

  test('isLocalIP detects local addresses', () => {
    expect(isLocalIP('127.0.0.1')).toBe(true);
    expect(isLocalIP('192.168.1.20')).toBe(true);
    expect(isLocalIP('8.8.8.8')).toBe(false);
  });

  test('pickForwardedIP prefers first non-192.168', () => {
    const header = '192.168.1.2, 10.0.0.5, 203.0.113.4';
    expect(pickForwardedIP(header)).toBe('10.0.0.5');
  });

  test('getClientIP prefers x-forwarded-for', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.4' }, socket: { remoteAddress: '10.0.0.1' } };
    expect(getClientIP(req, req.socket, false)).toBe('203.0.113.4');
  });

  test('getClientIP falls back to socket when local filtering disabled', () => {
    const req = { headers: {}, socket: { remoteAddress: '192.168.1.4' } };
    expect(getClientIP(req, req.socket, true)).toBe('192.168.1.4');
  });
});
