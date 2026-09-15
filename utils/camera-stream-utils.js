function detectCameraMode(configuredMode, contentType, url) {
  if (configuredMode !== 'auto') return configuredMode === 'raw' ? 'h264' : configuredMode;
  const source = `${contentType} ${url}`.toLowerCase();
  if (/mpegurl|\.m3u8(?:$|\?)/.test(source)) return 'hls';
  if (/dash\+xml|\.mpd(?:$|\?)/.test(source)) return 'dash';
  if (/h265|hevc|\.h265(?:$|\?)|\.hevc(?:$|\?)/.test(source)) return 'h265';
  if (/h264|\.h264(?:$|\?)|\.264(?:$|\?)/.test(source)) return 'h264';
  if (/^video\//i.test(contentType)) return 'video';
  return configuredMode;
}

module.exports = {
  detectCameraMode
};