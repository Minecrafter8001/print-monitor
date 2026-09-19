const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const TimelapseCache = require('modules/timelapse-cache');

describe('TimelapseCache', () => {
  let cacheDirectory;

  beforeEach(async () => {
    cacheDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'timelapse-cache-'));
  });

  afterEach(async () => {
    await fs.promises.rm(cacheDirectory, { recursive: true, force: true });
  });

  test('persists downloaded timelapses across cache instances', async () => {
    const timelapse = {
      name: 'print.mp4', path: 'print.mp4', size: 4, modified: 10,
      printStatus: 'completed', downloadUrl: '/api/timelapses/download?file=print.mp4'
    };
    const cache = new TimelapseCache(cacheDirectory);
    await cache.sync([timelapse], async () => Readable.from(Buffer.from('test')));

    const reloaded = new TimelapseCache(cacheDirectory);
    expect(await reloaded.list()).toEqual([timelapse]);
    expect((await reloaded.get('print.mp4')).absolutePath).toMatch(/\.mp4$/);
  });

  test('does not replace a valid cached file with an incomplete download', async () => {
    const original = { name: 'print.mp4', path: 'print.mp4', size: 4, modified: 10 };
    const cache = new TimelapseCache(cacheDirectory);
    await cache.sync([original], async () => Readable.from(Buffer.from('test')));
    await cache.sync([{ ...original, size: 8, modified: 20 }], async () => Readable.from(Buffer.from('bad')));

    const cached = await cache.get('print.mp4');
    expect(cached.entry.modified).toBe(10);
    expect(await fs.promises.readFile(cached.absolutePath, 'utf8')).toBe('test');
  });

  test('omits manifest entries whose cached file is missing', async () => {
    const cache = new TimelapseCache(cacheDirectory);
    await cache.ready;
    await fs.promises.writeFile(cache.manifestPath, JSON.stringify({
      entries: [{ path: 'missing.mp4', cacheFile: 'missing.mp4', modified: 1 }]
    }));

    const reloaded = new TimelapseCache(cacheDirectory);
    expect(await reloaded.list()).toEqual([]);
  });
});