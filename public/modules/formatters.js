(function initializeFormatters(global) {
    const ETA_UPDATE_THRESHOLD_MS = 60000;
    let etaEstimate = { filename: null, state: null, timestamp: null };

    function formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '-';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function formatClockTime(date) {
        if (!(date instanceof Date) || isNaN(date)) return '-';
        return date.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    }

    function getStableEtaTimestamp(printer) {
        const print = printer.print || {};
        const remainingSeconds = print.estimatedRemainingSeconds;
        const canEstimate = Number.isFinite(remainingSeconds) && remainingSeconds > 0;
        const isActive = print.state === 'printing' || print.state === 'paused';

        if (!canEstimate || !isActive) {
            etaEstimate = { filename: null, state: print.state || null, timestamp: null };
            return null;
        }

        const updatedAt = printer.updatedAt ? new Date(printer.updatedAt).getTime() : Date.now();
        const candidate = updatedAt + remainingSeconds * 1000;
        const printChanged = etaEstimate.filename !== (print.filename || null);
        const stateChanged = etaEstimate.state !== print.state;
        const estimateChanged = !Number.isFinite(etaEstimate.timestamp) ||
            Math.abs(candidate - etaEstimate.timestamp) >= ETA_UPDATE_THRESHOLD_MS;

        if (printChanged || stateChanged || estimateChanged) {
            etaEstimate = {
                filename: print.filename || null,
                state: print.state,
                timestamp: candidate
            };
        }

        return etaEstimate.timestamp;
    }

    function resetEtaEstimate() {
        etaEstimate = { filename: null, state: null, timestamp: null };
    }

    function formatFileSize(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return '-';
        if (bytes < 1024) return `${bytes} B`;

        const units = ['KB', 'MB', 'GB'];
        let value = bytes / 1024;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }
        return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
    }

    global.PrintMonitorFormatters = {
        formatClockTime,
        formatDuration,
        formatFileSize,
        getStableEtaTimestamp,
        resetEtaEstimate
    };
})(window);