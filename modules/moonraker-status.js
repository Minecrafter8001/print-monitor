function getToolFriendlyName(objectName) {
  const suffix = objectName.match(/^extruder(\d*)$/)?.[1];
  const nozzleIndex = suffix === '' ? 0 : Number.parseInt(suffix, 10);
  return `Toolhead ${nozzleIndex + 1}`;
}

function normalizeFilamentColor(value) {
  if (typeof value === 'string') {
    const hex = value.replace(/^#/, '').slice(0, 6);
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
  }
  if (Number.isFinite(value)) {
    return `#${(value & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
  }
  return null;
}

function getFilamentDetails(objects, toolIndex) {
  const sensor = objects[`filament_motion_sensor e${toolIndex}_filament`] ||
    objects[`filament_switch_sensor e${toolIndex}_filament`];
  const loaded = typeof sensor?.filament_detected === 'boolean' ? sensor.filament_detected : null;
  const taskConfig = objects.print_task_config || {};
  const taskType = taskConfig.filament_type?.[toolIndex];
  const taskSubtype = taskConfig.filament_sub_type?.[toolIndex];
  const taskMaterial = taskType && taskType !== 'NONE' ? taskType : taskSubtype;
  const taskColor = normalizeFilamentColor(
    taskConfig.filament_color_rgba?.[toolIndex] ?? taskConfig.filament_color?.[toolIndex]
  );

  if ((taskMaterial && taskMaterial !== 'NONE') || taskColor) {
    return {
      material: taskMaterial && taskMaterial !== 'NONE' ? taskMaterial : null,
      color: taskColor,
      source: 'printer',
      loaded
    };
  }

  const rfid = objects.filament_detect?.info?.[toolIndex];
  const rfidMaterial = rfid?.MAIN_TYPE && rfid.MAIN_TYPE !== 'NONE' ? rfid.MAIN_TYPE : rfid?.SUB_TYPE;

  if (rfidMaterial && rfidMaterial !== 'NONE') {
    return {
      material: rfidMaterial,
      color: normalizeFilamentColor(Number(rfid.RGB_1 ?? rfid.ARGB_COLOR)),
      source: 'rfid',
      loaded
    };
  }

  return {
    material: null,
    color: null,
    source: null,
    loaded
  };
}

function mapMoonrakerStatus(objects, metadata = {}) {
  const webhooks = objects.webhooks || {};
  const printStats = objects.print_stats || {};
  const printInfo = printStats.info || {};
  const virtualSD = objects.virtual_sdcard || {};
  const toolhead = objects.toolhead || {};
  const heaterBed = objects.heater_bed || {};
  const toolEntries = Object.entries(objects)
    .filter(([name]) => /^extruder\d*$/.test(name))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  const hasActivePinState = toolEntries.some(([, tool]) => typeof tool.active_pin === 'boolean');
  const activeToolEntry = hasActivePinState
    ? toolEntries.find(([, tool]) => tool.active_pin === true)
    : toolEntries.find(([name]) => name === toolhead.extruder);
  const enclosureEntry = Object.entries(objects).find(([name]) =>
    /^temperature_sensor /.test(name) && /(cavity|chamber|enclosure)/i.test(name)
  );
  const enclosure = enclosureEntry?.[1] || {};
  const printTime = Math.max(0, Math.floor(printStats.print_duration || 0));
  const estimatedTime = Number(metadata.estimated_time) || 0;

  return {
    connected: webhooks.state === 'ready',
    klipper: {
      state: webhooks.state || 'disconnected',
      message: webhooks.state_message || ''
    },
    print: {
      state: printStats.state || 'standby',
      filename: printStats.filename || '',
      progressPercent: Math.max(0, Math.min(100, (virtualSD.progress || 0) * 100)),
      elapsedSeconds: printTime,
      estimatedRemainingSeconds: estimatedTime > 0
        ? Math.max(0, Math.floor(estimatedTime - printTime))
        : null,
      layers: {
        current: printInfo.current_layer || 0,
        total: printInfo.total_layer || metadata.layer_count || 0
      }
    },
    temperatures: {
      bed: {
        current: Math.round(heaterBed.temperature || 0),
        target: Math.round(heaterBed.target || 0)
      },
      activeTool: activeToolEntry ? {
        name: activeToolEntry[0],
        friendlyName: getToolFriendlyName(activeToolEntry[0]),
        current: Math.round(activeToolEntry[1].temperature || 0),
        target: Math.round(activeToolEntry[1].target || 0)
      } : null,
      enclosure: {
        name: enclosureEntry?.[0] || null,
        current: Math.round(enclosure.temperature || 0),
        target: 0
      },
      tools: toolEntries.map(([name, tool], index) => ({
        name,
        friendlyName: getToolFriendlyName(name),
        current: Math.round(tool.temperature || 0),
        target: Math.round(tool.target || 0),
        active: name === activeToolEntry?.[0],
        filament: getFilamentDetails(objects, index)
      }))
    },
    updatedAt: new Date().toISOString()
  };
}

module.exports = { getFilamentDetails, getToolFriendlyName, mapMoonrakerStatus };