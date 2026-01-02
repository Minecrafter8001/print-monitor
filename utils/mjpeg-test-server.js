const express = require('express');
const Jimp = require('jimp');

const app = express();
const PORT = process.env.TEST_MJPEG_PORT || 4000;
const boundary = 'frame';

let latestFrame = null;

async function generateFrame() {
  const image = new Jimp(320, 240, '#000000');
  const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  const now = new Date().toISOString();
  image.print(font, 10, 10, `Time: ${now}`);
  image.print(font, 10, 40, `Rand: ${Math.random().toFixed(6)}`);
  latestFrame = await image.getBufferAsync(Jimp.MIME_JPEG);
}

async function startGenerator() {
  await generateFrame();
  setInterval(generateFrame, 500);
}

app.get('/mjpeg', (req, res) => {
  res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${boundary}`);
  res.write(`--${boundary}\r\n`);

  const sendFrame = () => {
    if (!latestFrame) return;
    res.write(`Content-Type: image/jpeg\r\n`);
    res.write(`Content-Length: ${latestFrame.length}\r\n\r\n`);
    res.write(latestFrame);
    res.write(`\r\n--${boundary}\r\n`);
  };

  const interval = setInterval(sendFrame, 200);
  sendFrame();

  const cleanup = () => {
    clearInterval(interval);
    try {
      res.end();
    } catch (_) {}
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

startGenerator().then(() => {
  app.listen(PORT, () => {
    console.log(`MJPEG test server running at http://localhost:${PORT}/mjpeg`);
  });
});
