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

function isManifestType(contentType, url) {
  return /(?:mpegurl|dash\+xml)/i.test(contentType) || /\.(?:m3u8|mpd)(?:$|\?)/i.test(url);
}

function cameraProxyURL(resource, baseURL) {
  const absoluteURL = new URL(resource, baseURL).toString();
  const encodedURL = encodeURIComponent(absoluteURL).replace(/%24/g, '$');
  return `/api/camera/video/resource?url=${encodedURL}`;
}

function rewriteCameraManifest(manifest, manifestURL, contentType) {
  if (/mpegurl|m3u8/i.test(`${contentType} ${manifestURL}`)) {
    return manifest.split('\n').map((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) return cameraProxyURL(trimmed, manifestURL);
      return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${cameraProxyURL(uri, manifestURL)}"`);
    }).join('\n');
  }

  const baseURLMatch = manifest.match(/<BaseURL>([^<]+)<\/BaseURL>/i);
  const resourceBaseURL = baseURLMatch ? new URL(baseURLMatch[1].trim(), manifestURL).toString() : manifestURL;
  const hasTemplates = /\b(?:media|initialization)="/i.test(manifest);
  const rewritten = manifest.replace(/\b(media|initialization|sourceURL|href)="([^"]+)"/gi,
    (_, attribute, url) => `${attribute}="${cameraProxyURL(url, resourceBaseURL)}"`);

  return hasTemplates
    ? rewritten.replace(/<BaseURL>[^<]+<\/BaseURL>/gi, '')
    : rewritten.replace(/(<BaseURL>)([^<]+)(<\/BaseURL>)/gi,
      (_, open, url, close) => `${open}${cameraProxyURL(url.trim(), manifestURL)}${close}`);
}

module.exports = {
  detectCameraMode,
  isManifestType,
  rewriteCameraManifest
};