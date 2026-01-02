const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

/**
 * Spawn an ffmpeg process that converts an MJPEG stream to H.264 (MP4 container).
 * Returns { proc, onClose } where proc.stdout is the video stream.
 */
function startH264Transcode(sourceUrl) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not found');
  }

  const args = [
    '-loglevel', 'error',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-i', sourceUrl,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'
  ];

  const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return proc;
}

module.exports = {
  startH264Transcode
};
