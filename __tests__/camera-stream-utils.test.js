const { detectCameraMode } = require('../modules/camera-stream-utils');

describe('camera stream utilities', () => {
  test.each([
    ['application/vnd.apple.mpegurl', 'http://camera/live', 'hls'],
    ['application/dash+xml', 'http://camera/live', 'dash'],
    ['video/h264', 'http://camera/live', 'h264'],
    ['video/h265', 'http://camera/live', 'h265'],
    ['video/mp4', 'http://camera/live', 'video'],
    ['application/octet-stream', 'http://camera/live.m3u8', 'hls'],
    ['application/octet-stream', 'http://camera/live.mpd', 'dash']
  ])('detects %s at %s as %s', (contentType, url, expected) => {
    expect(detectCameraMode('auto', contentType, url)).toBe(expected);
  });

  test('accepts raw as an H.264 mode alias', () => {
    expect(detectCameraMode('raw', '', 'http://camera/live')).toBe('h264');
  });
});