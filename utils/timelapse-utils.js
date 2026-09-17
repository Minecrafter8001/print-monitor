const TIMELAPSE_EXTENSION = /\.mp4$/i;

function isSafeTimelapsePath(filePath) {
  if (typeof filePath !== 'string' || !TIMELAPSE_EXTENSION.test(filePath)) return false;
  if (filePath.includes('\\')) return false;

  const segments = filePath.split('/');
  return segments.every(segment => segment && segment !== '.' && segment !== '..');
}

function buildTimelapseList(files) {
  return files
    .filter(file => isSafeTimelapsePath(file.path))
    .sort((left, right) => right.modified - left.modified)
    .map(file => ({
      name: file.path.split('/').pop(),
      path: file.path,
      modified: file.modified,
      size: file.size,
      downloadUrl: `/api/timelapses/download?file=${encodeURIComponent(file.path)}`
    }));
}

function encodeMoonrakerFilePath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

module.exports = { buildTimelapseList, encodeMoonrakerFilePath, isSafeTimelapsePath };