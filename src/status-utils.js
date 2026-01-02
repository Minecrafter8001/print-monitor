const {
  MACHINE_STATUS,
  MACHINE_STATUS_LABELS,
} = require('../utils/status-codes');

function mapStatusIntToLabel(statusInt) {
  if ([18, 19, 21].includes(statusInt)) return 'LOADING';
  if (statusInt === MACHINE_STATUS.PRINTING_RECOVERY) return 'PRINTING';
  if (MACHINE_STATUS_LABELS[statusInt]) return MACHINE_STATUS_LABELS[statusInt];
  return null;
}

function parseStatusPayload(data) {
  const statusBlock = data?.Status || {};
  let currentStatus = statusBlock.CurrentStatus;
  if (typeof currentStatus === 'number') currentStatus = [currentStatus];
  let statusCode = Array.isArray(currentStatus) && currentStatus.length ? currentStatus[0] : null;
  let status = mapStatusIntToLabel(statusCode) || 'UNKNOWN';

  const jobStatusCode = statusBlock.PrintInfo?.Status ?? null;
  if (jobStatusCode === 13) {
    status = 'PRINTING';
    statusCode = 13;
  }

  return { status, status_code: statusCode };
}

module.exports = {
  mapStatusIntToLabel,
  parseStatusPayload
};
