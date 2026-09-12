const { getToolFriendlyName, mapMoonrakerStatus } = require('utils/moonraker-status');

describe('mapMoonrakerStatus', () => {
  test('maps a printing status to the Moonraker browser contract', () => {
    const result = mapMoonrakerStatus({
      webhooks: { state: 'ready' },
      print_stats: {
        state: 'printing',
        filename: 'part.gcode',
        print_duration: 120,
        info: { current_layer: 4, total_layer: 20 }
      },
      virtual_sdcard: { progress: 0.25 },
      toolhead: { extruder: 'extruder1' },
      extruder: { temperature: 32, target: 0, active_pin: false },
      extruder1: { temperature: 204.6, target: 210, active_pin: true },
      heater_bed: { temperature: 59.7, target: 60 }
    }, { estimated_time: 600 });

    expect(result).toMatchObject({
      connected: true,
      klipper: { state: 'ready', message: '' },
      print: {
        state: 'printing',
        filename: 'part.gcode',
        progressPercent: 25,
        elapsedSeconds: 120,
        estimatedRemainingSeconds: 480,
        layers: { current: 4, total: 20 }
      },
      temperatures: {
        activeTool: {
          name: 'extruder1',
          friendlyName: 'Toolhead 2',
          current: 205,
          target: 210
        },
        bed: { current: 60, target: 60 },
        tools: [
          { name: 'extruder', friendlyName: 'Toolhead 1', current: 32, target: 0, active: false },
          { name: 'extruder1', friendlyName: 'Toolhead 2', current: 205, target: 210, active: true }
        ]
      }
    });
  });

  test('reports a non-ready Klipper instance as disconnected', () => {
    const result = mapMoonrakerStatus({
      webhooks: { state: 'shutdown' },
      print_stats: { state: 'standby' }
    });

    expect(result.connected).toBe(false);
    expect(result.klipper.state).toBe('shutdown');
    expect(result.print.state).toBe('standby');
  });

  test('detects Snapmaker cavity sensor and active_pin tool', () => {
    const result = mapMoonrakerStatus({
      webhooks: { state: 'ready' },
      toolhead: { extruder: 'extruder1' },
      extruder1: { temperature: 212, target: 70, active_pin: false },
      extruder3: { temperature: 220, target: 220, active_pin: true },
      'temperature_sensor cavity': { temperature: 35 }
    });

    expect(result.temperatures.activeTool).toEqual({
      name: 'extruder3',
      friendlyName: 'Toolhead 4',
      current: 220,
      target: 220
    });
    expect(result.temperatures.enclosure).toEqual({
      name: 'temperature_sensor cavity',
      current: 35,
      target: 0
    });
  });

  test('numbers Klipper extruders as one-based toolheads', () => {
    expect(getToolFriendlyName('extruder')).toBe('Toolhead 1');
    expect(getToolFriendlyName('extruder1')).toBe('Toolhead 2');
    expect(getToolFriendlyName('extruder3')).toBe('Toolhead 4');
  });
});