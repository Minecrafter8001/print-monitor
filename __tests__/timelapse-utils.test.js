const {
  buildTimelapseList,
  encodeMoonrakerFilePath,
  isSafeTimelapsePath
} = require('../modules/timelapse-utils');

describe('timelapse utilities', () => {
  test('returns MP4 files newest first with download URLs', () => {
    const files = [
      { path: 'older video.mp4', modified: 10, size: 100 },
      { path: 'newer.mp4', modified: 20, size: 200 },
      { path: 'newer_cover.jpg', modified: 21, size: 50 }
    ];

    expect(buildTimelapseList(files)).toEqual([
      {
        name: 'newer.mp4',
        path: 'newer.mp4',
        modified: 20,
        size: 200,
        downloadUrl: '/api/timelapses/download?file=newer.mp4'
      },
      {
        name: 'older video.mp4',
        path: 'older video.mp4',
        modified: 10,
        size: 100,
        downloadUrl: '/api/timelapses/download?file=older%20video.mp4'
      }
    ]);
  });

  test.each(['../secret.mp4', 'folder/../secret.mp4', '/video.mp4', 'video.jpg', 'video.mp4\\other']) (
    'rejects unsafe or unsupported path %s',
    filePath => expect(isSafeTimelapsePath(filePath)).toBe(false)
  );

  test('encodes each path segment for Moonraker file URLs', () => {
    expect(encodeMoonrakerFilePath('archive/my video.mp4')).toBe('archive/my%20video.mp4');
  });
});