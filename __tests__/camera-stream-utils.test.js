const {
  detectCameraMode,
  isManifestType,
  rewriteCameraManifest
} = require('../utils/camera-stream-utils');

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

  test('detects manifests by content type or extension', () => {
    expect(isManifestType('application/vnd.apple.mpegurl', 'http://camera/live')).toBe(true);
    expect(isManifestType('', 'http://camera/manifest.mpd')).toBe(true);
    expect(isManifestType('video/mp4', 'http://camera/live.mp4')).toBe(false);
  });

  test('rewrites HLS segments and key URIs through the camera proxy', () => {
    const result = rewriteCameraManifest(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsegment.ts',
      'http://camera/live/index.m3u8',
      'application/vnd.apple.mpegurl'
    );

    expect(result).not.toContain('URI="key.bin"');
    expect(result).not.toMatch(/\nsegment\.ts$/);
    expect(result.match(/\/api\/camera\/video\/resource\?url=/g)).toHaveLength(2);
  });

  test('rewrites DASH base and media URLs through the camera proxy', () => {
    const result = rewriteCameraManifest(
      '<MPD><BaseURL>chunks/</BaseURL><SegmentTemplate media="segment-$Number$.m4s" initialization="init.m4s"/></MPD>',
      'http://camera/live/manifest.mpd',
      'application/dash+xml'
    );

    expect(result).not.toContain('<BaseURL>chunks/</BaseURL>');
    expect(result).not.toContain('media="segment-$Number$.m4s"');
    expect(result.match(/\/api\/camera\/video\/resource\?url=/g)).toHaveLength(2);
    expect(result).toContain('$Number$');
  });
});