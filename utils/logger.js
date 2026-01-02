const orig = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

function stamp(level, args) {
  const ts = new Date().toISOString();
  return [`[${ts}] [${level}]`, ...args];
}

const logger = {
  info: (...args) => orig.log(...stamp('INFO', args)),
  warn: (...args) => orig.warn(...stamp('WARN', args)),
  error: (...args) => orig.error(...stamp('ERROR', args)),
};

// Patch console to ensure global usage is timestamped (idempotent)
console.log = logger.info;
console.warn = logger.warn;
console.error = logger.error;

module.exports = logger;
