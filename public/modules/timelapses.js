(function initializeTimelapses(global) {
    const DOWNLOAD_CHUNK_SIZE = 16 * 1024 * 1024;

    function createTimelapseController({ formatFileSize, showToast }) {
        function formatStatus(status) {
            if (!status) return 'Status unknown';
            return status
                .replaceAll('_', ' ')
                .replace(/\b\w/g, character => character.toUpperCase());
        }

        function formatCompactDuration(seconds) {
            if (!Number.isFinite(seconds) || seconds <= 0) return '-';
            if (seconds < 10) return `${seconds.toFixed(1)}s`;

            const totalSeconds = Math.round(seconds);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const remainingSeconds = totalSeconds % 60;
            return [
                hours ? `${hours}h` : null,
                minutes ? `${minutes}m` : null,
                remainingSeconds || (!hours && !minutes) ? `${remainingSeconds}s` : null
            ].filter(Boolean).join(' ');
        }

        async function download(timelapse, button) {
            if (!Number.isFinite(timelapse.size) || timelapse.size <= 0) {
                throw new Error('Timelapse size is unavailable');
            }

            button.disabled = true;
            const chunks = [];

            try {
                for (let start = 0; start < timelapse.size; start += DOWNLOAD_CHUNK_SIZE) {
                    const end = Math.min(start + DOWNLOAD_CHUNK_SIZE, timelapse.size) - 1;
                    const response = await fetch(timelapse.downloadUrl, {
                        headers: { Range: `bytes=${start}-${end}` }
                    });
                    if (response.status !== 206) {
                        throw new Error(`Chunk request failed with status ${response.status}`);
                    }

                    const chunk = await response.blob();
                    if (chunk.size !== end - start + 1) {
                        throw new Error('Downloaded chunk size did not match the requested range');
                    }
                    chunks.push(chunk);
                    button.textContent = `${Math.round(((end + 1) / timelapse.size) * 100)}%`;
                }

                const objectUrl = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
                const anchor = document.createElement('a');
                anchor.href = objectUrl;
                anchor.download = timelapse.name;
                anchor.click();
                URL.revokeObjectURL(objectUrl);
            } finally {
                button.disabled = false;
                button.textContent = 'Download';
            }
        }

        function render(timelapses) {
            const list = document.getElementById('timelapseList');
            const state = document.getElementById('timelapseState');
            list.replaceChildren();

            if (!timelapses.length) {
                state.textContent = 'No completed timelapses found.';
                state.classList.remove('hidden');
                return;
            }

            state.classList.add('hidden');
            timelapses.forEach(timelapse => {
                const row = document.createElement('div');
                row.className = 'timelapse-row';

                const details = document.createElement('div');
                details.className = 'timelapse-details';
                const name = document.createElement('div');
                name.className = 'timelapse-name';
                name.textContent = timelapse.name;
                const metadata = document.createElement('div');
                metadata.className = 'timelapse-metadata';
                const modified = new Date(timelapse.modified * 1000);
                metadata.textContent = `${modified.toLocaleString()} · ${formatFileSize(timelapse.size)}`;
                const summary = document.createElement('div');
                summary.className = 'timelapse-summary';
                summary.textContent = `${formatStatus(timelapse.printStatus)} · ` +
                    `Print: ${formatCompactDuration(timelapse.printDurationSeconds)} · ` +
                    `Timelapse: ${formatCompactDuration(timelapse.timelapseDurationSeconds)}`;
                details.append(name, metadata, summary);

                const downloadButton = document.createElement('button');
                downloadButton.className = 'download-button';
                downloadButton.type = 'button';
                downloadButton.textContent = 'Download';
                downloadButton.addEventListener('click', async () => {
                    try {
                        await download(timelapse, downloadButton);
                    } catch (error) {
                        console.error('Failed to download timelapse:', error);
                        showToast({
                            title: 'Download failed',
                            body: timelapse.name,
                            hint: 'Try again in a moment.'
                        });
                    }
                });

                row.append(details, downloadButton);
                list.appendChild(row);
            });
        }

        async function load() {
            const state = document.getElementById('timelapseState');
            const list = document.getElementById('timelapseList');
            state.textContent = 'Loading timelapses...';
            state.classList.remove('hidden');
            list.replaceChildren();

            try {
                const response = await fetch('/api/timelapses');
                if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
                const payload = await response.json();
                render(payload.timelapses || []);
            } catch (error) {
                console.error('Failed to load timelapses:', error);
                state.textContent = 'Timelapses could not be loaded.';
            }
        }

        function open() {
            const backdrop = document.getElementById('menuBackdrop');
            backdrop.classList.remove('hidden');
            document.body.classList.add('menu-open');
            document.getElementById('closeMenu').focus();
            load();
        }

        function close() {
            document.getElementById('menuBackdrop').classList.add('hidden');
            document.body.classList.remove('menu-open');
            document.getElementById('menuButton').focus();
        }

        function initialize() {
            document.getElementById('menuButton').addEventListener('click', open);
            document.getElementById('closeMenu').addEventListener('click', close);
            document.getElementById('refreshTimelapses').addEventListener('click', load);
            document.getElementById('menuBackdrop').addEventListener('click', event => {
                if (event.target === event.currentTarget) close();
            });
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape' && !document.getElementById('menuBackdrop').classList.contains('hidden')) {
                    close();
                }
            });
        }

        return { close, download, formatCompactDuration, initialize, load, open, render };
    }

    global.PrintMonitorTimelapses = { DOWNLOAD_CHUNK_SIZE, createTimelapseController };
})(window);