function stamp(level, args) {
  const ts = new Date().toISOString();
  return [`[${ts}] [${level}]`, ...args];
}

const logger = {
  info: (...args) => console.log(...stamp('INFO', args)),
  warn: (...args) => console.warn(...stamp('WARN', args)),
  error: (...args) => console.error(...stamp('ERROR', args)),
};

// Patch console to ensure global usage is timestamped
console.log = logger.info;
console.warn = logger.warn;
console.error = logger.error;

module.exports = logger;
