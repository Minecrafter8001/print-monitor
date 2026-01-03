const { parseStatusPayload, mapStatusIntToLabel } = require('utils/status-utils');
const { MACHINE_STATUS, JOB_STATUS } = require('utils/status-codes');
const PRINTING_RECOVERY = MACHINE_STATUS.PRINTING_RECOVERY;
const JOB_PRINTING_RECOVERY = JOB_STATUS.PRINTING_RECOVERY;

describe('status-utils', () => {
  describe('mapStatusIntToLabel', () => {
    test('maps recovery printing to PRINTING', () => {
      expect(mapStatusIntToLabel(PRINTING_RECOVERY)).toBe('PRINTING');
    });

    test('returns null for unknown code', () => {
      expect(mapStatusIntToLabel(999)).toBeNull();
    });
  });

  describe('parseStatusPayload', () => {
    const cases = [
      {
        name: 'Machine-level HOMING (array)',
        payload: {
          Status: {
            CurrentStatus: [9],
            PrintInfo: { Status: 0, Progress: 0 }
          }
        },
        expect: { status: 'HOMING', status_code: 9 }
      },
      {
        name: 'Machine-level HOMING (int)',
        payload: {
          Status: {
            CurrentStatus: 9,
            PrintInfo: { Status: 0, Progress: 0 }
          }
        },
        expect: { status: 'HOMING', status_code: 9 }
      },
      {
        name: 'Print-job PREHEATING overrides unknown machine status',
        payload: {
          Status: {
            CurrentStatus: [0],
            PrintInfo: { Status: 16, Progress: 0 }
          }
        },
        expect: { status: 'IDLE', status_code: 0 }
      },
      {
        name: 'Unknown status (missing CurrentStatus)',
        payload: {
          Status: {
            PrintInfo: { Status: 16, Progress: 0 }
          }
        },
        expect: { status: 'UNKNOWN', status_code: null }
      },
      {
        name: 'PrintInfo status PRINTING_RECOVERY forces PRINTING',
        payload: {
          Status: {
            CurrentStatus: [0],
            PrintInfo: { Status: JOB_PRINTING_RECOVERY, Progress: 50 }
          }
        },
        expect: { status: 'PRINTING', status_code: 0 }
      }
    ];

    cases.forEach(({ name, payload, expect: expected }) => {
      test(name, () => {
        const result = parseStatusPayload(payload);
        expect(result.status).toBe(expected.status);
        expect(result.status_code).toBe(expected.status_code);
      });
    });
  });
});
