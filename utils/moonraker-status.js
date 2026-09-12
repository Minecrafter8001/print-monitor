function getToolFriendlyName(objectName) {
  const suffix = objectName.match(/^extruder(\d*)$/)?.[1];
  const nozzleIndex = suffix === '' ? 0 : Number.parseInt(suffix, 10);
  return `Toolhead ${nozzleIndex + 1}`;
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
  const activeToolEntry = toolEntries.find(([, tool]) => tool.active_pin === true) ||
    toolEntries.find(([name]) => name === toolhead.extruder) ||
    toolEntries[0] ||
    ['extruder', {}];
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
      activeTool: {
        name: activeToolEntry[0],
        friendlyName: getToolFriendlyName(activeToolEntry[0]),
        current: Math.round(activeToolEntry[1].temperature || 0),
        target: Math.round(activeToolEntry[1].target || 0)
      },
      enclosure: {
        name: enclosureEntry?.[0] || null,
        current: Math.round(enclosure.temperature || 0),
        target: 0
      },
      tools: toolEntries.map(([name, tool]) => ({
        name,
        friendlyName: getToolFriendlyName(name),
        current: Math.round(tool.temperature || 0),
        target: Math.round(tool.target || 0),
        active: name === activeToolEntry[0]
      }))
    },
    updatedAt: new Date().toISOString()
  };
}

module.exports = { getToolFriendlyName, mapMoonrakerStatus };