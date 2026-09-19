const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

class TimelapseCache {
  constructor(cacheDirectory) {
    this.cacheDirectory = cacheDirectory;
    this.manifestPath = path.join(cacheDirectory, 'manifest.json');
    this.entries = new Map();
    this.syncPromise = null;
    this.ready = this.load();
  }

  async load() {
    await fs.promises.mkdir(this.cacheDirectory, { recursive: true });
    try {
      const manifest = JSON.parse(await fs.promises.readFile(this.manifestPath, 'utf8'));
      for (const entry of manifest.entries || []) {
        if (entry?.path && entry.cacheFile && fs.existsSync(this.getAbsolutePath(entry))) {
          this.entries.set(entry.path, entry);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Failed to load timelapse cache manifest:', error.message);
    }
  }

  getAbsolutePath(entry) {
    return path.join(this.cacheDirectory, entry.cacheFile);
  }

  async list() {
    await this.ready;
    return [...this.entries.values()]
      .sort((left, right) => right.modified - left.modified)
      .map(({ cacheFile, ...entry }) => ({ ...entry }));
  }

  async get(filePath) {
    await this.ready;
    const entry = this.entries.get(filePath);
    if (!entry) return null;
    const absolutePath = this.getAbsolutePath(entry);
    if (!fs.existsSync(absolutePath)) {
      this.entries.delete(filePath);
      await this.saveManifest();
      return null;
    }
    return { entry, absolutePath };
  }

  sync(timelapses, download) {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.runSync(timelapses, download)
      .finally(() => { this.syncPromise = null; });
    return this.syncPromise;
  }

  async runSync(timelapses, download) {
    await this.ready;
    for (const timelapse of timelapses) {
      const existing = this.entries.get(timelapse.path);
      if (existing?.size === timelapse.size && existing?.modified === timelapse.modified &&
          fs.existsSync(this.getAbsolutePath(existing))) {
        this.entries.set(timelapse.path, { ...existing, ...timelapse, cacheFile: existing.cacheFile });
        continue;
      }

      const cacheFile = `${crypto.createHash('sha256')
        .update(`${timelapse.path}:${timelapse.modified}`)
        .digest('hex')}.mp4`;
      const destination = path.join(this.cacheDirectory, cacheFile);
      const temporary = `${destination}.partial`;
      try {
        const stream = await download(timelapse);
        await pipeline(stream, fs.createWriteStream(temporary));
        const stats = await fs.promises.stat(temporary);
        if (stats.size !== timelapse.size) {
          throw new Error(`Expected ${timelapse.size} bytes, received ${stats.size}`);
        }
        await fs.promises.rename(temporary, destination);
        this.entries.set(timelapse.path, { ...timelapse, cacheFile });
        await this.saveManifest();
        if (existing?.cacheFile && existing.cacheFile !== cacheFile) {
          await fs.promises.rm(this.getAbsolutePath(existing), { force: true });
        }
      } catch (error) {
        await fs.promises.rm(temporary, { force: true });
        console.warn(`Failed to cache timelapse ${timelapse.path}:`, error.message);
      }
    }
    await this.saveManifest();
  }

  async saveManifest() {
    const temporary = `${this.manifestPath}.partial`;
    const manifest = JSON.stringify({ version: 1, entries: [...this.entries.values()] }, null, 2);
    await fs.promises.writeFile(temporary, manifest);
    await fs.promises.rename(temporary, this.manifestPath);
  }
}

module.exports = TimelapseCache;