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

  test('evicts the oldest timelapses when the cache reaches its size limit', async () => {
    const cache = new TimelapseCache(cacheDirectory, { maxBytes: 8 });
    const timelapses = [
      { name: 'new.mp4', path: 'new.mp4', size: 4, modified: 30 },
      { name: 'middle.mp4', path: 'middle.mp4', size: 4, modified: 20 },
      { name: 'old.mp4', path: 'old.mp4', size: 4, modified: 10 }
    ];

    await cache.sync(timelapses, async timelapse => Readable.from(Buffer.from(timelapse.name.slice(0, 4))));

    expect((await cache.list()).map(entry => entry.path)).toEqual(['new.mp4', 'middle.mp4']);
    expect(await cache.get('old.mp4')).toBeNull();
  });

  test('evicts old timelapses to reserve free space for a download', async () => {
    let freeBytes = 100;
    const cache = new TimelapseCache(cacheDirectory, {
      minFreeBytes: 5,
      getFreeBytes: async () => freeBytes
    });
    const old = { name: 'old.mp4', path: 'old.mp4', size: 4, modified: 10 };
    await cache.sync([old], async () => Readable.from(Buffer.from('old!')));
    freeBytes = 6;

    const recent = { name: 'new.mp4', path: 'new.mp4', size: 4, modified: 20 };
    await cache.sync([recent], async () => Readable.from(Buffer.from('new!')));

    expect(await cache.get('old.mp4')).toBeNull();
    expect(await cache.get('new.mp4')).not.toBeNull();
  });
});