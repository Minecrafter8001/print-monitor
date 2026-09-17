(function initializeCameraPlayer(global) {
    const CAMERA_MIME_TYPE = 'video/mp4; codecs="avc1.640028"';
    const CAMERA_MAX_BUFFER_SECONDS = 6;
    const CAMERA_LIVE_EDGE_DELAY_SECONDS = 0.5;

    function createCameraPlayer() {
        let initialized = false;
        let restartTimer = null;
        let streamAbortController = null;
        let objectURL = null;
        let playbackGeneration = 0;

        function stop(cameraVideo) {
            const hadSource = cameraVideo.hasAttribute('src');
            playbackGeneration += 1;
            if (restartTimer) clearTimeout(restartTimer);
            restartTimer = null;
            streamAbortController?.abort();
            streamAbortController = null;
            cameraVideo.removeAttribute('src');
            if (hadSource) cameraVideo.load?.();
            if (objectURL) URL.revokeObjectURL(objectURL);
            objectURL = null;
        }

        function scheduleRestart(cameraVideo, intervalSeconds) {
            if (!intervalSeconds) return;
            const delay = Math.max(1000, intervalSeconds * 1000 - 1000);
            restartTimer = setTimeout(() => {
                start(cameraVideo, true);
                scheduleRestart(cameraVideo, intervalSeconds);
            }, delay);
        }

        function waitForSourceBuffer(sourceBuffer, operation) {
            return new Promise((resolve, reject) => {
                const cleanup = () => {
                    sourceBuffer.removeEventListener('updateend', handleUpdateEnd);
                    sourceBuffer.removeEventListener('error', handleError);
                };
                const handleUpdateEnd = () => {
                    cleanup();
                    resolve();
                };
                const handleError = () => {
                    cleanup();
                    reject(new Error('Camera media buffer failed'));
                };
                sourceBuffer.addEventListener('updateend', handleUpdateEnd, { once: true });
                sourceBuffer.addEventListener('error', handleError, { once: true });
                operation();
            });
        }

        async function startMediaSource(cameraVideo, streamURL, generation) {
            const mediaSource = new MediaSource();
            objectURL = URL.createObjectURL(mediaSource);
            cameraVideo.src = objectURL;

            await new Promise((resolve, reject) => {
                mediaSource.addEventListener('sourceopen', resolve, { once: true });
                mediaSource.addEventListener('error', reject, { once: true });
            });
            if (generation !== playbackGeneration) return;

            const sourceBuffer = mediaSource.addSourceBuffer(CAMERA_MIME_TYPE);
            const abortController = new AbortController();
            streamAbortController = abortController;
            const response = await fetch(streamURL, { cache: 'no-store', signal: abortController.signal });
            if (!response.ok || !response.body) throw new Error(`Camera stream error ${response.status}`);

            const reader = response.body.getReader();
            while (generation === playbackGeneration) {
                const { done, value } = await reader.read();
                if (done) break;
                await waitForSourceBuffer(sourceBuffer, () => sourceBuffer.appendBuffer(value));

                if (sourceBuffer.buffered.length) {
                    const bufferStart = sourceBuffer.buffered.start(0);
                    const bufferEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
                    if (bufferEnd - bufferStart > CAMERA_MAX_BUFFER_SECONDS) {
                        await waitForSourceBuffer(sourceBuffer, () => {
                            sourceBuffer.remove(bufferStart, bufferEnd - CAMERA_MAX_BUFFER_SECONDS);
                        });
                    }
                    if (cameraVideo.currentTime < bufferEnd - 2) {
                        cameraVideo.currentTime = Math.max(bufferStart, bufferEnd - CAMERA_LIVE_EDGE_DELAY_SECONDS);
                    }
                    cameraVideo.play?.().catch(() => {});
                }
            }

            if (generation === playbackGeneration) throw new Error('Camera stream ended');
        }

        function start(cameraVideo, restarting = false) {
            stop(cameraVideo);
            const streamURL = restarting
                ? `/api/camera/video?restart=${Date.now()}`
                : '/api/camera/video';
            const generation = playbackGeneration;
            const supportsMediaSource = typeof MediaSource !== 'undefined' &&
                typeof fetch === 'function' && MediaSource.isTypeSupported?.(CAMERA_MIME_TYPE);

            if (!supportsMediaSource) {
                cameraVideo.src = streamURL;
                return;
            }

            startMediaSource(cameraVideo, streamURL, generation).catch(error => {
                if (error.name !== 'AbortError' && generation === playbackGeneration) {
                    console.error('Camera stream playback failed:', error);
                    setTimeout(() => {
                        if (generation === playbackGeneration && initialized) start(cameraVideo, true);
                    }, 1000);
                }
            });
        }

        function update(cameraVideo, placeholder, cameraStatus = {}) {
            const placeholderLabel = placeholder.querySelector('span') || placeholder;
            if (cameraStatus.available) {
                if (!initialized) {
                    start(cameraVideo);
                    scheduleRestart(cameraVideo, cameraStatus.restartIntervalSeconds);
                    initialized = true;
                }
                cameraVideo.style.display = 'block';
                placeholder.style.display = 'none';
                return;
            }

            cameraVideo.style.display = 'none';
            stop(cameraVideo);
            placeholder.style.display = 'flex';
            initialized = false;
            placeholderLabel.textContent = cameraStatus.error || 'No camera feed available';
        }

        return { start, stop, update };
    }

    global.createCameraPlayer = createCameraPlayer;
})(window);