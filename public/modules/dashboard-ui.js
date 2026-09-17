(function initializeDashboardUI(global) {
    const STATUS_COLORS = {
        ready: '#27ae60',
        startup: '#f39c12',
        shutdown: '#e74c3c',
        error: '#e74c3c',
        disconnected: '#888',
        standby: '#444',
        printing: '#3498db',
        paused: '#e67e22',
        complete: '#27ae60',
        cancelled: '#e74c3c'
    };

    function createDashboardRenderer({ cameraPlayer, formatters }) {
        const { formatClockTime, formatDuration, getStableEtaTimestamp } = formatters;

        function getToolheadIndex(tool) {
            const suffix = tool?.name?.match(/^extruder(\d*)$/)?.[1];
            if (suffix !== undefined) return suffix === '' ? 0 : Number.parseInt(suffix, 10);

            const friendlyNumber = tool?.friendlyName?.match(/(\d+)$/)?.[1];
            return friendlyNumber ? Number.parseInt(friendlyNumber, 10) - 1 : -1;
        }

        function updateToolheadTiles(tools = []) {
            const toolsByIndex = new Map(tools.map(tool => [getToolheadIndex(tool), tool]));

            for (let index = 0; index < 4; index += 1) {
                const tile = document.getElementById(`toolhead${index}`);
                const tool = toolsByIndex.get(index);
                const isActive = tool?.active === true;
                const filament = tool?.filament || {};
                const swatch = tile.querySelector('.filament-swatch');

                tile.querySelector('.tool-current').textContent = Math.round(tool?.current || 0);
                tile.querySelector('.tool-target').textContent = Math.round(tool?.target || 0);
                tile.querySelector('.filament-material').textContent = filament.material || 'Unknown';
                swatch.style.backgroundColor = filament.color || 'transparent';
                swatch.classList.toggle('unknown', !filament.color);
                tile.classList.toggle('filament-empty', filament.loaded === false);
                tile.classList.toggle('active', isActive);
                tile.setAttribute('aria-current', isActive ? 'true' : 'false');
            }
        }

        function update(payload) {
            const printer = payload?.printer || {};
            const users = payload?.users || {};
            const statusIndicator = document.getElementById('connectionStatus');
            const connectionText = document.getElementById('connectionText');

            document.getElementById('currentTime').textContent = formatClockTime(new Date());
            statusIndicator.classList.toggle('connected', Boolean(printer.connected));
            connectionText.textContent = printer.connected ? 'Connected' : 'Disconnected';

            const uniqueUsers = users.activeUniqueWebIPs || 0;
            document.getElementById('userCount').textContent =
                `${uniqueUsers} user${uniqueUsers === 1 ? '' : 's'} online`;
            document.getElementById('printerName').textContent = printer.name || '-';

            const klipperState = printer.klipper?.state || 'disconnected';
            const klipperStateElement = document.getElementById('klipperState');
            klipperStateElement.textContent = klipperState.toUpperCase();
            klipperStateElement.className = 'value state';
            klipperStateElement.style.background = STATUS_COLORS[klipperState] || '#888';
            klipperStateElement.style.color = '#fff';

            const printState = printer.print?.state || 'standby';
            const printStateElement = document.getElementById('printState');
            printStateElement.textContent = printState.toUpperCase();
            printStateElement.className = 'value state';
            printStateElement.style.background = STATUS_COLORS[printState] || '#888';
            printStateElement.style.color = '#fff';

            document.getElementById('currentFile').textContent = printer.print?.filename || '-';
            document.getElementById('lastUpdate').textContent =
                printer.updatedAt ? formatClockTime(new Date(printer.updatedAt)) : '-';

            const progress = printer.print?.progressPercent || 0;
            document.getElementById('progressFill').style.width = `${progress.toFixed(0)}%`;
            document.getElementById('progressText').textContent = `${progress.toFixed(0)}%`;
            document.getElementById('printTime').textContent = formatDuration(printer.print?.elapsedSeconds);
            document.getElementById('remainingTime').textContent =
                formatDuration(printer.print?.estimatedRemainingSeconds);

            const etaTimestamp = getStableEtaTimestamp(printer);
            document.getElementById('ReportedETA').textContent = Number.isFinite(etaTimestamp)
                ? formatClockTime(new Date(etaTimestamp))
                : '-';

            const layers = printer.print?.layers || { current: 0, total: 0 };
            const completedLayers = layers.current || 0;
            const totalLayers = layers.total || 0;
            const remainingLayers = totalLayers > 0 ? Math.max(0, totalLayers - completedLayers) : 0;
            document.getElementById('completedLayers').textContent = completedLayers;
            document.getElementById('totalLayers').textContent = totalLayers;
            document.getElementById('remainingLayers').textContent = remainingLayers;

            const temperatures = printer.temperatures || { bed: {}, enclosure: {} };
            updateToolheadTiles(temperatures.tools || []);
            document.getElementById('bedTemp').textContent = Math.round(temperatures.bed.current || 0);
            document.getElementById('bedTarget').textContent = Math.round(temperatures.bed.target || 0);
            document.getElementById('enclosureTemp').textContent = Math.round(temperatures.enclosure.current || 0);
            document.getElementById('enclosureTarget').textContent = Math.round(temperatures.enclosure.target || 0);

            cameraPlayer.update(
                document.getElementById('cameraVideo'),
                document.getElementById('cameraPlaceholder'),
                printer.camera
            );
        }

        return { update };
    }

    global.createDashboardRenderer = createDashboardRenderer;
})(window);