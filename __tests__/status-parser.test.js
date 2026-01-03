// Unit tests for status parser
const assert = require('assert');
const {
  MACHINE_STATUS_LABELS,
  JOB_STATUS_LABELS
} = require('utils/status-codes');

// Import the parser logic from server.js (simulate here)
function parseStatusPayload(data) {
  const statusBlock = data?.Status || {};
  let currentStatus = statusBlock.CurrentStatus;
  if (typeof currentStatus === 'number') currentStatus = [currentStatus];
  const machineStatusCode = Array.isArray(currentStatus) && currentStatus.length ? currentStatus[0] : null;
  const machineStatus =
    machineStatusCode != null && MACHINE_STATUS_LABELS[machineStatusCode]
      ? MACHINE_STATUS_LABELS[machineStatusCode]
      : 'UNKNOWN';
  const jobStatusCode = statusBlock.PrintInfo?.Status ?? null;
  const jobStatus =
    jobStatusCode != null && JOB_STATUS_LABELS[jobStatusCode] ? JOB_STATUS_LABELS[jobStatusCode] : null;
  return { machine_status: machineStatus, job_status: jobStatus, machine_status_code: machineStatusCode, job_status_code: jobStatusCode };
}

// Test cases
const tests = [
  {
    name: 'Machine-level HOMING (array)',
    payload: {
      Data: {
        Status: {
          CurrentStatus: [9],
          PrintInfo: { Status: 0, Progress: 0 }
        }
      }
    },
    expect: { machine_status: 'HOMING', job_status: 'IDLE' }
  },
  {
    name: 'Machine-level HOMING (int)',
    payload: {
      Data: {
        Status: {
          CurrentStatus: 9,
          PrintInfo: { Status: 0, Progress: 0 }
        }
      }
    },
    expect: { machine_status: 'HOMING', job_status: 'IDLE' }
  },
  {
    name: 'Print-job PREHEATING',
    payload: {
      Data: {
        Status: {
          CurrentStatus: [0],
          PrintInfo: { Status: 16, Progress: 0 }
        }
      }
    },
    expect: { machine_status: 'IDLE', job_status: 'PREHEATING' }
  },
  {
    name: 'Unknown status (empty array)',
    payload: {
      Data: {
        Status: {
          CurrentStatus: [],
          PrintInfo: { Status: 99, Progress: 0 }
        }
      }
    },
    expect: { machine_status: 'UNKNOWN', job_status: null }
  },
  {
    name: 'Unknown status (missing CurrentStatus)',
    payload: {
      Data: {
        Status: {
          PrintInfo: { Status: 16, Progress: 0 }
        }
      }
    },
    expect: { machine_status: 'UNKNOWN', job_status: 'PREHEATING' }
  },
  {
    name: 'Unknown job status',
    payload: {
      Data: {
        Status: {
          CurrentStatus: [1],
          PrintInfo: { Status: 999, Progress: 0 }
        }
      }
    },
    expect: { machine_status: 'PRINTING', job_status: null }
  }
];

tests.forEach(({ name, payload, expect: expectedResults }) => {
  test(name, () => {
    const { machine_status, job_status } = parseStatusPayload(payload.Data);
    expect(machine_status).toBe(expectedResults.machine_status);
    expect(job_status).toBe(expectedResults.job_status);
  });
});

describe('parseStatusPayload', () => {
  tests.forEach(({ name, payload, expect: expectedResults }) => {
    test(name, () => {
      const { machine_status, job_status } = parseStatusPayload(payload.Data);
      expect(machine_status).toBe(expectedResults.machine_status);
      expect(job_status).toBe(expectedResults.job_status);
    });
  });
});
