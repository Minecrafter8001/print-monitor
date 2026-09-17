const TIMELAPSE_EXTENSION = /\.mp4$/i;
const TIMELAPSE_SUFFIX = /_\d{14}\.mp4$/i;
const HISTORY_MATCH_WINDOW_SECONDS = 15 * 60;

function isSafeTimelapsePath(filePath) {
  if (typeof filePath !== 'string' || !TIMELAPSE_EXTENSION.test(filePath)) return false;
  if (filePath.includes('\\')) return false;

  const segments = filePath.split('/');
  return segments.every(segment => segment && segment !== '.' && segment !== '..');
}

function getPrintName(filePath) {
  return filePath.split('/').pop().replace(TIMELAPSE_SUFFIX, '');
}

function findMatchingJob(file, jobs) {
  const printName = getPrintName(file.path);
  return jobs
    .filter(job => job.filename?.split('/').pop().replace(/\.gcode$/i, '') === printName)
    .map(job => ({ job, distance: Math.abs(file.modified - job.end_time) }))
    .filter(match => Number.isFinite(match.distance) && match.distance <= HISTORY_MATCH_WINDOW_SECONDS)
    .sort((left, right) => left.distance - right.distance)[0]?.job || null;
}

function buildTimelapseList(files, jobs = []) {
  return files
    .filter(file => isSafeTimelapsePath(file.path))
    .sort((left, right) => right.modified - left.modified)
    .map(file => {
      const job = findMatchingJob(file, jobs);
      return {
        name: file.path.split('/').pop(),
        path: file.path,
        modified: file.modified,
        size: file.size,
        printStatus: job?.status || null,
        printDurationSeconds: Number.isFinite(job?.print_duration) ? job.print_duration : null,
        timelapseDurationSeconds: null,
        downloadUrl: `/api/timelapses/download?file=${encodeURIComponent(file.path)}`
      };
    });
}

function encodeMoonrakerFilePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function parseMp4Duration(buffer) {
  const marker = Buffer.from('mvhd');
  const markerOffset = buffer.indexOf(marker);
  if (markerOffset < 4 || markerOffset + 24 > buffer.length) return null;

  const version = buffer[markerOffset + 4];
  const timescaleOffset = markerOffset + (version === 1 ? 24 : 16);
  const durationOffset = markerOffset + (version === 1 ? 28 : 20);
  if (durationOffset + (version === 1 ? 8 : 4) > buffer.length) return null;

  const timescale = buffer.readUInt32BE(timescaleOffset);
  const duration = version === 1
    ? Number(buffer.readBigUInt64BE(durationOffset))
    : buffer.readUInt32BE(durationOffset);
  return timescale > 0 && Number.isFinite(duration) ? duration / timescale : null;
}

module.exports = {
  buildTimelapseList,
  encodeMoonrakerFilePath,
  findMatchingJob,
  isSafeTimelapsePath,
  parseMp4Duration
};