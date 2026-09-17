const {
  buildTimelapseList,
  encodeMoonrakerFilePath,
  isSafeTimelapsePath,
  parseMp4Duration
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
        printStatus: null,
        printDurationSeconds: null,
        timelapseDurationSeconds: null,
        downloadUrl: '/api/timelapses/download?file=newer.mp4'
      },
      {
        name: 'older video.mp4',
        path: 'older video.mp4',
        modified: 10,
        size: 100,
        printStatus: null,
        printDurationSeconds: null,
        timelapseDurationSeconds: null,
        downloadUrl: '/api/timelapses/download?file=older%20video.mp4'
      }
    ]);
  });

  test('matches print history by filename and nearest completion time', () => {
    const files = [{ path: 'part_20260917120000.mp4', modified: 2005, size: 100 }];
    const jobs = [
      { filename: 'part.gcode', status: 'cancelled', end_time: 1000, print_duration: 20 },
      { filename: 'part.gcode', status: 'completed', end_time: 2000, print_duration: 120 }
    ];

    expect(buildTimelapseList(files, jobs)[0]).toMatchObject({
      printStatus: 'completed',
      printDurationSeconds: 120
    });
  });

  test('reads duration from a version zero MP4 movie header', () => {
    const buffer = Buffer.alloc(32);
    buffer.writeUInt32BE(28, 0);
    buffer.write('mvhd', 4);
    buffer.writeUInt32BE(1000, 20);
    buffer.writeUInt32BE(12500, 24);

    expect(parseMp4Duration(buffer)).toBe(12.5);
  });

  test.each(['../secret.mp4', 'folder/../secret.mp4', '/video.mp4', 'video.jpg', 'video.mp4\\other']) (
    'rejects unsafe or unsupported path %s',
    filePath => expect(isSafeTimelapsePath(filePath)).toBe(false)
  );

  test('encodes each path segment for Moonraker file URLs', () => {
    expect(encodeMoonrakerFilePath('archive/my video.mp4')).toBe('archive/my%20video.mp4');
  });
});